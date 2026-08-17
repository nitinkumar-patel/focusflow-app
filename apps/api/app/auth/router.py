"""POST /auth/register, POST /auth/verify — contracts/openapi/focusflow-api.yaml."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import (
    DUMMY_PASSWORD_HASH,
    hash_password,
    require_internal_secret,
    verify_password,
)
from app.db.session import get_db_session
from app.models import User

router = APIRouter(
    prefix="/auth", tags=["auth"], dependencies=[Depends(require_internal_secret)]
)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class VerifyRequest(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str


@router.post("/register", response_model=UserResponse, status_code=201)
async def register(
    body: RegisterRequest, db: AsyncSession = Depends(get_db_session)
) -> User:
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="email already registered")

    user = User(email=body.email, password_hash=hash_password(body.password))
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        # Two concurrent registrations for the same email can both pass
        # the existence check above; the unique constraint is the real
        # guard, so a race here should still surface as 409, not 500.
        await db.rollback()
        raise HTTPException(status_code=409, detail="email already registered") from None
    await db.refresh(user)
    return user


@router.post("/verify", response_model=UserResponse)
async def verify(body: VerifyRequest, db: AsyncSession = Depends(get_db_session)) -> User:
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is None:
        # Timing-attack mitigation: burn the same wall-clock work an
        # existing-user wrong-password check would, so an unknown email
        # doesn't respond measurably faster (spec Testing Strategy).
        verify_password(body.password, DUMMY_PASSWORD_HASH)
        raise HTTPException(status_code=401, detail="invalid credentials")

    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="invalid credentials")

    return user
