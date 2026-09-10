"""Recordings and the Fathom-style AI recap.

Recording start/stop is metadata only — no media file is written. Stopping a
recording is what triggers summarisation: transcript segments are folded into a
summary, sections and action items by `services.summarizer`.

Summarisation does not happen in the request. `POST /recordings/{id}/stop` marks
the recording `processing`, queues the work and returns; the worker in
`services.jobs` generates the recap, flips the status to `ready` and tells the
meeting over its WebSocket.
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db, session_scope
from ..deps import get_current_user, get_optional_user
from ..models import (
    ActionItem,
    ActionItemStatus,
    AdmissionState,
    Highlight,
    Invitee,
    Meeting,
    Participant,
    ParticipantRole,
    Recording,
    RecordingStatus,
    Summary,
    SummarySection,
    TranscriptSegment,
    User,
    utcnow,
)
from ..security import new_share_token
from ..serializers import recording_detail, recording_out, refresh_talk_time
from ..services.jobs import jobs
from ..services.summarizer import summarise
from ..ws.hub import hub

logger = logging.getLogger("zoomeet.recordings")

router = APIRouter(prefix="/api", tags=["recordings"])


def _meeting(db: Session, code: str) -> Meeting:
    meeting = db.scalar(select(Meeting).where(Meeting.code == code))
    if meeting is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Meeting not found")
    return meeting


def _recording(db: Session, recording_id: int) -> Recording:
    recording = db.get(Recording, recording_id)
    if recording is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recording not found")
    return recording


def _assert_can_record(meeting: Meeting, user: User) -> None:
    """Recording is a host control in Zoom, not something any attendee can flip.

    It also has to be *someone in the meeting*: without this, knowing a meeting
    id was enough to start a recording on a stranger's call.
    """
    cohost_ids = {
        p.user_id
        for p in meeting.participants
        if p.role == ParticipantRole.cohost
        and p.admission == AdmissionState.admitted
    }
    if meeting.host_id != user.id and user.id not in cohost_ids:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the host can start or stop the recording"
        )


def _assert_can_view(recording: Recording, user: User) -> None:
    allowed = {recording.meeting.host_id}
    allowed |= {p.user_id for p in recording.meeting.participants}
    allowed |= {i.user_id for i in recording.meeting.invitees}
    if user.id not in allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You were not in this meeting")


def generate_summary(db: Session, recording: Recording) -> Summary:
    """(Re)build the recap for a recording. Idempotent — replaces what exists."""
    segments = sorted(recording.segments, key=lambda s: s.start_ms)
    utterances = [(s.speaker_name, s.text) for s in segments]
    names = [p.display_name for p in recording.meeting.participants]
    draft = summarise(utterances, recording.meeting.topic, names)

    if recording.summary is not None:
        db.delete(recording.summary)
        db.flush()
    for stale in list(recording.action_items):
        db.delete(stale)
    db.flush()

    summary = Summary(
        recording_id=recording.id,
        headline=draft.headline,
        tldr=draft.tldr,
        generator=draft.generator,
        keywords=",".join(draft.keywords),
    )
    db.add(summary)
    db.flush()
    for position, section in enumerate(draft.sections):
        db.add(
            SummarySection(
                summary_id=summary.id,
                title=section.title,
                position=position,
                bullets="\n".join(section.bullets),
            )
        )

    name_to_id = {p.display_name: p.user_id for p in recording.meeting.participants}
    for item in draft.action_items:
        source = segments[item.source_segment_index] if item.source_segment_index < len(segments) else None
        db.add(
            ActionItem(
                recording_id=recording.id,
                text=item.text,
                assignee_name=item.assignee_name,
                assignee_id=name_to_id.get(item.assignee_name or ""),
                due_hint=item.due_hint,
                source_segment_id=source.id if source else None,
            )
        )
    db.commit()
    db.refresh(recording)
    return summary


# ---------------------------------------------------------------- recording flow
@router.post("/meetings/{code}/recording/start", response_model=schemas.RecordingOut, status_code=201)
async def start_recording(
    code: str, current: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    meeting = _meeting(db, code)
    _assert_can_record(meeting, current)
    active = db.scalar(
        select(Recording).where(
            Recording.meeting_id == meeting.id, Recording.status == RecordingStatus.recording
        )
    )
    if active:
        return recording_out(active)

    recording = Recording(
        meeting_id=meeting.id,
        title=meeting.topic,
        status=RecordingStatus.recording,
        share_token=new_share_token(),
    )
    db.add(recording)
    db.commit()
    db.refresh(recording)
    await hub.broadcast(
        meeting.code,
        {"type": "recording", "state": "started", "recordingId": recording.id,
         "by": current.display_name},
    )
    return recording_out(recording)


def _build_recap(recording_id: int) -> None:
    """Worker-thread half of the recap job: summarise and publish.

    Runs on its own session because the request that queued this returned long
    ago and took its session with it.
    """
    db = session_scope()
    try:
        recording = db.get(Recording, recording_id)
        if recording is None:  # deleted while the job sat in the queue
            return
        generate_summary(db, recording)
        refresh_talk_time(db, recording)
        recording.status = RecordingStatus.ready
        db.commit()
    finally:
        db.close()


async def _recap_job(recording_id: int, meeting_code: str, by: str) -> None:
    """Generate the recap off the request path, then tell the meeting."""
    try:
        # The summariser is CPU-bound and the database calls block, so this must
        # not run inline: the same event loop is serving the meeting sockets.
        await asyncio.to_thread(_build_recap, recording_id)
    except Exception:
        # The recording stays `processing`, which is the truth, and the recap
        # page offers Regenerate as the way out.
        logger.exception("Recap generation failed for recording %s", recording_id)
        await hub.broadcast(
            meeting_code,
            {"type": "recording", "state": "failed", "recordingId": recording_id, "by": by},
        )
        return

    await hub.broadcast(
        meeting_code,
        {"type": "recording", "state": "ready", "recordingId": recording_id, "by": by},
    )


@router.post("/recordings/{recording_id}/stop", response_model=schemas.RecordingDetail)
async def stop_recording(
    recording_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Stop recording and queue the recap.

    Returns as soon as the recording is marked `processing`. The recap arrives
    later: the worker sets the status to `ready` and broadcasts it to the room.
    """
    recording = _recording(db, recording_id)
    _assert_can_record(recording.meeting, current)
    if recording.status != RecordingStatus.recording:
        return recording_detail(recording)

    recording.ended_at = utcnow()
    recording.duration_seconds = max(
        int((recording.ended_at - recording.started_at).total_seconds()),
        max((s.end_ms for s in recording.segments), default=0) // 1000,
    )
    recording.status = RecordingStatus.processing
    db.commit()
    db.refresh(recording)

    # Read off the ORM objects now: the job runs after this session is closed.
    meeting_code = recording.meeting.code
    stopped_by = current.display_name
    await jobs.enqueue(
        f"recap:{recording_id}",
        lambda: _recap_job(recording_id, meeting_code, stopped_by),
    )
    # Tells the room the REC indicator can go away, before the recap exists.
    await hub.broadcast(
        meeting_code,
        {"type": "recording", "state": "processing", "recordingId": recording_id,
         "by": stopped_by},
    )
    return recording_detail(recording)


@router.post("/recordings/{recording_id}/regenerate", response_model=schemas.RecordingDetail)
def regenerate(
    recording_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    recording = _recording(db, recording_id)
    _assert_can_view(recording, current)
    generate_summary(db, recording)
    refresh_talk_time(db, recording)
    # Also the recovery path for a recap job that failed: that leaves the
    # recording `processing`, and a successful rebuild is what makes it ready.
    if recording.status == RecordingStatus.processing:
        recording.status = RecordingStatus.ready
        db.commit()
    db.refresh(recording)
    return recording_detail(recording)


# ------------------------------------------------------------------------ reading
@router.get("/recordings", response_model=list[schemas.RecordingOut])
def list_recordings(
    q: str = Query("", max_length=200),
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    hosted = select(Meeting.id).where(Meeting.host_id == current.id)
    attended = select(Participant.meeting_id).where(Participant.user_id == current.id)
    invited = select(Invitee.meeting_id).where(Invitee.user_id == current.id)
    stmt = (
        select(Recording)
        .where(
            or_(
                Recording.meeting_id.in_(hosted),
                Recording.meeting_id.in_(attended),
                Recording.meeting_id.in_(invited),
            )
        )
        .order_by(Recording.started_at.desc())
    )
    recordings = list(db.scalars(stmt))
    if q:
        needle = q.lower()
        recordings = [
            r
            for r in recordings
            if needle in r.title.lower()
            or any(needle in s.text.lower() for s in r.segments)
            or any(needle in p.display_name.lower() for p in r.meeting.participants)
        ]
    return [recording_out(r) for r in recordings]


@router.get("/recordings/{recording_id}", response_model=schemas.RecordingDetail)
def get_recording(
    recording_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    recording = _recording(db, recording_id)
    _assert_can_view(recording, current)
    return recording_detail(recording)


@router.get("/shared/recordings/{share_token}", response_model=schemas.RecordingDetail)
def get_shared_recording(
    share_token: str,
    _: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Public recap link — anyone holding the token can read the notes."""
    recording = db.scalar(select(Recording).where(Recording.share_token == share_token))
    if recording is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This shared recap does not exist")
    return recording_detail(recording)


# ---------------------------------------------------------------------- transcript
@router.post(
    "/recordings/{recording_id}/segments",
    response_model=schemas.TranscriptSegmentOut,
    status_code=201,
)
async def add_segment(
    recording_id: int,
    payload: schemas.TranscriptSegmentCreate,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """REST fallback for clients whose browser cannot hold the socket open."""
    recording = _recording(db, recording_id)
    _assert_can_view(recording, current)
    segment = TranscriptSegment(
        recording_id=recording.id,
        speaker_id=current.id,
        speaker_name=payload.speaker_name or current.display_name,
        start_ms=payload.start_ms,
        end_ms=max(payload.end_ms, payload.start_ms),
        text=payload.text.strip(),
    )
    db.add(segment)
    db.commit()
    db.refresh(segment)
    return schemas.TranscriptSegmentOut.model_validate(segment)


# -------------------------------------------------------------------- action items
@router.post("/recordings/{recording_id}/action-items", response_model=schemas.ActionItemOut, status_code=201)
def create_action_item(
    recording_id: int,
    payload: schemas.ActionItemCreate,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    recording = _recording(db, recording_id)
    _assert_can_view(recording, current)
    name_to_id = {p.display_name: p.user_id for p in recording.meeting.participants}
    item = ActionItem(
        recording_id=recording.id,
        text=payload.text.strip(),
        assignee_name=payload.assignee_name,
        assignee_id=name_to_id.get(payload.assignee_name or ""),
        due_hint=payload.due_hint,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return schemas.ActionItemOut.model_validate(item)


@router.patch("/action-items/{item_id}", response_model=schemas.ActionItemOut)
def update_action_item(
    item_id: int,
    payload: schemas.ActionItemUpdate,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.get(ActionItem, item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Action item not found")
    _assert_can_view(item.recording, current)
    data = payload.model_dump(exclude_unset=True)
    if "status" in data and data["status"] is not None:
        item.status = ActionItemStatus(data.pop("status"))
    for field, value in data.items():
        if value is not None:
            setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return schemas.ActionItemOut.model_validate(item)


@router.delete("/action-items/{item_id}", status_code=204)
def delete_action_item(
    item_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    item = db.get(ActionItem, item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Action item not found")
    _assert_can_view(item.recording, current)
    db.delete(item)
    db.commit()


# ----------------------------------------------------------------------- highlights
@router.post("/recordings/{recording_id}/highlights", response_model=schemas.HighlightOut, status_code=201)
async def create_highlight(
    recording_id: int,
    payload: schemas.HighlightCreate,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    recording = _recording(db, recording_id)
    _assert_can_view(recording, current)
    highlight = Highlight(
        recording_id=recording.id,
        created_by_id=current.id,
        created_by_name=current.display_name,
        label=payload.label[:200],
        at_ms=payload.at_ms,
        note=payload.note,
    )
    db.add(highlight)
    db.commit()
    db.refresh(highlight)
    await hub.broadcast(
        recording.meeting.code,
        {"type": "highlight", "by": current.display_name, "atMs": highlight.at_ms},
    )
    return schemas.HighlightOut.model_validate(highlight)


@router.delete("/highlights/{highlight_id}", status_code=204)
def delete_highlight(
    highlight_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    highlight = db.get(Highlight, highlight_id)
    if highlight is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Highlight not found")
    _assert_can_view(highlight.recording, current)
    db.delete(highlight)
    db.commit()
