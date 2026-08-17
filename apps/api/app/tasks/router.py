"""GET /tasks, POST /tasks — contracts/openapi/focusflow-api.yaml."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import require_internal_secret, require_user_id
from app.db.session import get_db_session
from app.models import PomodoroSession, Task

router = APIRouter(
    prefix="/tasks", tags=["tasks"], dependencies=[Depends(require_internal_secret)]
)

# AC5's canonical work-interval length, hardcoded here per plan.md's
# Design decisions (independently hardcoded on both runtimes, not shared
# via env var — the spec's Ask-first boundary on AC5 is what keeps the
# two copies in sync).
MAX_WORK_INTERVAL_SECONDS = 1500
DURATION_TOLERANCE_SECONDS = 2
CLOCK_SKEW_TOLERANCE_SECONDS = 60
RAPID_DUPLICATE_WINDOW_SECONDS = 60


class CreateTaskRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class TaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    created_at: datetime


@router.get("", response_model=list[TaskResponse])
async def list_tasks(
    user_id: uuid.UUID = Depends(require_user_id),
    db: AsyncSession = Depends(get_db_session),
) -> list[Task]:
    result = await db.execute(
        select(Task).where(Task.user_id == user_id).order_by(Task.created_at.desc())
    )
    return list(result.scalars().all())


@router.post("", response_model=TaskResponse, status_code=201)
async def create_task(
    body: CreateTaskRequest,
    user_id: uuid.UUID = Depends(require_user_id),
    db: AsyncSession = Depends(get_db_session),
) -> Task:
    task = Task(user_id=user_id, title=body.title)
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return task


class RecordSessionRequest(BaseModel):
    started_at: datetime
    ended_at: datetime
    duration_seconds: int = Field(gt=0)


class SessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    task_id: uuid.UUID
    started_at: datetime
    ended_at: datetime
    duration_seconds: int


@router.post("/{task_id}/sessions", response_model=SessionResponse, status_code=201)
async def record_session(
    task_id: uuid.UUID,
    body: RecordSessionRequest,
    user_id: uuid.UUID = Depends(require_user_id),
    db: AsyncSession = Depends(get_db_session),
) -> PomodoroSession:
    task_result = await db.execute(
        select(Task).where(Task.id == task_id, Task.user_id == user_id)
    )
    if task_result.scalar_one_or_none() is None:
        # Same response whether the task doesn't exist or belongs to
        # another user — never confirms which (AC14).
        raise HTTPException(status_code=404, detail="task not found")

    started_at = body.started_at
    ended_at = body.ended_at
    if started_at.tzinfo is None or ended_at.tzinfo is None:
        raise HTTPException(
            status_code=422, detail="started_at and ended_at must be timezone-aware"
        )

    now = datetime.now(UTC)
    if ended_at > now + timedelta(seconds=CLOCK_SKEW_TOLERANCE_SECONDS):
        raise HTTPException(status_code=422, detail="ended_at is too far in the future")

    actual_seconds = (ended_at - started_at).total_seconds()
    if abs(actual_seconds - body.duration_seconds) > DURATION_TOLERANCE_SECONDS:
        raise HTTPException(
            status_code=422,
            detail="duration_seconds does not match ended_at - started_at",
        )

    if body.duration_seconds > MAX_WORK_INTERVAL_SECONDS:
        raise HTTPException(
            status_code=422, detail="duration_seconds exceeds the maximum work interval"
        )

    recent_cutoff = now - timedelta(seconds=RAPID_DUPLICATE_WINDOW_SECONDS)
    recent_result = await db.execute(
        select(PomodoroSession).where(
            PomodoroSession.task_id == task_id,
            PomodoroSession.ended_at >= recent_cutoff,
        )
    )
    if recent_result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=422, detail="a session for this task was just recorded"
        )

    session_row = PomodoroSession(
        task_id=task_id,
        started_at=started_at,
        ended_at=ended_at,
        duration_seconds=body.duration_seconds,
    )
    db.add(session_row)
    await db.commit()
    await db.refresh(session_row)
    return session_row
