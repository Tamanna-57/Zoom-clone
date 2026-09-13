"""Model -> schema conversion.

Kept in one place so routers stay thin and every endpoint returns the same
shape for the same entity.
"""
from __future__ import annotations

from collections import defaultdict

from sqlalchemy.orm import Session

from . import models, schemas
from .config import settings


def ice_servers() -> list[dict]:
    servers: list[dict] = [{"urls": settings.stun_urls}]
    if settings.turn_url:
        servers.append(
            {
                "urls": settings.turn_url,
                "username": settings.turn_username or "",
                "credential": settings.turn_credential or "",
            }
        )
    return servers


def _columns(instance) -> dict:
    """Scalar column values of an ORM row.

    Nested schema fields (host, participants, transcript ...) are filled in
    explicitly by the callers below; reading only real columns here keeps
    Pydantic from trying to coerce a relationship into the wrong schema.
    """
    return {column.name: getattr(instance, column.name) for column in instance.__table__.columns}


def user_public(user: models.User) -> schemas.UserPublic:
    return schemas.UserPublic.model_validate(user)


def waiting_participant(participant: models.Participant) -> schemas.WaitingParticipant:
    return schemas.WaitingParticipant(
        participant_id=participant.id,
        user_id=participant.user_id,
        display_name=participant.display_name,
        avatar_color=participant.user.avatar_color if participant.user else "#2D8CFF",
    )


def participant_out(participant: models.Participant) -> schemas.ParticipantOut:
    return schemas.ParticipantOut(
        **_columns(participant),
        avatar_color=participant.user.avatar_color if participant.user else "#2D8CFF",
    )


def can_see_passcode(meeting: models.Meeting, viewer: models.User | None) -> bool:
    """Who is allowed to read a meeting's passcode.

    The host and co-hosts need it to share the invitation, and anyone already
    admitted has evidently supplied it. Serving it to every signed-in account
    that knows the meeting id would make the passcode decorative.
    """
    if viewer is None:
        return False
    if meeting.host_id == viewer.id:
        return True
    return any(
        p.user_id == viewer.id
        and (
            p.role == models.ParticipantRole.cohost
            or p.admission == models.AdmissionState.admitted
        )
        for p in meeting.participants
    )


def meeting_out(
    meeting: models.Meeting, viewer: models.User | None = None
) -> schemas.MeetingOut:
    recordings = sorted(meeting.recordings, key=lambda r: r.started_at)
    active = [r for r in recordings if r.status == models.RecordingStatus.recording]
    columns = _columns(meeting)
    if not can_see_passcode(meeting, viewer):
        columns["passcode"] = None
    return schemas.MeetingOut(
        **columns,
        host=user_public(meeting.host),
        participants=[participant_out(p) for p in meeting.participants],
        invitees=[user_public(i.user) for i in meeting.invitees if i.user],
        latest_recording_id=recordings[-1].id if recordings else None,
        active_recording_id=active[-1].id if active else None,
        join_url=f"/meeting/{meeting.code}",
    )


def summary_out(summary: models.Summary) -> schemas.SummaryOut:
    return schemas.SummaryOut(
        id=summary.id,
        headline=summary.headline,
        tldr=summary.tldr,
        generator=summary.generator,
        keywords=[k for k in summary.keywords.split(",") if k],
        created_at=summary.created_at,
        sections=[
            schemas.SummarySectionOut(
                title=section.title,
                position=section.position,
                bullets=[b for b in section.bullets.split("\n") if b.strip()],
            )
            for section in summary.sections
        ],
    )


def speaker_stats(segments: list[models.TranscriptSegment]) -> list[schemas.SpeakerStat]:
    seconds: dict[str, float] = defaultdict(float)
    words: dict[str, int] = defaultdict(int)
    for segment in segments:
        seconds[segment.speaker_name] += max(segment.end_ms - segment.start_ms, 0) / 1000
        words[segment.speaker_name] += len(segment.text.split())
    total = sum(seconds.values()) or 1.0
    stats = [
        schemas.SpeakerStat(
            speaker_name=name,
            seconds=round(value),
            percent=round(value / total * 100, 1),
            words=words[name],
        )
        for name, value in seconds.items()
    ]
    return sorted(stats, key=lambda s: s.seconds, reverse=True)


def recording_out(recording: models.Recording) -> schemas.RecordingOut:
    return schemas.RecordingOut(
        **_columns(recording),
        meeting_code=recording.meeting.code,
        host_name=recording.meeting.host.display_name,
        participant_names=[p.display_name for p in recording.meeting.participants],
        segment_count=len(recording.segments),
        action_item_count=len(recording.action_items),
        highlight_count=len(recording.highlights),
    )


def recording_detail(recording: models.Recording) -> schemas.RecordingDetail:
    base = recording_out(recording)
    segments = sorted(recording.segments, key=lambda s: s.start_ms)
    return schemas.RecordingDetail(
        **base.model_dump(),
        segments=[schemas.TranscriptSegmentOut.model_validate(s) for s in segments],
        summary=summary_out(recording.summary) if recording.summary else None,
        action_items=[
            schemas.ActionItemOut.model_validate(a)
            for a in sorted(recording.action_items, key=lambda a: a.id)
        ],
        highlights=[
            schemas.HighlightOut.model_validate(h)
            for h in sorted(recording.highlights, key=lambda h: h.at_ms)
        ],
        speaker_stats=speaker_stats(segments),
    )


def refresh_talk_time(db: Session, recording: models.Recording) -> None:
    """Roll transcript durations up onto the participant rows."""
    totals: dict[str, float] = defaultdict(float)
    for segment in recording.segments:
        totals[segment.speaker_name] += max(segment.end_ms - segment.start_ms, 0) / 1000
    for participant in recording.meeting.participants:
        participant.talk_seconds = round(totals.get(participant.display_name, 0))
    db.commit()
