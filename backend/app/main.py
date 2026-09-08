"""Zoomeet API — FastAPI application factory."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings, warn_about_insecure_defaults
from .routers import auth, meetings, recordings, users
from .serializers import ice_servers
from .ws import signaling

logger = logging.getLogger("zoomeet")


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Startup checks only.

    The schema is owned by Alembic: run `alembic upgrade head` before starting
    (the Render start command does). Creating tables from the models at boot
    cannot apply a change to a database that already exists, which is exactly
    the case that matters once there is data to keep.
    """
    for warning in warn_about_insecure_defaults(settings):
        logger.warning(warning)
    yield


app = FastAPI(
    lifespan=lifespan,
    title=settings.app_name,
    version="1.0.0",
    description=(
        "Backend for Zoomeet: video meetings with a Fathom-style AI notetaker. "
        "REST for state, one WebSocket per meeting for WebRTC signaling, presence, "
        "chat and live transcript."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", tags=["meta"])
def health() -> dict:
    return {"status": "ok", "service": settings.app_name}


@app.get("/api/config", tags=["meta"])
def client_config() -> dict:
    """Everything the browser needs before signing in or joining a call.

    `googleClientId` is served rather than baked into the frontend build so the
    Google credentials can be rotated without redeploying the frontend.
    """
    return {
        "iceServers": ice_servers(),
        "mockOtp": settings.mock_otp,
        "googleClientId": settings.google_client_id,
    }


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(meetings.router)
app.include_router(recordings.router)
app.include_router(signaling.router)
