"""In-process fan-out for meeting rooms.

Every browser tab in a meeting holds one WebSocket; the hub keeps them grouped
by meeting code so the signaling endpoint (and REST handlers such as "host ended
the meeting") can push to a whole room or to one peer.

Single-process by design: with one uvicorn worker this is all the coordination a
mesh call needs. Scaling out horizontally would mean swapping this class for a
Redis pub/sub backend and nothing else.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from fastapi import WebSocket


@dataclass
class Connection:
    id: str
    websocket: WebSocket
    meeting_code: str
    user_id: int
    participant_id: int
    display_name: str
    avatar_color: str
    role: str
    is_muted: bool = True
    is_video_on: bool = True
    is_hand_raised: bool = False
    is_sharing: bool = False

    def peer_payload(self) -> dict:
        return {
            "connectionId": self.id,
            "userId": self.user_id,
            "participantId": self.participant_id,
            "displayName": self.display_name,
            "avatarColor": self.avatar_color,
            "role": self.role,
            "isMuted": self.is_muted,
            "isVideoOn": self.is_video_on,
            "isHandRaised": self.is_hand_raised,
            "isSharing": self.is_sharing,
        }


@dataclass
class Poll:
    id: str
    question: str
    options: list[str]
    created_by: str
    is_open: bool = True
    # option index -> the user ids that picked it, so a re-vote moves the tally
    # instead of double-counting and one person cannot stuff the ballot.
    votes: dict[int, set[int]] = field(default_factory=dict)

    def payload(self, viewer_id: int | None = None) -> dict:
        return {
            "id": self.id,
            "question": self.question,
            "options": self.options,
            "createdBy": self.created_by,
            "isOpen": self.is_open,
            "counts": [len(self.votes.get(i, set())) for i in range(len(self.options))],
            "myVote": next((i for i, voters in self.votes.items() if viewer_id in voters), None),
        }


@dataclass
class Room:
    code: str
    connections: dict[str, Connection] = field(default_factory=dict)
    # The whiteboard is a list of objects rather than a bitmap: every mark keeps
    # its own identity, so it can be moved, rubbed out or undone on its own long
    # after it was drawn. Keyed by id, and a dict keeps insertion order, so this
    # is also the z-order - later marks draw on top.
    board: dict[str, dict] = field(default_factory=dict)
    polls: dict[str, Poll] = field(default_factory=dict)
    # The board is shared, not personal: one person opens it and everyone's
    # stage follows. These track who started the session so the opener (and any
    # host) can end it for the room, and so late joiners land on an open board.
    whiteboard_open: bool = False
    whiteboard_by: str | None = None
    whiteboard_by_connection: str | None = None
    # Zoom's "who can annotate", as a room-wide latch: while it is on, only the
    # host and cohosts may change the board. Everyone can still watch it.
    board_locked: bool = False

    # Zoom's Security menu. The host holds these and the server enforces them,
    # because a hidden button is not a control - anyone can send the message it
    # would have sent. They live and die with the call, like the board.
    locked: bool = False
    allow_share: bool = True
    allow_chat: bool = True
    allow_unmute: bool = True
    # Zoom's spotlight: the host puts one person on everybody's stage. Distinct
    # from a pin, which each viewer sets for themselves and never leaves their
    # own screen, so it is not room state at all.
    spotlight: str | None = None

    def security_payload(self) -> dict:
        return {
            "locked": self.locked,
            "allowShare": self.allow_share,
            "allowChat": self.allow_chat,
            "allowUnmute": self.allow_unmute,
        }


class Hub:
    def __init__(self) -> None:
        self._rooms: dict[str, Room] = {}
        self._lock = asyncio.Lock()

    async def add(self, connection: Connection) -> None:
        async with self._lock:
            room = self._rooms.setdefault(connection.meeting_code, Room(connection.meeting_code))
            room.connections[connection.id] = connection

    async def remove(self, meeting_code: str, connection_id: str) -> None:
        async with self._lock:
            room = self._rooms.get(meeting_code)
            if not room:
                return
            room.connections.pop(connection_id, None)
            if not room.connections:
                self._rooms.pop(meeting_code, None)

    def peers(self, meeting_code: str, exclude: str | None = None) -> list[Connection]:
        room = self._rooms.get(meeting_code)
        if not room:
            return []
        return [c for cid, c in room.connections.items() if cid != exclude]

    def room(self, meeting_code: str) -> Room | None:
        return self._rooms.get(meeting_code)

    def get(self, meeting_code: str, connection_id: str) -> Connection | None:
        room = self._rooms.get(meeting_code)
        return room.connections.get(connection_id) if room else None

    def online_user_ids(self, meeting_code: str) -> set[int]:
        return {c.user_id for c in self.peers(meeting_code)}

    def connections_for_user(
        self, meeting_code: str, user_id: int, exclude: str | None = None
    ) -> list[Connection]:
        """Every live socket a given user holds in a room.

        One person opening a second tab must not appear twice in the call, so the
        signaling endpoint uses this to retire the older socket.
        """
        return [c for c in self.peers(meeting_code, exclude=exclude) if c.user_id == user_id]

    async def close_user(self, meeting_code: str, user_id: int, code: int = 1000) -> None:
        """Hang up every socket a user holds in a room.

        A host ejecting someone has to actually cut the connection: telling the
        browser it was removed and trusting it to leave is not a control.
        """
        for connection in self.connections_for_user(meeting_code, user_id):
            try:
                await connection.websocket.close(code=code)
            except Exception:  # pragma: no cover - socket already gone
                pass
            await self.remove(meeting_code, connection.id)

    async def send_to(self, meeting_code: str, connection_id: str, payload: dict) -> None:
        connection = self.get(meeting_code, connection_id)
        if connection is None:
            return
        await self._safe_send(connection, payload)

    async def broadcast(
        self,
        meeting_code: str,
        payload: dict,
        exclude: str | None = None,
        only_user_ids: set[int] | None = None,
    ) -> None:
        targets = [
            c
            for c in self.peers(meeting_code, exclude=exclude)
            if only_user_ids is None or c.user_id in only_user_ids
        ]
        if targets:
            await asyncio.gather(*(self._safe_send(c, payload) for c in targets))

    async def _safe_send(self, connection: Connection, payload: dict) -> None:
        try:
            await connection.websocket.send_json(payload)
        except Exception:  # pragma: no cover - socket already gone
            await self.remove(connection.meeting_code, connection.id)


hub = Hub()
