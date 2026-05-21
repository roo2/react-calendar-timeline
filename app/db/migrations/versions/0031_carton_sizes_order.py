"""Set conversion carton sizes to business sort order (not cost-sorted).

Revision ID: 0031_carton_sizes_order
Revises: 0030_conversion_cartons
Create Date: 2026-05-20
"""

from alembic import op
import sqlalchemy as sa


revision = "0031_carton_sizes_order"
down_revision = "0030_conversion_cartons"
branch_labels = None
depends_on = None

# (carton_size, cost) — sort_order is list index (explicit business ordering).
_CARTON_SIZES_ORDER = [
    ("Small", 0.474),
    ("110", 0.8),
    ("130", 0.84),
    ("140", 0.874),
    ("150", 0.94),
    ("190", 1.0),
    ("230", 1.015),
    ("80 Wide", 1.404),
    ("110 Wide", 1.06),
    ("VDM Box", 47.25),
]

# 0030 state (for downgrade)
_0030_CARTON_SIZES = [
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


def _bulk_replace(rows: list[tuple[str, float]]) -> None:
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
            {"carton_size": name, "sort_order": idx, "cost": cost}
            for idx, (name, cost) in enumerate(rows)
        ],
    )


def upgrade() -> None:
    _bulk_replace(_CARTON_SIZES_ORDER)


def downgrade() -> None:
    _bulk_replace(_0030_CARTON_SIZES)
