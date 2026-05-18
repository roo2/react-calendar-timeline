"""Product default qty type for repeat orders.

Revision ID: 0029_products_default_qty_type
Revises: 0028_xero_oauth
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0029_products_default_qty_type"
down_revision = "0028_xero_oauth"
branch_labels = None
depends_on = None


def _seed_default_qty_type_from_job_sheets(conn) -> None:
    """Latest non-import job sheet per product → products.default_qty_type."""
    if conn.dialect.name == "postgresql":
        conn.execute(
            sa.text(
                """
                UPDATE products AS p
                SET default_qty_type = sub.qty_type
                FROM (
                    SELECT DISTINCT ON (product_id) product_id, qty_type
                    FROM job_sheets
                    WHERE is_import_draft = FALSE
                      AND qty_type IS NOT NULL
                      AND TRIM(qty_type) <> ''
                    ORDER BY product_id, created_at DESC NULLS LAST
                ) AS sub
                WHERE p.id = sub.product_id
                """
            )
        )
        return

    # SQLite (local dev): correlated subquery with LIMIT 1
    conn.execute(
        sa.text(
            """
            UPDATE products
            SET default_qty_type = (
                SELECT js.qty_type
                FROM job_sheets AS js
                WHERE js.product_id = products.id
                  AND js.is_import_draft = 0
                  AND js.qty_type IS NOT NULL
                  AND TRIM(js.qty_type) <> ''
                ORDER BY js.created_at DESC
                LIMIT 1
            )
            """
        )
    )


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    product_cols = {c["name"] for c in inspector.get_columns("products")}
    if "default_qty_type" not in product_cols:
        op.add_column(
            "products",
            sa.Column("default_qty_type", sa.String(length=16), nullable=True),
        )
    _seed_default_qty_type_from_job_sheets(conn)


def downgrade() -> None:
    op.drop_column("products", "default_qty_type")
