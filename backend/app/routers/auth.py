"""Onboarding: register -> verify -> login, plus Google Sign-In.

E-mail verification is still mocked behind a fixed `MOCK_OTP`; Google accounts
skip it entirely, because Google has already proved the address.
"""
from __future__ import annotations

import hashlib
import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import schemas
from ..config import settings
from ..database import get_db
from ..deps import get_current_user
from ..models import User, utcnow
from ..security import create_access_token, hash_password, verify_password
from ..serializers import user_public
from ..services.google import GoogleAuthError, GoogleIdentity, verify_credential

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Zoom-ish tile colours; picked deterministically from the e-mail so a user keeps
# the same colour across devices and seeds.
AVATAR_COLORS = [
    "#2D8CFF", "#F97316", "#8B5CF6", "#10B981", "#EF4444",
    "#0EA5E9", "#EC4899", "#F59E0B", "#14B8A6", "#6366F1",
]


def color_for(email: str) -> str:
    digest = hashlib.sha256(email.lower().encode()).digest()
    return AVATAR_COLORS[digest[0] % len(AVATAR_COLORS)]


def new_personal_meeting_id() -> str:
    return "".join(secrets.choice("0123456789") for _ in range(10))


@router.post("/register", response_model=schemas.AuthResponse, status_code=201)
def register(payload: schemas.RegisterRequest, db: Session = Depends(get_db)):
    existing = db.scalar(select(User).where(User.email == payload.email.lower()))
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with that e-mail already exists")

    user = User(
        email=payload.email.lower(),
        display_name=payload.display_name.strip(),
        password_hash=hash_password(payload.password),
        job_title=payload.job_title,
        avatar_color=color_for(payload.email),
        personal_meeting_id=new_personal_meeting_id(),
        is_verified=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return schemas.AuthResponse(access_token=create_access_token(user.id), user=user_public(user))


@router.post("/verify", response_model=schemas.AuthResponse)
def verify_otp(payload: schemas.VerifyOtpRequest, db: Session = Depends(get_db)):
    """Verification is mocked: any account is verified by the fixed MOCK_OTP."""
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No account for that e-mail")
    if payload.code.strip() != settings.mock_otp:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That code is not correct")
    user.is_verified = True
    db.commit()
    db.refresh(user)
    return schemas.AuthResponse(access_token=create_access_token(user.id), user=user_public(user))


@router.post("/login", response_model=schemas.AuthResponse)
def login(payload: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if user is not None and user.password_hash is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "That account was created with Google. Use Continue with Google.",
        )
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect e-mail or password")
    user.last_seen_at = utcnow()
    db.commit()
    db.refresh(user)
    return schemas.AuthResponse(access_token=create_access_token(user.id), user=user_public(user))


def _user_for_google(db: Session, identity: GoogleIdentity) -> User:
    """Find, link or create the account behind a verified Google identity."""
    user = db.scalar(select(User).where(User.google_sub == identity.subject))
    if user is None:
        # Same address, signed up with a password first: link the two rather
        # than failing on the unique e-mail, which is what Zoom does too.
        user = db.scalar(select(User).where(User.email == identity.email))
    if user is None:
        user = User(
            email=identity.email,
            display_name=identity.name or identity.email.split("@")[0],
            password_hash=None,
            avatar_url=identity.picture,
            avatar_color=color_for(identity.email),
            personal_meeting_id=new_personal_meeting_id(),
        )
        db.add(user)

    user.google_sub = identity.subject
    # Google only ever hands us verified addresses (checked in the service).
    user.is_verified = True
    if identity.picture and not user.avatar_url:
        user.avatar_url = identity.picture
    user.last_seen_at = utcnow()
    return user


@router.post("/google", response_model=schemas.AuthResponse)
def google_sign_in(payload: schemas.GoogleAuthRequest, db: Session = Depends(get_db)):
    """Exchange a Google ID token for a Zoomeet access token."""
    try:
        identity = verify_credential(payload.credential)
    except GoogleAuthError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc

    user = _user_for_google(db, identity)
    db.commit()
    db.refresh(user)
    return schemas.AuthResponse(access_token=create_access_token(user.id), user=user_public(user))


@router.get("/me", response_model=schemas.UserPublic)
def me(current: User = Depends(get_current_user)):
    return user_public(current)


@router.post("/logout", status_code=204)
def logout(current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Tokens are stateless; this just records the sign-out for last-seen."""
    current.last_seen_at = utcnow()
    db.commit()
