from __future__ import annotations

import json
import uuid
import os
import sys

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# Allow importing app modules when running Alembic from various entrypoints.
# (Some environments don't put the repo root on sys.path by default.)
_cwd = os.getcwd()
if _cwd and _cwd not in sys.path:
    sys.path.insert(0, _cwd)

from app.db.seed_data.inks_database import INKS as INKS_DB  # noqa: E402

# revision identifiers, used by Alembic.
revision = "0003_views_and_seeds"
down_revision = "0002_postgres_extras"
branch_labels = None
depends_on = None


def _fk_name_to_machines(table: str) -> str | None:
    conn = op.get_bind()
    for fk in inspect(conn).get_foreign_keys(table):
        if fk.get("referred_table") == "machines" and fk.get("constrained_columns") == ["machine_id"]:
            return fk.get("name")
    return None


def _apply_squashed_post_0003_changes(conn, is_pg: bool, is_sqlite: bool) -> None:
    _false = sa.text("false") if is_pg else sa.text("0")

    # 0005_production_operating_hours
    op.create_table(
        "production_operating_settings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="Australia/Brisbane"),
        sa.Column("gantt_preview_weeks", sa.Integer(), nullable=False, server_default="26"),
        sa.Column("week_json", sa.JSON(), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_production_operating_settings_singleton"),
        sa.CheckConstraint("gantt_preview_weeks >= 1 AND gantt_preview_weeks <= 52", name="ck_gantt_preview_weeks_range"),
    )
    week_json = json.dumps(
        {
            "monday": {"enabled": True, "start": "00:00", "end": "24:00"},
            "tuesday": {"enabled": True, "start": "00:00", "end": "24:00"},
            "wednesday": {"enabled": True, "start": "00:00", "end": "24:00"},
            "thursday": {"enabled": True, "start": "00:00", "end": "24:00"},
            "friday": {"enabled": True, "start": "00:00", "end": "16:30"},
            "saturday": {"enabled": False, "start": "00:00", "end": "24:00"},
            "sunday": {"enabled": False, "start": "00:00", "end": "24:00"},
        }
    )
    conn.execute(
        sa.text(
            "INSERT INTO production_operating_settings (id, timezone, gantt_preview_weeks, week_json) "
            "VALUES (1, 'Australia/Brisbane', 26, :wj)"
        ),
        {"wj": week_json},
    )
    op.create_table(
        "production_calendar_exceptions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("exception_date", sa.Date(), nullable=False),
        sa.Column("closed", sa.Boolean(), nullable=False, server_default=_false),
        sa.Column("open_time", sa.String(8), nullable=True),
        sa.Column("close_time", sa.String(8), nullable=True),
        sa.Column("note", sa.String(255), nullable=True),
        sa.UniqueConstraint("exception_date", name="uq_production_calendar_exception_date"),
    )
    op.create_index("ix_production_calendar_exceptions_date", "production_calendar_exceptions", ["exception_date"])

    # 0006_jobs_standalone_job_sheet + 0007_job_sheet_qty_rolls
    if is_sqlite:
        with op.batch_alter_table("jobs", recreate="always") as batch:
            batch.drop_constraint("uq_job_order_jobcode", type_="unique")
            batch.alter_column("order_id", existing_type=sa.String(36), nullable=True)
            batch.add_column(sa.Column("job_sheet_id", sa.String(36), nullable=True))
            batch.create_foreign_key(
                "fk_jobs_job_sheet_id",
                "job_sheets",
                ["job_sheet_id"],
                ["id"],
                ondelete="RESTRICT",
            )
        op.create_index("ix_jobs_job_sheet_id", "jobs", ["job_sheet_id"], unique=False)
    else:
        op.drop_constraint("uq_job_order_jobcode", "jobs", type_="unique")
        op.alter_column("jobs", "order_id", existing_type=sa.String(36), nullable=True)
        op.add_column("jobs", sa.Column("job_sheet_id", sa.String(36), nullable=True))
        op.create_foreign_key("fk_jobs_job_sheet_id", "jobs", "job_sheets", ["job_sheet_id"], ["id"], ondelete="RESTRICT")
        op.create_index("ix_jobs_job_sheet_id", "jobs", ["job_sheet_id"], unique=False)
    op.execute(
        sa.text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_standalone_sheet ON jobs (job_sheet_id) "
            "WHERE job_sheet_id IS NOT NULL"
        )
    )
    op.execute(
        sa.text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_order_jobcode_partial ON jobs (order_id, job_code) "
            "WHERE order_id IS NOT NULL"
        )
    )
    if is_pg:
        op.execute(
            sa.text(
                "ALTER TABLE jobs ADD CONSTRAINT ck_jobs_order_xor_sheet CHECK ("
                "(order_id IS NOT NULL AND job_sheet_id IS NULL) OR "
                "(order_id IS NULL AND job_sheet_id IS NOT NULL)"
                ")"
            )
        )
    op.add_column("job_sheets", sa.Column("qty_type", sa.String(16), nullable=False, server_default="kg"))
    op.add_column("job_sheets", sa.Column("num_product_units", sa.Numeric(18, 6), nullable=True))
    op.add_column("job_sheets", sa.Column("weight_per_roll_kg", sa.Numeric(18, 6), nullable=True))
    op.add_column("job_sheets", sa.Column("num_rolls", sa.Integer(), nullable=False, server_default="1"))

    # 0008_extrusion_tool_types
    for code, name, icon in [
        ("inline_perforator", "Inline perforator", "icon_perforator"),
        ("inline_hole_punch", "Inline hole punch", "icon_hole_punch"),
    ]:
        conn.execute(
            sa.text(
                """
                INSERT INTO tool_types (id, code, name, icon_ref, unique_per_machine)
                VALUES (:id, :code, :name, :icon, FALSE)
                ON CONFLICT (code) DO NOTHING
                """
            ),
            {"id": str(uuid.uuid4()), "code": code, "name": name, "icon": icon},
        )

    # 0009_queue_operating_hours_lead (needed before queue split migration query)
    op.add_column(
        "machine_queue_items",
        sa.Column(
            "operating_hours_lead_before",
            sa.Numeric(14, 4),
            server_default="0",
            nullable=False,
        ),
    )

    # 0010_schedule_queues_split (squashed)
    queue_status = sa.Enum("queued", "running", "completed", "removed", name="queue_status", native_enum=False)

    op.create_table(
        "uteco_printers",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("code", sa.String(32), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("capability", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("1" if is_sqlite else "true")),
    )
    op.create_index("ix_uteco_printers_code", "uteco_printers", ["code"], unique=True)
    op.create_table(
        "bagging_machines",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("code", sa.String(32), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("capability", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("1" if is_sqlite else "true")),
    )
    op.create_index("ix_bagging_machines_code", "bagging_machines", ["code"], unique=True)

    op.create_table(
        "extrusion_queue_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("extruder_code", sa.String(16), sa.ForeignKey("extruders.extruder_code", ondelete="RESTRICT"), nullable=False),
        sa.Column("job_id", sa.String(36), sa.ForeignKey("jobs.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("status", queue_status, nullable=False),
        sa.Column("operating_hours_lead_before", sa.Numeric(14, 4), nullable=False, server_default="0"),
        sa.Column("scheduled_start_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("extruder_code", "position", name="uq_extrusion_queue_lane_position"),
    )
    op.create_index("ix_extrusion_queue_extruder", "extrusion_queue_items", ["extruder_code"])
    op.create_index("ix_extrusion_queue_job", "extrusion_queue_items", ["job_id"])

    op.create_table(
        "uteco_queue_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("uteco_printer_id", sa.String(36), sa.ForeignKey("uteco_printers.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("job_id", sa.String(36), sa.ForeignKey("jobs.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("status", queue_status, nullable=False),
        sa.Column("operating_hours_lead_before", sa.Numeric(14, 4), nullable=False, server_default="0"),
        sa.Column("scheduled_start_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("uteco_printer_id", "position", name="uq_uteco_queue_lane_position"),
    )
    op.create_index("ix_uteco_queue_printer", "uteco_queue_items", ["uteco_printer_id"])
    op.create_index("ix_uteco_queue_job", "uteco_queue_items", ["job_id"])

    op.create_table(
        "bagging_queue_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("bagging_machine_id", sa.String(36), sa.ForeignKey("bagging_machines.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("job_id", sa.String(36), sa.ForeignKey("jobs.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("status", queue_status, nullable=False),
        sa.Column("operating_hours_lead_before", sa.Numeric(14, 4), nullable=False, server_default="0"),
        sa.Column("scheduled_start_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("bagging_machine_id", "position", name="uq_bagging_queue_lane_position"),
    )
    op.create_index("ix_bagging_queue_machine", "bagging_queue_items", ["bagging_machine_id"])
    op.create_index("ix_bagging_queue_job", "bagging_queue_items", ["job_id"])

    rows = conn.execute(sa.text("SELECT id, code, type, capability, active FROM machines ORDER BY code")).fetchall()
    machine_old_to_uteco: dict[str, str] = {}
    machine_old_to_bagger: dict[str, str] = {}
    for mid, code, mtype, cap, active in rows:
        t = str(mtype)
        cap_json = cap if isinstance(cap, (dict, list)) else (json.loads(cap) if cap else {})
        if t == "printer_uteco":
            new_id = str(uuid.uuid4())
            machine_old_to_uteco[str(mid)] = new_id
            conn.execute(
                sa.text("INSERT INTO uteco_printers (id, code, name, capability, active) VALUES (:id, :code, :name, :cap, :active)"),
                {"id": new_id, "code": code, "name": code, "cap": json.dumps(cap_json), "active": bool(active)},
            )
        elif t == "converter_bagger":
            new_id = str(uuid.uuid4())
            machine_old_to_bagger[str(mid)] = new_id
            conn.execute(
                sa.text("INSERT INTO bagging_machines (id, code, name, capability, active) VALUES (:id, :code, :name, :cap, :active)"),
                {"id": new_id, "code": code, "name": code, "cap": json.dumps(cap_json), "active": bool(active)},
            )

    qrows = conn.execute(
        sa.text(
            """
            SELECT mqi.id, mqi.machine_id, mqi.job_id, mqi.position, mqi.status, mqi.operating_hours_lead_before, mqi.created_at, mqi.updated_at, m.code, m.type
            FROM machine_queue_items mqi
            JOIN machines m ON m.id = mqi.machine_id
            """
        )
    ).fetchall()
    for qid, machine_id, job_id, position, status, lead, created_at, updated_at, mcode, mtype in qrows:
        t = str(mtype)
        st = str(status) if hasattr(status, "value") else str(status)
        lead_v = float(lead or 0)
        if t == "extruder":
            conn.execute(
                sa.text(
                    """
                    INSERT INTO extrusion_queue_items (id, extruder_code, job_id, position, status, operating_hours_lead_before, created_at, updated_at)
                    VALUES (:id, :ec, :jid, :pos, :st, :lead, :ca, :ua)
                    """
                ),
                {"id": qid, "ec": mcode, "jid": job_id, "pos": position, "st": st, "lead": lead_v, "ca": created_at, "ua": updated_at},
            )
        elif t == "printer_uteco":
            new_pid = machine_old_to_uteco.get(str(machine_id))
            if new_pid:
                conn.execute(
                    sa.text(
                        """
                        INSERT INTO uteco_queue_items (id, uteco_printer_id, job_id, position, status, operating_hours_lead_before, created_at, updated_at)
                        VALUES (:id, :pid, :jid, :pos, :st, :lead, :ca, :ua)
                        """
                    ),
                    {"id": qid, "pid": new_pid, "jid": job_id, "pos": position, "st": st, "lead": lead_v, "ca": created_at, "ua": updated_at},
                )
        elif t == "converter_bagger":
            new_bid = machine_old_to_bagger.get(str(machine_id))
            if new_bid:
                conn.execute(
                    sa.text(
                        """
                        INSERT INTO bagging_queue_items (id, bagging_machine_id, job_id, position, status, operating_hours_lead_before, created_at, updated_at)
                        VALUES (:id, :bid, :jid, :pos, :st, :lead, :ca, :ua)
                        """
                    ),
                    {"id": qid, "bid": new_bid, "jid": job_id, "pos": position, "st": st, "lead": lead_v, "ca": created_at, "ua": updated_at},
                )

    op.execute(sa.text("DROP INDEX IF EXISTS uq_running_run_per_machine"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_operation_runs_machine"))
    with op.batch_alter_table("operation_runs") as batch:
        batch.add_column(sa.Column("extruder_code", sa.String(16), nullable=True))
        batch.add_column(sa.Column("uteco_printer_id", sa.String(36), nullable=True))
        batch.add_column(sa.Column("bagging_machine_id", sa.String(36), nullable=True))
    conn.execute(
        sa.text(
            """
            UPDATE operation_runs
            SET extruder_code = (SELECT code FROM machines WHERE machines.id = operation_runs.machine_id AND machines.type = 'extruder')
            WHERE EXISTS (SELECT 1 FROM machines WHERE machines.id = operation_runs.machine_id AND machines.type = 'extruder')
            """
        )
    )
    for old_mid, new_uid in machine_old_to_uteco.items():
        conn.execute(sa.text("UPDATE operation_runs SET uteco_printer_id = :np WHERE machine_id = :mid"), {"np": new_uid, "mid": old_mid})
    for old_mid, new_bid in machine_old_to_bagger.items():
        conn.execute(sa.text("UPDATE operation_runs SET bagging_machine_id = :nb WHERE machine_id = :mid"), {"nb": new_bid, "mid": old_mid})
    fk_m = _fk_name_to_machines("operation_runs")
    with op.batch_alter_table("operation_runs") as batch:
        if fk_m:
            batch.drop_constraint(fk_m, type_="foreignkey")
        batch.drop_column("machine_id")
        batch.create_foreign_key("fk_operation_runs_extruder_code", "extruders", ["extruder_code"], ["extruder_code"])
        batch.create_foreign_key("fk_operation_runs_uteco_printer", "uteco_printers", ["uteco_printer_id"], ["id"])
        batch.create_foreign_key("fk_operation_runs_bagging_machine", "bagging_machines", ["bagging_machine_id"], ["id"])
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_running_run_extruder ON operation_runs(extruder_code) "
        "WHERE status = 'running' AND extruder_code IS NOT NULL"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_running_run_uteco ON operation_runs(uteco_printer_id) "
        "WHERE status = 'running' AND uteco_printer_id IS NOT NULL"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_running_run_bagging ON operation_runs(bagging_machine_id) "
        "WHERE status = 'running' AND bagging_machine_id IS NOT NULL"
    )

    op.execute(sa.text("DROP INDEX IF EXISTS ix_tool_reservations_machine"))
    with op.batch_alter_table("tool_reservations") as batch:
        batch.add_column(sa.Column("extruder_code", sa.String(16), nullable=True))
        batch.add_column(sa.Column("uteco_printer_id", sa.String(36), nullable=True))
        batch.add_column(sa.Column("bagging_machine_id", sa.String(36), nullable=True))
    conn.execute(
        sa.text(
            """
            UPDATE tool_reservations
            SET extruder_code = (SELECT code FROM machines WHERE machines.id = tool_reservations.machine_id AND machines.type = 'extruder')
            WHERE EXISTS (SELECT 1 FROM machines WHERE machines.id = tool_reservations.machine_id AND machines.type = 'extruder')
            """
        )
    )
    for old_mid, new_uid in machine_old_to_uteco.items():
        conn.execute(sa.text("UPDATE tool_reservations SET uteco_printer_id = :np WHERE machine_id = :mid"), {"np": new_uid, "mid": old_mid})
    for old_mid, new_bid in machine_old_to_bagger.items():
        conn.execute(sa.text("UPDATE tool_reservations SET bagging_machine_id = :nb WHERE machine_id = :mid"), {"nb": new_bid, "mid": old_mid})
    fk_tr = _fk_name_to_machines("tool_reservations")
    with op.batch_alter_table("tool_reservations") as batch:
        if fk_tr:
            batch.drop_constraint(fk_tr, type_="foreignkey")
        batch.drop_column("machine_id")
        batch.create_foreign_key("fk_tool_res_extruder_code", "extruders", ["extruder_code"], ["extruder_code"])
        batch.create_foreign_key("fk_tool_res_uteco_printer", "uteco_printers", ["uteco_printer_id"], ["id"])
        batch.create_foreign_key("fk_tool_res_bagging_machine", "bagging_machines", ["bagging_machine_id"], ["id"])

    op.execute(sa.text("DROP INDEX IF EXISTS ix_tool_mounts_machine"))
    with op.batch_alter_table("tool_mounts") as batch:
        batch.add_column(sa.Column("extruder_code", sa.String(16), nullable=True))
    conn.execute(
        sa.text(
            """
            UPDATE tool_mounts
            SET extruder_code = (SELECT code FROM machines WHERE machines.id = tool_mounts.machine_id AND machines.type = 'extruder')
            WHERE EXISTS (SELECT 1 FROM machines WHERE machines.id = tool_mounts.machine_id AND machines.type = 'extruder')
            """
        )
    )
    fk_tm = _fk_name_to_machines("tool_mounts")
    with op.batch_alter_table("tool_mounts") as batch:
        if fk_tm:
            batch.drop_constraint(fk_tm, type_="foreignkey")
        batch.drop_column("machine_id")
        batch.create_foreign_key("fk_tool_mounts_extruder_code", "extruders", ["extruder_code"], ["extruder_code"])

    op.execute(
        sa.text(
            """
            DELETE FROM telemetry_events WHERE machine_id IN (
                SELECT id FROM machines WHERE type IN ('extruder', 'printer_uteco', 'converter_bagger')
            )
            """
        )
    )
    op.execute(
        sa.text(
            """
            DELETE FROM sensor_assignments WHERE machine_id IN (
                SELECT id FROM machines WHERE type IN ('extruder', 'printer_uteco', 'converter_bagger')
            )
            """
        )
    )
    op.execute(
        sa.text(
            """
            DELETE FROM sensors WHERE machine_id IN (
                SELECT id FROM machines WHERE type IN ('extruder', 'printer_uteco', 'converter_bagger')
            )
            """
        )
    )
    op.execute(sa.text("DELETE FROM machine_queue_items"))
    op.execute(sa.text("DELETE FROM machines WHERE type IN ('extruder', 'printer_uteco', 'converter_bagger')"))
    op.drop_table("machine_queue_items")

    # 0013_job_schedule_chain_offsets
    op.add_column("jobs", sa.Column("schedule_chain_uteco_offset_operating_hours", sa.Numeric(18, 6), nullable=True))
    op.add_column("jobs", sa.Column("schedule_chain_bagging_offset_operating_hours", sa.Numeric(18, 6), nullable=True))


def upgrade() -> None:
    conn = op.get_bind()
    is_pg = conn.dialect.name == "postgresql"
    is_sqlite = conn.dialect.name == "sqlite"

    # Views
    if is_pg:
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
        # SQLite: no OR REPLACE for views
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

    # Seed roles (non-sensitive)
    for code in ["SALES", "OPERATOR", "PROD_MANAGER", "SYS_ADMIN"]:
        if is_sqlite:
            conn.execute(sa.text("INSERT OR IGNORE INTO roles (code) VALUES (:c)"), {"c": code})
        else:
            conn.execute(
                sa.text("INSERT INTO roles (code) VALUES (:c) ON CONFLICT (code) DO NOTHING"),
                {"c": code},
            )

    # Seed machines and tool types (non-sensitive)
    extruder_cap = {
        "supports_inline_1c_print": True,
        "supports_inline_perforation": True,
        "width_range_mm": [100, 2000],
        "gauge_range_um": [25, 200],
    }
    for i in range(1, 9):
        code = f"EX{str(i).zfill(2)}"
        if is_pg:
            conn.execute(
                sa.text(
                    """
                    INSERT INTO machines (id, code, type, capability, active)
                    VALUES (:id, :code, 'extruder', CAST(:cap AS JSON), TRUE)
                    ON CONFLICT (code) DO NOTHING
                    """
                ),
                {"id": str(uuid.uuid4()), "code": code, "cap": json.dumps(extruder_cap)},
            )
        else:
            conn.execute(
                sa.text(
                    """
                    INSERT INTO machines (id, code, type, capability, active)
                    VALUES (:id, :code, 'extruder', :cap, 1)
                    """
                ),
                {"id": str(uuid.uuid4()), "code": code, "cap": json.dumps(extruder_cap)},
            )

    u_cap = {"max_colours_per_side": 6, "duplex_supported": True, "max_web_width_mm": 1600}
    if is_pg:
        conn.execute(
            sa.text(
                """
                INSERT INTO machines (id, code, type, capability, active)
                VALUES (:id, 'UTECO01', 'printer_uteco', CAST(:cap AS JSON), TRUE)
                ON CONFLICT (code) DO NOTHING
                """
            ),
            {"id": str(uuid.uuid4()), "cap": json.dumps(u_cap)},
        )
    else:
        conn.execute(
            sa.text(
                """
                INSERT INTO machines (id, code, type, capability, active)
                VALUES (:id, 'UTECO01', 'printer_uteco', :cap, 1)
                """
            ),
            {"id": str(uuid.uuid4()), "cap": json.dumps(u_cap)},
        )

    b_cap = {"supported_finish_modes": ["Cartons"], "min_max_width_mm": [150, 800]}
    for i in range(1, 4):
        code = f"BGR{str(i).zfill(2)}"
        if is_pg:
            conn.execute(
                sa.text(
                    """
                    INSERT INTO machines (id, code, type, capability, active)
                    VALUES (:id, :code, 'converter_bagger', CAST(:cap AS JSON), TRUE)
                    ON CONFLICT (code) DO NOTHING
                    """
                ),
                {"id": str(uuid.uuid4()), "code": code, "cap": json.dumps(b_cap)},
            )
        else:
            conn.execute(
                sa.text(
                    """
                    INSERT INTO machines (id, code, type, capability, active)
                    VALUES (:id, :code, 'converter_bagger', :cap, 1)
                    """
                ),
                {"id": str(uuid.uuid4()), "code": code, "cap": json.dumps(b_cap)},
            )

    tool_types = [
        ("inline_printer_1c", "Inline Printer 1C", "icon_inline_printer"),
        ("electra_punch", "Electra Punch", "icon_punch"),
    ]
    for code, name, icon in tool_types:
        conn.execute(
            sa.text(
                """
                INSERT INTO tool_types (id, code, name, icon_ref, unique_per_machine)
                VALUES (:id, :code, :name, :icon, FALSE)
                ON CONFLICT (code) DO NOTHING
                """
            ),
            {"id": str(uuid.uuid4()), "code": code, "name": name, "icon": icon},
        )

    # --- Seed rate-card master data (resins/additives/colours/cores) ---
    # This is the SQL equivalent of:
    # - scripts/seed_resins_from_tsv.py (embedded DEFAULT_TSV)
    # - scripts/seed_additives.py
    # - scripts/seed_colours.py
    # - scripts/seed_cores.py
    #
    # NOTE: resin_blends schema is created in the initial migration; seeds live here.

    resins_seed = [
        # resin_code, name, density, price_per_kg
        ("Q1018H", "Linear", 0.001848, 1.98),
        ("FD0270", "Sanofi", 0.001848, 2.26),
        ("FD0274", "Light G", 0.001848, 2.29),
        ("FE8004", "Med G", 0.001848, 2.28),
        ("FE3000", "Heavy G", 0.001848, 2.28),
        ("S199F", "H/D", 0.001924, 2.06),
        ("1018RA", "Metallizine", 0.001848, 2.21),
    ]
    for resin_code, name, density, price_per_kg in resins_seed:
        conn.execute(
            sa.text(
                """
                INSERT INTO resins (resin_code, name, density, price_per_kg)
                VALUES (:resin_code, :name, :density, :price_per_kg)
                ON CONFLICT (resin_code) DO UPDATE SET
                  name = excluded.name,
                  density = excluded.density,
                  price_per_kg = excluded.price_per_kg
                """
            ),
            {
                "resin_code": resin_code,
                "name": name,
                "density": density,
                "price_per_kg": price_per_kg,
            },
        )

    # --- Inks master data ---
    for row in INKS_DB:
        code = (row.get("ink_code") or "").strip()
        name = (row.get("name") or "").strip()
        ptype = (row.get("printer_type") or "inline").strip()
        if not code or not name:
            continue
        conn.execute(
            sa.text(
                """
                INSERT INTO inks (ink_code, name, printer_type)
                VALUES (:ink_code, :name, :printer_type)
                ON CONFLICT (ink_code) DO UPDATE SET
                  name = excluded.name,
                  printer_type = excluded.printer_type
                """
            ),
            {"ink_code": code, "name": name, "printer_type": ptype},
        )

    # Resin blend presets (SQL equivalent of scripts/seed_resin_blends.py)
    blends_seed = [
        ("LD",  "House Blend (LD)"),
        ("MD", "MD"),
    ]
    for blend_code, name in blends_seed:
        conn.execute(
            sa.text(
                """
                INSERT INTO resin_blends (blend_code, name)
                VALUES (:blend_code, :name)
                ON CONFLICT (blend_code) DO UPDATE SET
                  name = excluded.name
                """
            ),
            {"blend_code": blend_code, "name": name},
        )

    # Replace components for these blends to match the presets.
    conn.execute(sa.text("DELETE FROM resin_blend_components WHERE blend_code IN ('LD','MD')"))
    comps_seed = [
        ("LD", "FD0270", 50.0),
        ("LD", "S199F", 50.0),
        ("MD", "FD0270", 30.0),
        ("MD", "FE3000", 40.0),
        ("MD", "S199F", 30.0),
    ]
    for blend_code, resin_code, pct in comps_seed:
        conn.execute(
            sa.text(
                """
                INSERT INTO resin_blend_components (blend_code, resin_code, pct)
                VALUES (:blend_code, :resin_code, :pct)
                ON CONFLICT (blend_code, resin_code) DO UPDATE SET
                  pct = excluded.pct
                """
            ),
            {"blend_code": blend_code, "resin_code": resin_code, "pct": pct},
        )

    additives_seed = [
        # additive_code, name, price_per_kg, notes
        ("ANTI_BLOCK", "Anti Block", 3.5, None),
        ("ANTI_STATIC", "Anti Static", 7.7, None),
        ("SLIP", "Slip", 6.4, None),
        ("UV", "UV", 13.4, None),
    ]
    for additive_code, name, price_per_kg, notes in additives_seed:
        conn.execute(
            sa.text(
                """
                INSERT INTO additives (additive_code, name, price_per_kg, notes)
                VALUES (:additive_code, :name, :price_per_kg, :notes)
                ON CONFLICT (additive_code) DO UPDATE SET
                  name = excluded.name,
                  price_per_kg = excluded.price_per_kg,
                  notes = excluded.notes
                """
            ),
            {
                "additive_code": additive_code,
                "name": name,
                "price_per_kg": price_per_kg,
                "notes": notes,
            },
        )

    # Order here defines display order (sort_order) in app and dropdowns.
    # short_code: 3-char code used in product code (e.g. PBR-200-400-40-BLK-2P).
    colours_seed = [
        # colour_code, name, price_per_kg, sort_order, short_code
        ("WHITE", "White", 5.8, 1, "WHT"),
        ("BLACK", "Black", 4.5, 2, "BLK"),
        ("SILVER", "Silver", 19.88, 3, "SLV"),
        ("GREY", "Grey", 14.5, 4, "GRY"),
        ("BLUE", "Blue", 5.7, 5, "BLU"),
        ("PIPE_COVER_BLUE", "Pipe Cover Blue", 16.0, 6, "PCB"),
        ("PIPECOVER_PURPLE", "PipeCover Purple", 16.86, 7, "PRP"),
        ("PIPECOVER_BEIGE", "PipeCover Beige", 14.1, 8, "BGE"),
        ("YELLOW", "Yellow", 20.33, 9, "YEL"),
        ("SIGNET_YELLOW", "Signet Yellow", 17.33, 10, "SYL"),
        ("GREEN", "Green", 14.69, 11, "GRN"),
        ("ORANGE", "Orange", 19.55, 12, "ORG"),
        ("RED", "Red", 19.02, 13, "RED"),
        ("PURPLE", "Purple", 17.23, 14, "PPL"),
        ("BROWN", "Brown", 19.42, 15, "BRN"),
        ("PINK", "Pink", 32.29, 16, "PNK"),
        ("OTHER", "Other", 25.0, 17, "OTH"),
    ]
    for colour_code, name, price_per_kg, sort_order, short_code in colours_seed:
        conn.execute(
            sa.text(
                """
                INSERT INTO colours (colour_code, name, price_per_kg, sort_order, short_code)
                VALUES (:colour_code, :name, :price_per_kg, :sort_order, :short_code)
                ON CONFLICT (colour_code) DO UPDATE SET
                  name = excluded.name,
                  price_per_kg = excluded.price_per_kg,
                  sort_order = excluded.sort_order,
                  short_code = excluded.short_code
                """
            ),
            {
                "colour_code": colour_code,
                "name": name,
                "price_per_kg": price_per_kg,
                "sort_order": sort_order,
                "short_code": short_code,
            },
        )

    cores_seed = [
        # core_type, description, cost_per_meter, kg_per_meter
        ("13mm", "13mm core", 4.65040650406504, 2.92682926829268),
        ("7mm", "7mm core", 2.15454545454545, 1.44545454545455),
        ("PVC", "PVC core", 3.62251655629139, 0.728476821192053),
    ]
    for core_type, description, cost_per_meter, kg_per_meter in cores_seed:
        conn.execute(
            sa.text(
                """
                INSERT INTO cores (core_type, description, cost_per_meter, kg_per_meter)
                VALUES (:core_type, :description, :cost_per_meter, :kg_per_meter)
                ON CONFLICT (core_type) DO UPDATE SET
                  description = excluded.description,
                  cost_per_meter = excluded.cost_per_meter,
                  kg_per_meter = excluded.kg_per_meter
                """
            ),
            {
                "core_type": core_type,
                "description": description,
                "cost_per_meter": cost_per_meter,
                "kg_per_meter": kg_per_meter,
            },
        )

    _apply_squashed_post_0003_changes(conn, is_pg, is_sqlite)


def downgrade() -> None:
    conn = op.get_bind()
    is_sqlite = conn.dialect.name == "sqlite"

    # Drop views
    op.execute("DROP VIEW IF EXISTS v_wip_stage_balances")
    op.execute("DROP VIEW IF EXISTS v_inventory_balances_by_category")

    # Remove seeded rate-card master data (best-effort)
    conn.execute(sa.text("DELETE FROM cores WHERE core_type IN ('13mm','7mm','PVC')"))
    conn.execute(
        sa.text(
            "DELETE FROM colours WHERE colour_code IN ("
            "'WHITE','BLACK','SILVER','GREY','BLUE','PIPE_COVER_BLUE','PIPECOVER_PURPLE','PIPECOVER_BEIGE',"
            "'YELLOW','SIGNET_YELLOW','GREEN','ORANGE','RED','PURPLE','BROWN','PINK','OTHER'"
            ")"
        )
    )
    conn.execute(sa.text("DELETE FROM additives WHERE additive_code IN ('ANTI_BLOCK','ANTI_STATIC','SLIP','UV')"))
    conn.execute(
        sa.text(
            "DELETE FROM resins WHERE resin_code IN ('Q1018H','FD0270','FD0274','FE8004','FE3000','S199F','1018RA')"
        )
    )
    conn.execute(sa.text("DELETE FROM resin_blend_components WHERE blend_code IN ('LD','MD')"))
    conn.execute(sa.text("DELETE FROM resin_blends WHERE blend_code IN ('LD','MD')"))

    # Seeded tool types
    conn.execute(sa.text("DELETE FROM tool_types WHERE code IN ('inline_printer_1c','electra_punch')"))

    # Seeded machines
    codes = [f"EX{str(i).zfill(2)}" for i in range(1, 9)] + ["UTECO01"] + [
        f"BGR{str(i).zfill(2)}" for i in range(1, 4)
    ]
    if conn.dialect.name == "postgresql":
        conn.execute(sa.text("DELETE FROM machines WHERE code = ANY(:codes)"), {"codes": codes})
    else:
        placeholders = ",".join([f":c{i}" for i in range(len(codes))])
        params = {f"c{i}": code for i, code in enumerate(codes)}
        conn.execute(sa.text(f"DELETE FROM machines WHERE code IN ({placeholders})"), params)

    # Roles
    if is_sqlite:
        conn.execute(
            sa.text("DELETE FROM roles WHERE code IN ('SALES','OPERATOR','PROD_MANAGER','SYS_ADMIN')")
        )
    else:
        conn.execute(
            sa.text("DELETE FROM roles WHERE code IN ('SALES','OPERATOR','PROD_MANAGER','SYS_ADMIN')")
        )

