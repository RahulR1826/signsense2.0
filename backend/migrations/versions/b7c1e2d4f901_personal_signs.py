"""personal signs ("My signs")

Revision ID: b7c1e2d4f901
Revises: 96fae9592cf3
Create Date: 2026-10-27 21:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7c1e2d4f901'
down_revision: Union[str, Sequence[str], None] = '96fae9592cf3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('personal_signs',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('label', sa.String(length=40), nullable=False),
    sa.Column('emoji', sa.String(length=16), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'label', name='uq_personal_sign_label')
    )
    op.create_index(op.f('ix_personal_signs_user_id'), 'personal_signs', ['user_id'], unique=False)
    op.create_table('personal_sign_samples',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('sign_id', sa.Uuid(), nullable=False),
    sa.Column('extractor_version', sa.String(length=100), nullable=False),
    sa.Column('aspect', sa.Float(), nullable=False),
    sa.Column('frames', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['sign_id'], ['personal_signs.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_personal_sign_samples_sign_id'), 'personal_sign_samples', ['sign_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_personal_sign_samples_sign_id'), table_name='personal_sign_samples')
    op.drop_table('personal_sign_samples')
    op.drop_index(op.f('ix_personal_signs_user_id'), table_name='personal_signs')
    op.drop_table('personal_signs')
