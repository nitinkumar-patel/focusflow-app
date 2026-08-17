"""GET /tasks, POST /tasks — contracts/openapi/focusflow-api.yaml."""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import require_internal_secret, require_user_id
from app.db.session import get_db_session
from app.models import Task

router = APIRouter(
    prefix="/tasks", tags=["tasks"], dependencies=[Depends(require_internal_secret)]
)


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
