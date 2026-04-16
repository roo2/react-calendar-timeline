"""Brands + customer brand and priority rank.

Revision ID: 0008_brands_customer
Revises: 0007_myob_oauth
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0008_brands_customer"
down_revision = "0007_myob_oauth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    is_sqlite = conn.dialect.name == "sqlite"

    op.create_table(
        "brands",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.UniqueConstraint("code", name="uq_brands_code"),
    )
    op.create_index("ix_brands_code", "brands", ["code"], unique=True)

    if is_sqlite:
        with op.batch_alter_table("customers") as batch_op:
            batch_op.add_column(sa.Column("brand_id", sa.String(length=36), nullable=True))
            batch_op.add_column(sa.Column("priority_rank", sa.Integer(), nullable=True))
            batch_op.create_foreign_key(
                "fk_customers_brand_id_brands",
                "brands",
                ["brand_id"],
                ["id"],
                ondelete="SET NULL",
            )
    else:
        op.add_column("customers", sa.Column("brand_id", sa.String(length=36), nullable=True))
        op.add_column("customers", sa.Column("priority_rank", sa.Integer(), nullable=True))
        op.create_foreign_key(
            "fk_customers_brand_id_brands",
            "customers",
            "brands",
            ["brand_id"],
            ["id"],
            ondelete="SET NULL",
        )

    op.create_index("ix_customers_brand_id", "customers", ["brand_id"])
    op.create_index("ix_customers_priority_rank", "customers", ["priority_rank"])


def downgrade() -> None:
    conn = op.get_bind()
    is_sqlite = conn.dialect.name == "sqlite"

    op.drop_index("ix_customers_priority_rank", table_name="customers")
    op.drop_index("ix_customers_brand_id", table_name="customers")

    if is_sqlite:
        with op.batch_alter_table("customers") as batch_op:
            batch_op.drop_constraint("fk_customers_brand_id_brands", type_="foreignkey")
            batch_op.drop_column("priority_rank")
            batch_op.drop_column("brand_id")
    else:
        op.drop_constraint("fk_customers_brand_id_brands", "customers", type_="foreignkey")
        op.drop_column("customers", "priority_rank")
        op.drop_column("customers", "brand_id")

    op.drop_index("ix_brands_code", table_name="brands")
    op.drop_table("brands")
