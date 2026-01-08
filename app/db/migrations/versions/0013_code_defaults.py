from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0013_code_defaults"
down_revision = "0012_rate_cards"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name == "postgresql":
        # Ensure sequences exist (created in 0010); set explicit text casts to text for varchar columns
        op.alter_column(
            "customers",
            "code",
            server_default=sa.text("nextval('customer_code_seq')::text"),
            existing_type=sa.String(length=32),
        )
        op.alter_column(
            "products",
            "code",
            server_default=sa.text("nextval('product_code_seq')::text"),
            existing_type=sa.String(length=32),
        )
        op.alter_column(
            "orders",
            "code",
            server_default=sa.text("nextval('order_code_seq')::text"),
            existing_type=sa.String(length=32),
        )


def downgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name == "postgresql":
        op.alter_column("orders", "code", server_default=None, existing_type=sa.String(length=32))
        op.alter_column("products", "code", server_default=None, existing_type=sa.String(length=32))
        op.alter_column("customers", "code", server_default=None, existing_type=sa.String(length=32))


