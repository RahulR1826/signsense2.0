from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.security import read_session_token
from app.models import User

Session = Annotated[AsyncSession, Depends(get_session)]


async def optional_user(request: Request, session: Session) -> User | None:
    token = request.cookies.get(settings.session_cookie)
    user_id = read_session_token(token) if token else None
    return await session.get(User, user_id) if user_id else None


async def current_user(user: Annotated[User | None, Depends(optional_user)]) -> User:
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not signed in")
    return user


OptionalUser = Annotated[User | None, Depends(optional_user)]
CurrentUser = Annotated[User, Depends(current_user)]
