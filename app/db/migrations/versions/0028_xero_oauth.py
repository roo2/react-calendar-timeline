"""Xero OAuth connection + customer Xero Contact link.

Revision ID: 0028_xero_oauth
Revises: 0027_extruders_die_size_mm
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0028_xero_oauth"
down_revision = "0027_extruders_die_size_mm"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "xero_oauth_states",
        sa.Column("state", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("state", name="pk_xero_oauth_states"),
    )
    op.create_table(
        "xero_connection",
        sa.Column("id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("refresh_token", sa.Text(), nullable=True),
        sa.Column("access_token", sa.Text(), nullable=True),
        sa.Column("access_token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tenant_id", sa.String(length=64), nullable=True),
        sa.Column("tenant_name", sa.String(length=255), nullable=True),
        sa.Column("scope", sa.String(length=1024), nullable=True),
        sa.Column("last_refreshed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.CheckConstraint("id = 1", name="ck_xero_connection_singleton"),
        sa.PrimaryKeyConstraint("id", name="pk_xero_connection"),
    )
    with op.batch_alter_table("customers") as batch_op:
        batch_op.add_column(sa.Column("xero_contact_id", sa.String(length=36), nullable=True))
    op.create_index("ix_customers_xero_contact_id", "customers", ["xero_contact_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_customers_xero_contact_id", table_name="customers")
    with op.batch_alter_table("customers") as batch_op:
        batch_op.drop_column("xero_contact_id")
    op.drop_table("xero_connection")
    op.drop_table("xero_oauth_states")
