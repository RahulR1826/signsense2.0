from fastapi import APIRouter, HTTPException, Request, Response, status

from app.api.deps import CurrentUser, Session
from app.core.config import settings
from app.core.security import create_session_token, login_limiter, signup_limiter
from app.schemas.auth import DeleteAccountIn, LoginIn, PreferencesIn, ProfileIn, PreferencesOut, SignupIn, UserOut
from app.services import users

router = APIRouter(tags=["auth"])


def _set_session(response: Response, user_id) -> None:
    response.set_cookie(
        settings.session_cookie,
        create_session_token(user_id),
        max_age=settings.session_days * 24 * 3600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


@router.post("/auth/signup", status_code=status.HTTP_201_CREATED)
async def signup(body: SignupIn, request: Request, response: Response, session: Session) -> UserOut:
    if not signup_limiter.hit(request.client.host if request.client else "unknown"):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many new accounts. Try again later.")
    try:
        user = await users.create_user(session, body.name, body.email, body.password)
    except users.EmailTaken:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists")
    _set_session(response, user.id)
    return UserOut.model_validate(user)


@router.post("/auth/login")
async def login(body: LoginIn, request: Request, response: Response, session: Session) -> UserOut:
    client = request.client.host if request.client else "unknown"
    if not login_limiter.hit(f"{client}|{body.email.lower()}"):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many attempts. Try again later.")
    user = await users.authenticate(session, body.email, body.password)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Wrong email or password")
    _set_session(response, user.id)
    return UserOut.model_validate(user)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> None:
    response.delete_cookie(settings.session_cookie, path="/", httponly=True, secure=settings.cookie_secure, samesite="lax")


@router.get("/auth/me")
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.patch("/users/me")
async def update_profile(body: ProfileIn, user: CurrentUser, session: Session) -> UserOut:
    user.name = body.name
    await session.commit()
    await session.refresh(user, attribute_names=["name", "preferences"])
    return UserOut.model_validate(user)


@router.delete("/users/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(body: DeleteAccountIn, request: Request, response: Response, user: CurrentUser, session: Session) -> None:
    """Permanently delete the signed-in account. The password is required again, so a borrowed session can't do it."""
    client = request.client.host if request.client else "unknown"
    if not login_limiter.hit(f"{client}|{user.email}"):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many attempts. Try again later.")
    if await users.authenticate(session, user.email, body.password) is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="That password is not correct")
    from app.api.signaling import close_meeting  # local import: signaling imports auth helpers

    for code in await users.delete_account(session, user):
        await close_meeting(code)
    response.delete_cookie(settings.session_cookie, path="/", httponly=True, secure=settings.cookie_secure, samesite="lax")


@router.put("/users/me/preferences")
async def update_preferences(body: PreferencesIn, user: CurrentUser, session: Session) -> PreferencesOut:
    return PreferencesOut.model_validate(await users.set_preferences(session, user, body))
