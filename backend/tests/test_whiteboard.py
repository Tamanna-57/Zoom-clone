"""Clearing the shared whiteboard is a host control.

The UI hides the Clear button from participants, but that is cosmetic: the
socket accepts whatever a browser sends. These tests drive the message handler
directly, because the rule being checked lives there and not in the UI.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass

import pytest


@dataclass
class _Meeting:
    """Just enough of a meeting for the whiteboard branch, which only reads the code."""

    code: str


class _Socket:
    """A websocket that records what was sent instead of sending it."""

    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_json(self, payload: dict) -> None:
        self.sent.append(payload)


def _room_with_a_drawing(code: str):
    from app.ws.hub import Connection, Room, hub

    room = Room(code=code)
    room.strokes.append({"points": [[0.1, 0.1], [0.4, 0.4]], "color": "#fff", "width": 3, "by": "Host"})
    hub._rooms[code] = room  # noqa: SLF001 - test reaches past the public API on purpose

    def connection(role: str) -> Connection:
        c = Connection(
            id=f"conn-{role}",
            websocket=_Socket(),
            meeting_code=code,
            user_id=1,
            participant_id=1,
            display_name=role.title(),
            avatar_color="#2D8CFF",
            role=role,
        )
        room.connections[c.id] = c
        return c

    return room, connection


@pytest.fixture(autouse=True)
def _clean_rooms():
    from app.ws.hub import hub

    hub._rooms.clear()  # noqa: SLF001
    yield
    hub._rooms.clear()  # noqa: SLF001


def _clear(connection, meeting):
    from app.ws.signaling import _handle

    asyncio.run(
        _handle(None, connection, meeting, None, {"type": "whiteboard", "action": "clear"})
    )


def test_a_participant_cannot_clear_the_board():
    meeting = _Meeting(code="board-1")
    room, connection = _room_with_a_drawing(meeting.code)
    _clear(connection("participant"), meeting)
    assert len(room.strokes) == 1, "a participant wiped the board"


def test_the_host_can_clear_the_board():
    meeting = _Meeting(code="board-2")
    room, connection = _room_with_a_drawing(meeting.code)
    _clear(connection("host"), meeting)
    assert room.strokes == []


def test_a_cohost_can_clear_the_board():
    meeting = _Meeting(code="board-3")
    room, connection = _room_with_a_drawing(meeting.code)
    _clear(connection("cohost"), meeting)
    assert room.strokes == []
