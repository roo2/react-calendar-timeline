"""Refresh conversion carton sizes (sorted by cost).

Revision ID: 0030_conversion_cartons
Revises: 0029_products_default_qty_type
Create Date: 2026-05-19
"""

from alembic import op
import sqlalchemy as sa


revision = "0030_conversion_cartons"
down_revision = "0029_products_default_qty_type"
branch_labels = None
depends_on = None

# (carton_size, cost) — sort_order assigned by ascending cost in upgrade()
_CARTON_SIZES_BY_COST = [
    ("Small", 0.474),
    ("110", 0.8),
    ("150", 0.874),
    ("140", 0.94),
    ("190", 1.0),
    ("230", 1.015),
    ("110 Wide", 1.06),
    ("80 Wide", 1.404),
    ("130", 8.4),
    ("VDM Box", 47.25),
]

# Original seed from 0025 (for downgrade restore)
_0025_CARTON_SIZES = [
    ("Small", 0, 0.474),
    ("110 Wide", 1, 1.06),
    ("80wide", 2, 1.404),
    ("110", 3, 0.8),
    ("150", 4, 0.874),
    ("140", 5, 0.94),
    ("230", 6, 1.015),
    ("VDM Box", 7, 47.25),
]


def upgrade() -> None:
    op.execute(sa.text("DELETE FROM conversion_carton_sizes"))
    carton_sizes_table = sa.table(
        "conversion_carton_sizes",
        sa.column("carton_size", sa.String()),
        sa.column("sort_order", sa.Integer()),
        sa.column("cost", sa.Numeric(12, 4)),
    )
    rows = [
        {"carton_size": name, "sort_order": idx, "cost": cost}
        for idx, (name, cost) in enumerate(_CARTON_SIZES_BY_COST)
    ]
    op.bulk_insert(carton_sizes_table, rows)

    # Legacy key rename for product specs that stored the old label.
    conn = op.get_bind()
    if conn.dialect.name == "postgresql":
        op.execute(
            sa.text(
                """
                UPDATE product_versions
                SET spec_payload = replace(
                    spec_payload::text,
                    '"carton_size": "80wide"',
                    '"carton_size": "80 Wide"'
                )::jsonb
                WHERE spec_payload::text LIKE '%"carton_size": "80wide"%'
                """
            )
        )
    else:
        op.execute(
            sa.text(
                """
                UPDATE product_versions
                SET spec_payload = replace(
                    spec_payload,
                    '"carton_size": "80wide"',
                    '"carton_size": "80 Wide"'
                )
                WHERE spec_payload LIKE '%"carton_size": "80wide"%'
                """
            )
        )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM conversion_carton_sizes"))
    carton_sizes_table = sa.table(
        "conversion_carton_sizes",
        sa.column("carton_size", sa.String()),
        sa.column("sort_order", sa.Integer()),
        sa.column("cost", sa.Numeric(12, 4)),
    )
    op.bulk_insert(
        carton_sizes_table,
        [
            {"carton_size": name, "sort_order": order, "cost": cost}
            for name, order, cost in _0025_CARTON_SIZES
        ],
    )
