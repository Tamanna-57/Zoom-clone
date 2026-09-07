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
from .hub import Connection, Poll, hub

router = APIRouter()

# Sent to the older socket when the same account joins the room again, so the
# browser can tell "you opened this meeting somewhere else" apart from a drop.
WS_REPLACED_ELSEWHERE = 4409

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

        # One account is one seat. A second tab (or another device) signing in as
        # the same user retires the older socket instead of appearing twice in
        # the mesh. Register the newcomer first so the closing socket sees the
        # user as still present and does not mark the participant offline.
        await hub.add(connection)
        superseded = hub.connections_for_user(meeting.code, user.id, exclude=connection.id)

        stale = {c.id for c in superseded}
        existing_peers = [
            p.peer_payload() for p in hub.peers(meeting.code, exclude=connection.id)
            if p.id not in stale
        ]

        for previous in superseded:
            try:
                await previous.websocket.close(code=WS_REPLACED_ELSEWHERE)
            except Exception:  # pragma: no cover - socket already gone
                await hub.remove(meeting.code, previous.id)

        room = hub.room(meeting.code)
        await websocket.send_json(
            {
                "type": "welcome",
                "self": connection.peer_payload(),
                "peers": existing_peers,
                # Whoever joins late still needs the board and the open ballots.
                "whiteboard": list(room.strokes) if room else [],
                "polls": [p.payload(user.id) for p in room.polls.values()] if room else [],
            }
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
        # A muted microphone produces no transcript. The browser also stops its
        # recogniser on mute, but the recogniser listens to the raw device rather
        # than to the outgoing track, so the server is the authority here.
        if connection.is_muted:
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

    if kind == "whiteboard":
        room = hub.room(meeting.code)
        if room is None:
            return
        action = message.get("action")
        if action == "clear":
            room.strokes.clear()
            await hub.broadcast(meeting.code, {"type": "whiteboard", "action": "clear"})
            return
        if action != "stroke":
            return
        stroke = message.get("stroke")
        if not isinstance(stroke, dict):
            return
        points = stroke.get("points")
        if not isinstance(points, list) or len(points) < 2:
            return
        clean = {
            # Points are normalised 0..1 so every screen size draws the same
            # picture; clamping here keeps a hostile client inside the canvas.
            "points": [
                [min(max(float(x), 0.0), 1.0), min(max(float(y), 0.0), 1.0)]
                for x, y in (pair for pair in points[:500] if isinstance(pair, list) and len(pair) == 2)
            ],
            "color": str(stroke.get("color", "#ffffff"))[:16],
            "width": min(max(int(stroke.get("width", 3)), 1), 40),
            "by": connection.display_name,
        }
        if len(clean["points"]) < 2:
            return
        # A long call should not grow an unbounded board in memory.
        room.strokes.append(clean)
        del room.strokes[:-2000]
        await hub.broadcast(meeting.code, {"type": "whiteboard", "action": "stroke", "stroke": clean})
        return

    if kind == "poll":
        room = hub.room(meeting.code)
        if room is None:
            return
        action = message.get("action")

        if action == "create":
            if connection.role == "participant":
                return
            question = str(message.get("question", "")).strip()[:200]
            options = [
                str(o).strip()[:80]
                for o in (message.get("options") or [])
                if str(o).strip()
            ][:6]
            if not question or len(options) < 2:
                return
            poll = Poll(
                id=uuid.uuid4().hex[:12],
                question=question,
                options=options,
                created_by=connection.display_name,
            )
            room.polls[poll.id] = poll
            for peer in hub.peers(meeting.code):
                await hub.send_to(
                    meeting.code, peer.id, {"type": "poll", "poll": poll.payload(peer.user_id)}
                )
            return

        poll = room.polls.get(str(message.get("pollId", "")))
        if poll is None:
            return

        if action == "vote":
            if not poll.is_open:
                return
            choice = message.get("choice")
            if not isinstance(choice, int) or not 0 <= choice < len(poll.options):
                return
            # One ballot per person: drop any previous pick before recording.
            for voters in poll.votes.values():
                voters.discard(user.id)
            poll.votes.setdefault(choice, set()).add(user.id)
        elif action == "close":
            if connection.role == "participant":
                return
            poll.is_open = False
        else:
            return

        for peer in hub.peers(meeting.code):
            await hub.send_to(
                meeting.code, peer.id, {"type": "poll", "poll": poll.payload(peer.user_id)}
            )
        return

    if kind == "ping":
        await connection.websocket.send_json({"type": "pong"})
