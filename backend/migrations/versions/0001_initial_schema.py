"""Initial schema.

This is the schema the application shipped with, before Google Sign-In. An
existing database that was created by the old `Base.metadata.create_all()` boot
step already matches it, so those deployments run `alembic stamp 0001` once and
then upgrade normally.

Revision ID: 0001
Revises:
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('users',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('display_name', sa.String(length=120), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('avatar_url', sa.String(length=500), nullable=True),
    sa.Column('avatar_color', sa.String(length=9), nullable=False),
    sa.Column('job_title', sa.String(length=120), nullable=True),
    sa.Column('timezone', sa.String(length=64), nullable=False),
    sa.Column('personal_meeting_id', sa.String(length=16), nullable=False),
    sa.Column('is_verified', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('last_seen_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_users_email'), ['email'], unique=True)
        batch_op.create_index(batch_op.f('ix_users_personal_meeting_id'), ['personal_meeting_id'], unique=True)

    op.create_table('contacts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('owner_id', sa.Integer(), nullable=False),
    sa.Column('contact_id', sa.Integer(), nullable=False),
    sa.Column('starred', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['contact_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('owner_id', 'contact_id', name='uq_contact_pair')
    )
    with op.batch_alter_table('contacts', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_contacts_contact_id'), ['contact_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_contacts_owner_id'), ['owner_id'], unique=False)

    op.create_table('meetings',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('code', sa.String(length=16), nullable=False),
    sa.Column('topic', sa.String(length=200), nullable=False),
    sa.Column('passcode', sa.String(length=16), nullable=True),
    sa.Column('host_id', sa.Integer(), nullable=False),
    sa.Column('status', sa.Enum('scheduled', 'live', 'ended', name='meetingstatus'), nullable=False),
    sa.Column('scheduled_start', sa.DateTime(), nullable=True),
    sa.Column('duration_minutes', sa.Integer(), nullable=False),
    sa.Column('is_personal_room', sa.Boolean(), nullable=False),
    sa.Column('waiting_room', sa.Boolean(), nullable=False),
    sa.Column('mute_on_entry', sa.Boolean(), nullable=False),
    sa.Column('video_on_entry', sa.Boolean(), nullable=False),
    sa.Column('auto_record', sa.Boolean(), nullable=False),
    sa.Column('agenda', sa.Text(), nullable=True),
    sa.Column('started_at', sa.DateTime(), nullable=True),
    sa.Column('ended_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['host_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('meetings', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_meetings_code'), ['code'], unique=True)
        batch_op.create_index(batch_op.f('ix_meetings_host_id'), ['host_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_meetings_scheduled_start'), ['scheduled_start'], unique=False)
        batch_op.create_index(batch_op.f('ix_meetings_status'), ['status'], unique=False)

    op.create_table('chat_messages',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('meeting_id', sa.Integer(), nullable=False),
    sa.Column('sender_id', sa.Integer(), nullable=True),
    sa.Column('sender_name', sa.String(length=120), nullable=False),
    sa.Column('recipient_id', sa.Integer(), nullable=True),
    sa.Column('recipient_name', sa.String(length=120), nullable=True),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['meeting_id'], ['meetings.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['recipient_id'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['sender_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('chat_messages', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_chat_messages_created_at'), ['created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_chat_messages_meeting_id'), ['meeting_id'], unique=False)

    op.create_table('meeting_invitees',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('meeting_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['meeting_id'], ['meetings.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('meeting_id', 'user_id', name='uq_invitee')
    )
    with op.batch_alter_table('meeting_invitees', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_meeting_invitees_meeting_id'), ['meeting_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_meeting_invitees_user_id'), ['user_id'], unique=False)

    op.create_table('meeting_participants',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('meeting_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=True),
    sa.Column('display_name', sa.String(length=120), nullable=False),
    sa.Column('role', sa.Enum('host', 'cohost', 'participant', name='participantrole'), nullable=False),
    sa.Column('is_online', sa.Boolean(), nullable=False),
    sa.Column('is_muted', sa.Boolean(), nullable=False),
    sa.Column('is_video_on', sa.Boolean(), nullable=False),
    sa.Column('is_hand_raised', sa.Boolean(), nullable=False),
    sa.Column('is_sharing', sa.Boolean(), nullable=False),
    sa.Column('joined_at', sa.DateTime(), nullable=True),
    sa.Column('left_at', sa.DateTime(), nullable=True),
    sa.Column('talk_seconds', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['meeting_id'], ['meetings.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('meeting_id', 'user_id', name='uq_participant')
    )
    with op.batch_alter_table('meeting_participants', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_meeting_participants_meeting_id'), ['meeting_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_meeting_participants_user_id'), ['user_id'], unique=False)

    op.create_table('recordings',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('meeting_id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('status', sa.Enum('recording', 'processing', 'ready', name='recordingstatus'), nullable=False),
    sa.Column('started_at', sa.DateTime(), nullable=False),
    sa.Column('ended_at', sa.DateTime(), nullable=True),
    sa.Column('duration_seconds', sa.Integer(), nullable=False),
    sa.Column('share_token', sa.String(length=40), nullable=False),
    sa.ForeignKeyConstraint(['meeting_id'], ['meetings.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('recordings', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_recordings_meeting_id'), ['meeting_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_recordings_share_token'), ['share_token'], unique=True)

    op.create_table('highlights',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('recording_id', sa.Integer(), nullable=False),
    sa.Column('created_by_id', sa.Integer(), nullable=True),
    sa.Column('created_by_name', sa.String(length=120), nullable=False),
    sa.Column('label', sa.String(length=200), nullable=False),
    sa.Column('at_ms', sa.Integer(), nullable=False),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['recording_id'], ['recordings.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('highlights', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_highlights_recording_id'), ['recording_id'], unique=False)

    op.create_table('summaries',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('recording_id', sa.Integer(), nullable=False),
    sa.Column('headline', sa.String(length=300), nullable=False),
    sa.Column('tldr', sa.Text(), nullable=False),
    sa.Column('generator', sa.String(length=60), nullable=False),
    sa.Column('keywords', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['recording_id'], ['recordings.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('recording_id')
    )
    op.create_table('transcript_segments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('recording_id', sa.Integer(), nullable=False),
    sa.Column('speaker_id', sa.Integer(), nullable=True),
    sa.Column('speaker_name', sa.String(length=120), nullable=False),
    sa.Column('start_ms', sa.Integer(), nullable=False),
    sa.Column('end_ms', sa.Integer(), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['recording_id'], ['recordings.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['speaker_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('transcript_segments', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_transcript_segments_recording_id'), ['recording_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_transcript_segments_start_ms'), ['start_ms'], unique=False)

    op.create_table('action_items',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('recording_id', sa.Integer(), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('assignee_name', sa.String(length=120), nullable=True),
    sa.Column('assignee_id', sa.Integer(), nullable=True),
    sa.Column('due_hint', sa.String(length=120), nullable=True),
    sa.Column('status', sa.Enum('open', 'done', name='actionitemstatus'), nullable=False),
    sa.Column('source_segment_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['assignee_id'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['recording_id'], ['recordings.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['source_segment_id'], ['transcript_segments.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('action_items', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_action_items_recording_id'), ['recording_id'], unique=False)

    op.create_table('summary_sections',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('summary_id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=120), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('bullets', sa.Text(), nullable=False),
    sa.ForeignKeyConstraint(['summary_id'], ['summaries.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('summary_sections', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_summary_sections_summary_id'), ['summary_id'], unique=False)



def downgrade() -> None:
    with op.batch_alter_table('summary_sections', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_summary_sections_summary_id'))

    op.drop_table('summary_sections')
    with op.batch_alter_table('action_items', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_action_items_recording_id'))

    op.drop_table('action_items')
    with op.batch_alter_table('transcript_segments', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_transcript_segments_start_ms'))
        batch_op.drop_index(batch_op.f('ix_transcript_segments_recording_id'))

    op.drop_table('transcript_segments')
    op.drop_table('summaries')
    with op.batch_alter_table('highlights', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_highlights_recording_id'))

    op.drop_table('highlights')
    with op.batch_alter_table('recordings', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_recordings_share_token'))
        batch_op.drop_index(batch_op.f('ix_recordings_meeting_id'))

    op.drop_table('recordings')
    with op.batch_alter_table('meeting_participants', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_meeting_participants_user_id'))
        batch_op.drop_index(batch_op.f('ix_meeting_participants_meeting_id'))

    op.drop_table('meeting_participants')
    with op.batch_alter_table('meeting_invitees', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_meeting_invitees_user_id'))
        batch_op.drop_index(batch_op.f('ix_meeting_invitees_meeting_id'))

    op.drop_table('meeting_invitees')
    with op.batch_alter_table('chat_messages', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_chat_messages_meeting_id'))
        batch_op.drop_index(batch_op.f('ix_chat_messages_created_at'))

    op.drop_table('chat_messages')
    with op.batch_alter_table('meetings', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_meetings_status'))
        batch_op.drop_index(batch_op.f('ix_meetings_scheduled_start'))
        batch_op.drop_index(batch_op.f('ix_meetings_host_id'))
        batch_op.drop_index(batch_op.f('ix_meetings_code'))

    op.drop_table('meetings')
    with op.batch_alter_table('contacts', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_contacts_owner_id'))
        batch_op.drop_index(batch_op.f('ix_contacts_contact_id'))

    op.drop_table('contacts')
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_users_personal_meeting_id'))
        batch_op.drop_index(batch_op.f('ix_users_email'))

    op.drop_table('users')
