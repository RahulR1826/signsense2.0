"""My signs: a signed-in user's own signs (landmark takes only, never video). Owner-only access."""

import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, Session
from app.models import PersonalSign, PersonalSignSample
from app.schemas.personal_signs import MAX_SIGNS_PER_USER, PersonalSignIn, PersonalSignOut

router = APIRouter(prefix="/personal-signs", tags=["personal signs"])


@router.get("")
async def list_signs(user: CurrentUser, session: Session) -> list[PersonalSignOut]:
    rows = await session.scalars(select(PersonalSign).where(PersonalSign.user_id == user.id).order_by(PersonalSign.created_at))
    return [PersonalSignOut.model_validate(r) for r in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_sign(body: PersonalSignIn, user: CurrentUser, session: Session) -> PersonalSignOut:
    count = await session.scalar(select(func.count()).select_from(PersonalSign).where(PersonalSign.user_id == user.id))
    if count >= MAX_SIGNS_PER_USER:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"You can save up to {MAX_SIGNS_PER_USER} signs. Delete one first.")
    exists = await session.scalar(select(PersonalSign.id).where(PersonalSign.user_id == user.id, func.lower(PersonalSign.label) == body.label.lower()))
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You already have a sign with this name.")
    sign = PersonalSign(user_id=user.id, label=body.label, emoji=body.emoji or None)
    sign.samples = [
        PersonalSignSample(extractor_version=body.extractorVersion, aspect=s.aspect, frames=[f.model_dump(exclude_none=True) for f in s.frames])
        for s in body.samples
    ]
    session.add(sign)
    await session.commit()
    await session.refresh(sign, attribute_names=["samples", "created_at"])
    return PersonalSignOut.model_validate(sign)


@router.delete("/{sign_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sign(sign_id: uuid.UUID, user: CurrentUser, session: Session) -> None:
    sign = await session.get(PersonalSign, sign_id)
    if sign is None or sign.user_id != user.id:  # someone else's sign looks the same as a missing one
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such sign")
    await session.delete(sign)
    await session.commit()
