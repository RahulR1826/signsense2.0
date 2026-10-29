from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, verify_password
from app.models import CommunicationPreference, Meeting, MeetingStatus, Participant, User
from app.schemas.auth import PreferencesIn

# Verified against when the email doesn't exist, so a login takes the same time either way.
_DUMMY_HASH = hash_password("timing-equaliser-not-a-real-password")


class EmailTaken(Exception):
    pass


async def create_user(session: AsyncSession, name: str, email: str, password: str) -> User:
    user = User(name=name, email=email.lower(), password_hash=hash_password(password))
    session.add(user)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise EmailTaken from exc
    await session.refresh(user, attribute_names=["preferences"])
    return user


async def authenticate(session: AsyncSession, email: str, password: str) -> User | None:
    user = await session.scalar(select(User).where(User.email == email.lower()))
    if user is None:
        verify_password(_DUMMY_HASH, password)
        return None
    return user if verify_password(user.password_hash, password) else None


async def set_preferences(session: AsyncSession, user: User, prefs: PreferencesIn) -> CommunicationPreference:
    current = user.preferences
    if current is None:
        current = CommunicationPreference(user_id=user.id)
        session.add(current)
    for field, value in prefs.model_dump().items():
        setattr(current, field, value)
    await session.commit()
    await session.refresh(current)
    return current


async def delete_account(session: AsyncSession, user: User) -> list[str]:
    """Delete the user and everything tied to them. Returns codes of their meetings that were still active.

    Preferences and hosted meetings (with their participant rows) go via ON DELETE CASCADE. In other
    people's meetings the user's participant rows stay (the host's history) but lose the name and link.
    """
    active = list(
        await session.scalars(select(Meeting.code).where(Meeting.host_id == user.id, Meeting.status == MeetingStatus.active))
    )
    await session.execute(update(Participant).where(Participant.user_id == user.id).values(display_name="Deleted user", user_id=None))
    await session.execute(delete(User).where(User.id == user.id))
    await session.commit()
    return active
