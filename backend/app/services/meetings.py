import re
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import Meeting, MeetingStatus, Participant, User

# No 0/O, 1/I/L: codes get read aloud and typed by people.
ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
CODE_LEN = 5
CODE_PATTERN = re.compile(rf"^SS-[{ALPHABET}]{{{CODE_LEN}}}$")


def new_code() -> str:
    return "SS-" + "".join(secrets.choice(ALPHABET) for _ in range(CODE_LEN))


def normalize_code(raw: str) -> str | None:
    """Accept 'ss-7f4k2', '7F4K2', ' SS 7F4K2 ' -> 'SS-7F4K2'; None if it can't be a code."""
    s = re.sub(r"[\s-]", "", raw.upper())
    if s.startswith("SS"):
        s = s[2:]
    code = f"SS-{s}"
    return code if CODE_PATTERN.match(code) else None


async def create_meeting(session: AsyncSession, host: User) -> Meeting:
    for _ in range(5):
        meeting = Meeting(code=new_code(), host_id=host.id)
        session.add(meeting)
        try:
            await session.commit()
            return meeting
        except IntegrityError:  # code collision; try another
            await session.rollback()
    raise RuntimeError("could not allocate a meeting code")


async def get_meeting(session: AsyncSession, code: str) -> tuple[Meeting, User] | None:
    row = (
        await session.execute(select(Meeting, User).join(User, Meeting.host_id == User.id).where(Meeting.code == code))
    ).first()
    return (row[0], row[1]) if row else None


async def recent_meetings(session: AsyncSession, host: User, limit: int = 10) -> list[Meeting]:
    rows = await session.scalars(
        select(Meeting).where(Meeting.host_id == host.id).order_by(Meeting.created_at.desc()).limit(limit)
    )
    return list(rows)


async def end_meeting(session: AsyncSession, meeting: Meeting) -> None:
    meeting.status = MeetingStatus.ended
    meeting.ended_at = datetime.now(UTC)
    await session.commit()


def is_stale(meeting: Meeting, connected: int, now: datetime | None = None) -> bool:
    """An active meeting with nobody connected that is older than meeting_ttl_hours."""
    now = now or datetime.now(UTC)
    return (
        meeting.status == MeetingStatus.active
        and connected == 0
        and meeting.created_at is not None
        and now - meeting.created_at > timedelta(hours=settings.meeting_ttl_hours)
    )


async def close_dangling_participants(session: AsyncSession) -> int:
    """At startup nobody is connected yet: anyone still marked as in a call was cut off by a restart/crash."""
    result = await session.execute(update(Participant).where(Participant.left_at.is_(None)).values(left_at=datetime.now(UTC)))
    await session.commit()
    return result.rowcount or 0
