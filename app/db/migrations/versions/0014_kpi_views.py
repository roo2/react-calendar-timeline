from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0014_kpi_views"
down_revision = "0013_code_defaults"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name == "postgresql":
        # View: inventory balances by category
        op.execute(
            """
            CREATE OR REPLACE VIEW v_inventory_balances_by_category AS
            SELECT
                category AS inventory_category,
                COALESCE(SUM(quantity), 0) AS qty
            FROM inventory_transactions
            GROUP BY category;
            """
        )
        # View: WIP stage balances (single-row)
        op.execute(
            """
            CREATE OR REPLACE VIEW v_wip_stage_balances AS
            SELECT
                COALESCE((
                    SELECT SUM(quantity) FROM inventory_transactions WHERE category = 'wip_extruded_roll'
                ), 0) AS wip_extrusion_kg,
                COALESCE((
                    SELECT SUM(quantity) FROM inventory_transactions WHERE category = 'wip_printed_roll'
                ), 0) AS wip_printing_kg,
                COALESCE((
                    SELECT SUM(quantity) FROM inventory_transactions WHERE category = 'finished_goods'
                ), 0) AS fg_on_hand_units;
            """
        )
    else:
        # SQLite: DROP VIEW IF EXISTS then CREATE VIEW (no OR REPLACE)
        op.execute("DROP VIEW IF EXISTS v_inventory_balances_by_category")
        op.execute(
            """
            CREATE VIEW v_inventory_balances_by_category AS
            SELECT
                category AS inventory_category,
                COALESCE(SUM(quantity), 0) AS qty
            FROM inventory_transactions
            GROUP BY category
            """
        )
        op.execute("DROP VIEW IF EXISTS v_wip_stage_balances")
        op.execute(
            """
            CREATE VIEW v_wip_stage_balances AS
            SELECT
                COALESCE((
                    SELECT SUM(quantity) FROM inventory_transactions WHERE category = 'wip_extruded_roll'
                ), 0) AS wip_extrusion_kg,
                COALESCE((
                    SELECT SUM(quantity) FROM inventory_transactions WHERE category = 'wip_printed_roll'
                ), 0) AS wip_printing_kg,
                COALESCE((
                    SELECT SUM(quantity) FROM inventory_transactions WHERE category = 'finished_goods'
                ), 0) AS fg_on_hand_units
            """
        )


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS v_wip_stage_balances")
    op.execute("DROP VIEW IF EXISTS v_inventory_balances_by_category")


