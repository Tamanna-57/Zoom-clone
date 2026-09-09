"""Sign-in paths: e-mail/password, and Google.

The Google tests sign their own ID tokens with a throwaway RSA key and point the
verifier at that key, so they exercise the real `jwt.decode` call — audience,
issuer, expiry and signature — without talking to Google.
"""
from __future__ import annotations

import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

CLIENT_ID = "test-client.apps.googleusercontent.com"


@pytest.fixture(scope="module")
def signing_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(autouse=True)
def _trust_the_test_key(monkeypatch, signing_key):
    from app.services import google

    monkeypatch.setattr(
        google,
        "_jwks_client",
        lambda: SimpleNamespace(
            get_signing_key_from_jwt=lambda _token: SimpleNamespace(key=signing_key.public_key())
        ),
    )


def credential(signing_key, **overrides) -> str:
    now = int(time.time())
    claims = {
        "iss": "https://accounts.google.com",
        "aud": CLIENT_ID,
        "sub": "google-subject-1",
        "email": "Ada@Example.com",
        "email_verified": True,
        "name": "Ada Lovelace",
        "picture": "https://lh3.googleusercontent.com/ada",
        "iat": now,
        "exp": now + 3600,
    }
    claims.update(overrides)
    return jwt.encode(claims, signing_key, algorithm="RS256")


# ------------------------------------------------------------------ password
def test_register_then_login(client):
    created = client.post(
        "/api/auth/register",
        json={"email": "Grace@Example.com", "display_name": "Grace", "password": "hunter2x"},
    )
    assert created.status_code == 201
    # E-mail addresses are stored and matched lowercased.
    assert created.json()["user"]["email"] == "grace@example.com"

    assert client.post(
        "/api/auth/login", json={"email": "grace@example.com", "password": "hunter2x"}
    ).status_code == 200
    assert client.post(
        "/api/auth/login", json={"email": "grace@example.com", "password": "wrong"}
    ).status_code == 401


def test_duplicate_registration_is_rejected(client):
    body = {"email": "dupe@example.com", "display_name": "Dupe", "password": "hunter2x"}
    assert client.post("/api/auth/register", json=body).status_code == 201
    assert client.post("/api/auth/register", json=body).status_code == 409


# -------------------------------------------------------------------- google
def test_google_sign_in_creates_a_verified_account(client, signing_key):
    response = client.post("/api/auth/google", json={"credential": credential(signing_key)})
    assert response.status_code == 200

    user = response.json()["user"]
    assert user["email"] == "ada@example.com"
    assert user["display_name"] == "Ada Lovelace"
    # Google has already proved the address, so no OTP step.
    assert user["is_verified"] is True

    # The token works against an authenticated route.
    token = response.json()["access_token"]
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_google_sign_in_is_idempotent(client, signing_key):
    first = client.post("/api/auth/google", json={"credential": credential(signing_key)})
    second = client.post("/api/auth/google", json={"credential": credential(signing_key)})
    assert first.json()["user"]["id"] == second.json()["user"]["id"]


def test_google_links_to_an_existing_password_account(client, signing_key):
    client.post(
        "/api/auth/register",
        json={"email": "linked@example.com", "display_name": "Linked", "password": "hunter2x"},
    )
    existing = client.post(
        "/api/auth/login", json={"email": "linked@example.com", "password": "hunter2x"}
    ).json()["user"]["id"]

    linked = client.post(
        "/api/auth/google",
        json={"credential": credential(signing_key, sub="google-subject-2", email="linked@example.com")},
    )
    assert linked.json()["user"]["id"] == existing
    # Linking must not cost the account its password.
    assert client.post(
        "/api/auth/login", json={"email": "linked@example.com", "password": "hunter2x"}
    ).status_code == 200


def test_password_login_on_a_google_only_account_is_refused(client, signing_key):
    client.post(
        "/api/auth/google",
        json={"credential": credential(signing_key, sub="google-subject-3", email="pwless@example.com")},
    )
    response = client.post(
        "/api/auth/login", json={"email": "pwless@example.com", "password": "anything"}
    )
    assert response.status_code == 401
    assert "Google" in response.json()["detail"]


@pytest.mark.parametrize(
    ("overrides", "expected_in_detail"),
    [
        ({"email_verified": False}, "not verified"),
        ({"aud": "some-other-client"}, "could not be verified"),
        ({"iss": "https://evil.example.com"}, "not issued by Google"),
        ({"exp": int(time.time()) - 60}, "could not be verified"),
        ({"email": ""}, "no e-mail"),
    ],
)
def test_google_rejects_bad_credentials(client, signing_key, overrides, expected_in_detail):
    response = client.post(
        "/api/auth/google", json={"credential": credential(signing_key, **overrides)}
    )
    assert response.status_code == 401
    assert expected_in_detail in response.json()["detail"]


def test_google_rejects_a_token_it_cannot_parse(client):
    assert client.post("/api/auth/google", json={"credential": "not-a-jwt"}).status_code == 401
