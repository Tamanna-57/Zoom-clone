"""Zoomeet API — FastAPI application factory."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import Base, engine
from .routers import auth, meetings, recordings, users
from .serializers import ice_servers
from .ws import signaling

@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
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
    """Everything the browser needs before joining a call."""
    return {"iceServers": ice_servers(), "mockOtp": settings.mock_otp}


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(meetings.router)
app.include_router(recordings.router)
app.include_router(signaling.router)
