from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0004_resin_blends"
down_revision = "0003_views_and_seeds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "resin_blends",
        sa.Column("blend_code", sa.String(length=32), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
    )

    op.create_table(
        "resin_blend_components",
        sa.Column(
            "blend_code",
            sa.String(length=32),
            sa.ForeignKey("resin_blends.blend_code", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("resin_code", sa.String(length=32), primary_key=True, nullable=False),
        sa.Column("pct", sa.Numeric(6, 2), nullable=False),
        sa.CheckConstraint("pct >= 0", name="ck_resin_blend_components_pct_nonneg"),
        sa.CheckConstraint("pct <= 100", name="ck_resin_blend_components_pct_le_100"),
    )

    op.create_index("ix_resin_blend_components_blend_code", "resin_blend_components", ["blend_code"])

    # Seed resin blend presets (SQL equivalent of scripts/seed_resin_blends.py)
    conn = op.get_bind()

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


def downgrade() -> None:
    # Drop seeded blends (tables are dropped anyway, but keep downgrade safe/orderly)
    conn = op.get_bind()
    conn.execute(sa.text("DELETE FROM resin_blend_components WHERE blend_code IN ('HOUSE_LD','LD','MD')"))
    conn.execute(sa.text("DELETE FROM resin_blends WHERE blend_code IN ('HOUSE_LD','LD','MD')"))

    op.drop_index("ix_resin_blend_components_blend_code", table_name="resin_blend_components")
    op.drop_table("resin_blend_components")
    op.drop_table("resin_blends")

