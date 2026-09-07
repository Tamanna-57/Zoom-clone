"""Database schema.

Naming follows the product domain rather than the transport: a `Meeting` is the
scheduled/ad-hoc room, a `Participant` is one person's membership of one meeting,
and everything Fathom-shaped (transcript, summary, action items) hangs off a
`Recording`, which is created when a meeting starts recording.
"""
from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    """Naive UTC.

    SQLite has no timezone type, so every timestamp is stored naive and *is*
    UTC by convention. The API re-attaches the UTC offset on the way out
    (see `schemas.UtcDatetime`), which is what the browser needs.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)


class MeetingStatus(str, enum.Enum):
    scheduled = "scheduled"
    live = "live"
    ended = "ended"


class ParticipantRole(str, enum.Enum):
    host = "host"
    cohost = "cohost"
    participant = "participant"


class RecordingStatus(str, enum.Enum):
    recording = "recording"
    processing = "processing"
    ready = "ready"


class ActionItemStatus(str, enum.Enum):
    open = "open"
    done = "done"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Deterministic tile colour so a user looks the same everywhere without uploads.
    avatar_color: Mapped[str] = mapped_column(String(9), default="#2D8CFF")
    job_title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata")
    # A user's own permanent meeting room, mirroring Zoom's Personal Meeting ID.
    personal_meeting_id: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    hosted_meetings: Mapped[list["Meeting"]] = relationship(
        back_populates="host", foreign_keys="Meeting.host_id"
    )
    contacts: Mapped[list["Contact"]] = relationship(
        back_populates="owner", foreign_keys="Contact.owner_id",
        cascade="all, delete-orphan",
    )


class Contact(Base):
    """Directional address-book entry (owner saved contact)."""

    __tablename__ = "contacts"
    __table_args__ = (UniqueConstraint("owner_id", "contact_id", name="uq_contact_pair"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    contact_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    starred: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    owner: Mapped[User] = relationship(back_populates="contacts", foreign_keys=[owner_id])
    contact: Mapped[User] = relationship(foreign_keys=[contact_id])


class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 11 digits, rendered as "123 4567 8901" in the UI, like a Zoom meeting ID.
    code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    topic: Mapped[str] = mapped_column(String(200))
    passcode: Mapped[str | None] = mapped_column(String(16), nullable=True)
    host_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[MeetingStatus] = mapped_column(
        Enum(MeetingStatus), default=MeetingStatus.scheduled, index=True
    )
    scheduled_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=30)
    is_personal_room: Mapped[bool] = mapped_column(Boolean, default=False)
    waiting_room: Mapped[bool] = mapped_column(Boolean, default=False)
    mute_on_entry: Mapped[bool] = mapped_column(Boolean, default=True)
    video_on_entry: Mapped[bool] = mapped_column(Boolean, default=True)
    auto_record: Mapped[bool] = mapped_column(Boolean, default=True)
    agenda: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    host: Mapped[User] = relationship(back_populates="hosted_meetings", foreign_keys=[host_id])
    participants: Mapped[list["Participant"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan"
    )
    invitees: Mapped[list["Invitee"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan"
    )
    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan"
    )
    recordings: Mapped[list["Recording"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan"
    )


class Invitee(Base):
    """Someone invited to a scheduled meeting (may never join)."""

    __tablename__ = "meeting_invitees"
    __table_args__ = (UniqueConstraint("meeting_id", "user_id", name="uq_invitee"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    meeting: Mapped[Meeting] = relationship(back_populates="invitees")
    user: Mapped[User] = relationship()


class Participant(Base):
    """One attendance record. Rejoining the same meeting reuses the row."""

    __tablename__ = "meeting_participants"
    __table_args__ = (UniqueConstraint("meeting_id", "user_id", name="uq_participant"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    display_name: Mapped[str] = mapped_column(String(120))
    role: Mapped[ParticipantRole] = mapped_column(
        Enum(ParticipantRole), default=ParticipantRole.participant
    )
    is_online: Mapped[bool] = mapped_column(Boolean, default=False)
    is_muted: Mapped[bool] = mapped_column(Boolean, default=True)
    is_video_on: Mapped[bool] = mapped_column(Boolean, default=True)
    is_hand_raised: Mapped[bool] = mapped_column(Boolean, default=False)
    is_sharing: Mapped[bool] = mapped_column(Boolean, default=False)
    joined_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    left_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Seconds of speaking time, accumulated from transcript segments.
    talk_seconds: Mapped[int] = mapped_column(Integer, default=0)

    meeting: Mapped[Meeting] = relationship(back_populates="participants")
    user: Mapped[User | None] = relationship()


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), index=True)
    sender_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    sender_name: Mapped[str] = mapped_column(String(120))
    # NULL recipient means "Everyone"; otherwise a direct message inside the meeting.
    recipient_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    recipient_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)

    meeting: Mapped[Meeting] = relationship(back_populates="messages")


class Recording(Base):
    """A recorded session. The anchor for every Fathom-style artifact."""

    __tablename__ = "recordings"

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[RecordingStatus] = mapped_column(
        Enum(RecordingStatus), default=RecordingStatus.recording
    )
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)
    # Opaque token for the "share recap" link; no auth needed to view.
    share_token: Mapped[str] = mapped_column(String(40), unique=True, index=True)

    meeting: Mapped[Meeting] = relationship(back_populates="recordings")
    segments: Mapped[list["TranscriptSegment"]] = relationship(
        back_populates="recording", cascade="all, delete-orphan"
    )
    summary: Mapped["Summary | None"] = relationship(
        back_populates="recording", cascade="all, delete-orphan", uselist=False
    )
    action_items: Mapped[list["ActionItem"]] = relationship(
        back_populates="recording", cascade="all, delete-orphan"
    )
    highlights: Mapped[list["Highlight"]] = relationship(
        back_populates="recording", cascade="all, delete-orphan"
    )


class TranscriptSegment(Base):
    """One utterance. Offsets are milliseconds from the start of the recording."""

    __tablename__ = "transcript_segments"

    id: Mapped[int] = mapped_column(primary_key=True)
    recording_id: Mapped[int] = mapped_column(
        ForeignKey("recordings.id", ondelete="CASCADE"), index=True
    )
    speaker_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    speaker_name: Mapped[str] = mapped_column(String(120))
    start_ms: Mapped[int] = mapped_column(Integer, index=True)
    end_ms: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    recording: Mapped[Recording] = relationship(back_populates="segments")


class Summary(Base):
    __tablename__ = "summaries"

    id: Mapped[int] = mapped_column(primary_key=True)
    recording_id: Mapped[int] = mapped_column(
        ForeignKey("recordings.id", ondelete="CASCADE"), unique=True
    )
    headline: Mapped[str] = mapped_column(String(300))
    tldr: Mapped[str] = mapped_column(Text)
    # Which generator produced it: "rule-based-v1" today, an LLM id if wired up.
    generator: Mapped[str] = mapped_column(String(60), default="rule-based-v1")
    keywords: Mapped[str] = mapped_column(Text, default="")  # comma separated
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    recording: Mapped[Recording] = relationship(back_populates="summary")
    sections: Mapped[list["SummarySection"]] = relationship(
        back_populates="summary", cascade="all, delete-orphan", order_by="SummarySection.position"
    )


class SummarySection(Base):
    """A titled block of bullets, e.g. "Decisions" or "Risks"."""

    __tablename__ = "summary_sections"

    id: Mapped[int] = mapped_column(primary_key=True)
    summary_id: Mapped[int] = mapped_column(ForeignKey("summaries.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(120))
    position: Mapped[int] = mapped_column(Integer, default=0)
    # One bullet per line keeps this readable in SQLite without a JSON column.
    bullets: Mapped[str] = mapped_column(Text, default="")

    summary: Mapped[Summary] = relationship(back_populates="sections")


class ActionItem(Base):
    __tablename__ = "action_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    recording_id: Mapped[int] = mapped_column(
        ForeignKey("recordings.id", ondelete="CASCADE"), index=True
    )
    text: Mapped[str] = mapped_column(Text)
    assignee_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    assignee_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    due_hint: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[ActionItemStatus] = mapped_column(
        Enum(ActionItemStatus), default=ActionItemStatus.open
    )
    # Segment the item was extracted from, so the UI can jump to the moment.
    source_segment_id: Mapped[int | None] = mapped_column(
        ForeignKey("transcript_segments.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    recording: Mapped[Recording] = relationship(back_populates="action_items")


class Highlight(Base):
    """A moment a participant starred during the call (Fathom's headline feature)."""

    __tablename__ = "highlights"

    id: Mapped[int] = mapped_column(primary_key=True)
    recording_id: Mapped[int] = mapped_column(
        ForeignKey("recordings.id", ondelete="CASCADE"), index=True
    )
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_by_name: Mapped[str] = mapped_column(String(120))
    label: Mapped[str] = mapped_column(String(200), default="Highlight")
    at_ms: Mapped[int] = mapped_column(Integer)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    recording: Mapped[Recording] = relationship(back_populates="highlights")
