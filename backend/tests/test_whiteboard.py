"""The shared whiteboard's rules, driven straight at the message handler.

The board is a set of objects rather than a bitmap, which is what lets a mark be
moved, erased or undone on its own - and what makes ownership matter, because
"whose mark is this" now decides who may change it. None of that is enforceable
in the UI: the socket accepts whatever a browser sends, so every rule worth
having lives in the handler and is tested here.
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


def _item(item_id: str = "mark-1", **overrides) -> dict:
    item = {
        "id": item_id,
        "kind": "pen",
        "points": [[0.1, 0.1], [0.4, 0.4]],
        "color": "#2d8cff",
        "width": 5,
    }
    item.update(overrides)
    return item


def _room_with_a_drawing(code: str):
    from app.ws.hub import Connection, Room, hub

    room = Room(code=code)
    room.board["existing"] = {
        "id": "existing",
        "kind": "pen",
        "points": [[0.1, 0.1], [0.4, 0.4]],
        "color": "#ffffff",
        "width": 5,
        "by": "Host",
        "byConnection": "conn-host",
    }
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


def _send(connection, meeting, message):
    from app.ws.signaling import _handle

    asyncio.run(_handle(None, connection, meeting, None, message))


def _board_messages(connection):
    return [m for m in connection.websocket.sent if m.get("type") == "whiteboard"]


# --- clearing and latching: the host's controls ------------------------------


def _clear(connection, meeting):
    _send(connection, meeting, {"type": "whiteboard", "action": "clear"})


def test_a_participant_cannot_clear_the_board():
    meeting = _Meeting(code="board-1")
    room, connection = _room_with_a_drawing(meeting.code)
    _clear(connection("participant"), meeting)
    assert len(room.board) == 1, "a participant wiped the board"


def test_the_host_can_clear_the_board():
    meeting = _Meeting(code="board-2")
    room, connection = _room_with_a_drawing(meeting.code)
    _clear(connection("host"), meeting)
    assert room.board == {}


def test_a_cohost_can_clear_the_board():
    meeting = _Meeting(code="board-3")
    room, connection = _room_with_a_drawing(meeting.code)
    _clear(connection("cohost"), meeting)
    assert room.board == {}


def test_only_a_host_can_latch_the_board():
    meeting = _Meeting(code="board-lock-1")
    room, connection = _room_with_a_drawing(meeting.code)

    _send(connection("participant"), meeting, {"type": "whiteboard", "action": "lock", "locked": True})
    assert room.board_locked is False

    _send(connection("host"), meeting, {"type": "whiteboard", "action": "lock", "locked": True})
    assert room.board_locked is True


def test_a_latched_board_takes_the_pen_off_everyone_else():
    meeting = _Meeting(code="board-lock-2")
    room, connection = _room_with_a_drawing(meeting.code)
    host = connection("host")
    guest = connection("participant")
    _send(host, meeting, {"type": "whiteboard", "action": "lock", "locked": True})

    _send(guest, meeting, {"type": "whiteboard", "action": "add", "item": _item()})
    assert "mark-1" not in room.board, "a participant drew on a latched board"

    # The host is still holding the pen.
    _send(host, meeting, {"type": "whiteboard", "action": "add", "item": _item("mark-2")})
    assert "mark-2" in room.board


# --- adding marks ------------------------------------------------------------


def test_a_mark_reaches_the_room_and_opens_the_board():
    meeting = _Meeting(code="board-5")
    room, connection = _room_with_a_drawing(meeting.code)
    watcher = connection("host")
    drawer = connection("participant")

    _send(drawer, meeting, {"type": "whiteboard", "action": "add", "item": _item()})

    assert room.whiteboard_open is True
    assert [m["action"] for m in _board_messages(watcher)] == ["open", "add"]
    assert room.board["mark-1"]["points"] == [[0.1, 0.1], [0.4, 0.4]]


def test_authorship_is_stamped_by_the_server_not_the_client():
    """Otherwise anyone could sign a mark 'Host' and then edit the host's work."""
    meeting = _Meeting(code="board-own-1")
    room, connection = _room_with_a_drawing(meeting.code)
    guest = connection("participant")

    _send(
        guest,
        meeting,
        {
            "type": "whiteboard",
            "action": "add",
            "item": _item(by="Host", byConnection="conn-host"),
        },
    )

    assert room.board["mark-1"]["by"] == "Participant"
    assert room.board["mark-1"]["byConnection"] == guest.id


def test_a_mark_is_clamped_to_the_board():
    meeting = _Meeting(code="board-clamp-1")
    room, connection = _room_with_a_drawing(meeting.code)

    _send(
        connection("host"),
        meeting,
        {
            "type": "whiteboard",
            "action": "add",
            "item": _item(points=[[-4.0, 0.5], [9.0, 0.5]], width=5000),
        },
    )

    assert room.board["mark-1"]["points"] == [[0.0, 0.5], [1.0, 0.5]]
    assert room.board["mark-1"]["width"] == 80


@pytest.mark.parametrize(
    "bad",
    [
        _item(kind="iframe"),
        _item(color="javascript:alert(1)"),
        _item(color="red"),
        _item(item_id="../../etc/passwd"),
        _item(points=[[0.1, 0.1]]),
        _item(points="everywhere"),
        _item(kind="text"),  # text kinds must actually carry text
        _item(kind="note", text="   "),
    ],
)
def test_a_malformed_mark_never_reaches_the_board(bad):
    """The board is replayed to every late joiner, so one bad item would stick."""
    meeting = _Meeting(code="board-bad-1")
    room, connection = _room_with_a_drawing(meeting.code)

    _send(connection("host"), meeting, {"type": "whiteboard", "action": "add", "item": bad})

    assert len(room.board) == 1, f"a malformed item was stored: {bad}"


def test_a_repeated_id_does_not_overwrite_an_existing_mark():
    meeting = _Meeting(code="board-dup-1")
    room, connection = _room_with_a_drawing(meeting.code)
    host = connection("host")
    guest = connection("participant")
    _send(host, meeting, {"type": "whiteboard", "action": "add", "item": _item()})

    _send(guest, meeting, {"type": "whiteboard", "action": "add", "item": _item(points=[[0.9, 0.9], [0.95, 0.95]])})

    assert room.board["mark-1"]["byConnection"] == host.id
    assert room.board["mark-1"]["points"] == [[0.1, 0.1], [0.4, 0.4]]


# --- moving and erasing ------------------------------------------------------


def test_you_can_move_your_own_mark():
    meeting = _Meeting(code="board-move-1")
    room, connection = _room_with_a_drawing(meeting.code)
    guest = connection("participant")
    _send(guest, meeting, {"type": "whiteboard", "action": "add", "item": _item()})

    _send(guest, meeting, {"type": "whiteboard", "action": "move", "id": "mark-1", "dx": 0.1, "dy": 0.2})

    assert room.board["mark-1"]["points"] == [
        [pytest.approx(0.2), pytest.approx(0.3)],
        [pytest.approx(0.5), pytest.approx(0.6)],
    ]


def test_a_participant_cannot_move_someone_elses_mark():
    meeting = _Meeting(code="board-move-2")
    room, connection = _room_with_a_drawing(meeting.code)

    _send(
        connection("participant"),
        meeting,
        {"type": "whiteboard", "action": "move", "id": "existing", "dx": 0.5, "dy": 0.5},
    )

    assert room.board["existing"]["points"] == [[0.1, 0.1], [0.4, 0.4]]


def test_a_host_can_move_anyones_mark():
    meeting = _Meeting(code="board-move-3")
    room, connection = _room_with_a_drawing(meeting.code)
    guest = connection("participant")
    _send(guest, meeting, {"type": "whiteboard", "action": "add", "item": _item()})

    _send(
        connection("host"),
        meeting,
        {"type": "whiteboard", "action": "move", "id": "mark-1", "dx": 0.1, "dy": 0.0},
    )

    assert room.board["mark-1"]["points"][0][0] == pytest.approx(0.2)


def test_a_move_off_the_edge_stops_rather_than_collapsing():
    """Clamping each point on its own would flatten the shape against the wall."""
    meeting = _Meeting(code="board-move-4")
    room, connection = _room_with_a_drawing(meeting.code)
    host = connection("host")
    _send(host, meeting, {"type": "whiteboard", "action": "add", "item": _item()})

    _send(host, meeting, {"type": "whiteboard", "action": "move", "id": "mark-1", "dx": 5.0, "dy": 0.0})

    points = room.board["mark-1"]["points"]
    assert points[1][0] == pytest.approx(1.0), "the mark did not travel to the edge"
    # The stroke was 0.3 wide before the move and must still be 0.3 wide after.
    assert points[1][0] - points[0][0] == pytest.approx(0.3)


def test_you_can_erase_your_own_marks_but_not_anyone_elses():
    meeting = _Meeting(code="board-erase-1")
    room, connection = _room_with_a_drawing(meeting.code)
    guest = connection("participant")
    _send(guest, meeting, {"type": "whiteboard", "action": "add", "item": _item()})

    _send(guest, meeting, {"type": "whiteboard", "action": "delete", "ids": ["mark-1", "existing"]})

    assert "mark-1" not in room.board
    assert "existing" in room.board, "a participant erased someone else's mark"


def test_a_delete_announces_only_what_it_actually_removed():
    meeting = _Meeting(code="board-erase-2")
    room, connection = _room_with_a_drawing(meeting.code)
    watcher = connection("host")
    guest = connection("participant")
    _send(guest, meeting, {"type": "whiteboard", "action": "add", "item": _item()})

    _send(guest, meeting, {"type": "whiteboard", "action": "delete", "ids": ["mark-1", "existing", "ghost"]})

    deletes = [m for m in _board_messages(watcher) if m["action"] == "delete"]
    assert deletes == [{"type": "whiteboard", "action": "delete", "ids": ["mark-1"]}]


def test_a_host_can_erase_anyones_mark():
    meeting = _Meeting(code="board-erase-3")
    room, connection = _room_with_a_drawing(meeting.code)

    _send(connection("host"), meeting, {"type": "whiteboard", "action": "delete", "ids": ["existing"]})

    assert room.board == {}


# --- live cursors ------------------------------------------------------------


def test_a_cursor_reaches_the_others_and_is_never_stored():
    meeting = _Meeting(code="board-cursor-1")
    room, connection = _room_with_a_drawing(meeting.code)
    watcher = connection("host")
    mover = connection("participant")

    _send(mover, meeting, {"type": "whiteboard", "action": "cursor", "x": 0.25, "y": 4.0})

    assert _board_messages(watcher) == [
        {
            "type": "whiteboard",
            "action": "cursor",
            "connectionId": mover.id,
            "by": "Participant",
            "color": "#2D8CFF",
            "x": 0.25,
            "y": 1.0,
        }
    ]
    assert _board_messages(mover) == [], "a cursor was echoed back to its own sender"
    assert len(room.board) == 1, "a cursor was stored on the board"


# --- sharing the board -------------------------------------------------------


def test_opening_the_board_shares_it_with_the_room():
    meeting = _Meeting(code="board-4")
    room, connection = _room_with_a_drawing(meeting.code)
    watcher = connection("participant")
    opener = connection("host")

    _send(opener, meeting, {"type": "whiteboard", "action": "open"})

    assert room.whiteboard_open is True
    assert room.whiteboard_by_connection == opener.id
    assert {"type": "whiteboard", "action": "open", "by": "Host", "byConnection": opener.id} in (
        watcher.websocket.sent
    )


def test_a_participant_cannot_end_someone_elses_share():
    meeting = _Meeting(code="board-6")
    room, connection = _room_with_a_drawing(meeting.code)
    opener = connection("host")
    other = connection("participant")
    _send(opener, meeting, {"type": "whiteboard", "action": "open"})

    _send(other, meeting, {"type": "whiteboard", "action": "close"})

    assert room.whiteboard_open is True, "a participant closed another person's board"


def test_the_sharer_can_end_their_own_share():
    meeting = _Meeting(code="board-7")
    room, connection = _room_with_a_drawing(meeting.code)
    opener = connection("participant")
    _send(opener, meeting, {"type": "whiteboard", "action": "open"})

    _send(opener, meeting, {"type": "whiteboard", "action": "close"})

    assert room.whiteboard_open is False
    assert room.whiteboard_by is None
    assert room.board == {}, "the board kept its drawing after the share ended"


def test_ending_a_share_also_unlatches_the_board():
    """Otherwise the next person to put a board up finds it read-only."""
    meeting = _Meeting(code="board-8b")
    room, connection = _room_with_a_drawing(meeting.code)
    host = connection("host")
    _send(host, meeting, {"type": "whiteboard", "action": "open"})
    _send(host, meeting, {"type": "whiteboard", "action": "lock", "locked": True})

    _send(host, meeting, {"type": "whiteboard", "action": "close"})

    assert room.board_locked is False


def test_a_host_can_end_a_participants_share():
    meeting = _Meeting(code="board-8")
    room, connection = _room_with_a_drawing(meeting.code)
    opener = connection("participant")
    host = connection("host")
    _send(opener, meeting, {"type": "whiteboard", "action": "open"})

    _send(host, meeting, {"type": "whiteboard", "action": "close"})

    assert room.whiteboard_open is False


def test_leaving_tells_the_room_at_once():
    """A departure must not wait on the browser's socket teardown."""
    meeting = _Meeting(code="board-9")
    room, connection = _room_with_a_drawing(meeting.code)
    watcher = connection("host")
    goer = connection("participant")

    class _ClosingSocket(_Socket):
        def __init__(self) -> None:
            super().__init__()
            self.closed_with: int | None = None

        async def close(self, code: int = 1000) -> None:
            self.closed_with = code

    goer.websocket = _ClosingSocket()

    _send(goer, meeting, {"type": "leave"})

    assert {
        "type": "peer-left",
        "connectionId": goer.id,
        "userId": goer.user_id,
    } in watcher.websocket.sent
    assert goer.websocket.closed_with == 1000
    assert goer.id not in room.connections
