from __future__ import annotations

import json
import uuid
import os
import sys

from alembic import op
import sqlalchemy as sa

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
        ("HOUSE_LD", "House Blend (LD)"),
        ("LD", "LD"),
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
    conn.execute(sa.text("DELETE FROM resin_blend_components WHERE blend_code IN ('HOUSE_LD','LD','MD')"))
    comps_seed = [
        ("HOUSE_LD", "Q1018H", 50.0),
        ("HOUSE_LD", "FE3000", 50.0),
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
    colours_seed = [
        # colour_code, name, price_per_kg, sort_order
        ("WHITE", "White", 5.8, 1),
        ("BLACK", "Black", 4.5, 2),
        ("SILVER", "Silver", 19.88, 3),
        ("GREY", "Grey", 14.5, 4),
        ("BLUE", "Blue", 5.7, 5),
        ("PIPE_COVER_BLUE", "Pipe Cover Blue", 16.0, 6),
        ("PIPECOVER_PURPLE", "PipeCover Purple", 16.86, 7),
        ("PIPECOVER_BEIGE", "PipeCover Beige", 14.1, 8),
        ("YELLOW", "Yellow", 20.33, 9),
        ("SIGNET_YELLOW", "Signet Yellow", 17.33, 10),
        ("GREEN", "Green", 14.69, 11),
        ("ORANGE", "Orange", 19.55, 12),
        ("RED", "Red", 19.02, 13),
        ("PURPLE", "Purple", 17.23, 14),
        ("BROWN", "Brown", 19.42, 15),
        ("PINK", "Pink", 32.29, 16),
        ("OTHER", "Other", 25.0, 17),
    ]
    for colour_code, name, price_per_kg, sort_order in colours_seed:
        conn.execute(
            sa.text(
                """
                INSERT INTO colours (colour_code, name, price_per_kg, sort_order)
                VALUES (:colour_code, :name, :price_per_kg, :sort_order)
                ON CONFLICT (colour_code) DO UPDATE SET
                  name = excluded.name,
                  price_per_kg = excluded.price_per_kg,
                  sort_order = excluded.sort_order
                """
            ),
            {
                "colour_code": colour_code,
                "name": name,
                "price_per_kg": price_per_kg,
                "sort_order": sort_order,
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
    conn.execute(sa.text("DELETE FROM resin_blend_components WHERE blend_code IN ('HOUSE_LD','LD','MD')"))
    conn.execute(sa.text("DELETE FROM resin_blends WHERE blend_code IN ('HOUSE_LD','LD','MD')"))

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

