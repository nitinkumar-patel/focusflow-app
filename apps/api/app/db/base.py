"""Declarative base — models (T2) import this; Alembic's env.py reads
its metadata."""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
