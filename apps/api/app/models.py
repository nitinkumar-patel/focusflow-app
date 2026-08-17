"""SQLAlchemy 2.0 declarative models — see plan.md's Data & schema."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

_TZ_DATETIME = DateTime(timezone=True)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        _TZ_DATETIME, server_default=func.now(), nullable=False
    )

    tasks: Mapped[list[Task]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        _TZ_DATETIME, server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(back_populates="tasks")
    sessions: Mapped[list[PomodoroSession]] = relationship(
        back_populates="task", cascade="all, delete-orphan"
    )


class PomodoroSession(Base):
    __tablename__ = "pomodoro_sessions"
    __table_args__ = (CheckConstraint("duration_seconds > 0", name="ck_duration_positive"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id"), nullable=False, index=True
    )
    started_at: Mapped[datetime] = mapped_column(_TZ_DATETIME, nullable=False)
    ended_at: Mapped[datetime] = mapped_column(_TZ_DATETIME, nullable=False)
    duration_seconds: Mapped[int] = mapped_column(nullable=False)

    task: Mapped[Task] = relationship(back_populates="sessions")
