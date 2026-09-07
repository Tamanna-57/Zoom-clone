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
class Room:
    code: str
    connections: dict[str, Connection] = field(default_factory=dict)


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

    def get(self, meeting_code: str, connection_id: str) -> Connection | None:
        room = self._rooms.get(meeting_code)
        return room.connections.get(connection_id) if room else None

    def online_user_ids(self, meeting_code: str) -> set[int]:
        return {c.user_id for c in self.peers(meeting_code)}

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
