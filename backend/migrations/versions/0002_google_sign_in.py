"""Google Sign-In: link accounts to a Google subject, allow password-less users.

Revision ID: 0002
Revises: 0001
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('google_sub', sa.String(length=64), nullable=True))
        batch_op.create_index(batch_op.f('ix_users_google_sub'), ['google_sub'], unique=True)
        # An account created through Google has no password to hash.
        batch_op.alter_column(
            'password_hash', existing_type=sa.String(length=255), nullable=True
        )


def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        # Password-less (Google-only) accounts cannot be represented before this
        # revision, so they are dropped rather than silently given a null hash.
        batch_op.drop_index(batch_op.f('ix_users_google_sub'))
        batch_op.drop_column('google_sub')
    op.execute(sa.text("DELETE FROM users WHERE password_hash IS NULL"))
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.alter_column(
            'password_hash', existing_type=sa.String(length=255), nullable=False
        )
