from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0006_resin_blends"
down_revision = "0005_products_orders"
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


def downgrade() -> None:
    op.drop_index("ix_resin_blend_components_blend_code", table_name="resin_blend_components")
    op.drop_table("resin_blend_components")
    op.drop_table("resin_blends")

