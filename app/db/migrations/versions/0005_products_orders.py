from __future__ import annotations

import uuid

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0005_products_orders"
down_revision = "0004_drop_customer_code"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # --- Products: add description column ---
    if conn.dialect.name == "sqlite":
        with op.batch_alter_table("products") as batch_op:
            batch_op.add_column(sa.Column("description", sa.String(length=255), nullable=True))
    else:
        op.add_column("products", sa.Column("description", sa.String(length=255), nullable=True))

    # --- Orders: support multi-product orders via order_items ---
    op.create_table(
        "order_items",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "order_id",
            sa.String(length=36),
            sa.ForeignKey("orders.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "product_version_id",
            sa.String(length=36),
            sa.ForeignKey("product_versions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("quantity", sa.Numeric(18, 6), nullable=False),
        sa.UniqueConstraint("order_id", "product_version_id", name="uq_order_item_order_version"),
    )
    op.create_index("ix_order_items_order", "order_items", ["order_id"], unique=False)
    op.create_index("ix_order_items_version", "order_items", ["product_version_id"], unique=False)

    # Make orders.product_version_id nullable (deprecated field kept for compatibility)
    if conn.dialect.name == "sqlite":
        with op.batch_alter_table("orders", schema=None) as batch_op:
            batch_op.alter_column("product_version_id", existing_type=sa.String(length=36), nullable=True)
    else:
        op.alter_column("orders", "product_version_id", existing_type=sa.String(length=36), nullable=True)

    # Backfill: for existing single-product orders, create one order_item with qty=1
    rows = conn.execute(sa.text("SELECT id, product_version_id FROM orders WHERE product_version_id IS NOT NULL")).fetchall()
    for order_id, pv_id in rows:
        conn.execute(
            sa.text(
                "INSERT INTO order_items (id, order_id, product_version_id, quantity) "
                "VALUES (:id, :oid, :pvid, :qty)"
            ),
            {"id": str(uuid.uuid4()), "oid": str(order_id), "pvid": str(pv_id), "qty": 1},
        )


def downgrade() -> None:
    conn = op.get_bind()

    # Best-effort: restore orders.product_version_id from the first item per order
    if conn.dialect.name == "postgresql":
        conn.execute(
            sa.text(
                """
                UPDATE orders o
                SET product_version_id = x.product_version_id
                FROM (
                  SELECT DISTINCT ON (order_id) order_id, product_version_id
                  FROM order_items
                  ORDER BY order_id, id
                ) x
                WHERE o.id = x.order_id
                """
            )
        )
    elif conn.dialect.name == "sqlite":
        rows = conn.execute(sa.text("SELECT order_id, MIN(id) AS mid FROM order_items GROUP BY order_id")).fetchall()
        for order_id, mid in rows:
            pv = conn.execute(
                sa.text("SELECT product_version_id FROM order_items WHERE id = :id"),
                {"id": mid},
            ).fetchone()
            if pv:
                conn.execute(
                    sa.text("UPDATE orders SET product_version_id = :pv WHERE id = :oid"),
                    {"pv": pv[0], "oid": order_id},
                )

    if conn.dialect.name == "sqlite":
        with op.batch_alter_table("orders", schema=None) as batch_op:
            batch_op.alter_column("product_version_id", existing_type=sa.String(length=36), nullable=False)
    else:
        op.alter_column("orders", "product_version_id", existing_type=sa.String(length=36), nullable=False)

    op.drop_index("ix_order_items_version", table_name="order_items")
    op.drop_index("ix_order_items_order", table_name="order_items")
    op.drop_table("order_items")

    # Drop products.description column
    if conn.dialect.name == "sqlite":
        with op.batch_alter_table("products") as batch_op:
            batch_op.drop_column("description")
    else:
        op.drop_column("products", "description")

