"""Order GST metadata and line tax fields."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0037_order_gst_metadata"
down_revision = "0036_conversion_waste_pct"
branch_labels = None
depends_on = None


def _cols(table_name: str) -> set[str]:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return {c["name"] for c in insp.get_columns(table_name)}


def upgrade() -> None:
    order_cols = _cols("orders")
    if "gst_rate" not in order_cols:
        op.add_column(
            "orders",
            sa.Column("gst_rate", sa.Numeric(9, 6), nullable=False, server_default=sa.text("0.10")),
        )
    if "source_prices_include_gst" not in order_cols:
        op.add_column("orders", sa.Column("source_prices_include_gst", sa.Boolean(), nullable=True))

    item_cols = _cols("order_items")
    if "tax_code" not in item_cols:
        op.add_column("order_items", sa.Column("tax_code", sa.String(length=32), nullable=True))
    if "gst_rate" not in item_cols:
        op.add_column("order_items", sa.Column("gst_rate", sa.Numeric(9, 6), nullable=True))
    if "source_unit_price_includes_gst" not in item_cols:
        op.add_column("order_items", sa.Column("source_unit_price_includes_gst", sa.Boolean(), nullable=True))

    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        op.execute(
            sa.text(
                """
                UPDATE orders
                SET source_prices_include_gst =
                    CASE json_extract(myob_source_sales_order_json, '$.IsTaxInclusive')
                        WHEN 1 THEN 1
                        WHEN 'true' THEN 1
                        WHEN 0 THEN 0
                        WHEN 'false' THEN 0
                        ELSE source_prices_include_gst
                    END
                WHERE myob_source_sales_order_json IS NOT NULL
                """
            )
        )
    elif bind.dialect.name == "postgresql":
        op.execute(
            sa.text(
                """
                UPDATE orders
                SET source_prices_include_gst =
                    CASE lower(coalesce(myob_source_sales_order_json ->> 'IsTaxInclusive', ''))
                        WHEN 'true' THEN true
                        WHEN '1' THEN true
                        WHEN 'false' THEN false
                        WHEN '0' THEN false
                        ELSE source_prices_include_gst
                    END
                WHERE myob_source_sales_order_json IS NOT NULL
                """
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"

    item_cols = _cols("order_items")
    order_cols = _cols("orders")

    if is_sqlite:
        if {"tax_code", "gst_rate", "source_unit_price_includes_gst"} & item_cols:
            with op.batch_alter_table("order_items", recreate="always") as batch:
                if "source_unit_price_includes_gst" in item_cols:
                    batch.drop_column("source_unit_price_includes_gst")
                if "gst_rate" in item_cols:
                    batch.drop_column("gst_rate")
                if "tax_code" in item_cols:
                    batch.drop_column("tax_code")
        if {"gst_rate", "source_prices_include_gst"} & order_cols:
            with op.batch_alter_table("orders", recreate="always") as batch:
                if "source_prices_include_gst" in order_cols:
                    batch.drop_column("source_prices_include_gst")
                if "gst_rate" in order_cols:
                    batch.drop_column("gst_rate")
        return

    if "source_unit_price_includes_gst" in item_cols:
        op.drop_column("order_items", "source_unit_price_includes_gst")
    if "gst_rate" in item_cols:
        op.drop_column("order_items", "gst_rate")
    if "tax_code" in item_cols:
        op.drop_column("order_items", "tax_code")
    if "source_prices_include_gst" in order_cols:
        op.drop_column("orders", "source_prices_include_gst")
    if "gst_rate" in order_cols:
        op.drop_column("orders", "gst_rate")
