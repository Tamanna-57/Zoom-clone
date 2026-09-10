"""Meeting access control: passcodes, the waiting room, ejection and recording.

These cover the rules that make a meeting a meeting rather than a public URL, so
each one is written as the thing an attacker or a mis-clicking attendee would
try, not as a call to the handler.
"""
from __future__ import annotations

import itertools

import pytest

_counter = itertools.count()


def register(client, name: str) -> tuple[str, dict]:
    """A fresh verified account, returning its bearer token and user row."""
    email = f"{name.lower().replace(' ', '.')}.{next(_counter)}@example.com"
    response = client.post(
        "/api/auth/register",
        json={"email": email, "display_name": name, "password": "password123"},
    )
    assert response.status_code in (200, 201), response.text
    body = response.json()
    return body["access_token"], body["user"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def make_meeting(client, token: str, **overrides) -> dict:
    payload = {
        "topic": "Weekly sync",
        "passcode_required": True,
        "start_now": True,
        "auto_record": False,
        **overrides,
    }
    response = client.post("/api/meetings", json=payload, headers=auth(token))
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def host(client):
    return register(client, "Hana Host")


@pytest.fixture
def guest(client):
    return register(client, "Gus Guest")


@pytest.fixture
def stranger(client):
    return register(client, "Otto Outsider")


# --------------------------------------------------------------------- passcodes
def test_passcode_is_not_served_to_someone_who_has_not_joined(client, host, stranger):
    host_token, _ = host
    stranger_token, _ = stranger
    meeting = make_meeting(client, host_token)
    assert meeting["passcode"], "a passcode-protected meeting should have one"

    seen = client.get(f"/api/meetings/{meeting['code']}", headers=auth(stranger_token))
    assert seen.status_code == 200
    # Handing the passcode to anyone who knows the meeting id would make it
    # decorative: they could read it here and then join with it.
    assert seen.json()["passcode"] is None


def test_passcode_is_visible_to_the_host_and_to_anyone_admitted(client, host, guest):
    host_token, _ = host
    guest_token, _ = guest
    meeting = make_meeting(client, host_token)
    passcode = meeting["passcode"]

    mine = client.get(f"/api/meetings/{meeting['code']}", headers=auth(host_token))
    assert mine.json()["passcode"] == passcode

    joined = client.post(
        f"/api/meetings/{meeting['code']}/join",
        json={"passcode": passcode},
        headers=auth(guest_token),
    )
    assert joined.status_code == 200
    theirs = client.get(f"/api/meetings/{meeting['code']}", headers=auth(guest_token))
    assert theirs.json()["passcode"] == passcode


def test_wrong_passcode_cannot_join(client, host, guest):
    host_token, _ = host
    guest_token, _ = guest
    meeting = make_meeting(client, host_token)
    response = client.post(
        f"/api/meetings/{meeting['code']}/join",
        json={"passcode": "000000"},
        headers=auth(guest_token),
    )
    assert response.status_code == 403


# ------------------------------------------------------------------ waiting room
def test_waiting_room_holds_a_guest_until_the_host_admits(client, host, guest):
    host_token, _ = host
    guest_token, _ = guest
    meeting = make_meeting(client, host_token, waiting_room=True, passcode_required=False)
    code = meeting["code"]

    knock = client.post(f"/api/meetings/{code}/join", json={}, headers=auth(guest_token))
    assert knock.status_code == 200
    assert knock.json()["admitted"] is False
    participant_id = knock.json()["participant"]["id"]

    # The host walks straight in: the waiting room is theirs to run.
    entry = client.post(f"/api/meetings/{code}/join", json={}, headers=auth(host_token))
    assert entry.json()["admitted"] is True

    queue = client.get(f"/api/meetings/{code}/waiting", headers=auth(host_token))
    assert [p["participant_id"] for p in queue.json()] == [participant_id]

    admitted = client.post(
        f"/api/meetings/{code}/participants/{participant_id}/admit",
        headers=auth(host_token),
    )
    assert admitted.status_code == 200
    assert admitted.json()["admission"] == "admitted"

    again = client.post(f"/api/meetings/{code}/join", json={}, headers=auth(guest_token))
    assert again.json()["admitted"] is True
    assert client.get(f"/api/meetings/{code}/waiting", headers=auth(host_token)).json() == []


def test_an_attendee_cannot_run_the_waiting_room(client, host, guest):
    host_token, _ = host
    guest_token, _ = guest
    meeting = make_meeting(client, host_token, waiting_room=True, passcode_required=False)
    code = meeting["code"]
    knock = client.post(f"/api/meetings/{code}/join", json={}, headers=auth(guest_token))
    participant_id = knock.json()["participant"]["id"]

    assert client.get(f"/api/meetings/{code}/waiting", headers=auth(guest_token)).status_code == 403
    letting_self_in = client.post(
        f"/api/meetings/{code}/participants/{participant_id}/admit",
        headers=auth(guest_token),
    )
    assert letting_self_in.status_code == 403


def test_denied_at_the_door_means_denied(client, host, guest):
    host_token, _ = host
    guest_token, _ = guest
    meeting = make_meeting(client, host_token, waiting_room=True, passcode_required=False)
    code = meeting["code"]
    knock = client.post(f"/api/meetings/{code}/join", json={}, headers=auth(guest_token))
    participant_id = knock.json()["participant"]["id"]

    denied = client.post(
        f"/api/meetings/{code}/participants/{participant_id}/deny", headers=auth(host_token)
    )
    assert denied.status_code == 204

    retry = client.post(f"/api/meetings/{code}/join", json={}, headers=auth(guest_token))
    assert retry.status_code == 403


def test_no_waiting_room_means_straight_in(client, host, guest):
    host_token, _ = host
    guest_token, _ = guest
    meeting = make_meeting(client, host_token, waiting_room=False, passcode_required=False)
    joined = client.post(
        f"/api/meetings/{meeting['code']}/join", json={}, headers=auth(guest_token)
    )
    assert joined.json()["admitted"] is True


# --------------------------------------------------------------------- ejection
def test_a_removed_participant_cannot_rejoin(client, host, guest):
    host_token, _ = host
    guest_token, _ = guest
    meeting = make_meeting(client, host_token, passcode_required=False)
    code = meeting["code"]
    joined = client.post(f"/api/meetings/{code}/join", json={}, headers=auth(guest_token))
    participant_id = joined.json()["participant"]["id"]

    removed = client.post(
        f"/api/meetings/{code}/participants/{participant_id}/remove", headers=auth(host_token)
    )
    assert removed.status_code == 204

    # Zoom keeps an ejected attendee out for the rest of the meeting. A removal
    # they can undo by re-opening the invite link is not a removal.
    retry = client.post(f"/api/meetings/{code}/join", json={}, headers=auth(guest_token))
    assert retry.status_code == 403


def test_an_attendee_cannot_remove_or_mute_other_people(client, host, guest, stranger):
    host_token, _ = host
    guest_token, _ = guest
    other_token, _ = stranger
    meeting = make_meeting(client, host_token, passcode_required=False)
    code = meeting["code"]
    joined = client.post(f"/api/meetings/{code}/join", json={}, headers=auth(guest_token))
    participant_id = joined.json()["participant"]["id"]
    client.post(f"/api/meetings/{code}/join", json={}, headers=auth(other_token))

    assert client.post(
        f"/api/meetings/{code}/participants/{participant_id}/mute", headers=auth(other_token)
    ).status_code == 403
    assert client.post(
        f"/api/meetings/{code}/participants/{participant_id}/remove", headers=auth(other_token)
    ).status_code == 403


def test_the_host_cannot_be_removed(client, host, guest):
    host_token, host_user = host
    guest_token, _ = guest
    meeting = make_meeting(client, host_token, passcode_required=False)
    code = meeting["code"]
    entry = client.post(f"/api/meetings/{code}/join", json={}, headers=auth(host_token))
    host_participant_id = entry.json()["participant"]["id"]
    client.post(f"/api/meetings/{code}/join", json={}, headers=auth(guest_token))

    response = client.post(
        f"/api/meetings/{code}/participants/{host_participant_id}/remove",
        headers=auth(host_token),
    )
    assert response.status_code == 400


# -------------------------------------------------------------------- recording
def test_only_the_host_can_start_or_stop_the_recording(client, host, guest, stranger):
    host_token, _ = host
    guest_token, _ = guest
    stranger_token, _ = stranger
    meeting = make_meeting(client, host_token, passcode_required=False)
    code = meeting["code"]
    client.post(f"/api/meetings/{code}/join", json={}, headers=auth(guest_token))

    # Knowing a meeting id was once enough to record a stranger's call.
    assert client.post(
        f"/api/meetings/{code}/recording/start", headers=auth(stranger_token)
    ).status_code == 403
    assert client.post(
        f"/api/meetings/{code}/recording/start", headers=auth(guest_token)
    ).status_code == 403

    started = client.post(f"/api/meetings/{code}/recording/start", headers=auth(host_token))
    assert started.status_code == 201
    recording_id = started.json()["id"]

    assert client.post(
        f"/api/recordings/{recording_id}/stop", headers=auth(guest_token)
    ).status_code == 403
    assert client.post(
        f"/api/recordings/{recording_id}/stop", headers=auth(host_token)
    ).status_code == 200


def test_a_cohost_may_record(client, host, guest):
    host_token, _ = host
    guest_token, _ = guest
    meeting = make_meeting(client, host_token, passcode_required=False)
    code = meeting["code"]
    joined = client.post(f"/api/meetings/{code}/join", json={}, headers=auth(guest_token))
    participant_id = joined.json()["participant"]["id"]

    promoted = client.post(
        f"/api/meetings/{code}/participants/{participant_id}/cohost", headers=auth(host_token)
    )
    assert promoted.json()["role"] == "cohost"
    assert client.post(
        f"/api/meetings/{code}/recording/start", headers=auth(guest_token)
    ).status_code == 201


# ---------------------------------------------------------------- meeting is over
def test_nobody_can_join_a_meeting_that_ended(client, host, guest):
    host_token, _ = host
    guest_token, _ = guest
    meeting = make_meeting(client, host_token, passcode_required=False)
    code = meeting["code"]
    client.post(f"/api/meetings/{code}/end", headers=auth(host_token))

    assert client.post(
        f"/api/meetings/{code}/join", json={}, headers=auth(guest_token)
    ).status_code == 409
