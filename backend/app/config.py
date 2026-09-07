"""Application settings, read from the environment with safe local defaults."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings:
    """Runtime configuration.

    Everything has a working default so `uvicorn app.main:app` runs with no
    environment set up at all, which is what the README tells a reviewer to do.
    """

    def __init__(self) -> None:
        self.app_name: str = "Zoomeet API"
        self.database_url: str = os.getenv(
            "DATABASE_URL", f"sqlite:///{BASE_DIR / 'zoomeet.db'}"
        )
        self.jwt_secret: str = os.getenv("JWT_SECRET", "dev-secret-change-me")
        self.jwt_algorithm: str = "HS256"
        self.access_token_ttl_minutes: int = int(
            os.getenv("ACCESS_TOKEN_TTL_MINUTES", str(60 * 24 * 7))
        )
        # Mocked SMS/e-mail verification code. Any account can be verified with it.
        self.mock_otp: str = os.getenv("MOCK_OTP", "123456")
        self.cors_origins: list[str] = [
            o.strip()
            for o in os.getenv(
                "CORS_ORIGINS",
                "http://localhost:3000,http://127.0.0.1:3000",
            ).split(",")
            if o.strip()
        ]
        # Public STUN servers are enough for a mesh call between browsers that are
        # not both behind symmetric NAT. A TURN URL can be injected for hard networks.
        self.stun_urls: list[str] = [
            u.strip()
            for u in os.getenv(
                "STUN_URLS", "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302"
            ).split(",")
            if u.strip()
        ]
        self.turn_url: str | None = os.getenv("TURN_URL") or None
        self.turn_username: str | None = os.getenv("TURN_USERNAME") or None
        self.turn_credential: str | None = os.getenv("TURN_CREDENTIAL") or None


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
