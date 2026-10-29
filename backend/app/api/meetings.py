from fastapi import APIRouter, HTTPException, Request, status

from app.api.deps import CurrentUser, OptionalUser, Session
from app.api.signaling import close_meeting
from app.core.security import meeting_lookup_limiter
from app.websocket.rooms import rooms
from app.models import Meeting, User
from app.schemas.meetings import MeetingOut
from app.services import meetings

router = APIRouter(prefix="/meetings", tags=["meetings"])


def _out(meeting: Meeting, host: User, viewer: User | None) -> MeetingOut:
    return MeetingOut(
        code=meeting.code,
        status=meeting.status,
        host_name=host.name,
        is_host=viewer is not None and viewer.id == host.id,
        created_at=meeting.created_at,
    )


@router.post("", status_code=status.HTTP_201_CREATED)
async def create(user: CurrentUser, session: Session) -> MeetingOut:
    meeting = await meetings.create_meeting(session, user)
    await session.refresh(meeting)
    return _out(meeting, user, user)


@router.get("")
async def mine(user: CurrentUser, session: Session) -> list[MeetingOut]:
    """The signed-in user's most recent meetings (as host), newest first."""
    return [_out(m, user, user) for m in await meetings.recent_meetings(session, user)]


@router.get("/{code}")
async def get(code: str, request: Request, session: Session, viewer: OptionalUser) -> MeetingOut:
    """Anyone with the code can look a meeting up (guests join without an account)."""
    if not meeting_lookup_limiter.hit(request.client.host if request.client else "unknown"):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many lookups. Try again in a minute.")
    normalized = meetings.normalize_code(code)
    found = await meetings.get_meeting(session, normalized) if normalized else None
    if found is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No meeting with this code")
    if meetings.is_stale(found[0], rooms.size(found[0].code)):
        await meetings.end_meeting(session, found[0])
    return _out(*found, viewer)


@router.post("/{code}/end")
async def end(code: str, user: CurrentUser, session: Session) -> MeetingOut:
    normalized = meetings.normalize_code(code)
    found = await meetings.get_meeting(session, normalized) if normalized else None
    if found is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No meeting with this code")
    meeting, host = found
    if host.id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the host can end the meeting")
    await meetings.end_meeting(session, meeting)
    await close_meeting(meeting.code)
    return _out(meeting, host, user)
