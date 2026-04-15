"""Quote materials retail bands (width-based MOQ + retail $/kg).

Revision ID: 0006_quote_materials_retail_bands
Revises: 0005_drop_carton_options
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006_quote_materials_retail_bands"
down_revision = "0005_drop_carton_options"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "quote_materials_retail_bands",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("product_group", sa.String(length=32), nullable=False),
        sa.Column("width_min_mm", sa.Integer(), nullable=False),
        sa.Column("width_max_mm", sa.Integer(), nullable=False),
        sa.Column("moq_plain_kg", sa.Numeric(12, 2), nullable=True),
        sa.Column("retail_price_per_kg", sa.Numeric(12, 4), nullable=True),
        sa.Column("moq_printed_kg", sa.Numeric(12, 2), nullable=True),
        sa.CheckConstraint("width_max_mm >= width_min_mm", name="ck_qmrb_width_range"),
        sa.CheckConstraint(
            "product_group IN ('tube','centerfold','sheet','u_film','bag')",
            name="ck_qmrb_product_group",
        ),
        sa.CheckConstraint(
            "moq_plain_kg IS NULL OR moq_plain_kg >= 0",
            name="ck_qmrb_moq_plain_nonneg",
        ),
        sa.CheckConstraint(
            "moq_printed_kg IS NULL OR moq_printed_kg >= 0",
            name="ck_qmrb_moq_printed_nonneg",
        ),
        sa.CheckConstraint(
            "retail_price_per_kg IS NULL OR retail_price_per_kg >= 0",
            name="ck_qmrb_retail_price_nonneg",
        ),
        sa.UniqueConstraint("product_group", "width_min_mm", "width_max_mm", name="uq_qmrb_group_width"),
    )

    t = sa.table(
        "quote_materials_retail_bands",
        sa.column("product_group", sa.String),
        sa.column("width_min_mm", sa.Integer),
        sa.column("width_max_mm", sa.Integer),
        sa.column("moq_plain_kg", sa.Numeric),
        sa.column("retail_price_per_kg", sa.Numeric),
        sa.column("moq_printed_kg", sa.Numeric),
    )
    rows: list[dict] = [
        # Poly Tube (Tube / Sleeve in app)
        dict(product_group="tube", width_min_mm=0, width_max_mm=99, moq_plain_kg=200, retail_price_per_kg=None, moq_printed_kg=200),
        dict(product_group="tube", width_min_mm=100, width_max_mm=399, moq_plain_kg=300, retail_price_per_kg=None, moq_printed_kg=300),
        dict(product_group="tube", width_min_mm=400, width_max_mm=799, moq_plain_kg=400, retail_price_per_kg=None, moq_printed_kg=500),
        dict(product_group="tube", width_min_mm=800, width_max_mm=1800, moq_plain_kg=None, retail_price_per_kg=None, moq_printed_kg=None),
        # Poly C/Fold (Centerfold)
        dict(product_group="centerfold", width_min_mm=200, width_max_mm=399, moq_plain_kg=200, retail_price_per_kg=4.45, moq_printed_kg=250),
        dict(product_group="centerfold", width_min_mm=400, width_max_mm=799, moq_plain_kg=300, retail_price_per_kg=4.40, moq_printed_kg=300),
        dict(product_group="centerfold", width_min_mm=800, width_max_mm=1460, moq_plain_kg=400, retail_price_per_kg=4.35, moq_printed_kg=400),
        # Poly S.W.S (Sheet)
        dict(product_group="sheet", width_min_mm=200, width_max_mm=399, moq_plain_kg=300, retail_price_per_kg=5.00, moq_printed_kg=300),
        dict(product_group="sheet", width_min_mm=400, width_max_mm=799, moq_plain_kg=300, retail_price_per_kg=4.85, moq_printed_kg=400),
        dict(product_group="sheet", width_min_mm=800, width_max_mm=999, moq_plain_kg=400, retail_price_per_kg=4.75, moq_printed_kg=500),
        dict(product_group="sheet", width_min_mm=1000, width_max_mm=1460, moq_plain_kg=500, retail_price_per_kg=4.75, moq_printed_kg=600),
        # Poly U Film
        dict(product_group="u_film", width_min_mm=300, width_max_mm=499, moq_plain_kg=250, retail_price_per_kg=4.50, moq_printed_kg=300),
        dict(product_group="u_film", width_min_mm=500, width_max_mm=999, moq_plain_kg=300, retail_price_per_kg=4.40, moq_printed_kg=300),
        dict(product_group="u_film", width_min_mm=1000, width_max_mm=1460, moq_plain_kg=400, retail_price_per_kg=4.35, moq_printed_kg=500),
        # Poly B.O.R (Bag)
        dict(product_group="bag", width_min_mm=350, width_max_mm=499, moq_plain_kg=250, retail_price_per_kg=5.00, moq_printed_kg=350),
        dict(product_group="bag", width_min_mm=500, width_max_mm=799, moq_plain_kg=300, retail_price_per_kg=4.65, moq_printed_kg=400),
        dict(product_group="bag", width_min_mm=800, width_max_mm=1800, moq_plain_kg=400, retail_price_per_kg=4.50, moq_printed_kg=500),
    ]
    op.bulk_insert(t, rows)


def downgrade() -> None:
    op.drop_table("quote_materials_retail_bands")
