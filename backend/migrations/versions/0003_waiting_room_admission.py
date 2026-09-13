"""Waiting room and host ejection: track whether a participant may be in the room.

Revision ID: 0003
Revises: 0002
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None

admission_enum = sa.Enum('admitted', 'waiting', 'removed', name='admissionstate')


def upgrade() -> None:
    bind = op.get_bind()
    admission_enum.create(bind, checkfirst=True)
    with op.batch_alter_table('meeting_participants', schema=None) as batch_op:
        # Everyone already in the database got in before there was a waiting
        # room, so they are admitted by definition.
        batch_op.add_column(
            sa.Column(
                'admission',
                admission_enum,
                nullable=False,
                server_default='admitted',
            )
        )
        batch_op.create_index(
            batch_op.f('ix_meeting_participants_admission'), ['admission'], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table('meeting_participants', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_meeting_participants_admission'))
        batch_op.drop_column('admission')
    admission_enum.drop(op.get_bind(), checkfirst=True)
