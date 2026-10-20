"""add task priority and estimate, active_timers

Revision ID: a1c4e7b92d10
Revises: 75d3bf36261f
Create Date: 2026-10-19 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1c4e7b92d10'
down_revision: Union[str, None] = '75d3bf36261f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Server defaults backfill existing rows (medium / 1).
    op.add_column('tasks', sa.Column('priority', sa.String(), server_default=sa.text("'medium'"), nullable=False))
    op.add_column('tasks', sa.Column('estimated_pomodoros', sa.Integer(), server_default=sa.text('1'), nullable=False))
    op.create_check_constraint('ck_tasks_priority', 'tasks', "priority IN ('high', 'medium', 'low')")
    op.create_check_constraint('ck_tasks_estimated_pomodoros', 'tasks', 'estimated_pomodoros BETWEEN 1 AND 20')
    op.create_table('active_timers',
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('task_id', sa.UUID(), nullable=False),
    sa.Column('phase', sa.String(), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('duration_seconds', sa.Integer(), nullable=False),
    sa.CheckConstraint("phase IN ('work', 'short_break', 'long_break')", name='ck_active_timers_phase'),
    sa.CheckConstraint('duration_seconds > 0', name='ck_active_timers_duration_positive'),
    sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('user_id')
    )


def downgrade() -> None:
    op.drop_table('active_timers')
    op.drop_constraint('ck_tasks_estimated_pomodoros', 'tasks', type_='check')
    op.drop_constraint('ck_tasks_priority', 'tasks', type_='check')
    op.drop_column('tasks', 'estimated_pomodoros')
    op.drop_column('tasks', 'priority')
