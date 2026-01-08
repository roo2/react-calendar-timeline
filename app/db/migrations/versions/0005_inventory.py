from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0005_inventory"
down_revision = "0004_runs_outputs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Inventory Items
    op.create_table(
        "inventory_items",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("category", sa.Enum(name="inventory_category", native_enum=False), nullable=False),
        sa.Column("uom", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.text("TRUE")),
    )

    # Inventory Transactions (append-only ledger)
    op.create_table(
        "inventory_transactions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("item_id", sa.String(length=36), sa.ForeignKey("inventory_items.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("category", sa.Enum(name="inventory_category", native_enum=False), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 6), nullable=False),
        sa.Column("uom", sa.String(length=32), nullable=False),
        sa.Column("job_id", sa.String(length=36), sa.ForeignKey("jobs.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("run_id", sa.String(length=36), sa.ForeignKey("operation_runs.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("reason", sa.String(length=255), nullable=True),
        sa.Column("created_by", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_inventory_tx_item", "inventory_transactions", ["item_id"], unique=False)
    op.create_index("ix_inventory_tx_job", "inventory_transactions", ["job_id"], unique=False)
    op.create_index("ix_inventory_tx_run", "inventory_transactions", ["run_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_inventory_tx_run", table_name="inventory_transactions")
    op.drop_index("ix_inventory_tx_job", table_name="inventory_transactions")
    op.drop_index("ix_inventory_tx_item", table_name="inventory_transactions")
    op.drop_table("inventory_transactions")
    op.drop_table("inventory_items")


