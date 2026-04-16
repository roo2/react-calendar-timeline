"""MYOB OAuth connection + short-lived OAuth state rows.

Timestamp column defaults use CURRENT_TIMESTAMP (portable; SQLite has no now()).

Revision ID: 0007_myob_oauth
Revises: 0006_quote_mat_retail_bands
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007_myob_oauth"
down_revision = "0006_quote_mat_retail_bands"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "myob_oauth_states",
        sa.Column("state", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("state", name="pk_myob_oauth_states"),
    )
    op.create_table(
        "myob_connection",
        sa.Column("id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("refresh_token", sa.Text(), nullable=True),
        sa.Column("access_token", sa.Text(), nullable=True),
        sa.Column("access_token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("business_id", sa.String(length=255), nullable=True),
        sa.Column("scope", sa.String(length=512), nullable=True),
        sa.Column("myob_user_uid", sa.String(length=128), nullable=True),
        sa.Column("myob_username", sa.String(length=255), nullable=True),
        sa.Column("last_refreshed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.CheckConstraint("id = 1", name="ck_myob_connection_singleton"),
        sa.PrimaryKeyConstraint("id", name="pk_myob_connection"),
    )


def downgrade() -> None:
    op.drop_table("myob_connection")
    op.drop_table("myob_oauth_states")
