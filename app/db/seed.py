from __future__ import annotations

"""
Database seed script for MVP initial data.
This populates the database with essential initial data:
- System roles
- Test users (for development/testing)
- Machine catalog
Safe to run multiple times (idempotent).
"""

import json
import uuid
from typing import Iterable

from sqlalchemy import Engine, text
from app.db.models import Base
from app.auth.models import User, Role, UserRole, UserSession  # ensure models are imported
from app.db.models.domain import Machine  # ensure machines table is included
from app.auth.security import hash_password, verify_password


def seed_database(engine: Engine) -> None:
	"""Seed initial data into the database.

	Args:
		engine: SQLAlchemy engine instance
	"""
	with engine.begin() as conn:
		try:
			# Ensure tables exist (auto-create for dev)
			Base.metadata.create_all(engine)

			_seed_roles(conn)
			_seed_users(conn)
			_seed_machines(conn)
		except Exception as exc:
			raise RuntimeError(f"Seeding failed: {exc}") from exc


def _seed_roles(conn) -> None:
	"""Seed system roles."""
	roles: Iterable[str] = ["SALES", "OPERATOR", "PROD_MANAGER", "SYS_ADMIN"]
	is_sqlite = conn.dialect.name == "sqlite"

	for code in roles:
		if is_sqlite:
			conn.execute(
				text("INSERT OR IGNORE INTO roles (code) VALUES (:c)"),
				{"c": code},
			)
		else:
			conn.execute(
				text("INSERT INTO roles (code) VALUES (:c) ON CONFLICT (code) DO NOTHING"),
				{"c": code},
			)


def _seed_users(conn) -> None:
	"""Seed test users with hashed passwords."""
	is_sqlite = conn.dialect.name == "sqlite"
	seed_users: list[tuple[str, str, list[str]]] = [
		("admin", "Admin123!", ["SYS_ADMIN", "PROD_MANAGER"]),
		("manager", "Manager123!", ["PROD_MANAGER"]),
		("operator", "Operator123!", ["OPERATOR"]),
		("sales", "Sales123!", ["SALES"]),
	]

	for username, password, role_codes in seed_users:
		existing = conn.execute(
			text("SELECT id, password_hash FROM users WHERE username = :u"),
			{"u": username},
		).fetchone()

		if existing:
			user_id, existing_hash = existing
			# If the stored hash doesn't verify with current hasher, update it
			try:
				ok = verify_password(password, existing_hash)
			except Exception:
				ok = False
			if not ok:
				conn.execute(
					text("UPDATE users SET password_hash = :p WHERE id = :id"),
					{"p": hash_password(password), "id": user_id},
				)
		else:
			user_id = str(uuid.uuid4())
			password_hash = hash_password(password)
			conn.execute(
				text(
					"INSERT INTO users (id, username, password_hash, is_active) "
					"VALUES (:id, :u, :p, :active)"
				),
				{"id": user_id, "u": username, "p": password_hash, "active": True},
			)

		# Assign roles (idempotent)
		for role_code in role_codes:
			if is_sqlite:
				conn.execute(
					text(
						"INSERT OR IGNORE INTO user_roles (user_id, role_id) "
						"SELECT :uid, r.id FROM roles r WHERE r.code = :code"
					),
					{"uid": user_id, "code": role_code},
				)
			else:
				conn.execute(
					text(
						"INSERT INTO user_roles (user_id, role_id) "
						"SELECT :uid, r.id FROM roles r WHERE r.code = :code "
						"ON CONFLICT DO NOTHING"
					),
					{"uid": user_id, "code": role_code},
				)


def _seed_machines(conn) -> None:
	"""Seed machine catalog (extruders, printer, baggers)."""
	is_sqlite = conn.dialect.name == "sqlite"

	def _insert_machine(code: str, machine_type: str, capability_json: str) -> None:
		if is_sqlite:
			conn.execute(
				text(
					"INSERT OR IGNORE INTO machines (id, code, type, capability, active) "
					"VALUES (:id, :code, :type, :cap, 1)"
				),
				{"id": str(uuid.uuid4()), "code": code, "type": machine_type, "cap": capability_json},
			)
		else:
			conn.execute(
				text(
					"INSERT INTO machines (id, code, type, capability, active) "
					"VALUES (:id, :code, :type, :cap::jsonb, TRUE) "
					"ON CONFLICT (code) DO NOTHING"
				),
				{"id": str(uuid.uuid4()), "code": code, "type": machine_type, "cap": capability_json},
			)

	# Extruders EX01-EX08
	extruder_cap = json.dumps(
		{
			"supports_inline_1c_print": True,
			"supports_inline_perforation": True,
			"width_range_mm": [100, 2000],
			"gauge_range_um": [25, 200],
		}
	)
	for i in range(1, 9):
		_insert_machine(f"EX{str(i).zfill(2)}", "extruder", extruder_cap)

	# UTECO printer
	uteco_cap = json.dumps(
		{"max_colours_per_side": 6, "duplex_supported": True, "max_web_width_mm": 1600}
	)
	_insert_machine("UTECO01", "printer_uteco", uteco_cap)

	# Bagging machines BGR01-BGR03
	bagger_cap = json.dumps({"supported_finish_modes": ["Cartons"], "min_max_width_mm": [150, 800]})
	for i in range(1, 3 + 1):
		_insert_machine(f"BGR{str(i).zfill(2)}", "converter_bagger", bagger_cap)


# Optional: allow running directly
if __name__ == "__main__":
	from sqlalchemy import create_engine
	try:
		# Attempt to get URL from environment for convenience
		import os

		db_url = os.getenv("DATABASE_URL")
		if not db_url:
			raise RuntimeError(
				"DATABASE_URL environment variable is not set. Set it or call seed_database(engine) programmatically."
			)
		engine = create_engine(db_url, future=True)
		seed_database(engine)
		print("Seeding completed successfully.")
	except Exception as exc:
		print(f"Seeding failed: {exc}")
		raise


