"""GET /analytics/focus-time — contracts/openapi/focusflow-api.yaml."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, time, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import require_internal_secret, require_user_id
from app.db.session import get_db_session
from app.models import PomodoroSession, Task

router = APIRouter(
    prefix="/analytics", tags=["analytics"], dependencies=[Depends(require_internal_secret)]
)


class FocusTimeByDay(BaseModel):
    date: date
    minutes: float


class FocusTimeByTask(BaseModel):
    task_id: uuid.UUID
    task_title: str
    minutes: float


class FocusTimeResponse(BaseModel):
    by_day: list[FocusTimeByDay]
    by_task: list[FocusTimeByTask]


def _minutes(total_seconds: int) -> float:
    return round(total_seconds / 60, 1)


@router.get("/focus-time", response_model=FocusTimeResponse)
async def focus_time(
    days: int = Query(default=7, ge=1, le=90),
    user_id: uuid.UUID = Depends(require_user_id),
    db: AsyncSession = Depends(get_db_session),
) -> FocusTimeResponse:
    today = datetime.now(UTC).date()
    start_date = today - timedelta(days=days - 1)
    window_start = datetime.combine(start_date, time.min, tzinfo=UTC)

    # UTC calendar date, regardless of the DB session's timezone setting
    # (Behavior & rules — `by_day` buckets in UTC, not server-local time).
    utc_day = func.date(func.timezone("UTC", PomodoroSession.started_at))

    day_result = await db.execute(
        select(utc_day.label("day"), func.sum(PomodoroSession.duration_seconds).label("total"))
        .join(Task, Task.id == PomodoroSession.task_id)
        .where(Task.user_id == user_id, PomodoroSession.started_at >= window_start)
        .group_by(utc_day)
    )
    totals_by_day: dict[date, int] = {row.day: row.total for row in day_result.all()}

    by_day = [
        FocusTimeByDay(
            date=start_date + timedelta(days=offset),
            minutes=_minutes(totals_by_day.get(start_date + timedelta(days=offset), 0)),
        )
        for offset in range(days)
    ]

    task_result = await db.execute(
        select(
            Task.id, Task.title, func.sum(PomodoroSession.duration_seconds).label("total")
        )
        .join(PomodoroSession, PomodoroSession.task_id == Task.id)
        .where(Task.user_id == user_id, PomodoroSession.started_at >= window_start)
        .group_by(Task.id, Task.title)
    )
    by_task = [
        FocusTimeByTask(task_id=row.id, task_title=row.title, minutes=_minutes(row.total))
        for row in task_result.all()
    ]

    return FocusTimeResponse(by_day=by_day, by_task=by_task)
