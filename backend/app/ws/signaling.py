"""The meeting WebSocket.

One socket per participant carries four concerns:
  * WebRTC signaling (offer/answer/ICE) relayed peer-to-peer,
  * presence and media state (mute, camera, raised hand, screen share),
  * in-call chat and reactions,
  * live transcript lines from the browser's speech recogniser.

The server never touches media: it only relays SDP and ICE between browsers.
"""
from __future__ import annotations

import re
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from ..database import session_scope
from ..models import (
    AdmissionState,
    ChatMessage,
    Meeting,
    Participant,
    ParticipantRole,
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

# Sent when the socket belongs to someone the waiting room still holds, or whom
# the host ejected. The browser must not treat either as a dropped connection to
# retry: one waits for the host, the other is over.
WS_NOT_ADMITTED = 4403

# Sent when the socket says it is leaving on purpose, so the browser retires it
# instead of treating the close as a drop worth reconnecting through.
WS_NORMAL = 1000

MEDIA_STATE_FIELDS = {
    "isMuted": "is_muted",
    "isVideoOn": "is_video_on",
    "isHandRaised": "is_hand_raised",
    "isSharing": "is_sharing",
}


# What a whiteboard object is allowed to be. Everything here is checked rather
# than trusted: the board is replayed verbatim to every late joiner, so a single
# bad item would be served to the whole room for the rest of the call.
BOARD_KINDS = {"pen", "highlighter", "line", "arrow", "rect", "ellipse", "text", "note"}
# Freehand keeps its whole path; every other shape is defined by two corners.
BOARD_PATH_KINDS = {"pen", "highlighter"}
BOARD_TEXT_KINDS = {"text", "note"}
BOARD_MAX_PATH_POINTS = 500
BOARD_MAX_TEXT = 500
BOARD_MAX_ITEMS = 2000
# How many ids one delete may name. An eraser dragged across a busy board is the
# reason this is not 1, and the cap is the reason it is not unbounded.
BOARD_MAX_DELETE = 200
_HEX_COLOUR = re.compile(r"^#[0-9a-fA-F]{6}$")
_BOARD_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _clamp_unit(value: float) -> float:
    """Board coordinates run 0..1, so the same drawing lands on every screen."""
    return min(max(value, 0.0), 1.0)


def _board_points(raw: object, kind: str) -> list[list[float]] | None:
    if not isinstance(raw, list):
        return None
    points: list[list[float]] = []
    for pair in raw[:BOARD_MAX_PATH_POINTS]:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            continue
        try:
            x, y = float(pair[0]), float(pair[1])
        except (TypeError, ValueError):
            continue
        # NaN survives clamping (every comparison against it is false), so it
        # has to be dropped by hand or it reaches a canvas as an invisible mark.
        if x != x or y != y:
            continue
        points.append([_clamp_unit(x), _clamp_unit(y)])
    if len(points) < 2:
        return None
    # A shape is its two corners. Trimming here means the move handler below can
    # shift any item the same way without caring what kind it is.
    return points if kind in BOARD_PATH_KINDS else [points[0], points[-1]]


def _clean_board_item(raw: object, connection: Connection) -> dict | None:
    """Narrow one untrusted item off the socket into something safe to store."""
    if not isinstance(raw, dict):
        return None
    kind = raw.get("kind")
    if kind not in BOARD_KINDS:
        return None
    item_id = raw.get("id")
    if not isinstance(item_id, str) or not _BOARD_ID.fullmatch(item_id):
        return None
    points = _board_points(raw.get("points"), kind)
    if points is None:
        return None
    colour = raw.get("color")
    if not isinstance(colour, str) or not _HEX_COLOUR.fullmatch(colour):
        return None
    try:
        width = int(raw.get("width", 5))
    except (TypeError, ValueError):
        return None
    item = {
        "id": item_id,
        "kind": kind,
        "points": points,
        "color": colour,
        # Per-mille of the board's height rather than pixels, so a line keeps
        # its weight on a laptop, a phone and an exported PNG alike.
        "width": min(max(width, 1), 80),
        # Authorship is stamped here and never read off the wire. It decides who
        # may later move or erase the mark, so a client that could set it could
        # both forge someone else's signature and take over their drawing.
        "by": connection.display_name,
        "byConnection": connection.id,
    }
    if kind in BOARD_TEXT_KINDS:
        text = raw.get("text")
        if not isinstance(text, str) or not text.strip():
            return None
        item["text"] = text[:BOARD_MAX_TEXT]
    return item


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
        if participant.admission != AdmissionState.admitted:
            # Waiting room or ejected: either way this person is not in the room
            # yet, and must not receive its media, chat or transcript.
            await websocket.close(code=WS_NOT_ADMITTED)
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
        # A host who joins (or reloads) mid-call needs the current knock list;
        # the waiting-room broadcasts only cover people who arrive afterwards.
        waiting = []
        if participant.role in (ParticipantRole.host, ParticipantRole.cohost):
            waiting = [
                {
                    "participant_id": p.id,
                    "user_id": p.user_id,
                    "display_name": p.display_name,
                    "avatar_color": p.user.avatar_color if p.user else "#2D8CFF",
                }
                for p in meeting.participants
                if p.admission == AdmissionState.waiting
            ]
        await websocket.send_json(
            {
                "type": "welcome",
                "self": connection.peer_payload(),
                "peers": existing_peers,
                # Whoever joins late still needs the board and the open ballots.
                "whiteboard": list(room.board.values()) if room else [],
                # A board someone is already sharing opens for the newcomer too.
                "whiteboardOpen": bool(room.whiteboard_open) if room else False,
                "whiteboardBy": room.whiteboard_by if room else None,
                "whiteboardByConnection": room.whiteboard_by_connection if room else None,
                "whiteboardLocked": bool(room.board_locked) if room else False,
                # The Security menu and the spotlight, so a late joiner arrives
                # under the same rules and looking at the same person.
                "security": room.security_payload() if room else None,
                "spotlight": room.spotlight if room else None,
                "polls": [p.payload(user.id) for p in room.polls.values()] if room else [],
                "waiting": waiting,
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
        room = hub.room(meeting.code)
        moderates = connection.role in ("host", "cohost")
        participant = db.get(Participant, connection.participant_id)
        refused: dict[str, bool] = {}
        for wire_field, column in MEDIA_STATE_FIELDS.items():
            if wire_field not in message:
                continue
            value = bool(message[wire_field])
            # The Security menu is enforced here, not in the browser. Refusing
            # the change is not enough on its own - the browser has already
            # turned its own microphone on, so it is told to put it back.
            if room is not None and not moderates:
                if wire_field == "isMuted" and not value and not room.allow_unmute:
                    refused["isMuted"] = True
                    continue
                if wire_field == "isSharing" and value and not room.allow_share:
                    refused["isSharing"] = False
                    continue
            setattr(connection, column, value)
            if participant is not None:
                setattr(participant, column, value)
        db.commit()
        if refused:
            await hub.send_to(
                meeting.code,
                connection.id,
                {"type": "state-refused", **refused},
            )
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
        room = hub.room(meeting.code)
        # A muted chat still lets the host talk, the way Zoom's does.
        if room is not None and not room.allow_chat and connection.role == "participant":
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

    if kind == "leave":
        # Someone pressing Leave should vanish from everyone's grid at once.
        # Waiting for the browser's socket teardown costs a couple of seconds,
        # so announce the departure the moment the intent arrives and close.
        await hub.broadcast(
            meeting.code,
            {"type": "peer-left", "connectionId": connection.id, "userId": connection.user_id},
            exclude=connection.id,
        )
        try:
            await connection.websocket.close(code=WS_NORMAL)
        except Exception:  # pragma: no cover - socket already gone
            pass
        await hub.remove(meeting.code, connection.id)
        return

    if kind == "whiteboard":
        room = hub.room(meeting.code)
        if room is None:
            return
        action = message.get("action")
        # Hosts and cohosts moderate the board: they end anyone's share, wipe it,
        # latch it, and edit marks that are not theirs.
        moderates = connection.role in ("host", "cohost")

        if action == "open":
            # Anyone may put the board up, the same way anyone may share a
            # screen. Re-announcing an already open board is harmless: it just
            # nudges any client that missed the first broadcast.
            room.whiteboard_open = True
            room.whiteboard_by = connection.display_name
            room.whiteboard_by_connection = connection.id
            await hub.broadcast(
                meeting.code,
                {
                    "type": "whiteboard",
                    "action": "open",
                    "by": connection.display_name,
                    "byConnection": connection.id,
                },
            )
            return

        if action == "close":
            # Closing ends the session for the room, so only the person who
            # opened it or a host/cohost may do it. Everyone else can hide the
            # panel locally without taking the board away from the others.
            if not moderates and room.whiteboard_by_connection != connection.id:
                return
            room.whiteboard_open = False
            room.whiteboard_by = None
            room.whiteboard_by_connection = None
            # Ending the share ends the drawing with it: the next person to put
            # a board up starts on a blank one rather than someone else's notes.
            room.board.clear()
            room.board_locked = False
            await hub.broadcast(
                meeting.code,
                {"type": "whiteboard", "action": "close", "by": connection.display_name},
            )
            return

        if action == "clear":
            # The UI hides this from participants, but hiding a button proves
            # nothing: anyone could send this message straight down the socket
            # and wipe the board mid-meeting.
            if not moderates:
                return
            room.board.clear()
            await hub.broadcast(meeting.code, {"type": "whiteboard", "action": "clear"})
            return

        if action == "lock":
            if not moderates:
                return
            room.board_locked = bool(message.get("locked"))
            await hub.broadcast(
                meeting.code,
                {
                    "type": "whiteboard",
                    "action": "lock",
                    "locked": room.board_locked,
                    "by": connection.display_name,
                },
            )
            return

        if action == "cursor":
            # Presence, not content. Seeing where the other pens are is most of
            # what makes a shared board feel shared, but a pointer a second old
            # is worthless, so this is never stored and never replayed.
            try:
                x = float(message.get("x"))
                y = float(message.get("y"))
            except (TypeError, ValueError):
                return
            if x != x or y != y:
                return
            await hub.broadcast(
                meeting.code,
                {
                    "type": "whiteboard",
                    "action": "cursor",
                    "connectionId": connection.id,
                    "by": connection.display_name,
                    "color": connection.avatar_color,
                    "x": _clamp_unit(x),
                    "y": _clamp_unit(y),
                },
                exclude=connection.id,
            )
            return

        if action not in ("add", "move", "delete"):
            return
        # While the host has the board latched, everyone else is a spectator.
        if room.board_locked and not moderates:
            return

        if action == "add":
            item = _clean_board_item(message.get("item"), connection)
            if item is None:
                return
            # Drawing implicitly shares the board: a mark on a closed board would
            # otherwise land somewhere nobody is looking.
            if not room.whiteboard_open:
                room.whiteboard_open = True
                room.whiteboard_by = connection.display_name
                room.whiteboard_by_connection = connection.id
                await hub.broadcast(
                    meeting.code,
                    {
                        "type": "whiteboard",
                        "action": "open",
                        "by": connection.display_name,
                        "byConnection": connection.id,
                    },
                )
            # An id that is already taken is a replay or a collision, not an
            # edit: re-keying it here would silently overwrite someone's mark.
            if item["id"] in room.board:
                return
            room.board[item["id"]] = item
            # A long call should not grow an unbounded board in memory. The
            # oldest marks go first, which is also the least surprising.
            while len(room.board) > BOARD_MAX_ITEMS:
                del room.board[next(iter(room.board))]
            await hub.broadcast(
                meeting.code, {"type": "whiteboard", "action": "add", "item": item}
            )
            return

        if action == "move":
            item_id = message.get("id")
            item = room.board.get(item_id) if isinstance(item_id, str) else None
            if item is None:
                return
            if not moderates and item["byConnection"] != connection.id:
                return
            try:
                dx = float(message.get("dx", 0.0))
                dy = float(message.get("dy", 0.0))
            except (TypeError, ValueError):
                return
            if dx != dx or dy != dy:
                return
            xs = [p[0] for p in item["points"]]
            ys = [p[1] for p in item["points"]]
            # Clamp the whole move rather than each point, so a shape dragged off
            # the edge stops at the edge instead of collapsing against it.
            dx = min(max(dx, -min(xs)), 1.0 - max(xs))
            dy = min(max(dy, -min(ys)), 1.0 - max(ys))
            item["points"] = [[x + dx, y + dy] for x, y in item["points"]]
            # The result travels, not the delta: a delta the server clamped is
            # not reproducible, and every client has to land on the same picture.
            await hub.broadcast(
                meeting.code,
                {
                    "type": "whiteboard",
                    "action": "move",
                    "id": item["id"],
                    "points": item["points"],
                },
            )
            return

        # action == "delete"
        ids = message.get("ids")
        if not isinstance(ids, list):
            return
        removed: list[str] = []
        for item_id in ids[:BOARD_MAX_DELETE]:
            if not isinstance(item_id, str):
                continue
            item = room.board.get(item_id)
            if item is None:
                continue
            # You rub out your own marks; everyone else's are the host's to take.
            if not moderates and item["byConnection"] != connection.id:
                continue
            del room.board[item_id]
            removed.append(item_id)
        if not removed:
            return
        await hub.broadcast(
            meeting.code, {"type": "whiteboard", "action": "delete", "ids": removed}
        )
        return

    if kind == "security":
        room = hub.room(meeting.code)
        if room is None or connection.role not in ("host", "cohost"):
            return
        if message.get("action") == "spotlight":
            # Spotlight is the host putting one person on everyone's stage. A
            # null clears it; an id that has since left simply never matches.
            target = message.get("connectionId")
            room.spotlight = target if isinstance(target, str) and target else None
            await hub.broadcast(
                meeting.code,
                {
                    "type": "security",
                    "action": "spotlight",
                    "connectionId": room.spotlight,
                    "by": connection.display_name,
                },
            )
            return
        if message.get("action") != "set":
            return
        for wire_field, attribute in (
            ("locked", "locked"),
            ("allowShare", "allow_share"),
            ("allowChat", "allow_chat"),
            ("allowUnmute", "allow_unmute"),
        ):
            if wire_field in message:
                setattr(room, attribute, bool(message[wire_field]))
        # Taking unmute away is not retroactive on its own: whoever is already
        # unmuted stays that way until the next time they toggle. Zoom mutes
        # them there and then, so do the same.
        if not room.allow_unmute:
            for peer in hub.peers(meeting.code):
                if peer.role == "participant" and not peer.is_muted:
                    peer.is_muted = True
                    row = db.get(Participant, peer.participant_id)
                    if row is not None:
                        row.is_muted = True
                    await hub.broadcast(
                        meeting.code, {"type": "peer-state", "peer": peer.peer_payload()}
                    )
                    await hub.send_to(
                        meeting.code, peer.id, {"type": "state-refused", "isMuted": True}
                    )
            db.commit()
        await hub.broadcast(
            meeting.code,
            {
                "type": "security",
                "action": "set",
                "by": connection.display_name,
                **room.security_payload(),
            },
        )
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
