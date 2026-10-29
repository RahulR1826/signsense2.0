import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Enum, Float, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class CommunicationMode(str, enum.Enum):
    signer = "signer"  # uses sign language
    non_signer = "non_signer"  # speaks / types
    both = "both"


class MeetingStatus(str, enum.Enum):
    active = "active"
    ended = "ended"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(80))
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    preferences: Mapped["CommunicationPreference | None"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan", lazy="selectin"
    )


class CommunicationPreference(Base):
    __tablename__ = "communication_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    mode: Mapped[CommunicationMode] = mapped_column(Enum(CommunicationMode, name="communication_mode"))
    sign_language: Mapped[str] = mapped_column(String(8), default="ISL")
    sign_to_text: Mapped[bool] = mapped_column(Boolean, default=True)
    text_to_sign: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="preferences")


class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    host_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[MeetingStatus] = mapped_column(
        Enum(MeetingStatus, name="meeting_status"), default=MeetingStatus.active
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Participant(Base):
    """One person's presence in a meeting. Guests (no account) have user_id NULL."""

    __tablename__ = "participants"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    meeting_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    display_name: Mapped[str] = mapped_column(String(80))
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PersonalSign(Base):
    """A user's own sign ("My signs"): matched on their device, offered as a suggestion, never auto-sent."""

    __tablename__ = "personal_signs"
    __table_args__ = (UniqueConstraint("user_id", "label", name="uq_personal_sign_label"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(40))
    emoji: Mapped[str | None] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    samples: Mapped[list["PersonalSignSample"]] = relationship(
        back_populates="sign", cascade="all, delete-orphan", lazy="selectin", order_by="PersonalSignSample.created_at"
    )


class PersonalSignSample(Base):
    """One recorded take: body/hand/face landmarks only (no video), so it can be re-matched by future models
    and replayed by the mascot."""

    __tablename__ = "personal_sign_samples"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("personal_signs.id", ondelete="CASCADE"), index=True)
    extractor_version: Mapped[str] = mapped_column(String(100))
    aspect: Mapped[float] = mapped_column(Float)
    frames: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    sign: Mapped[PersonalSign] = relationship(back_populates="samples")

