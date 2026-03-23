"""
Split scheduling off generic `machines`: extrusion queues reference `extruders` (rate cards);
Uteco and bagging use dedicated tables. Migrates `machine_queue_items` and updates FKs on runs/tools.
"""

from __future__ import annotations

import json
import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0010_schedule_queues_split"
down_revision = "0009_queue_lead"
branch_labels = None
depends_on = None

QUEUE_STATUS = sa.Enum("queued", "running", "completed", "removed", name="queue_status", native_enum=False)


def _fk_name_to_machines(table: str) -> str | None:
	conn = op.get_bind()
	for fk in inspect(conn).get_foreign_keys(table):
		if fk.get("referred_table") == "machines" and fk.get("constrained_columns") == ["machine_id"]:
			return fk.get("name")
	return None


def upgrade() -> None:
	conn = op.get_bind()
	is_sqlite = conn.dialect.name == "sqlite"
	is_pg = conn.dialect.name == "postgresql"

	# --- New catalog tables (Uteco / bagging) ---
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

	# --- Queue tables (same queue_status enum as legacy machine_queue_items) ---
	op.create_table(
		"extrusion_queue_items",
		sa.Column("id", sa.String(36), primary_key=True),
		sa.Column("extruder_code", sa.String(16), sa.ForeignKey("extruders.extruder_code", ondelete="RESTRICT"), nullable=False),
		sa.Column("job_id", sa.String(36), sa.ForeignKey("jobs.id", ondelete="RESTRICT"), nullable=False),
		sa.Column("position", sa.Integer(), nullable=False),
		sa.Column("status", QUEUE_STATUS, nullable=False),
		sa.Column("operating_hours_lead_before", sa.Numeric(14, 4), nullable=False, server_default="0"),
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
		sa.Column("status", QUEUE_STATUS, nullable=False),
		sa.Column("operating_hours_lead_before", sa.Numeric(14, 4), nullable=False, server_default="0"),
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
		sa.Column("status", QUEUE_STATUS, nullable=False),
		sa.Column("operating_hours_lead_before", sa.Numeric(14, 4), nullable=False, server_default="0"),
		sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
		sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
		sa.UniqueConstraint("bagging_machine_id", "position", name="uq_bagging_queue_lane_position"),
	)
	op.create_index("ix_bagging_queue_machine", "bagging_queue_items", ["bagging_machine_id"])
	op.create_index("ix_bagging_queue_job", "bagging_queue_items", ["job_id"])

	# --- Data: seed uteco_printers / bagging_machines from `machines`, migrate queue rows ---
	rows = conn.execute(
		sa.text("SELECT id, code, type, capability, active FROM machines ORDER BY code")
	).fetchall()
	machine_old_to_uteco: dict[str, str] = {}
	machine_old_to_bagger: dict[str, str] = {}

	for mid, code, mtype, cap, active in rows:
		t = str(mtype)
		cap_json = cap if isinstance(cap, (dict, list)) else (json.loads(cap) if cap else {})
		if t == "printer_uteco":
			new_id = str(uuid.uuid4())
			machine_old_to_uteco[str(mid)] = new_id
			conn.execute(
				sa.text(
					"INSERT INTO uteco_printers (id, code, name, capability, active) VALUES (:id, :code, :name, :cap, :active)"
				),
				{"id": new_id, "code": code, "name": code, "cap": json.dumps(cap_json), "active": bool(active)},
			)
		elif t == "converter_bagger":
			new_id = str(uuid.uuid4())
			machine_old_to_bagger[str(mid)] = new_id
			conn.execute(
				sa.text(
					"INSERT INTO bagging_machines (id, code, name, capability, active) VALUES (:id, :code, :name, :cap, :active)"
				),
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
				{
					"id": qid,
					"ec": mcode,
					"jid": job_id,
					"pos": position,
					"st": st,
					"lead": lead_v,
					"ca": created_at,
					"ua": updated_at,
				},
			)
		elif t == "printer_uteco":
			new_pid = machine_old_to_uteco.get(str(machine_id))
			if not new_pid:
				continue
			conn.execute(
				sa.text(
					"""
					INSERT INTO uteco_queue_items (id, uteco_printer_id, job_id, position, status, operating_hours_lead_before, created_at, updated_at)
					VALUES (:id, :pid, :jid, :pos, :st, :lead, :ca, :ua)
					"""
				),
				{
					"id": qid,
					"pid": new_pid,
					"jid": job_id,
					"pos": position,
					"st": st,
					"lead": lead_v,
					"ca": created_at,
					"ua": updated_at,
				},
			)
		elif t == "converter_bagger":
			new_bid = machine_old_to_bagger.get(str(machine_id))
			if not new_bid:
				continue
			conn.execute(
				sa.text(
					"""
					INSERT INTO bagging_queue_items (id, bagging_machine_id, job_id, position, status, operating_hours_lead_before, created_at, updated_at)
					VALUES (:id, :bid, :jid, :pos, :st, :lead, :ca, :ua)
					"""
				),
				{
					"id": qid,
					"bid": new_bid,
					"jid": job_id,
					"pos": position,
					"st": st,
					"lead": lead_v,
					"ca": created_at,
					"ua": updated_at,
				},
			)

	# --- operation_runs: drop indexes on machine_id, then replace machine_id ---
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
		conn.execute(
			sa.text("UPDATE operation_runs SET uteco_printer_id = :np WHERE machine_id = :mid"),
			{"np": new_uid, "mid": old_mid},
		)
	for old_mid, new_bid in machine_old_to_bagger.items():
		conn.execute(
			sa.text("UPDATE operation_runs SET bagging_machine_id = :nb WHERE machine_id = :mid"),
			{"nb": new_bid, "mid": old_mid},
		)

	fk_m = _fk_name_to_machines("operation_runs")
	# Single batch: drop machine FK/column and add new FKs (SQLite rebuild must not resurrect ix_operation_runs_machine).
	with op.batch_alter_table("operation_runs") as batch:
		if fk_m:
			batch.drop_constraint(fk_m, type_="foreignkey")
		batch.drop_column("machine_id")
		batch.create_foreign_key("fk_operation_runs_extruder_code", "extruders", ["extruder_code"], ["extruder_code"])
		batch.create_foreign_key("fk_operation_runs_uteco_printer", "uteco_printers", ["uteco_printer_id"], ["id"])
		batch.create_foreign_key("fk_operation_runs_bagging_machine", "bagging_machines", ["bagging_machine_id"], ["id"])

	# One running run per lane (same semantics as old uq_running_run_per_machine on machine_id)
	if is_pg:
		op.create_index(
			"uq_running_run_extruder",
			"operation_runs",
			["extruder_code"],
			unique=True,
			postgresql_where=sa.text("status = 'running' AND extruder_code IS NOT NULL"),
		)
		op.create_index(
			"uq_running_run_uteco",
			"operation_runs",
			["uteco_printer_id"],
			unique=True,
			postgresql_where=sa.text("status = 'running' AND uteco_printer_id IS NOT NULL"),
		)
		op.create_index(
			"uq_running_run_bagging",
			"operation_runs",
			["bagging_machine_id"],
			unique=True,
			postgresql_where=sa.text("status = 'running' AND bagging_machine_id IS NOT NULL"),
		)
	else:
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

	# --- tool_reservations: extruder / Uteco / bagging columns ---
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
		conn.execute(
			sa.text("UPDATE tool_reservations SET uteco_printer_id = :np WHERE machine_id = :mid"),
			{"np": new_uid, "mid": old_mid},
		)
	for old_mid, new_bid in machine_old_to_bagger.items():
		conn.execute(
			sa.text("UPDATE tool_reservations SET bagging_machine_id = :nb WHERE machine_id = :mid"),
			{"nb": new_bid, "mid": old_mid},
		)

	fk_tr = _fk_name_to_machines("tool_reservations")
	with op.batch_alter_table("tool_reservations") as batch:
		if fk_tr:
			batch.drop_constraint(fk_tr, type_="foreignkey")
		batch.drop_column("machine_id")
		batch.create_foreign_key("fk_tool_res_extruder_code", "extruders", ["extruder_code"], ["extruder_code"])
		batch.create_foreign_key("fk_tool_res_uteco_printer", "uteco_printers", ["uteco_printer_id"], ["id"])
		batch.create_foreign_key("fk_tool_res_bagging_machine", "bagging_machines", ["bagging_machine_id"], ["id"])

	# --- tool_mounts: physical mount on extruder (rate card) ---
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

	# --- Telemetry / sensors reference machines we are about to delete ---
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

	# --- Drop old queue + scheduling machine rows ---
	op.execute(sa.text("DELETE FROM machine_queue_items"))
	op.execute(sa.text("DELETE FROM machines WHERE type IN ('extruder', 'printer_uteco', 'converter_bagger')"))

	op.drop_table("machine_queue_items")


def downgrade() -> None:
	raise NotImplementedError("0010_schedule_queues_split downgrade not supported")
