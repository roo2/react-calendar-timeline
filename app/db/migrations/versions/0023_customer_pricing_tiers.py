"""Customer pricing tiers (quote discounts off retail) + optional customer assignment.

Revision ID: 0023_customer_pricing_tiers
Revises: 0022_products_code_not_unique

Retail list price is the summed ratebook sell total. Each tier stores ``discount_percent`` off
that retail subtotal (e.g. Tier 1 = 15% off, Wholesale = 30% off, Retail = 0%).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0023_customer_pricing_tiers"
down_revision = "0022_products_code_not_unique"
branch_labels = None
depends_on = None

WHOLESALE_ID = "c1111111-1111-4111-8111-111111111101"
TIER1_ID = "c1111111-1111-4111-8111-111111111102"
RETAIL_ID = "c1111111-1111-4111-8111-111111111103"


def upgrade() -> None:
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    op.create_table(
        "customer_pricing_tiers",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("discount_percent", sa.Numeric(9, 4), nullable=False, server_default="0"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_customer_pricing_tiers_sort", "customer_pricing_tiers", ["sort_order"], unique=False)

    tiers = sa.table(
        "customer_pricing_tiers",
        sa.column("id", sa.String),
        sa.column("name", sa.String),
        sa.column("discount_percent", sa.Numeric),
        sa.column("sort_order", sa.Integer),
    )
    op.bulk_insert(
        tiers,
        [
            {"id": RETAIL_ID, "name": "Retail", "discount_percent": 0, "sort_order": 0},
            {"id": TIER1_ID, "name": "Tier 1", "discount_percent": 15, "sort_order": 10},
            {"id": WHOLESALE_ID, "name": "Wholesale", "discount_percent": 30, "sort_order": 20},
        ],
    )

    if is_sqlite:
        with op.batch_alter_table("customers", schema=None) as batch_op:
            batch_op.add_column(sa.Column("pricing_tier_id", sa.String(length=36), nullable=True))
            batch_op.create_foreign_key(
                "fk_customers_pricing_tier",
                "customer_pricing_tiers",
                ["pricing_tier_id"],
                ["id"],
                ondelete="RESTRICT",
            )
        op.create_index("ix_customers_pricing_tier", "customers", ["pricing_tier_id"], unique=False)
        return

    op.add_column("customers", sa.Column("pricing_tier_id", sa.String(length=36), nullable=True))
    op.create_foreign_key(
        "fk_customers_pricing_tier",
        "customers",
        "customer_pricing_tiers",
        ["pricing_tier_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_customers_pricing_tier", "customers", ["pricing_tier_id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    if is_sqlite:
        with op.batch_alter_table("customers", schema=None) as batch_op:
            batch_op.drop_constraint("fk_customers_pricing_tier", type_="foreignkey")
            batch_op.drop_index("ix_customers_pricing_tier")
            batch_op.drop_column("pricing_tier_id")
    else:
        op.drop_index("ix_customers_pricing_tier", table_name="customers")
        op.drop_constraint("fk_customers_pricing_tier", "customers", type_="foreignkey")
        op.drop_column("customers", "pricing_tier_id")

    op.drop_index("ix_customer_pricing_tiers_sort", table_name="customer_pricing_tiers")
    op.drop_table("customer_pricing_tiers")
