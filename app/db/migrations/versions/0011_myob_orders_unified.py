"""Consolidated: MYOB order import, MYOB item cache + income accounts, unified order items, resell MYOB links.

Replaces migrations 0011_myob_order_import through 0015_myob_income_accounts for fresh installs.
"""

from __future__ import annotations

import json
import uuid

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
    # -- former 0011_myob_order_import --
    op.add_column("orders", sa.Column("import_source", sa.String(length=32), nullable=True))
    op.add_column("orders", sa.Column("myob_order_uid", sa.String(length=36), nullable=True))
    op.add_column("orders", sa.Column("myob_last_modified", sa.String(length=64), nullable=True))
    op.add_column("orders", sa.Column("myob_synced_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_orders_myob_order_uid", "orders", ["myob_order_uid"], unique=True)

    op.create_table(
        "order_myob_lines",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("order_id", sa.String(length=36), nullable=False),
        sa.Column("line_index", sa.Integer(), nullable=False),
        sa.Column("myob_row_id", sa.Integer(), nullable=True),
        sa.Column("myob_line_type", sa.String(length=32), nullable=True),
        sa.Column("myob_item_uid", sa.String(length=36), nullable=True),
        sa.Column("myob_item_number", sa.String(length=64), nullable=True),
        sa.Column("myob_item_name", sa.String(length=255), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("ship_quantity", sa.Numeric(18, 6), nullable=False),
        sa.Column("unit_price", sa.Numeric(18, 6), nullable=True),
        sa.Column("line_total", sa.Numeric(18, 6), nullable=True),
        sa.Column("quantity_unit", sa.String(length=16), nullable=False, server_default="kg"),
        sa.Column("qty_type", sa.String(length=32), nullable=False, server_default="kg"),
        sa.Column("myob_item_sales_unit_raw", sa.String(length=64), nullable=True),
        sa.Column("myob_item_json", sa.JSON(), nullable=True),
        sa.Column("requires_job_sheet", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("job_sheet_id", sa.String(length=36), nullable=True),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["job_sheet_id"], ["job_sheets.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("order_id", "line_index", name="uq_order_myob_lines_order_line_index"),
        sa.UniqueConstraint("order_id", "myob_row_id", name="uq_order_myob_lines_order_row_id"),
    )
    op.create_index("ix_order_myob_lines_order", "order_myob_lines", ["order_id"])
    op.create_index("ix_order_myob_lines_job_sheet", "order_myob_lines", ["job_sheet_id"])

    # -- former 0015 (income accounts) + 0012/0014/0015 (MYOB item cache + resell columns) --
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
    # SQLite cannot ALTER TABLE to add FK constraints outside batch mode.
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

    # -- former 0013_unified_order_items --

    has_draft = False
    if _is_sqlite(conn):
        info = conn.execute(text("PRAGMA table_info(job_sheets)")).fetchall()
        has_draft = any(str(row[1]) == "is_import_draft" for row in info)
    elif _is_postgres(conn):
        r = conn.execute(
            text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name = 'job_sheets' AND column_name = 'is_import_draft'"
            )
        ).fetchone()
        has_draft = r is not None
    if not has_draft:
        op.add_column(
            "job_sheets",
            sa.Column("is_import_draft", sa.Boolean(), nullable=False, server_default=sa.text("0")),
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
            try:
                batch.drop_constraint("uq_order_item_order_job_sheet", type_="unique")
            except Exception:
                pass
            _add_columns_sqlite_batch(batch)
    else:
        op.drop_constraint("uq_order_item_order_job_sheet", "order_items", type_="unique")
        _add_columns_plain()

    oi_by_order: dict[str, list[tuple[str, str, str, int]]] = {}
    for row in conn.execute(
        text(
            """
            SELECT oi.id, oi.order_id, oi.job_sheet_id, js.job_seq
            FROM order_items oi
            JOIN job_sheets js ON js.id = oi.job_sheet_id
            ORDER BY oi.order_id ASC, js.job_seq ASC, oi.id ASC
            """
        )
    ).fetchall():
        oi_id, order_id, js_id, job_seq = str(row[0]), str(row[1]), str(row[2]), int(row[3] or 0)
        oi_by_order.setdefault(order_id, []).append((oi_id, order_id, js_id, job_seq))

    for _order_id, ois in oi_by_order.items():
        ois.sort(key=lambda x: (x[3], x[0]))
        for idx, (oi_id, _, _, _) in enumerate(ois):
            conn.execute(
                text("UPDATE order_items SET line_index = :li, line_kind = 'manufactured' WHERE id = :id"),
                {"li": idx, "id": oi_id},
            )

    def _order_max_line_index(oid: str) -> int:
        r = conn.execute(
            text("SELECT COALESCE(MAX(line_index), -1) FROM order_items WHERE order_id = :o"), {"o": oid}
        ).fetchone()
        v = r[0] if r is not None else -1
        return int(v) if v is not None else -1

    for row in conn.execute(
        text(
            """
            SELECT id, order_id, resell_product_id, description_snapshot, quantity_value, quantity_unit, unit_rate, line_total, due_date
            FROM order_resell_lines
            ORDER BY order_id, id
            """
        )
    ).fetchall():
        (lid, order_id, rpid, desc, qv, qu, ur, lt, dd) = row
        oid = str(order_id)
        li = _order_max_line_index(oid) + 1
        conn.execute(
            text(
                """
                INSERT INTO order_items (
                    id, order_id, job_sheet_id, line_index, line_kind,
                    resell_product_id, resell_description_snapshot, resell_due_date, resell_quantity_value,
                    resell_quantity_unit, resell_unit_rate, resell_line_total
                ) VALUES (
                    :id, :oid, NULL, :li, 'resell',
                    :rpid, :desc, :dd, :qv, :qu, :ur, :lt
                )
                """
            ),
            {
                "id": str(lid),
                "oid": oid,
                "li": li,
                "rpid": str(rpid),
                "desc": str(desc),
                "dd": dd,
                "qv": qv,
                "qu": str(qu or "ea"),
                "ur": ur,
                "lt": lt,
            },
        )

    myob_rows = conn.execute(
        text(
            """
            SELECT
              id, order_id, line_index, myob_row_id, myob_line_type, myob_item_uid, myob_item_number, myob_item_name,
              description, ship_quantity, unit_price, line_total, quantity_unit, qty_type,
              myob_item_sales_unit_raw, myob_item_json, requires_job_sheet, job_sheet_id
            FROM order_myob_lines
            ORDER BY order_id, line_index, id
            """
        )
    ).fetchall()

    for m in myob_rows:
        (
            mid,
            m_order_id,
            _m_line_index,
            myob_row_id,
            myob_line_type,
            myob_item_uid,
            myob_item_number,
            myob_item_name,
            description,
            ship_quantity,
            unit_price,
            line_total,
            quantity_unit,
            qty_type,
            sales_raw,
            myob_item_json,
            requires_js,
            existing_js_id,
        ) = m
        oid = str(m_order_id)
        li = _order_max_line_index(oid) + 1
        mjid = str(mid)

        payload_json = myob_item_json
        if isinstance(payload_json, (dict, list)):
            payload_json = json.dumps(payload_json)
        elif payload_json is not None:
            payload_json = str(payload_json)

        needs_draft = bool(requires_js) and existing_js_id is None
        jsid = str(existing_js_id) if existing_js_id is not None else None

        if needs_draft:
            cust = conn.execute(
                text("SELECT customer_id FROM orders WHERE id = :o"), {"o": oid}
            ).fetchone()
            if not cust:
                continue
            customer_id = str(cust[0])
            nseq = int(
                conn.execute(
                    text("SELECT COALESCE(MAX(job_seq),0) + 1 FROM job_sheets WHERE customer_id = :c"),
                    {"c": customer_id},
                ).fetchone()[0]
            )
            pfx = f"MIG-{str(customer_id).replace('-', '')[:4].upper()}"
            jno = f"{pfx}_{nseq}"
            new_js = str(uuid.uuid4())
            conn.execute(
                text(
                    """
                    INSERT INTO job_sheets (
                        id, job_no, job_seq, customer_id, product_id, product_version_id, due_date,
                        quantity_value, quantity_unit, qty_type, num_product_units, weight_per_roll_kg, num_rolls,
                        unit_rate, line_total, created_by, is_import_draft, created_at
                    ) VALUES (
                        :id, :jno, :nseq, :cid, :pid, :pvid, NULL,
                        :qv, :qu, :qyt, NULL, NULL, 1,
                        :ur, :lt, 'migration', 1, CURRENT_TIMESTAMP
                    )
                    """
                ),
                {
                    "id": new_js,
                    "jno": jno,
                    "nseq": nseq,
                    "cid": customer_id,
                    "pid": PPID,
                    "pvid": PVID,
                    "qv": float(ship_quantity or 0),
                    "qu": str(quantity_unit or "kg"),
                    "qyt": str(qty_type or "kg"),
                    "ur": unit_price,
                    "lt": line_total,
                },
            )
            jsid = new_js

        if _is_postgres(conn) and payload_json is not None:
            conn.execute(
                text(
                    """
                    INSERT INTO order_items (
                        id, order_id, job_sheet_id, line_index, line_kind,
                        import_line_description, myob_row_id, myob_line_type, myob_item_uid, myob_item_number, myob_item_name,
                        import_ship_quantity, import_unit_price, import_line_total, import_quantity_unit, import_qty_type,
                        myob_item_sales_unit_raw, myob_item_json, import_requires_job_sheet
                    ) VALUES (
                        :id, :oid, :ejs, :li, 'myob_import',
                        :desc, :mrid, :mlt, :mui, :mun, :mun2,
                        :ship, :iup, :ilt, :iqu, :iqt, :sraw, CAST(:jp AS jsonb), :reqj
                    )
                    """
                ),
                {
                    "id": mjid,
                    "oid": oid,
                    "ejs": jsid,
                    "li": li,
                    "desc": str(description or ""),
                    "mrid": myob_row_id,
                    "mlt": myob_line_type,
                    "mui": str(myob_item_uid) if myob_item_uid is not None else None,
                    "mun": str(myob_item_number) if myob_item_number is not None else None,
                    "mun2": str(myob_item_name) if myob_item_name is not None else None,
                    "ship": ship_quantity,
                    "iup": unit_price,
                    "ilt": line_total,
                    "iqu": str(quantity_unit or "kg"),
                    "iqt": str(qty_type or "kg"),
                    "sraw": str(sales_raw) if sales_raw is not None else None,
                    "jp": payload_json,
                    "reqj": bool(requires_js),
                },
            )
        else:
            conn.execute(
                text(
                    """
                    INSERT INTO order_items (
                        id, order_id, job_sheet_id, line_index, line_kind,
                        import_line_description, myob_row_id, myob_line_type, myob_item_uid, myob_item_number, myob_item_name,
                        import_ship_quantity, import_unit_price, import_line_total, import_quantity_unit, import_qty_type,
                        myob_item_sales_unit_raw, myob_item_json, import_requires_job_sheet
                    ) VALUES (
                        :id, :oid, :ejs, :li, 'myob_import',
                        :desc, :mrid, :mlt, :mui, :mun, :mun2,
                        :ship, :iup, :ilt, :iqu, :iqt, :sraw, :jp, :reqj
                    )
                    """
                ),
                {
                    "id": mjid,
                    "oid": oid,
                    "ejs": jsid,
                    "li": li,
                    "desc": str(description or ""),
                    "mrid": myob_row_id,
                    "mlt": myob_line_type,
                    "mui": str(myob_item_uid) if myob_item_uid is not None else None,
                    "mun": str(myob_item_number) if myob_item_number is not None else None,
                    "mun2": str(myob_item_name) if myob_item_name is not None else None,
                    "ship": ship_quantity,
                    "iup": unit_price,
                    "ilt": line_total,
                    "iqu": str(quantity_unit or "kg"),
                    "iqt": str(qty_type or "kg"),
                    "sraw": str(sales_raw) if sales_raw is not None else None,
                    "jp": payload_json,
                    "reqj": bool(requires_js),
                },
            )

        if not needs_draft and existing_js_id is not None:
            conn.execute(
                text("UPDATE job_sheets SET is_import_draft = 0 WHERE id = :id"), {"id": str(existing_js_id)}
            )

    if _is_postgres(conn):
        op.execute(text("DROP TABLE IF EXISTS order_resell_lines CASCADE"))
        op.execute(text("DROP TABLE IF EXISTS order_myob_lines CASCADE"))
    else:
        for t in ("order_resell_lines", "order_myob_lines"):
            try:
                op.execute(text(f"DROP TABLE IF EXISTS {t}"))
            except Exception:
                pass

    if _is_sqlite(conn):
        op.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_order_items_order_line_index "
            "ON order_items (order_id, line_index)"
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
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_order_items_job_sheet_id_notnull "
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
