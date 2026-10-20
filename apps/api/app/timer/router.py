"""POST /timer/start, GET /timer, POST /timer/stop —
contracts/openapi/focusflow-api.yaml."""

from __future__ import annotations

import math
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import require_internal_secret, require_user_id
from app.db.session import get_db_session
from app.models import ActiveTimer, Task
from app.timer.settlement import count_user_sessions, ends_at, settle_timer

router = APIRouter(
    prefix="/timer", tags=["timer"], dependencies=[Depends(require_internal_secret)]
)


class StartTimerRequest(BaseModel):
    task_id: uuid.UUID


class TimerResponse(BaseModel):
    task_id: uuid.UUID
    phase: str
    started_at: datetime
    ends_at: datetime
    duration_seconds: int
    remaining_seconds: int
    server_time: datetime
    cycle_position: int


async def _timer_body(
    db: AsyncSession, user_id: uuid.UUID, timer: ActiveTimer, now: datetime
) -> TimerResponse:
    count = await count_user_sessions(db, user_id)
    end = ends_at(timer)
    position = (count % 4) + 1 if timer.phase == "work" else ((count - 1) % 4) + 1
    return TimerResponse(
        task_id=timer.task_id,
        phase=timer.phase,
        started_at=timer.started_at,
        ends_at=end,
        duration_seconds=timer.duration_seconds,
        remaining_seconds=max(0, math.ceil((end - now).total_seconds())),
        server_time=now,
        cycle_position=position,
    )


@router.post("/start", response_model=TimerResponse, status_code=201)
async def start_timer(
    body: StartTimerRequest,
    user_id: uuid.UUID = Depends(require_user_id),
    db: AsyncSession = Depends(get_db_session),
) -> TimerResponse:
    now = datetime.now(UTC)
    existing = await settle_timer(db, user_id, now)
    # Settlement is committed even when the request itself is refused.
    await db.commit()

    # Scoped to the caller: same 404 for a missing task and another user's.
    task = await db.execute(select(Task.id).where(Task.id == body.task_id, Task.user_id == user_id))
    if task.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="task not found")
    if existing is not None:
        raise HTTPException(status_code=409, detail="a timer is already active")

    timer = ActiveTimer(
        user_id=user_id,
        task_id=body.task_id,
        phase="work",
        started_at=now,
        duration_seconds=settings.phase_durations_seconds["work"],
    )
    db.add(timer)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="a timer is already active") from exc
    return await _timer_body(db, user_id, timer, now)


@router.get("", response_model=TimerResponse | None)
async def get_timer(
    user_id: uuid.UUID = Depends(require_user_id),
    db: AsyncSession = Depends(get_db_session),
) -> TimerResponse | None:
    now = datetime.now(UTC)
    timer = await settle_timer(db, user_id, now)
    await db.commit()
    if timer is None:
        return None
    return await _timer_body(db, user_id, timer, now)


@router.post("/stop", status_code=204)
async def stop_timer(
    user_id: uuid.UUID = Depends(require_user_id),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    timer = await settle_timer(db, user_id, datetime.now(UTC))
    if timer is None:
        await db.commit()
        raise HTTPException(status_code=404, detail="no active timer")
    await db.delete(timer)
    await db.commit()
    return Response(status_code=204)
