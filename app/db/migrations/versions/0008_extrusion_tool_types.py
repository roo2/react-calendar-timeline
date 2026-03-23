"""Seed extrusion tool types: perforator, hole punch."""

from alembic import op
import sqlalchemy as sa
import uuid

revision = "0008_extrusion_tool_types"
down_revision = "0007_job_sheet_qty_rolls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    for code, name, icon in [
        ("inline_perforator", "Inline perforator", "icon_perforator"),
        ("inline_hole_punch", "Inline hole punch", "icon_hole_punch"),
    ]:
        conn.execute(
            sa.text(
                """
                INSERT INTO tool_types (id, code, name, icon_ref, unique_per_machine)
                VALUES (:id, :code, :name, :icon, 0)
                ON CONFLICT (code) DO NOTHING
                """
            ),
            {"id": str(uuid.uuid4()), "code": code, "name": name, "icon": icon},
        )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            DELETE FROM tools WHERE tool_type_id IN (
              SELECT id FROM tool_types WHERE code IN ('inline_perforator','inline_hole_punch')
            )
            """
        )
    )
    conn.execute(sa.text("DELETE FROM tool_types WHERE code IN ('inline_perforator','inline_hole_punch')"))
