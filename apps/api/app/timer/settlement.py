"""Lazy settlement of elapsed timer phases (plan.md, State & control flow).

Callers pass the session and an explicit `now`; the function locks the
user's active_timers row (SELECT ... FOR UPDATE) so concurrent readers
record each elapsed work phase once. It does not commit.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import ActiveTimer, PomodoroSession, Task


async def count_user_sessions(db: AsyncSession, user_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(PomodoroSession)
        .join(Task, Task.id == PomodoroSession.task_id)
        .where(Task.user_id == user_id)
    )
    return int(result.scalar_one())


def ends_at(timer: ActiveTimer) -> datetime:
    return timer.started_at + timedelta(seconds=timer.duration_seconds)


async def settle_timer(db: AsyncSession, user_id: uuid.UUID, now: datetime) -> ActiveTimer | None:
    """Advance the user's timer past every phase that ended at or before
    `now`. Returns the remaining timer row, or None."""
    result = await db.execute(
        select(ActiveTimer)
        .where(ActiveTimer.user_id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    timer = result.scalar_one_or_none()
    durations = settings.phase_durations_seconds
    while timer is not None and ends_at(timer) <= now:
        if timer.phase == "work":
            phase_end = ends_at(timer)
            db.add(
                PomodoroSession(
                    task_id=timer.task_id,
                    started_at=timer.started_at,
                    ended_at=phase_end,
                    duration_seconds=timer.duration_seconds,
                )
            )
            await db.flush()
            count = await count_user_sessions(db, user_id)
            timer.phase = "long_break" if count % 4 == 0 else "short_break"
            timer.started_at = phase_end
            timer.duration_seconds = durations[timer.phase]
            await db.flush()
        else:
            await db.delete(timer)
            await db.flush()
            timer = None
    return timer
