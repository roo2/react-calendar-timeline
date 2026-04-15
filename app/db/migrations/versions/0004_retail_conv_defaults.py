"""Retail pricing, conversion factors, quote defaults, and anilox cleanup (post-0003).

Includes:
- Drop ``anilox`` master table
- Quote retail pricing (``quote_defaults.extrusion_retail_addon_per_kg``, printing tier cost/price split)
- Conversion factors: per-minute slugs → per-hour (×60) when present
- Remove ``quote_defaults.default_margin_pct`` (+ check constraint on Postgres)

Revision ID: 0004_retail_conv_defaults (must fit ``alembic_version.version_num`` VARCHAR(32) on Postgres).
Revises: 0003_views_and_seeds

If the DB was migrated with the older split revisions (``0004_drop_anilox_table``,
``0004_quote_retail_pricing``, ``0005_conversion_factors_per_min``,
``0007_drop_quote_defaults_default_margin``), stamp to this revision after the schema matches, e.g.
``alembic stamp 0004_retail_conv_defaults``.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0004_retail_conv_defaults"
down_revision = "0003_views_and_seeds"
branch_labels = None
depends_on = None


def _is_sqlite(conn) -> bool:
	return conn.dialect.name == "sqlite"


# --- printing_pricing_tiers rebuild (from 0004_quote_retail_pricing) ---


def _sqlite_rebuild_printing_tiers_to_retail() -> None:
	"""Rebuild table without batch_alter_table (SQLite batch copies old CHECKs that reference dropped columns)."""
	op.execute(sa.text("DROP TABLE IF EXISTS printing_pricing_tiers_new"))
	op.create_table(
		"printing_pricing_tiers_new",
		sa.Column("id", sa.String(length=36), primary_key=True),
		sa.Column("method", sa.String(length=16), nullable=False),
		sa.Column("max_print_width_mm", sa.Integer(), nullable=False),
		sa.Column("num_colours", sa.Integer(), nullable=False),
		sa.Column("min_meters", sa.Integer(), nullable=False),
		sa.Column("min_charge", sa.Numeric(12, 4), nullable=True),
		sa.Column("setup_cost", sa.Numeric(12, 4), nullable=False, server_default=sa.text("0")),
		sa.Column("setup_price", sa.Numeric(12, 4), nullable=True),
		sa.Column("cost_per_1000m", sa.Numeric(12, 4), nullable=False),
		sa.Column("price_per_1000m", sa.Numeric(12, 4), nullable=False),
		sa.Column("meters_per_min", sa.Numeric(12, 4), nullable=True),
		sa.UniqueConstraint("method", "max_print_width_mm", "num_colours", name="uq_printing_pricing_tier"),
		sa.CheckConstraint("method IN ('inline','uteco')", name="ck_print_tier_method"),
		sa.CheckConstraint("max_print_width_mm > 0", name="ck_print_tier_max_width_pos"),
		sa.CheckConstraint("num_colours >= 1", name="ck_print_tier_num_colours_ge1"),
		sa.CheckConstraint("min_meters >= 0", name="ck_print_tier_min_m_ge0"),
		sa.CheckConstraint("min_charge IS NULL OR min_charge >= 0", name="ck_print_tier_min_charge_nonneg"),
		sa.CheckConstraint("setup_cost >= 0", name="ck_print_tier_setup_cost_nonneg"),
		sa.CheckConstraint("setup_price IS NULL OR setup_price >= 0", name="ck_print_tier_setup_price_nonneg"),
		sa.CheckConstraint("cost_per_1000m >= 0", name="ck_print_tier_cost_per_1000_nonneg"),
		sa.CheckConstraint("price_per_1000m >= 0", name="ck_print_tier_price_per_1000_nonneg"),
		sa.CheckConstraint("meters_per_min IS NULL OR meters_per_min > 0", name="ck_print_tier_meters_per_min_pos"),
	)
	op.execute(
		sa.text(
			"""
			INSERT INTO printing_pricing_tiers_new (
				id, method, max_print_width_mm, num_colours, min_meters, min_charge,
				setup_cost, setup_price, cost_per_1000m, price_per_1000m, meters_per_min
			)
			SELECT
				id, method, max_print_width_mm, num_colours, min_meters, min_charge,
				0 AS setup_cost,
				setup_fee AS setup_price,
				0 AS cost_per_1000m,
				cost_per_1000m AS price_per_1000m,
				meters_per_min
			FROM printing_pricing_tiers
			"""
		)
	)
	op.drop_table("printing_pricing_tiers")
	op.execute(sa.text("ALTER TABLE printing_pricing_tiers_new RENAME TO printing_pricing_tiers"))


def _sqlite_rebuild_printing_tiers_to_legacy() -> None:
	"""Downgrade: restore setup_fee + single cost_per_1000m (retail stored in price column)."""
	op.execute(sa.text("DROP TABLE IF EXISTS printing_pricing_tiers_revert"))
	op.create_table(
		"printing_pricing_tiers_revert",
		sa.Column("id", sa.String(length=36), primary_key=True),
		sa.Column("method", sa.String(length=16), nullable=False),
		sa.Column("max_print_width_mm", sa.Integer(), nullable=False),
		sa.Column("num_colours", sa.Integer(), nullable=False),
		sa.Column("min_meters", sa.Integer(), nullable=False),
		sa.Column("min_charge", sa.Numeric(12, 4), nullable=True),
		sa.Column("setup_fee", sa.Numeric(12, 4), nullable=True),
		sa.Column("cost_per_1000m", sa.Numeric(12, 4), nullable=False),
		sa.Column("meters_per_min", sa.Numeric(12, 4), nullable=True),
		sa.UniqueConstraint("method", "max_print_width_mm", "num_colours", name="uq_printing_pricing_tier"),
		sa.CheckConstraint("method IN ('inline','uteco')", name="ck_print_tier_method"),
		sa.CheckConstraint("max_print_width_mm > 0", name="ck_print_tier_max_width_pos"),
		sa.CheckConstraint("num_colours >= 1", name="ck_print_tier_num_colours_ge1"),
		sa.CheckConstraint("min_meters >= 0", name="ck_print_tier_min_m_ge0"),
		sa.CheckConstraint("min_charge IS NULL OR min_charge >= 0", name="ck_print_tier_min_charge_nonneg"),
		sa.CheckConstraint("setup_fee IS NULL OR setup_fee >= 0", name="ck_print_tier_setup_fee_nonneg"),
		sa.CheckConstraint("cost_per_1000m >= 0", name="ck_print_tier_cost_nonneg"),
		sa.CheckConstraint("meters_per_min IS NULL OR meters_per_min > 0", name="ck_print_tier_meters_per_min_pos"),
	)
	op.execute(
		sa.text(
			"""
			INSERT INTO printing_pricing_tiers_revert (
				id, method, max_print_width_mm, num_colours, min_meters, min_charge,
				setup_fee, cost_per_1000m, meters_per_min
			)
			SELECT
				id, method, max_print_width_mm, num_colours, min_meters, min_charge,
				setup_price AS setup_fee,
				price_per_1000m AS cost_per_1000m,
				meters_per_min
			FROM printing_pricing_tiers
			"""
		)
	)
	op.drop_table("printing_pricing_tiers")
	op.execute(sa.text("ALTER TABLE printing_pricing_tiers_revert RENAME TO printing_pricing_tiers"))


def _upgrade_quote_retail_pricing() -> None:
	conn = op.get_bind()
	insp = inspect(conn)

	# --- quote_defaults: retail add-on per kg (materials retail uplift) ---
	q_cols = {c["name"] for c in insp.get_columns("quote_defaults")}
	if "extrusion_retail_addon_per_kg" not in q_cols:
		op.add_column(
			"quote_defaults",
			sa.Column("extrusion_retail_addon_per_kg", sa.Numeric(12, 4), nullable=False, server_default=sa.text("1.8")),
		)
		op.execute(sa.text("UPDATE quote_defaults SET extrusion_retail_addon_per_kg = 1.8 WHERE id = 1"))

	# --- printing_pricing_tiers: split cost vs retail price ---
	pt_cols = {c["name"] for c in insp.get_columns("printing_pricing_tiers")}
	if "setup_cost" in pt_cols:
		return

	if _is_sqlite(conn):
		_sqlite_rebuild_printing_tiers_to_retail()
	else:
		op.drop_constraint("ck_print_tier_setup_fee_nonneg", "printing_pricing_tiers", type_="check")
		op.drop_constraint("ck_print_tier_cost_nonneg", "printing_pricing_tiers", type_="check")
		op.add_column(
			"printing_pricing_tiers",
			sa.Column("setup_cost", sa.Numeric(12, 4), nullable=False, server_default=sa.text("0")),
		)
		op.add_column("printing_pricing_tiers", sa.Column("setup_price", sa.Numeric(12, 4), nullable=True))
		op.add_column(
			"printing_pricing_tiers",
			sa.Column("price_per_1000m", sa.Numeric(12, 4), nullable=False, server_default=sa.text("0")),
		)
		op.add_column(
			"printing_pricing_tiers",
			sa.Column("cost_per_1000m_new", sa.Numeric(12, 4), nullable=False, server_default=sa.text("0")),
		)
		op.execute(
			sa.text(
				"""
				UPDATE printing_pricing_tiers
				SET
				  setup_price = setup_fee,
				  price_per_1000m = cost_per_1000m,
				  cost_per_1000m_new = 0,
				  setup_cost = 0
				"""
			)
		)
		op.drop_column("printing_pricing_tiers", "setup_fee")
		op.drop_column("printing_pricing_tiers", "cost_per_1000m")
		op.execute(sa.text("ALTER TABLE printing_pricing_tiers RENAME COLUMN cost_per_1000m_new TO cost_per_1000m"))
		op.create_check_constraint("ck_print_tier_setup_cost_nonneg", "printing_pricing_tiers", "setup_cost >= 0")
		op.create_check_constraint(
			"ck_print_tier_setup_price_nonneg", "printing_pricing_tiers", "setup_price IS NULL OR setup_price >= 0"
		)
		op.create_check_constraint("ck_print_tier_cost_per_1000_nonneg", "printing_pricing_tiers", "cost_per_1000m >= 0")
		op.create_check_constraint("ck_print_tier_price_per_1000_nonneg", "printing_pricing_tiers", "price_per_1000m >= 0")


def _downgrade_quote_retail_pricing() -> None:
	conn = op.get_bind()

	op.drop_column("quote_defaults", "extrusion_retail_addon_per_kg")

	if _is_sqlite(conn):
		_sqlite_rebuild_printing_tiers_to_legacy()
	else:
		op.drop_constraint("ck_print_tier_setup_cost_nonneg", "printing_pricing_tiers", type_="check")
		op.drop_constraint("ck_print_tier_setup_price_nonneg", "printing_pricing_tiers", type_="check")
		op.drop_constraint("ck_print_tier_cost_per_1000_nonneg", "printing_pricing_tiers", type_="check")
		op.drop_constraint("ck_print_tier_price_per_1000_nonneg", "printing_pricing_tiers", type_="check")
		op.add_column("printing_pricing_tiers", sa.Column("setup_fee", sa.Numeric(12, 4), nullable=True))
		op.add_column(
			"printing_pricing_tiers",
			sa.Column("cost_per_1000m_old", sa.Numeric(12, 4), nullable=False, server_default=sa.text("0")),
		)
		op.execute(
			sa.text(
				"""
				UPDATE printing_pricing_tiers
				SET setup_fee = setup_price,
				    cost_per_1000m_old = price_per_1000m
				"""
			)
		)
		op.drop_column("printing_pricing_tiers", "setup_cost")
		op.drop_column("printing_pricing_tiers", "setup_price")
		op.drop_column("printing_pricing_tiers", "price_per_1000m")
		op.drop_column("printing_pricing_tiers", "cost_per_1000m")
		op.execute(sa.text("ALTER TABLE printing_pricing_tiers RENAME COLUMN cost_per_1000m_old TO cost_per_1000m"))
		op.create_check_constraint("ck_print_tier_setup_fee_nonneg", "printing_pricing_tiers", "setup_fee IS NULL OR setup_fee >= 0")
		op.create_check_constraint("ck_print_tier_cost_nonneg", "printing_pricing_tiers", "cost_per_1000m >= 0")


# --- conversion_factors per-min → per-hr (from 0005_conversion_factors_per_min) ---

_TO_HOURLY = (
	(
		"conversion_cost_per_hr",
		"conversion_cost_per_min",
		"Conversion Cost ($/hr)",
	),
	(
		"conversion_price_per_hr",
		"conversion_price_per_min",
		"Conversion Price ($/hr)",
	),
)


def _upgrade_conversion_factors_hourly() -> None:
	conn = op.get_bind()
	for old_slug, new_slug, old_name in _TO_HOURLY:
		row = conn.execute(
			sa.text("SELECT value FROM conversion_factors WHERE slug = :s"),
			{"s": new_slug},
		).fetchone()
		if row is None:
			continue
		try:
			val_per_hr = float(row[0]) * 60.0
		except (TypeError, ValueError):
			continue
		conn.execute(sa.text("DELETE FROM conversion_factors WHERE slug = :s"), {"s": old_slug})
		conn.execute(
			sa.text("DELETE FROM conversion_factors WHERE slug = :s"),
			{"s": new_slug},
		)
		conn.execute(
			sa.text(
				"INSERT INTO conversion_factors (slug, name, value) VALUES (:slug, :name, :value)"
			),
			{"slug": old_slug, "name": old_name, "value": val_per_hr},
		)


def _downgrade_conversion_factors_per_min() -> None:
	conn = op.get_bind()
	for old_slug, new_slug, new_name in (
		(
			"conversion_cost_per_hr",
			"conversion_cost_per_min",
			"Conversion Cost ($/min)",
		),
		(
			"conversion_price_per_hr",
			"conversion_price_per_min",
			"Conversion Price ($/min)",
		),
	):
		row = conn.execute(
			sa.text("SELECT value FROM conversion_factors WHERE slug = :s"),
			{"s": old_slug},
		).fetchone()
		if row is None:
			continue
		try:
			val_per_min = float(row[0]) / 60.0
		except (TypeError, ValueError):
			continue
		conn.execute(sa.text("DELETE FROM conversion_factors WHERE slug = :s"), {"s": new_slug})
		conn.execute(
			sa.text("DELETE FROM conversion_factors WHERE slug = :s"),
			{"s": old_slug},
		)
		conn.execute(
			sa.text(
				"INSERT INTO conversion_factors (slug, name, value) VALUES (:slug, :name, :value)"
			),
			{"slug": new_slug, "name": new_name, "value": val_per_min},
		)


# --- drop quote_defaults.default_margin_pct (from 0007) ---


def _sqlite_upgrade_drop_default_margin() -> None:
	"""
	SQLite: avoid ``batch_alter_table`` here — it can recreate ``quote_defaults`` while still emitting
	``ck_quote_defaults_margin_range`` even after ``default_margin_pct`` is omitted, which fails with
	``no such column: default_margin_pct``.
	"""
	op.execute(sa.text("DROP TABLE IF EXISTS quote_defaults_new"))
	op.create_table(
		"quote_defaults_new",
		sa.Column("id", sa.Integer(), primary_key=True, nullable=False, autoincrement=False),
		sa.Column("extrusion_retail_addon_per_kg", sa.Numeric(12, 4), nullable=False, server_default=sa.text("1.8")),
		sa.CheckConstraint("id = 1", name="ck_quote_defaults_singleton"),
		sa.CheckConstraint("extrusion_retail_addon_per_kg >= 0", name="ck_quote_defaults_extrusion_addon_nonneg"),
	)
	op.execute(
		sa.text(
			"INSERT INTO quote_defaults_new (id, extrusion_retail_addon_per_kg) "
			"SELECT id, extrusion_retail_addon_per_kg FROM quote_defaults"
		)
	)
	op.drop_table("quote_defaults")
	op.execute(sa.text("ALTER TABLE quote_defaults_new RENAME TO quote_defaults"))


def _sqlite_downgrade_restore_default_margin() -> None:
	"""SQLite: rebuild table with ``default_margin_pct`` and margin CHECK (no batch_alter)."""
	op.execute(sa.text("DROP TABLE IF EXISTS quote_defaults_revert"))
	op.create_table(
		"quote_defaults_revert",
		sa.Column("id", sa.Integer(), primary_key=True, nullable=False, autoincrement=False),
		sa.Column("extrusion_retail_addon_per_kg", sa.Numeric(12, 4), nullable=False, server_default=sa.text("1.8")),
		sa.Column("default_margin_pct", sa.Numeric(6, 3), nullable=False, server_default=sa.text("37")),
		sa.CheckConstraint("id = 1", name="ck_quote_defaults_singleton"),
		sa.CheckConstraint("extrusion_retail_addon_per_kg >= 0", name="ck_quote_defaults_extrusion_addon_nonneg"),
		sa.CheckConstraint(
			"default_margin_pct >= 0 AND default_margin_pct < 100",
			name="ck_quote_defaults_margin_range",
		),
	)
	op.execute(
		sa.text(
			"INSERT INTO quote_defaults_revert (id, extrusion_retail_addon_per_kg, default_margin_pct) "
			"SELECT id, extrusion_retail_addon_per_kg, 37 FROM quote_defaults"
		)
	)
	op.drop_table("quote_defaults")
	op.execute(sa.text("ALTER TABLE quote_defaults_revert RENAME TO quote_defaults"))


def _upgrade_drop_default_margin() -> None:
	conn = op.get_bind()
	insp = inspect(conn)
	if "quote_defaults" not in insp.get_table_names():
		return
	cols = {c["name"] for c in insp.get_columns("quote_defaults")}
	if "default_margin_pct" not in cols:
		return
	if _is_sqlite(conn):
		_sqlite_upgrade_drop_default_margin()
	else:
		op.drop_constraint("ck_quote_defaults_margin_range", "quote_defaults", type_="check")
		op.drop_column("quote_defaults", "default_margin_pct")


def _downgrade_restore_default_margin() -> None:
	conn = op.get_bind()
	insp = inspect(conn)
	if "quote_defaults" in insp.get_table_names():
		cols = {c["name"] for c in insp.get_columns("quote_defaults")}
		if "default_margin_pct" in cols:
			return
	if _is_sqlite(conn):
		_sqlite_downgrade_restore_default_margin()
	else:
		op.add_column(
			"quote_defaults",
			sa.Column("default_margin_pct", sa.Numeric(6, 3), nullable=False, server_default=sa.text("37")),
		)
		op.create_check_constraint(
			"ck_quote_defaults_margin_range",
			"quote_defaults",
			"default_margin_pct >= 0 AND default_margin_pct < 100",
		)


def upgrade() -> None:
	# 1) Drop anilox (Uteco anilox rolls removed from product)
	op.execute(sa.text("DROP TABLE IF EXISTS anilox"))

	# 2) Quote retail pricing + printing tiers
	_upgrade_quote_retail_pricing()

	# 3) Conversion factors slug migration
	_upgrade_conversion_factors_hourly()

	# 4) Drop default_margin_pct from quote_defaults
	_upgrade_drop_default_margin()


def downgrade() -> None:
	# Reverse order of upgrade()
	_downgrade_restore_default_margin()
	_downgrade_conversion_factors_per_min()
	_downgrade_quote_retail_pricing()

	op.create_table(
		"anilox",
		sa.Column("anilox_code", sa.String(length=32), primary_key=True, nullable=False),
		sa.Column("description", sa.String(length=255), nullable=False),
	)
