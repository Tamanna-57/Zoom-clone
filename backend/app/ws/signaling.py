"""The meeting WebSocket.

One socket per participant carries four concerns:
  * WebRTC signaling (offer/answer/ICE) relayed peer-to-peer,
  * presence and media state (mute, camera, raised hand, screen share),
  * in-call chat and reactions,
  * live transcript lines from the browser's speech recogniser.

The server never touches media: it only relays SDP and ICE between browsers.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from ..database import session_scope
from ..models import (
    ChatMessage,
    Meeting,
    Participant,
    Recording,
    RecordingStatus,
    TranscriptSegment,
    User,
    utcnow,
)
from ..schemas import ChatMessageOut
from ..security import decode_access_token
from .hub import Connection, hub

router = APIRouter()

MEDIA_STATE_FIELDS = {
    "isMuted": "is_muted",
    "isVideoOn": "is_video_on",
    "isHandRaised": "is_hand_raised",
    "isSharing": "is_sharing",
}


@router.websocket("/ws/meetings/{code}")
async def meeting_socket(websocket: WebSocket, code: str, token: str = "") -> None:
    payload = decode_access_token(token)
    if not payload:
        await websocket.close(code=4401)
        return

    db = session_scope()
    try:
        user = db.get(User, int(payload["sub"]))
        meeting = db.scalar(select(Meeting).where(Meeting.code == code))
        if user is None or meeting is None:
            await websocket.close(code=4404)
            return
        participant = db.scalar(
            select(Participant).where(
                Participant.meeting_id == meeting.id, Participant.user_id == user.id
            )
        )
        if participant is None:
            # The REST join endpoint is the front door; refuse sockets without it.
            await websocket.close(code=4403)
            return

        participant.is_online = True
        participant.left_at = None
        participant.joined_at = participant.joined_at or utcnow()
        db.commit()

        connection = Connection(
            id=uuid.uuid4().hex,
            websocket=websocket,
            meeting_code=meeting.code,
            user_id=user.id,
            participant_id=participant.id,
            display_name=participant.display_name,
            avatar_color=user.avatar_color,
            role=participant.role.value,
            is_muted=participant.is_muted,
            is_video_on=participant.is_video_on,
        )

        await websocket.accept()
        existing_peers = [p.peer_payload() for p in hub.peers(meeting.code)]
        await hub.add(connection)

        await websocket.send_json(
            {"type": "welcome", "self": connection.peer_payload(), "peers": existing_peers}
        )
        # Existing peers create the offer; the newcomer answers. One offerer per
        # pair keeps the mesh from glare-colliding.
        await hub.broadcast(
            meeting.code,
            {"type": "peer-joined", "peer": connection.peer_payload()},
            exclude=connection.id,
        )

        try:
            while True:
                message = await websocket.receive_json()
                await _handle(db, connection, meeting, user, message)
        except WebSocketDisconnect:
            pass
        finally:
            await hub.remove(meeting.code, connection.id)
            still_connected = any(
                c.user_id == user.id for c in hub.peers(meeting.code)
            )
            if not still_connected:
                participant.is_online = False
                participant.left_at = utcnow()
                db.commit()
            await hub.broadcast(
                meeting.code,
                {"type": "peer-left", "connectionId": connection.id, "userId": user.id},
            )
    finally:
        db.close()


async def _handle(db, connection: Connection, meeting: Meeting, user: User, message: dict) -> None:
    kind = message.get("type")

    if kind == "signal":
        target = message.get("to")
        if target:
            await hub.send_to(
                meeting.code,
                target,
                {"type": "signal", "from": connection.id, "data": message.get("data")},
            )
        return

    if kind == "state":
        participant = db.get(Participant, connection.participant_id)
        for wire_field, column in MEDIA_STATE_FIELDS.items():
            if wire_field in message:
                value = bool(message[wire_field])
                setattr(connection, column, value)
                if participant is not None:
                    setattr(participant, column, value)
        db.commit()
        await hub.broadcast(
            meeting.code,
            {"type": "peer-state", "peer": connection.peer_payload()},
        )
        return

    if kind == "reaction":
        await hub.broadcast(
            meeting.code,
            {
                "type": "reaction",
                "connectionId": connection.id,
                "displayName": connection.display_name,
                "emoji": str(message.get("emoji", "👍"))[:8],
            },
        )
        return

    if kind == "chat":
        body = str(message.get("body", "")).strip()
        if not body:
            return
        recipient_id = message.get("recipientId")
        recipient = db.get(User, recipient_id) if recipient_id else None
        row = ChatMessage(
            meeting_id=meeting.id,
            sender_id=user.id,
            sender_name=connection.display_name,
            recipient_id=recipient.id if recipient else None,
            recipient_name=recipient.display_name if recipient else None,
            body=body[:4000],
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        await hub.broadcast(
            meeting.code,
            {"type": "chat", "message": ChatMessageOut.model_validate(row).model_dump(mode="json")},
            only_user_ids=None if recipient is None else {user.id, recipient.id},
        )
        return

    if kind == "transcript":
        text = str(message.get("text", "")).strip()
        if not text:
            return
        recording = db.scalar(
            select(Recording)
            .where(
                Recording.meeting_id == meeting.id,
                Recording.status == RecordingStatus.recording,
            )
            .order_by(Recording.id.desc())
        )
        if recording is None:
            return
        start_ms = int(message.get("startMs", 0))
        end_ms = int(message.get("endMs", start_ms + max(len(text.split()), 1) * 400))
        segment = TranscriptSegment(
            recording_id=recording.id,
            speaker_id=user.id,
            speaker_name=connection.display_name,
            start_ms=max(start_ms, 0),
            end_ms=max(end_ms, start_ms),
            text=text[:2000],
        )
        db.add(segment)
        db.commit()
        db.refresh(segment)
        await hub.broadcast(
            meeting.code,
            {
                "type": "transcript",
                "segment": {
                    "id": segment.id,
                    "speakerId": segment.speaker_id,
                    "speakerName": segment.speaker_name,
                    "startMs": segment.start_ms,
                    "endMs": segment.end_ms,
                    "text": segment.text,
                },
            },
        )
        return

    if kind == "ping":
        await connection.websocket.send_json({"type": "pong"})
