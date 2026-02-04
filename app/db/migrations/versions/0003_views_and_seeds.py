from __future__ import annotations

import json
import uuid

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0003_views_and_seeds"
down_revision = "0002_postgres_extras"
branch_labels = None
depends_on = None


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

    # Seed rate-card reference data
    conn.execute(
        sa.text(
            "INSERT INTO resins (resin_code, name, density, price_per_kg, currency) "
            "VALUES ('LD', 'Low Density PE', 0.9200, 1.8000, 'AUD') "
            "ON CONFLICT (resin_code) DO NOTHING"
        )
    )
    conn.execute(
        sa.text(
            "INSERT INTO resins (resin_code, name, density, price_per_kg, currency) "
            "VALUES ('MD', 'Medium Density PE', 0.9350, 2.1000, 'AUD') "
            "ON CONFLICT (resin_code) DO NOTHING"
        )
    )
    conn.execute(
        sa.text(
            "INSERT INTO additives (additive_code, name, price_per_kg, category) "
            "VALUES ('SLIP', 'Slip Agent', 4.5000, 'process') "
            "ON CONFLICT (additive_code) DO NOTHING"
        )
    )
    conn.execute(
        sa.text(
            "INSERT INTO additives (additive_code, name, price_per_kg, category) "
            "VALUES ('AB', 'Anti-Block', 3.7500, 'process') "
            "ON CONFLICT (additive_code) DO NOTHING"
        )
    )
    conn.execute(
        sa.text(
            "INSERT INTO colours (colour_code, name, price_per_kg, opacity_multiplier, currency) "
            "VALUES ('WHT', 'White', 5.0000, 0.200, 'AUD') "
            "ON CONFLICT (colour_code) DO NOTHING"
        )
    )
    conn.execute(
        sa.text(
            "INSERT INTO colours (colour_code, name, price_per_kg, opacity_multiplier, currency) "
            "VALUES ('BLK', 'Black', 4.5000, 0.100, 'AUD') "
            "ON CONFLICT (colour_code) DO NOTHING"
        )
    )
    conn.execute(
        sa.text(
            "INSERT INTO cores (core_type, description, cost_per_meter, kg_per_meter, currency) "
            "VALUES ('STD', 'Standard core', 0.1500, 0.0500, 'AUD') "
            "ON CONFLICT (core_type) DO NOTHING"
        )
    )

    # Idempotent inserts for printing_rates / conversion_rates (no natural unique key in schema)
    # printing_rates
    printing_rates = [
        ("inline", 0, 45.0000, 30, False),
        ("uteco", 0, 85.0000, 60, True),
        ("none", 0, 0.0000, 0, False),
    ]
    for method, min_meters, cost_per_1000m, setup_minutes, duplex_supported in printing_rates:
        conn.execute(
            sa.text(
                """
                INSERT INTO printing_rates (id, method, min_meters, cost_per_1000m, setup_minutes, duplex_supported)
                SELECT :id, :method, :min_meters, :cost_per_1000m, :setup_minutes, :duplex_supported
                WHERE NOT EXISTS (
                  SELECT 1 FROM printing_rates
                  WHERE method = :method
                    AND min_meters = :min_meters
                    AND cost_per_1000m = :cost_per_1000m
                    AND setup_minutes = :setup_minutes
                    AND duplex_supported = :duplex_supported
                )
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "method": method,
                "min_meters": min_meters,
                "cost_per_1000m": cost_per_1000m,
                "setup_minutes": setup_minutes,
                "duplex_supported": duplex_supported,
            },
        )

    # conversion_rates
    conv = (20, 100, 200, 1200, 18000, 30)
    conn.execute(
        sa.text(
            """
            INSERT INTO conversion_rates (id, min_gauge_um, max_gauge_um, min_length_mm, max_length_mm, bags_per_hour, setup_minutes)
            SELECT :id, :min_g, :max_g, :min_l, :max_l, :bph, :setup
            WHERE NOT EXISTS (
              SELECT 1 FROM conversion_rates
              WHERE min_gauge_um = :min_g
                AND max_gauge_um = :max_g
                AND min_length_mm = :min_l
                AND max_length_mm = :max_l
                AND bags_per_hour = :bph
                AND setup_minutes = :setup
            )
            """
        ),
        {
            "id": str(uuid.uuid4()),
            "min_g": conv[0],
            "max_g": conv[1],
            "min_l": conv[2],
            "max_l": conv[3],
            "bph": conv[4],
            "setup": conv[5],
        },
    )

    # waste_adders
    conn.execute(
        sa.text(
            "INSERT INTO waste_adders (id, condition, waste_minutes) "
            "VALUES (:id, 'default', 10) "
            "ON CONFLICT (condition) DO NOTHING"
        ),
        {"id": str(uuid.uuid4())},
    )
    conn.execute(
        sa.text(
            "INSERT INTO waste_adders (id, condition, waste_minutes) "
            "VALUES (:id, 'duplex_print', 20) "
            "ON CONFLICT (condition) DO NOTHING"
        ),
        {"id": str(uuid.uuid4())},
    )


def downgrade() -> None:
    conn = op.get_bind()
    is_sqlite = conn.dialect.name == "sqlite"

    # Drop views
    op.execute("DROP VIEW IF EXISTS v_wip_stage_balances")
    op.execute("DROP VIEW IF EXISTS v_inventory_balances_by_category")

    # Remove seeded data (best-effort)
    conn.execute(sa.text("DELETE FROM waste_adders WHERE condition IN ('default','duplex_print')"))
    conn.execute(sa.text("DELETE FROM conversion_rates"))
    conn.execute(sa.text("DELETE FROM printing_rates"))
    conn.execute(sa.text("DELETE FROM cores WHERE core_type IN ('STD')"))
    conn.execute(sa.text("DELETE FROM colours WHERE colour_code IN ('WHT','BLK')"))
    conn.execute(sa.text("DELETE FROM additives WHERE additive_code IN ('SLIP','AB')"))
    conn.execute(sa.text("DELETE FROM resins WHERE resin_code IN ('LD','MD')"))

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

