"""Verification of Google Sign-In credentials.

Google Identity Services hands the browser a signed ID token; the browser posts
it to `/api/auth/google`. Everything we act on is read from that token *after*
checking its signature against Google's published keys, so a caller cannot claim
an identity by editing a request body.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import jwt
from jwt import PyJWKClient

from ..config import settings

# Google signs ID tokens with rotating RSA keys published here.
JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
# Historic and current spellings; Google still mints both.
ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


class GoogleAuthError(Exception):
    """The credential is missing, malformed, expired or not ours."""


@dataclass(frozen=True)
class GoogleIdentity:
    subject: str
    email: str
    name: str | None
    picture: str | None


@lru_cache
def _jwks_client() -> PyJWKClient:
    # Keys are cached in-process and refetched when Google rotates them.
    return PyJWKClient(JWKS_URL, cache_keys=True)


def verify_credential(credential: str) -> GoogleIdentity:
    """Validate a Google ID token and return the identity it asserts."""
    if not settings.google_client_id:
        raise GoogleAuthError("Google sign-in is not configured on this server")

    try:
        signing_key = _jwks_client().get_signing_key_from_jwt(credential)
        claims = jwt.decode(
            credential,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.google_client_id,
            options={"require": ["exp", "iat", "aud", "iss", "sub"]},
        )
    except jwt.PyJWTError as exc:
        raise GoogleAuthError("That Google sign-in could not be verified") from exc
    except Exception as exc:  # network failure fetching the key set
        raise GoogleAuthError("Could not reach Google to verify the sign-in") from exc

    if claims.get("iss") not in ISSUERS:
        raise GoogleAuthError("That token was not issued by Google")

    email = (claims.get("email") or "").lower()
    if not email:
        raise GoogleAuthError("That Google account exposes no e-mail address")
    # Unverified addresses are refused: otherwise someone could claim an e-mail
    # they do not own and take over the matching Zoomeet account.
    if not claims.get("email_verified"):
        raise GoogleAuthError("That Google account's e-mail address is not verified")

    return GoogleIdentity(
        subject=str(claims["sub"]),
        email=email,
        name=(claims.get("name") or "").strip() or None,
        picture=claims.get("picture") or None,
    )
