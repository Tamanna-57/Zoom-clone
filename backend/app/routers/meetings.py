"""Meeting lifecycle: schedule, list, join, host controls, in-meeting chat."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..deps import get_current_user
from ..models import (
    AdmissionState,
    ChatMessage,
    Invitee,
    Meeting,
    MeetingStatus,
    Participant,
    ParticipantRole,
    User,
    utcnow,
)
from ..security import new_meeting_code, new_passcode
from ..serializers import ice_servers, meeting_out, participant_out, waiting_participant
from ..ws.hub import hub

# Close code the meeting socket uses when the host ejects someone, so the
# browser shows "you were removed" rather than trying to reconnect.
WS_REMOVED = 4403

router = APIRouter(prefix="/api/meetings", tags=["meetings"])


def _load(db: Session, code_or_id: str) -> Meeting:
    meeting = db.scalar(select(Meeting).where(Meeting.code == code_or_id))
    if meeting is None and code_or_id.isdigit():
        meeting = db.get(Meeting, int(code_or_id))
    if meeting is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Meeting not found")
    return meeting


def _host_user_ids(meeting: Meeting) -> set[int]:
    """The host plus every co-host — who may run the waiting room."""
    ids = {meeting.host_id}
    ids |= {
        p.user_id
        for p in meeting.participants
        if p.role == ParticipantRole.cohost and p.user_id is not None
    }
    return ids


async def _announce_waiting_room(meeting: Meeting) -> None:
    """Push the current knock list to the hosts' participant panels."""
    waiting = [
        waiting_participant(p)
        for p in meeting.participants
        if p.admission == AdmissionState.waiting
    ]
    await hub.broadcast(
        meeting.code,
        {"type": "waiting-room", "waiting": [w.model_dump() for w in waiting]},
        only_user_ids=_host_user_ids(meeting),
    )


def _require_host(meeting: Meeting, user: User) -> None:
    cohost_ids = {
        p.user_id for p in meeting.participants if p.role == ParticipantRole.cohost
    }
    if meeting.host_id != user.id and user.id not in cohost_ids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the host can do that")


def _visible_to(db: Session, user: User) -> list[Meeting]:
    """Meetings a user hosts, was invited to, or has attended."""
    hosted = select(Meeting.id).where(Meeting.host_id == user.id)
    invited = select(Invitee.meeting_id).where(Invitee.user_id == user.id)
    attended = select(Participant.meeting_id).where(Participant.user_id == user.id)
    stmt = select(Meeting).where(
        or_(Meeting.id.in_(hosted), Meeting.id.in_(invited), Meeting.id.in_(attended))
    )
    return list(db.scalars(stmt))


@router.post("", response_model=schemas.MeetingOut, status_code=201)
def create_meeting(
    payload: schemas.MeetingCreate,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meeting = Meeting(
        code=new_meeting_code(),
        topic=payload.topic.strip(),
        passcode=new_passcode() if payload.passcode_required else None,
        host_id=current.id,
        scheduled_start=payload.scheduled_start,
        duration_minutes=payload.duration_minutes,
        agenda=payload.agenda,
        waiting_room=payload.waiting_room,
        mute_on_entry=payload.mute_on_entry,
        video_on_entry=payload.video_on_entry,
        auto_record=payload.auto_record,
        status=MeetingStatus.live if payload.start_now else MeetingStatus.scheduled,
        started_at=utcnow() if payload.start_now else None,
    )
    db.add(meeting)
    db.flush()

    for user_id in dict.fromkeys(payload.invitee_ids):
        if db.get(User, user_id) and user_id != current.id:
            db.add(Invitee(meeting_id=meeting.id, user_id=user_id))

    db.commit()
    db.refresh(meeting)
    return meeting_out(meeting, current)


@router.get("", response_model=list[schemas.MeetingOut])
def list_meetings(
    scope: str = Query("upcoming", pattern="^(upcoming|previous|live|all)$"),
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meetings = _visible_to(db, current)
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    def is_upcoming(m: Meeting) -> bool:
        if m.status == MeetingStatus.ended:
            return False
        if m.status == MeetingStatus.live:
            return True
        return m.scheduled_start is None or m.scheduled_start >= now - timedelta(hours=1)

    if scope == "upcoming":
        meetings = [m for m in meetings if is_upcoming(m)]
        meetings.sort(key=lambda m: (m.status != MeetingStatus.live, m.scheduled_start or m.created_at))
    elif scope == "previous":
        meetings = [m for m in meetings if not is_upcoming(m)]
        meetings.sort(key=lambda m: m.ended_at or m.scheduled_start or m.created_at, reverse=True)
    elif scope == "live":
        meetings = [m for m in meetings if m.status == MeetingStatus.live]
    else:
        meetings.sort(key=lambda m: m.created_at, reverse=True)
    return [meeting_out(m, current) for m in meetings]


@router.get("/personal", response_model=schemas.MeetingOut)
def personal_room(current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Zoom's Personal Meeting ID: a permanent room owned by the user."""
    meeting = db.scalar(
        select(Meeting).where(Meeting.host_id == current.id, Meeting.is_personal_room.is_(True))
    )
    if meeting is None:
        meeting = Meeting(
            code=current.personal_meeting_id,
            topic=f"{current.display_name}'s Personal Meeting Room",
            passcode=new_passcode(),
            host_id=current.id,
            is_personal_room=True,
            status=MeetingStatus.scheduled,
        )
        db.add(meeting)
        db.commit()
        db.refresh(meeting)
    return meeting_out(meeting, current)


@router.get("/{code}", response_model=schemas.MeetingOut)
def get_meeting(
    code: str, current: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return meeting_out(_load(db, code), current)


@router.patch("/{code}", response_model=schemas.MeetingOut)
def update_meeting(
    code: str,
    payload: schemas.MeetingUpdate,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meeting = _load(db, code)
    _require_host(meeting, current)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(meeting, field, value)
    db.commit()
    db.refresh(meeting)
    return meeting_out(meeting, current)


@router.delete("/{code}", status_code=204)
def delete_meeting(
    code: str, current: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    meeting = _load(db, code)
    if meeting.host_id != current.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the host can delete a meeting")
    if meeting.is_personal_room:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The personal room cannot be deleted")
    db.delete(meeting)
    db.commit()


@router.post("/{code}/join", response_model=schemas.JoinResponse)
async def join_meeting(
    code: str,
    payload: schemas.JoinRequest,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meeting = _load(db, code)
    if meeting.status == MeetingStatus.ended:
        raise HTTPException(status.HTTP_409_CONFLICT, "This meeting has already ended")
    if meeting.passcode and meeting.host_id != current.id:
        if (payload.passcode or "").strip() != meeting.passcode:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "That passcode is not correct")

    participant = db.scalar(
        select(Participant).where(
            Participant.meeting_id == meeting.id, Participant.user_id == current.id
        )
    )
    if participant is not None and participant.admission == AdmissionState.removed:
        # Zoom keeps an ejected attendee out for the rest of the meeting; a
        # removal that the person can undo by re-opening the link is not one.
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "The host removed you from this meeting"
        )

    if participant is None:
        participant = Participant(
            meeting_id=meeting.id,
            user_id=current.id,
            display_name=payload.display_name or current.display_name,
            role=ParticipantRole.host if meeting.host_id == current.id else ParticipantRole.participant,
        )
        db.add(participant)

    # The waiting room holds everyone except the host and co-hosts, who are the
    # people who run it. Someone already admitted stays admitted on a rejoin.
    is_host_side = meeting.host_id == current.id or participant.role in (
        ParticipantRole.host,
        ParticipantRole.cohost,
    )
    if meeting.waiting_room and not is_host_side:
        if participant.admission != AdmissionState.admitted:
            participant.admission = AdmissionState.waiting
    else:
        participant.admission = AdmissionState.admitted

    participant.left_at = None
    participant.is_muted = meeting.mute_on_entry and meeting.host_id != current.id
    participant.is_video_on = meeting.video_on_entry

    admitted = participant.admission == AdmissionState.admitted
    if admitted:
        participant.joined_at = participant.joined_at or utcnow()
        if meeting.status == MeetingStatus.scheduled:
            meeting.status = MeetingStatus.live
            meeting.started_at = meeting.started_at or utcnow()

    db.commit()
    db.refresh(meeting)
    db.refresh(participant)

    if not admitted:
        await _announce_waiting_room(meeting)

    return schemas.JoinResponse(
        meeting=meeting_out(meeting, current),
        participant=participant_out(participant),
        ice_servers=ice_servers(),
        ws_url=f"/ws/meetings/{meeting.code}",
        admitted=admitted,
    )


@router.post("/{code}/leave", status_code=204)
def leave_meeting(
    code: str, current: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    meeting = _load(db, code)
    participant = db.scalar(
        select(Participant).where(
            Participant.meeting_id == meeting.id, Participant.user_id == current.id
        )
    )
    if participant:
        participant.is_online = False
        participant.left_at = utcnow()
        db.commit()


@router.post("/{code}/end", response_model=schemas.MeetingOut)
async def end_meeting(
    code: str, current: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    meeting = _load(db, code)
    _require_host(meeting, current)
    meeting.status = MeetingStatus.ended
    meeting.ended_at = utcnow()
    for participant in meeting.participants:
        participant.is_online = False
        participant.left_at = participant.left_at or utcnow()
    db.commit()
    db.refresh(meeting)
    await hub.broadcast(meeting.code, {"type": "meeting-ended", "by": current.display_name})
    return meeting_out(meeting, current)


# ------------------------------------------------------------------ host controls
@router.post("/{code}/participants/{participant_id}/mute", response_model=schemas.ParticipantOut)
async def mute_participant(
    code: str,
    participant_id: int,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meeting = _load(db, code)
    _require_host(meeting, current)
    participant = db.get(Participant, participant_id)
    if participant is None or participant.meeting_id != meeting.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Participant not found")
    participant.is_muted = True
    db.commit()
    db.refresh(participant)
    # Keep the socket's own view in step: it is what gates the transcript, and
    # what other participants' tiles are drawn from.
    if participant.user_id is not None:
        for connection in hub.connections_for_user(meeting.code, participant.user_id):
            connection.is_muted = True
            await hub.broadcast(
                meeting.code, {"type": "peer-state", "peer": connection.peer_payload()}
            )
    await hub.broadcast(
        meeting.code,
        {"type": "force-mute", "participantId": participant.id, "by": current.display_name},
    )
    return participant_out(participant)


@router.post("/{code}/participants/{participant_id}/remove", status_code=204)
async def remove_participant(
    code: str,
    participant_id: int,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meeting = _load(db, code)
    _require_host(meeting, current)
    participant = db.get(Participant, participant_id)
    if participant is None or participant.meeting_id != meeting.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Participant not found")
    if participant.user_id == meeting.host_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The host cannot be removed")
    participant.is_online = False
    participant.left_at = utcnow()
    participant.admission = AdmissionState.removed
    db.commit()
    await hub.broadcast(
        meeting.code,
        {"type": "removed", "participantId": participant.id, "by": current.display_name},
    )
    # Say it first, then actually hang up on them.
    if participant.user_id is not None:
        await hub.close_user(meeting.code, participant.user_id, code=WS_REMOVED)


# ------------------------------------------------------------------ waiting room
@router.get("/{code}/waiting", response_model=list[schemas.WaitingParticipant])
def list_waiting(
    code: str, current: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Who is knocking. Hosts only — the queue is not attendees' business."""
    meeting = _load(db, code)
    _require_host(meeting, current)
    return [
        waiting_participant(p)
        for p in meeting.participants
        if p.admission == AdmissionState.waiting
    ]


def _waiting_participant_or_404(
    db: Session, meeting: Meeting, participant_id: int
) -> Participant:
    participant = db.get(Participant, participant_id)
    if participant is None or participant.meeting_id != meeting.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Participant not found")
    if participant.admission != AdmissionState.waiting:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "That person is not in the waiting room"
        )
    return participant


@router.post("/{code}/participants/{participant_id}/admit", response_model=schemas.ParticipantOut)
async def admit_participant(
    code: str,
    participant_id: int,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meeting = _load(db, code)
    _require_host(meeting, current)
    participant = _waiting_participant_or_404(db, meeting, participant_id)

    participant.admission = AdmissionState.admitted
    participant.joined_at = participant.joined_at or utcnow()
    if meeting.status == MeetingStatus.scheduled:
        meeting.status = MeetingStatus.live
        meeting.started_at = meeting.started_at or utcnow()
    db.commit()
    db.refresh(participant)

    await hub.broadcast(
        meeting.code,
        {"type": "admitted", "participantId": participant.id, "by": current.display_name},
    )
    await _announce_waiting_room(meeting)
    return participant_out(participant)


@router.post("/{code}/participants/{participant_id}/deny", status_code=204)
async def deny_participant(
    code: str,
    participant_id: int,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Turn someone away at the door. In Zoom this also keeps them out."""
    meeting = _load(db, code)
    _require_host(meeting, current)
    participant = _waiting_participant_or_404(db, meeting, participant_id)

    participant.admission = AdmissionState.removed
    participant.left_at = utcnow()
    db.commit()

    await hub.broadcast(
        meeting.code,
        {"type": "removed", "participantId": participant.id, "by": current.display_name},
    )
    if participant.user_id is not None:
        await hub.close_user(meeting.code, participant.user_id, code=WS_REMOVED)
    await _announce_waiting_room(meeting)


@router.post("/{code}/participants/{participant_id}/cohost", response_model=schemas.ParticipantOut)
def make_cohost(
    code: str,
    participant_id: int,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meeting = _load(db, code)
    if meeting.host_id != current.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the host can assign a co-host")
    participant = db.get(Participant, participant_id)
    if participant is None or participant.meeting_id != meeting.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Participant not found")
    participant.role = (
        ParticipantRole.participant
        if participant.role == ParticipantRole.cohost
        else ParticipantRole.cohost
    )
    db.commit()
    db.refresh(participant)
    return participant_out(participant)


@router.post("/{code}/invite", response_model=schemas.MeetingOut)
def invite_users(
    code: str,
    user_ids: list[int],
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meeting = _load(db, code)
    _require_host(meeting, current)
    existing = {i.user_id for i in meeting.invitees}
    for user_id in user_ids:
        if user_id not in existing and db.get(User, user_id):
            db.add(Invitee(meeting_id=meeting.id, user_id=user_id))
    db.commit()
    db.refresh(meeting)
    return meeting_out(meeting, current)


# ------------------------------------------------------------------- in-call chat
@router.get("/{code}/messages", response_model=list[schemas.ChatMessageOut])
def list_messages(
    code: str, current: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    meeting = _load(db, code)
    stmt = (
        select(ChatMessage)
        .where(ChatMessage.meeting_id == meeting.id)
        .where(
            or_(
                ChatMessage.recipient_id.is_(None),
                ChatMessage.recipient_id == current.id,
                ChatMessage.sender_id == current.id,
            )
        )
        .order_by(ChatMessage.created_at)
    )
    return [schemas.ChatMessageOut.model_validate(m) for m in db.scalars(stmt)]


@router.post("/{code}/messages", response_model=schemas.ChatMessageOut, status_code=201)
async def post_message(
    code: str,
    payload: schemas.ChatMessageCreate,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meeting = _load(db, code)
    recipient = db.get(User, payload.recipient_id) if payload.recipient_id else None
    message = ChatMessage(
        meeting_id=meeting.id,
        sender_id=current.id,
        sender_name=current.display_name,
        recipient_id=recipient.id if recipient else None,
        recipient_name=recipient.display_name if recipient else None,
        body=payload.body.strip(),
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    out = schemas.ChatMessageOut.model_validate(message)
    await hub.broadcast(
        meeting.code,
        {"type": "chat", "message": out.model_dump(mode="json")},
        only_user_ids=None if recipient is None else {current.id, recipient.id},
    )
    return out
