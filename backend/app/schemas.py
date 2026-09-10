"""Pydantic request/response models. These are the API contract."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field

from .models import (
    ActionItemStatus,
    AdmissionState,
    MeetingStatus,
    ParticipantRole,
    RecordingStatus,
)


def _assume_utc(value: datetime) -> datetime:
    """Timestamps are stored naive-UTC; tag them so clients parse them right."""
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _to_naive_utc(value: datetime) -> datetime:
    """Incoming timestamps are normalised to naive UTC before they hit SQLite."""
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


UtcDatetime = Annotated[datetime, AfterValidator(_assume_utc)]
IncomingDatetime = Annotated[datetime, AfterValidator(_to_naive_utc)]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------- auth
class RegisterRequest(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=6, max_length=128)
    job_title: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class VerifyOtpRequest(BaseModel):
    email: EmailStr
    code: str


class GoogleAuthRequest(BaseModel):
    """The ID token Google Identity Services handed the browser."""

    credential: str = Field(min_length=1)


class UserPublic(ORMModel):
    id: int
    email: EmailStr
    display_name: str
    avatar_url: str | None = None
    avatar_color: str
    job_title: str | None = None
    timezone: str
    personal_meeting_id: str
    is_verified: bool
    last_seen_at: UtcDatetime


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class UserUpdate(BaseModel):
    display_name: str | None = None
    job_title: str | None = None
    avatar_color: str | None = None
    avatar_url: str | None = None
    timezone: str | None = None


# ----------------------------------------------------------------------- contacts
class ContactOut(ORMModel):
    id: int
    starred: bool
    contact: UserPublic


class ContactCreate(BaseModel):
    email: EmailStr


# ----------------------------------------------------------------------- meetings
class MeetingCreate(BaseModel):
    topic: str = Field(min_length=1, max_length=200)
    scheduled_start: IncomingDatetime | None = None
    duration_minutes: int = Field(default=30, ge=5, le=600)
    agenda: str | None = None
    passcode_required: bool = True
    waiting_room: bool = False
    mute_on_entry: bool = True
    video_on_entry: bool = True
    auto_record: bool = True
    invitee_ids: list[int] = Field(default_factory=list)
    start_now: bool = False


class MeetingUpdate(BaseModel):
    topic: str | None = None
    scheduled_start: IncomingDatetime | None = None
    duration_minutes: int | None = None
    agenda: str | None = None
    waiting_room: bool | None = None
    mute_on_entry: bool | None = None
    video_on_entry: bool | None = None
    auto_record: bool | None = None


class ParticipantOut(ORMModel):
    id: int
    user_id: int | None
    display_name: str
    role: ParticipantRole
    admission: AdmissionState
    is_online: bool
    is_muted: bool
    is_video_on: bool
    is_hand_raised: bool
    is_sharing: bool
    joined_at: UtcDatetime | None
    left_at: UtcDatetime | None
    talk_seconds: int
    avatar_color: str = "#2D8CFF"


class MeetingOut(ORMModel):
    id: int
    code: str
    topic: str
    # Only ever filled in for the host, a co-host, or someone already admitted.
    # Serving it to anyone who knows the meeting id would defeat the passcode.
    passcode: str | None
    status: MeetingStatus
    host: UserPublic
    scheduled_start: UtcDatetime | None
    duration_minutes: int
    is_personal_room: bool
    waiting_room: bool
    mute_on_entry: bool
    video_on_entry: bool
    auto_record: bool
    agenda: str | None
    started_at: UtcDatetime | None
    ended_at: UtcDatetime | None
    created_at: UtcDatetime
    participants: list[ParticipantOut] = Field(default_factory=list)
    invitees: list[UserPublic] = Field(default_factory=list)
    active_recording_id: int | None = None
    latest_recording_id: int | None = None
    join_url: str = ""


class JoinRequest(BaseModel):
    passcode: str | None = None
    display_name: str | None = None


class JoinResponse(BaseModel):
    meeting: MeetingOut
    participant: ParticipantOut
    ice_servers: list[dict]
    ws_url: str
    # False while the waiting room holds this person: the browser shows the
    # "waiting for the host to let you in" screen instead of opening the call.
    admitted: bool = True


class WaitingParticipant(BaseModel):
    """Someone knocking at the waiting room, as the host's panel sees them."""

    participant_id: int
    user_id: int | None
    display_name: str
    avatar_color: str


# --------------------------------------------------------------------------- chat
class ChatMessageOut(ORMModel):
    id: int
    meeting_id: int
    sender_id: int | None
    sender_name: str
    recipient_id: int | None
    recipient_name: str | None
    body: str
    created_at: UtcDatetime


class ChatMessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    recipient_id: int | None = None


# --------------------------------------------------------- recordings / AI notes
class TranscriptSegmentOut(ORMModel):
    id: int
    speaker_id: int | None
    speaker_name: str
    start_ms: int
    end_ms: int
    text: str


class TranscriptSegmentCreate(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)
    speaker_name: str | None = None


class SummarySectionOut(BaseModel):
    title: str
    position: int
    bullets: list[str]


class SummaryOut(ORMModel):
    id: int
    headline: str
    tldr: str
    generator: str
    keywords: list[str]
    created_at: UtcDatetime
    sections: list[SummarySectionOut]


class ActionItemOut(ORMModel):
    id: int
    text: str
    assignee_name: str | None
    assignee_id: int | None
    due_hint: str | None
    status: ActionItemStatus
    source_segment_id: int | None


class ActionItemCreate(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    assignee_name: str | None = None
    due_hint: str | None = None


class ActionItemUpdate(BaseModel):
    text: str | None = None
    assignee_name: str | None = None
    status: ActionItemStatus | None = None


class HighlightOut(ORMModel):
    id: int
    created_by_id: int | None
    created_by_name: str
    label: str
    at_ms: int
    note: str | None
    created_at: UtcDatetime


class HighlightCreate(BaseModel):
    at_ms: int = Field(ge=0)
    label: str = "Highlight"
    note: str | None = None


class SpeakerStat(BaseModel):
    speaker_name: str
    seconds: int
    percent: float
    words: int


class RecordingOut(ORMModel):
    id: int
    meeting_id: int
    meeting_code: str
    title: str
    status: RecordingStatus
    started_at: UtcDatetime
    ended_at: UtcDatetime | None
    duration_seconds: int
    share_token: str
    host_name: str = ""
    participant_names: list[str] = Field(default_factory=list)
    segment_count: int = 0
    action_item_count: int = 0
    highlight_count: int = 0


class RecordingDetail(RecordingOut):
    segments: list[TranscriptSegmentOut] = Field(default_factory=list)
    summary: SummaryOut | None = None
    action_items: list[ActionItemOut] = Field(default_factory=list)
    highlights: list[HighlightOut] = Field(default_factory=list)
    speaker_stats: list[SpeakerStat] = Field(default_factory=list)
