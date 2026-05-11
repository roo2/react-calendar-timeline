"""Add conversion carton sizes table.

Revision ID: 0025_conversion_carton_sizes
Revises: 0024_job_sheet_extruder_die_size
Create Date: 2026-05-07
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0025_conversion_carton_sizes"
down_revision = "0024_job_sheet_extruder_die_size"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "conversion_carton_sizes",
        sa.Column("carton_size", sa.String(length=64), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cost", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.CheckConstraint("length(carton_size) > 0", name="ck_conv_carton_sizes_nonempty"),
        sa.CheckConstraint("sort_order >= 0", name="ck_conv_carton_sizes_sort_nonneg"),
        sa.CheckConstraint("cost >= 0", name="ck_conv_carton_sizes_cost_nonneg"),
        sa.PrimaryKeyConstraint("carton_size"),
    )

    carton_sizes_table = sa.table(
        "conversion_carton_sizes",
        sa.column("carton_size", sa.String()),
        sa.column("sort_order", sa.Integer()),
        sa.column("cost", sa.Numeric(12, 4)),
    )
    op.bulk_insert(
        carton_sizes_table,
        [
            {"carton_size": "Small", "sort_order": 0, "cost": 0.474},
            {"carton_size": "110 Wide", "sort_order": 1, "cost": 1.06},
            {"carton_size": "80wide", "sort_order": 2, "cost": 1.404},
            {"carton_size": "110", "sort_order": 3, "cost": 0.8},
            {"carton_size": "150", "sort_order": 4, "cost": 0.874},
            {"carton_size": "140", "sort_order": 5, "cost": 0.94},
            {"carton_size": "230", "sort_order": 6, "cost": 1.015},
            {"carton_size": "VDM Box", "sort_order": 7, "cost": 47.25},
        ],
    )


def downgrade() -> None:
    op.drop_table("conversion_carton_sizes")
