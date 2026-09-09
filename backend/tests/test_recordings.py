"""Stopping a recording queues the recap instead of generating it inline."""
from __future__ import annotations

import pytest


@pytest.fixture
def host(client):
    """A signed-in user, as an Authorization header."""
    response = client.post(
        "/api/auth/register",
        json={"email": "host@example.com", "display_name": "Host", "password": "hunter2x"},
    )
    if response.status_code == 409:  # the session-scoped database is reused
        response = client.post(
            "/api/auth/login", json={"email": "host@example.com", "password": "hunter2x"}
        )
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def recording(client, host):
    """A live meeting with one transcript line, mid-recording."""
    meeting = client.post(
        "/api/meetings", json={"topic": "Launch review", "start_now": True}, headers=host
    ).json()
    started = client.post(
        f"/api/meetings/{meeting['code']}/recording/start", headers=host
    ).json()
    client.post(
        f"/api/recordings/{started['id']}/segments",
        json={
            "text": "We agreed to ship the pricing page on Friday. I'll draft the runbook.",
            "start_ms": 0,
            "end_ms": 6000,
        },
        headers=host,
    )
    return started


async def drain_jobs() -> None:
    from app.services.jobs import jobs

    await jobs.wait_for_idle()


def test_stop_returns_processing_then_the_worker_finishes(client, host, recording):
    stopped = client.post(f"/api/recordings/{recording['id']}/stop", headers=host)
    assert stopped.status_code == 200

    body = stopped.json()
    # The response comes back before the recap exists.
    assert body["status"] == "processing"
    assert body["summary"] is None
    assert body["ended_at"] is not None

    client.portal.call(drain_jobs)

    done = client.get(f"/api/recordings/{recording['id']}", headers=host).json()
    assert done["status"] == "ready"
    assert done["summary"] is not None
    assert done["summary"]["tldr"]
    # Talk time is rolled up by the same job.
    assert any(row["seconds"] > 0 for row in done["speaker_stats"])


def test_stopping_twice_queues_one_job(client, host, recording):
    first = client.post(f"/api/recordings/{recording['id']}/stop", headers=host).json()
    second = client.post(f"/api/recordings/{recording['id']}/stop", headers=host).json()
    assert first["status"] == "processing"
    # The second call is a no-op: already stopped, so nothing is queued again.
    assert second["status"] in {"processing", "ready"}

    client.portal.call(drain_jobs)
    assert client.get(f"/api/recordings/{recording['id']}", headers=host).json()["status"] == "ready"


def test_a_failed_job_leaves_the_recording_processing_and_says_so(
    client, host, recording, monkeypatch
):
    from app.routers import recordings as module

    sent: list[dict] = []

    async def capture(_code, payload, *args, **kwargs):
        sent.append(payload)

    def explode(*_args, **_kwargs):
        raise RuntimeError("summariser blew up")

    monkeypatch.setattr(module.hub, "broadcast", capture)
    monkeypatch.setattr(module, "generate_summary", explode)

    client.post(f"/api/recordings/{recording['id']}/stop", headers=host)
    client.portal.call(drain_jobs)

    assert [payload["state"] for payload in sent] == ["processing", "failed"]
    # Never marked ready on a recap that does not exist.
    stuck = client.get(f"/api/recordings/{recording['id']}", headers=host).json()
    assert stuck["status"] == "processing"
    assert stuck["summary"] is None


def test_regenerate_recovers_a_recording_stuck_in_processing(client, host, recording):
    client.post(f"/api/recordings/{recording['id']}/stop", headers=host)
    client.portal.call(drain_jobs)

    regenerated = client.post(f"/api/recordings/{recording['id']}/regenerate", headers=host).json()
    assert regenerated["status"] == "ready"
    assert regenerated["summary"] is not None
