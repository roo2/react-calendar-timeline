from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0002_postgres_extras"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def _is_postgres(conn) -> bool:
    return conn.dialect.name == "postgresql"


def upgrade() -> None:
    conn = op.get_bind()

    if _is_postgres(conn):
        # Extensions for exclusion constraints
        op.execute(sa.text("CREATE EXTENSION IF NOT EXISTS btree_gist"))

        # Sequences for code columns
        op.execute(sa.text("CREATE SEQUENCE IF NOT EXISTS product_code_seq START WITH 1000"))
        op.execute(sa.text("CREATE SEQUENCE IF NOT EXISTS order_code_seq START WITH 1000"))

        # Server defaults for code columns (explicit ::text casts for varchar columns)
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

        # Machine exclusivity: one running run per machine (partial unique)
        op.create_index(
            "uq_running_run_per_machine",
            "operation_runs",
            ["machine_id"],
            unique=True,
            postgresql_where=sa.text("status = 'running'"),
        )

        # Exclusion constraints (prevent overlapping windows for mounts/reservations)
        op.execute(
            """
            ALTER TABLE tool_mounts
            ADD CONSTRAINT ex_tool_mount_no_overlap
            EXCLUDE USING gist (
              tool_id WITH =,
              tstzrange(mounted_from, mounted_to) WITH &&
            );
            """
        )
        op.execute(
            """
            ALTER TABLE tool_reservations
            ADD CONSTRAINT ex_tool_res_no_overlap
            EXCLUDE USING gist (
              tool_id WITH =,
              tstzrange(planned_from, planned_to) WITH &&
            );
            """
        )

        # Append-only protections (PostgreSQL triggers)
        op.execute(
            """
            CREATE OR REPLACE FUNCTION prevent_update_delete()
            RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION 'Updates and deletes are not allowed on this append-only table';
            END;
            $$ LANGUAGE plpgsql;
            """
        )
        op.execute(
            """
            CREATE TRIGGER trg_run_output_entries_append_only
            BEFORE UPDATE OR DELETE ON run_output_entries
            FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();
            """
        )
        op.execute(
            """
            CREATE TRIGGER trg_inventory_transactions_append_only
            BEFORE UPDATE OR DELETE ON inventory_transactions
            FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();
            """
        )
        op.execute(
            """
            CREATE OR REPLACE FUNCTION prevent_delete_only()
            RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION 'Deletes are not allowed on this history table';
            END;
            $$ LANGUAGE plpgsql;
            """
        )
        op.execute(
            """
            CREATE TRIGGER trg_tool_mounts_no_delete
            BEFORE DELETE ON tool_mounts
            FOR EACH ROW EXECUTE FUNCTION prevent_delete_only();
            """
        )
    else:
        # SQLite: partial unique index via raw SQL
        op.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_running_run_per_machine "
            "ON operation_runs(machine_id) WHERE status = 'running'"
        )


def downgrade() -> None:
    conn = op.get_bind()

    if _is_postgres(conn):
        # Drop triggers and functions
        op.execute("DROP TRIGGER IF EXISTS trg_tool_mounts_no_delete ON tool_mounts")
        op.execute("DROP FUNCTION IF EXISTS prevent_delete_only()")
        op.execute("DROP TRIGGER IF EXISTS trg_inventory_transactions_append_only ON inventory_transactions")
        op.execute("DROP TRIGGER IF EXISTS trg_run_output_entries_append_only ON run_output_entries")
        op.execute("DROP FUNCTION IF EXISTS prevent_update_delete()")

        # Drop sequences and defaults
        op.alter_column("orders", "code", server_default=None, existing_type=sa.String(length=32))
        op.alter_column("products", "code", server_default=None, existing_type=sa.String(length=32))
        op.execute("DROP SEQUENCE IF EXISTS order_code_seq")
        op.execute("DROP SEQUENCE IF EXISTS product_code_seq")

        # Drop exclusion constraints
        op.execute("ALTER TABLE tool_reservations DROP CONSTRAINT IF EXISTS ex_tool_res_no_overlap")
        op.execute("ALTER TABLE tool_mounts DROP CONSTRAINT IF EXISTS ex_tool_mount_no_overlap")

        # Drop partial unique index
        op.drop_index("uq_running_run_per_machine", table_name="operation_runs")
    else:
        op.execute("DROP INDEX IF EXISTS uq_running_run_per_machine")

