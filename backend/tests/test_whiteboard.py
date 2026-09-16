"""The whiteboard is a presentation, not a private panel.

Opening it puts the board on everyone's stage the way a screen share does, so
the rules that matter are: who may put it there, that everyone hears about it,
and that someone joining mid-presentation walks into it already open.
"""
from __future__ import annotations

from contextlib import contextmanager

from test_meetings import auth, make_meeting, register


@contextmanager
def socket(client, code: str, token: str):
    with client.websocket_connect(f"/ws/meetings/{code}?token={token}") as ws:
        ws.receive_json()  # the welcome frame
        yield ws


def drain_until(ws, kind: str, limit: int = 12) -> dict | None:
    """Next frame of a given type, skipping unrelated room traffic."""
    for _ in range(limit):
        message = ws.receive_json()
        if message.get("type") == kind:
            return message
    return None


def joined_meeting(client, host_token: str, guest_token: str) -> str:
    """A live meeting both accounts have joined, with no waiting room."""
    meeting = make_meeting(client, host_token, passcode_required=False)
    code = meeting["code"]
    client.post(f"/api/meetings/{code}/join", json={}, headers=auth(host_token))
    client.post(f"/api/meetings/{code}/join", json={}, headers=auth(guest_token))
    return code


def test_opening_the_board_reaches_everyone_in_the_room(client):
    host_token, _ = register(client, "Hana Host")
    guest_token, _ = register(client, "Gus Guest")
    code = joined_meeting(client, host_token, guest_token)

    with socket(client, code, host_token) as host_ws:
        with socket(client, code, guest_token) as guest_ws:
            host_ws.send_json({"type": "whiteboard", "action": "open"})

            # The point of the change: the guest is told without asking for it.
            opened = drain_until(guest_ws, "whiteboard")
            assert opened is not None
            assert opened["action"] == "open"
            assert opened["by"] == "Hana Host"


def test_a_participant_cannot_put_the_board_on_everyone_stage(client):
    host_token, _ = register(client, "Hana Host")
    guest_token, _ = register(client, "Gus Guest")
    code = joined_meeting(client, host_token, guest_token)

    with socket(client, code, host_token) as host_ws:
        with socket(client, code, guest_token) as guest_ws:
            guest_ws.send_json({"type": "whiteboard", "action": "open"})
            # Nothing comes back, so the board never went up. A ping proves the
            # socket is still alive rather than merely silent.
            guest_ws.send_json({"type": "ping"})
            assert drain_until(guest_ws, "pong") is not None

        host_ws.send_json({"type": "ping"})
        assert drain_until(host_ws, "pong") is not None


def test_a_late_joiner_walks_into_the_open_board(client):
    host_token, _ = register(client, "Hana Host")
    guest_token, _ = register(client, "Gus Guest")
    code = joined_meeting(client, host_token, guest_token)

    with socket(client, code, host_token) as host_ws:
        host_ws.send_json({"type": "whiteboard", "action": "open"})
        assert drain_until(host_ws, "whiteboard") is not None
        host_ws.send_json(
            {
                "type": "whiteboard",
                "action": "stroke",
                "stroke": {"points": [[0.1, 0.1], [0.5, 0.5]], "color": "#fff", "width": 3},
            }
        )
        assert drain_until(host_ws, "whiteboard") is not None

        with client.websocket_connect(f"/ws/meetings/{code}?token={guest_token}") as late:
            welcome = late.receive_json()
            assert welcome["whiteboardOpen"] is True
            assert welcome["whiteboardBy"] == "Hana Host"
            # And the drawing that is already on it.
            assert len(welcome["whiteboard"]) == 1


def test_nobody_can_draw_on_a_board_that_is_not_up(client):
    host_token, _ = register(client, "Hana Host")
    guest_token, _ = register(client, "Gus Guest")
    code = joined_meeting(client, host_token, guest_token)

    with socket(client, code, host_token) as host_ws:
        host_ws.send_json(
            {
                "type": "whiteboard",
                "action": "stroke",
                "stroke": {"points": [[0.1, 0.1], [0.5, 0.5]], "color": "#fff", "width": 3},
            }
        )
        host_ws.send_json({"type": "ping"})
        assert drain_until(host_ws, "pong") is not None

    # The stroke was dropped, so a later joiner sees an empty board.
    with client.websocket_connect(f"/ws/meetings/{code}?token={guest_token}") as ws:
        welcome = ws.receive_json()
        assert welcome["whiteboard"] == []
        assert welcome["whiteboardOpen"] is False


def test_closing_the_board_takes_it_off_everyone_stage(client):
    host_token, _ = register(client, "Hana Host")
    guest_token, _ = register(client, "Gus Guest")
    code = joined_meeting(client, host_token, guest_token)

    with socket(client, code, host_token) as host_ws:
        host_ws.send_json({"type": "whiteboard", "action": "open"})
        assert drain_until(host_ws, "whiteboard") is not None
        host_ws.send_json({"type": "whiteboard", "action": "close"})
        closed = drain_until(host_ws, "whiteboard")
        assert closed is not None and closed["action"] == "close"

    with client.websocket_connect(f"/ws/meetings/{code}?token={guest_token}") as ws:
        assert ws.receive_json()["whiteboardOpen"] is False


def test_the_host_can_turn_the_waiting_room_on_during_the_meeting(client):
    """The setting is live, not only a scheduling choice."""
    host_token, _ = register(client, "Hana Host")
    guest_token, _ = register(client, "Gus Guest")
    meeting = make_meeting(client, host_token, passcode_required=False, waiting_room=False)
    code = meeting["code"]

    walked_in = client.post(f"/api/meetings/{code}/join", json={}, headers=auth(guest_token))
    assert walked_in.json()["admitted"] is True

    switched = client.patch(
        f"/api/meetings/{code}", json={"waiting_room": True}, headers=auth(host_token)
    )
    assert switched.status_code == 200
    assert switched.json()["waiting_room"] is True

    # Whoever knocks next is held, even though the meeting is already running.
    later_token, _ = register(client, "Lata Late")
    held = client.post(f"/api/meetings/{code}/join", json={}, headers=auth(later_token))
    assert held.json()["admitted"] is False


def test_only_the_host_can_switch_the_waiting_room(client):
    host_token, _ = register(client, "Hana Host")
    guest_token, _ = register(client, "Gus Guest")
    meeting = make_meeting(client, host_token, passcode_required=False)
    code = meeting["code"]
    client.post(f"/api/meetings/{code}/join", json={}, headers=auth(guest_token))

    response = client.patch(
        f"/api/meetings/{code}", json={"waiting_room": True}, headers=auth(guest_token)
    )
    assert response.status_code == 403
