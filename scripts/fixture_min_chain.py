from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
import json

from sqlalchemy import create_engine, text


def get_db_url() -> str:
    env_url = os.getenv("DATABASE_URL")
    if env_url:
        return env_url
    # Fallback to app default
    return "postgresql+psycopg://app:app@db:5432/app"


def insert_or_get_id(conn, table: str, unique_col: str, unique_val, insert_cols: dict) -> uuid.UUID:
    # Try insert with RETURNING, fallback to select
    cols = [unique_col] + list(insert_cols.keys())
    vals_placeholders = [f":{unique_col}"] + [f":{k}" for k in insert_cols.keys()]
    sql = text(
        f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join(vals_placeholders)}) "
        f"ON CONFLICT ({unique_col}) DO NOTHING RETURNING id"
    )
    params = {unique_col: unique_val, **insert_cols}
    res = conn.execute(sql, params).fetchone()
    if res:
        return res[0]
    # Already exists, select id
    row = conn.execute(text(f"SELECT id FROM {table} WHERE {unique_col} = :v"), {"v": unique_val}).fetchone()
    return row[0]


def main() -> None:
    engine = create_engine(get_db_url(), future=True)
    now = datetime.now(timezone.utc)

    with engine.begin() as conn:
        # Ensure there is at least one machine EX01 (seeded by migration)
        mrow = conn.execute(text("SELECT id FROM machines WHERE code = 'EX01'")).fetchone()
        if not mrow:
            raise RuntimeError("Seed machine EX01 not found. Run migrations with seeds first.")
        machine_id = mrow[0]

        # Customer
        customer_id = insert_or_get_id(
            conn,
            "customers",
            "code",
            "CUST-FIXTURE",
            {
                "name": "Fixture Customer",
                "contacts": json.dumps({}),
                "delivery_addresses": json.dumps({}),
                "created_at": now,
            },
        )

        # Product
        product_id = insert_or_get_id(
            conn,
            "products",
            "code",
            "PROD-FIXTURE",
            {
                "customer_id": customer_id,
                "active_version_id": None,
                "created_at": now,
            },
        )

        # ProductVersion (v1)
        pv_id = conn.execute(
            text(
                """
                INSERT INTO product_versions (id, product_id, version_number, created_by, created_at, spec_payload)
                VALUES (:id, :product_id, 1, 'fixture', :created_at, :spec::jsonb)
                ON CONFLICT (product_id, version_number) DO NOTHING
                RETURNING id
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "product_id": product_id,
                "created_at": now,
                "spec": json.dumps({"identity": {"name": "Fixture Product"}}),
            },
        ).fetchone()
        if pv_id:
            product_version_id = pv_id[0]
        else:
            product_version_id = conn.execute(
                text(
                    "SELECT id FROM product_versions WHERE product_id = :pid AND version_number = 1"
                ),
                {"pid": product_id},
            ).fetchone()[0]

        # Update product.active_version_id to v1 if null
        conn.execute(
            text(
                """
                UPDATE products SET active_version_id = COALESCE(active_version_id, :pvid)
                WHERE id = :pid
                """
            ),
            {"pvid": product_version_id, "pid": product_id},
        )

        # Order
        order_id = insert_or_get_id(
            conn,
            "orders",
            "code",
            "ORD-FIXTURE",
            {
                "customer_id": customer_id,
                "product_version_id": product_version_id,
                "quote_id": None,
                "status": "confirmed",
                "created_at": now,
            },
        )

        # Job (job_code 1)
        job_row = conn.execute(
            text(
                """
                INSERT INTO jobs (id, order_id, job_code, run_index, planned_qty, produced_qty, status, created_at)
                VALUES (:id, :order_id, 1, 0, 100, 0, 'planned', :created_at)
                ON CONFLICT (order_id, job_code) DO NOTHING
                RETURNING id
                """
            ),
            {"id": str(uuid.uuid4()), "order_id": order_id, "created_at": now},
        ).fetchone()
        if job_row:
            job_id = job_row[0]
        else:
            job_id = conn.execute(
                text(
                    "SELECT id FROM jobs WHERE order_id = :oid AND job_code = 1"
                ),
                {"oid": order_id},
            ).fetchone()[0]

        # OperationRun (completed extrusion)
        run_row = conn.execute(
            text(
                """
                INSERT INTO operation_runs (id, job_id, operation_type, machine_id, status, started_at, ended_at)
                VALUES (:id, :job_id, 'extrusion', :machine_id, 'completed', :started_at, :ended_at)
                ON CONFLICT DO NOTHING
                RETURNING id
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "job_id": job_id,
                "machine_id": machine_id,
                "started_at": now,
                "ended_at": now,
            },
        ).fetchone()
        if run_row:
            run_id = run_row[0]
        else:
            run_id = conn.execute(
                text(
                    "SELECT id FROM operation_runs WHERE job_id = :jid ORDER BY started_at ASC LIMIT 1"
                ),
                {"jid": job_id},
            ).fetchone()[0]

        # RunOutputEntry
        conn.execute(
            text(
                """
                INSERT INTO run_output_entries (id, run_id, timestamp, quantity, uom, good_or_scrap, finished_goods, note)
                VALUES (:id, :run_id, :ts, 100, 'kg', TRUE, FALSE, 'fixture output')
                ON CONFLICT DO NOTHING
                """
            ),
            {"id": str(uuid.uuid4()), "run_id": run_id, "ts": now},
        )

        # InventoryItem (finished goods)
        inv_item_id = insert_or_get_id(
            conn,
            "inventory_items",
            "name",
            "Fixture FG",
            {
                "category": "finished_goods",
                "uom": "kg",
                "active": True,
            },
        )

        # InventoryTransaction (+100 kg FG)
        conn.execute(
            text(
                """
                INSERT INTO inventory_transactions
                (id, item_id, category, quantity, uom, job_id, run_id, reason, created_by, created_at)
                VALUES (:id, :item_id, 'finished_goods', 100, 'kg', :job_id, :run_id, 'production output', 'fixture', :created_at)
                ON CONFLICT DO NOTHING
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "item_id": inv_item_id,
                "job_id": job_id,
                "run_id": run_id,
                "created_at": now,
            },
        )

        # QCReading (sensor)
        qcr_id = conn.execute(
            text(
                """
                INSERT INTO qc_readings (id, operation_run_id, sensor_id, check_type, value, result, recorded_at, source)
                VALUES (:id, :run_id, NULL, 'thickness', :val::jsonb, 'pass', :rec, 'sensor')
                ON CONFLICT DO NOTHING
                RETURNING id
                """
            ),
            {"id": str(uuid.uuid4()), "run_id": run_id, "val": json.dumps({"micron": 25}), "rec": now},
        ).fetchone()
        if qcr_id:
            qc_reading_id = qcr_id[0]
        else:
            qc_reading_id = conn.execute(
                text("SELECT id FROM qc_readings WHERE operation_run_id = :rid LIMIT 1"),
                {"rid": run_id},
            ).fetchone()[0]

        # QCCheck (manual, referencing reading)
        conn.execute(
            text(
                """
                INSERT INTO qc_checks (id, operation_run_id, check_type, required, result, numeric_values, measured_by, timestamp, source, reading_ref)
                VALUES (:id, :run_id, 'thickness', TRUE, 'pass', '{}'::jsonb, 'fixture', :ts, 'manual', :reading_ref)
                ON CONFLICT DO NOTHING
                """
            ),
            {"id": str(uuid.uuid4()), "run_id": run_id, "ts": now, "reading_ref": qc_reading_id},
        )

        # JobQCSummary
        conn.execute(
            text(
                """
                INSERT INTO job_qc_summaries
                (id, job_id, totals, aggregates, final_checklist, deviations, status, created_by, created_at, finalized_by, finalized_at)
                VALUES (:id, :job_id, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'final_pass', 'fixture', :created_at, 'fixture', :created_at)
                ON CONFLICT (job_id) DO NOTHING
                """
            ),
            {"id": str(uuid.uuid4()), "job_id": job_id, "created_at": now},
        )

        # DispatchRecord (persist KPI timestamps)
        conn.execute(
            text(
                """
                INSERT INTO dispatch_records
                (id, job_id, order_id, dispatch_status, packaging, dispatch_metadata, created_at,
                 first_run_started_at, last_run_completed_at, dispatched_at)
                VALUES (:id, :job_id, :order_id, 'ready', '{}'::jsonb, '{}'::jsonb, :created_at,
                        :started, :ended, NULL)
                ON CONFLICT (job_id) DO NOTHING
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "job_id": job_id,
                "order_id": order_id,
                "created_at": now,
                "started": now,
                "ended": now,
            },
        )

    print("Fixture chain inserted or already present.")


if __name__ == "__main__":
    main()


