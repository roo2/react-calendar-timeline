"""MYOB order columns, MYOB item cache + income accounts, unified order_items shape, MYOB draft placeholders.

Schema-only: assumes a fresh database (or empty orders/resell line tables). Legacy data moves from
order_resell_lines / staging tables are not performed — rebuild and re-import instead.
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

revision = "0011_myob_orders_unified"
down_revision = "0010_cust_myob_json_nocode"
branch_labels = None
depends_on = None

CUID = "a0000001-0000-4000-8000-000000000001"
PPID = "a0000001-0000-4000-8000-000000000002"
PVID = "a0000001-0000-4000-8000-000000000003"
PCODE = "__MYOB_IMPORT__"


def _is_sqlite(conn) -> bool:
    return conn.dialect.name == "sqlite"


def _is_postgres(conn) -> bool:
    return conn.dialect.name == "postgresql"


def upgrade() -> None:
    op.add_column("orders", sa.Column("import_source", sa.String(length=32), nullable=True))
    op.add_column("orders", sa.Column("myob_order_uid", sa.String(length=36), nullable=True))
    op.add_column("orders", sa.Column("myob_last_modified", sa.String(length=64), nullable=True))
    op.add_column("orders", sa.Column("myob_synced_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_orders_myob_order_uid", "orders", ["myob_order_uid"], unique=True)

    op.create_table(
        "myob_income_accounts",
        sa.Column("myob_account_uid", sa.String(length=36), nullable=False),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("display_id", sa.String(length=64), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("myob_account_uid", name="pk_myob_income_accounts"),
    )
    op.create_index("ix_myob_income_accounts_display_id", "myob_income_accounts", ["display_id"], unique=False)

    op.create_table(
        "myob_item_selling_uoms",
        sa.Column("myob_item_uid", sa.String(length=36), nullable=False),
        sa.Column("selling_unit_of_measure", sa.String(length=64), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("is_bought", sa.Boolean(), nullable=True),
        sa.Column("myob_income_account_uid", sa.String(length=36), nullable=True),
        sa.ForeignKeyConstraint(
            ["myob_income_account_uid"],
            ["myob_income_accounts.myob_account_uid"],
            name="fk_myob_item_selling_uoms_income_account",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("myob_item_uid", name="pk_myob_item_selling_uoms"),
    )
    op.create_index(
        "ix_myob_item_selling_uoms_uom",
        "myob_item_selling_uoms",
        ["selling_unit_of_measure"],
        unique=False,
    )
    op.create_index(
        "ix_myob_item_selling_uoms_income_account",
        "myob_item_selling_uoms",
        ["myob_income_account_uid"],
        unique=False,
    )

    conn = op.get_bind()
    if _is_sqlite(conn):
        with op.batch_alter_table("resell_products", schema=None) as batch:
            batch.add_column(sa.Column("myob_item_uid", sa.String(length=36), nullable=True))
            batch.create_index("ix_resell_products_myob_item_uid", ["myob_item_uid"], unique=True)
            batch.add_column(sa.Column("myob_income_account_uid", sa.String(length=36), nullable=True))
            batch.create_index(
                "ix_resell_products_myob_income_account_uid",
                ["myob_income_account_uid"],
                unique=False,
            )
            batch.create_foreign_key(
                "fk_resell_products_myob_income_account",
                "myob_income_accounts",
                ["myob_income_account_uid"],
                ["myob_account_uid"],
                ondelete="SET NULL",
            )
    else:
        op.add_column(
            "resell_products",
            sa.Column("myob_item_uid", sa.String(length=36), nullable=True),
        )
        op.create_index("ix_resell_products_myob_item_uid", "resell_products", ["myob_item_uid"], unique=True)
        op.add_column(
            "resell_products",
            sa.Column("myob_income_account_uid", sa.String(length=36), nullable=True),
        )
        op.create_index(
            "ix_resell_products_myob_income_account_uid",
            "resell_products",
            ["myob_income_account_uid"],
            unique=False,
        )
        op.create_foreign_key(
            "fk_resell_products_myob_income_account",
            "resell_products",
            "myob_income_accounts",
            ["myob_income_account_uid"],
            ["myob_account_uid"],
            ondelete="SET NULL",
        )

    op.add_column(
        "job_sheets",
        sa.Column("is_import_draft", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    spec = json.dumps({"identity": {"product_type": "other", "finish_mode": "Rolls"}, "import_placeholder": True})

    conn.execute(
        text(
            """
            INSERT INTO customers (id, name, brand_id, priority_rank, abn, contact_phone, status, contacts,
                delivery_addresses, delivery_preferences, payment_terms, notes, myob_display_id, myob_customer_uid,
                myob_last_modified, myob_synced_at, myob_notes)
            SELECT :id, 'Internal (MYOB import placeholder)', NULL, NULL, NULL, NULL, 'Active', '{}', '{}', '{}', NULL, NULL, NULL, NULL, NULL, NULL, NULL
            WHERE NOT EXISTS (SELECT 1 FROM customers WHERE id = :id)
            """
        ),
        {"id": CUID},
    )
    conn.execute(
        text(
            """
            INSERT INTO products (id, code, description, customer_id, active_version_id, created_at)
            SELECT :id, :code, 'Placeholder for MYOB import draft job sheets', :cust, NULL, CURRENT_TIMESTAMP
            WHERE NOT EXISTS (SELECT 1 FROM products WHERE id = :id)
            """
        ),
        {"id": PPID, "code": PCODE, "cust": CUID},
    )
    if _is_postgres(conn):
        conn.execute(
            text(
                """
                INSERT INTO product_versions (id, product_id, version_number, created_by, spec_payload, created_at)
                SELECT :pvid, :ppid, 1, 'migration', CAST(:spec AS jsonb), CURRENT_TIMESTAMP
                WHERE NOT EXISTS (SELECT 1 FROM product_versions WHERE id = :pvid)
                """
            ),
            {"pvid": PVID, "ppid": PPID, "spec": spec},
        )
    else:
        conn.execute(
            text(
                """
                INSERT INTO product_versions (id, product_id, version_number, created_by, spec_payload, created_at)
                SELECT :pvid, :ppid, 1, 'migration', :spec, CURRENT_TIMESTAMP
                WHERE NOT EXISTS (SELECT 1 FROM product_versions WHERE id = :pvid)
                """
            ),
            {"pvid": PVID, "ppid": PPID, "spec": spec},
        )
    conn.execute(
        text("UPDATE products SET active_version_id = :pvid WHERE id = :ppid"), {"pvid": PVID, "ppid": PPID}
    )

    def _add_columns_sqlite_batch(batch) -> None:
        batch.add_column(sa.Column("line_index", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(
            sa.Column("line_kind", sa.String(length=32), nullable=False, server_default="manufactured")
        )
        batch.add_column(sa.Column("resell_product_id", sa.String(length=36), nullable=True))
        batch.add_column(sa.Column("resell_description_snapshot", sa.Text(), nullable=True))
        batch.add_column(sa.Column("resell_due_date", sa.Date(), nullable=True))
        batch.add_column(sa.Column("resell_quantity_value", sa.Numeric(18, 6), nullable=True))
        batch.add_column(sa.Column("resell_quantity_unit", sa.String(16), nullable=True))
        batch.add_column(sa.Column("resell_unit_rate", sa.Numeric(18, 6), nullable=True))
        batch.add_column(sa.Column("resell_line_total", sa.Numeric(18, 6), nullable=True))
        batch.add_column(sa.Column("import_line_description", sa.Text(), nullable=True))
        batch.add_column(sa.Column("myob_row_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("myob_line_type", sa.String(32), nullable=True))
        batch.add_column(sa.Column("myob_item_uid", sa.String(36), nullable=True))
        batch.add_column(sa.Column("myob_item_number", sa.String(64), nullable=True))
        batch.add_column(sa.Column("myob_item_name", sa.String(255), nullable=True))
        batch.add_column(sa.Column("import_ship_quantity", sa.Numeric(18, 6), nullable=True))
        batch.add_column(sa.Column("import_unit_price", sa.Numeric(18, 6), nullable=True))
        batch.add_column(sa.Column("import_line_total", sa.Numeric(18, 6), nullable=True))
        batch.add_column(sa.Column("import_quantity_unit", sa.String(16), nullable=True))
        batch.add_column(sa.Column("import_qty_type", sa.String(32), nullable=True))
        batch.add_column(sa.Column("myob_item_sales_unit_raw", sa.String(64), nullable=True))
        batch.add_column(sa.Column("myob_item_json", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("import_requires_job_sheet", sa.Boolean(), nullable=True))
        batch.create_foreign_key("fk_order_items_resell_product", "resell_products", ["resell_product_id"], ["id"], ondelete="RESTRICT")
        batch.alter_column("job_sheet_id", existing_type=sa.String(length=36), nullable=True)

    def _add_columns_plain() -> None:
        op.add_column("order_items", sa.Column("line_index", sa.Integer(), nullable=False, server_default="0"))
        op.add_column(
            "order_items",
            sa.Column("line_kind", sa.String(length=32), nullable=False, server_default="manufactured"),
        )
        op.add_column(
            "order_items",
            sa.Column(
                "resell_product_id",
                sa.String(length=36),
                sa.ForeignKey("resell_products.id", ondelete="RESTRICT"),
                nullable=True,
            ),
        )
        op.add_column("order_items", sa.Column("resell_description_snapshot", sa.Text(), nullable=True))
        op.add_column("order_items", sa.Column("resell_due_date", sa.Date(), nullable=True))
        op.add_column("order_items", sa.Column("resell_quantity_value", sa.Numeric(18, 6), nullable=True))
        op.add_column("order_items", sa.Column("resell_quantity_unit", sa.String(16), nullable=True))
        op.add_column("order_items", sa.Column("resell_unit_rate", sa.Numeric(18, 6), nullable=True))
        op.add_column("order_items", sa.Column("resell_line_total", sa.Numeric(18, 6), nullable=True))
        op.add_column("order_items", sa.Column("import_line_description", sa.Text(), nullable=True))
        op.add_column("order_items", sa.Column("myob_row_id", sa.Integer(), nullable=True))
        op.add_column("order_items", sa.Column("myob_line_type", sa.String(32), nullable=True))
        op.add_column("order_items", sa.Column("myob_item_uid", sa.String(36), nullable=True))
        op.add_column("order_items", sa.Column("myob_item_number", sa.String(64), nullable=True))
        op.add_column("order_items", sa.Column("myob_item_name", sa.String(255), nullable=True))
        op.add_column("order_items", sa.Column("import_ship_quantity", sa.Numeric(18, 6), nullable=True))
        op.add_column("order_items", sa.Column("import_unit_price", sa.Numeric(18, 6), nullable=True))
        op.add_column("order_items", sa.Column("import_line_total", sa.Numeric(18, 6), nullable=True))
        op.add_column("order_items", sa.Column("import_quantity_unit", sa.String(16), nullable=True))
        op.add_column("order_items", sa.Column("import_qty_type", sa.String(32), nullable=True))
        op.add_column("order_items", sa.Column("myob_item_sales_unit_raw", sa.String(64), nullable=True))
        op.add_column("order_items", sa.Column("myob_item_json", sa.JSON(), nullable=True))
        op.add_column("order_items", sa.Column("import_requires_job_sheet", sa.Boolean(), nullable=True))
        op.alter_column("order_items", "job_sheet_id", existing_type=sa.String(36), nullable=True)

    if _is_sqlite(conn):
        with op.batch_alter_table("order_items", schema=None) as batch:
            batch.drop_constraint("uq_order_item_order_job_sheet", type_="unique")
            _add_columns_sqlite_batch(batch)
    else:
        op.drop_constraint("uq_order_item_order_job_sheet", "order_items", type_="unique")
        _add_columns_plain()

    op.drop_table("order_resell_lines")

    if _is_sqlite(conn):
        op.execute(
            "CREATE UNIQUE INDEX uq_order_items_order_line_index ON order_items (order_id, line_index)"
        )
    else:
        op.create_unique_constraint("uq_order_items_order_line_index", "order_items", ["order_id", "line_index"])
    if _is_postgres(conn):
        op.create_index(
            "uq_order_items_job_sheet_id_notnull",
            "order_items",
            ["job_sheet_id"],
            unique=True,
            postgresql_where=sa.text("job_sheet_id IS NOT NULL"),
        )
    else:
        op.execute(
            "CREATE UNIQUE INDEX uq_order_items_job_sheet_id_notnull "
            "ON order_items (job_sheet_id) WHERE job_sheet_id IS NOT NULL"
        )

    if _is_postgres(conn):
        op.alter_column("order_items", "line_index", server_default=None, existing_type=sa.Integer())
        op.alter_column("order_items", "line_kind", server_default=None, existing_type=sa.String(length=32))
    else:
        with op.batch_alter_table("order_items", schema=None) as batch:
            batch.alter_column("line_index", server_default=None)
            batch.alter_column("line_kind", server_default=None)


def downgrade() -> None:
    raise NotImplementedError(
        "downgrade not supported for consolidated migration 0011_myob_orders_unified"
    )
