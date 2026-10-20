"""GET /tasks, POST /tasks — contracts/openapi/focusflow-api.yaml."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import require_internal_secret, require_user_id
from app.db.session import get_db_session
from app.models import PomodoroSession, Task
from app.timer.settlement import settle_timer

router = APIRouter(
    prefix="/tasks", tags=["tasks"], dependencies=[Depends(require_internal_secret)]
)

class CreateTaskRequest(BaseModel):
    # strict: reject "3" and 2.5 rather than coercing them (AC2).
    model_config = ConfigDict(strict=True)

    title: str = Field(min_length=1, max_length=200)
    priority: Literal["high", "medium", "low"] = "medium"
    estimated_pomodoros: int = Field(default=1, ge=1, le=20)


class TaskResponse(BaseModel):
    id: uuid.UUID
    title: str
    priority: str
    estimated_pomodoros: int
    completed_pomodoros: int
    created_at: datetime


@router.get("", response_model=list[TaskResponse])
async def list_tasks(
    user_id: uuid.UUID = Depends(require_user_id),
    db: AsyncSession = Depends(get_db_session),
) -> list[TaskResponse]:
    # Settle first so counts are never stale (AC11); committed like the
    # timer routes do.
    await settle_timer(db, user_id, datetime.now(UTC))
    await db.commit()

    completed = (
        select(func.count(PomodoroSession.id))
        .where(PomodoroSession.task_id == Task.id)
        .correlate(Task)
        .scalar_subquery()
    )
    rank = case({"high": 0, "medium": 1}, value=Task.priority, else_=2)
    result = await db.execute(
        select(Task, completed.label("completed_pomodoros"))
        .where(Task.user_id == user_id)
        .order_by(rank, Task.created_at.desc())
    )
    return [
        TaskResponse(
            id=task.id,
            title=task.title,
            priority=task.priority,
            estimated_pomodoros=task.estimated_pomodoros,
            completed_pomodoros=count,
            created_at=task.created_at,
        )
        for task, count in result.all()
    ]


@router.post("", response_model=TaskResponse, status_code=201)
async def create_task(
    body: CreateTaskRequest,
    user_id: uuid.UUID = Depends(require_user_id),
    db: AsyncSession = Depends(get_db_session),
) -> TaskResponse:
    task = Task(
        user_id=user_id,
        title=body.title,
        priority=body.priority,
        estimated_pomodoros=body.estimated_pomodoros,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return TaskResponse(
        id=task.id,
        title=task.title,
        priority=task.priority,
        estimated_pomodoros=task.estimated_pomodoros,
        completed_pomodoros=0,
        created_at=task.created_at,
    )
