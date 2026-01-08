from __future__ import annotations

from alembic import op
import sqlalchemy as sa
import uuid
import json

# revision identifiers, used by Alembic.
revision = "0011_seeds"
down_revision = "0010_constraints_indexes_sequences"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Seed machines
    conn = op.get_bind()
    is_pg = conn.dialect.name == "postgresql"
    # Extruders EX01..EX08
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
                    VALUES (:id, :code, 'extruder', :cap::jsonb, TRUE)
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

    # UTECO printer
    u_cap = {"max_colours_per_side": 6, "duplex_supported": True, "max_web_width_mm": 1600}
    if is_pg:
        conn.execute(
            sa.text(
                """
                INSERT INTO machines (id, code, type, capability, active)
                VALUES (:id, 'UTECO01', 'printer_uteco', :cap::jsonb, TRUE)
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

    # Bagger/Converter BGR01..BGR03
    b_cap = {"supported_finish_modes": ["Cartons"], "min_max_width_mm": [150, 800]}
    for i in range(1, 4):
        code = f"BGR{str(i).zfill(2)}"
        if is_pg:
            conn.execute(
                sa.text(
                    """
                    INSERT INTO machines (id, code, type, capability, active)
                    VALUES (:id, :code, 'converter_bagger', :cap::jsonb, TRUE)
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

    # Optional: seed some tool types
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


def downgrade() -> None:
    conn = op.get_bind()
    # Remove seeded tool types
    conn.execute(sa.text("DELETE FROM tool_types WHERE code IN ('inline_printer_1c','electra_punch')"))
    # Remove seeded machines
    codes = [f"EX{str(i).zfill(2)}" for i in range(1, 9)] + ["UTECO01"] + [f"BGR{str(i).zfill(2)}" for i in range(1, 4)]
    if conn.dialect.name == "postgresql":
        conn.execute(sa.text("DELETE FROM machines WHERE code = ANY(:codes)"), {"codes": codes})
    else:
        placeholders = ",".join([f":c{i}" for i in range(len(codes))])
        params = {f"c{i}": code for i, code in enumerate(codes)}
        conn.execute(sa.text(f"DELETE FROM machines WHERE code IN ({placeholders})"), params)


