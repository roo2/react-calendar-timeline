from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0012_rate_cards"
down_revision = "0014_scheduling_queue_and_job_alloc"
branch_labels = None
depends_on = None


def _is_postgres(connection) -> bool:
    return connection.dialect.name == "postgresql"


def upgrade() -> None:
    conn = op.get_bind()
    # Enum for printing method (PostgreSQL only)
    if _is_postgres(conn):
        op.execute(sa.text("CREATE TYPE printing_method AS ENUM ('none','inline','uteco')"))

    # Resins
    op.create_table(
        "resins",
        sa.Column("resin_code", sa.String(length=32), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("density", sa.Numeric(6, 4), nullable=False),
        sa.Column("price_per_kg", sa.Numeric(12, 4), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.CheckConstraint("density > 0", name="ck_resins_density_positive"),
        sa.CheckConstraint("price_per_kg >= 0", name="ck_resins_price_nonneg"),
    )

    # Additives
    op.create_table(
        "additives",
        sa.Column("additive_code", sa.String(length=32), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("price_per_kg", sa.Numeric(12, 4), nullable=False),
        sa.Column("category", sa.String(length=64), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.CheckConstraint("price_per_kg >= 0", name="ck_additives_price_nonneg"),
    )

    # Colours
    op.create_table(
        "colours",
        sa.Column("colour_code", sa.String(length=32), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("price_per_kg", sa.Numeric(12, 4), nullable=False),
        sa.Column("opacity_multiplier", sa.Numeric(6, 3), nullable=False, server_default=sa.text("0")),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.CheckConstraint("price_per_kg >= 0", name="ck_colours_price_nonneg"),
        sa.CheckConstraint("opacity_multiplier >= 0", name="ck_colours_opacity_nonneg"),
    )

    # Cores
    op.create_table(
        "cores",
        sa.Column("core_type", sa.String(length=32), primary_key=True, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("cost_per_meter", sa.Numeric(12, 4), nullable=False),
        sa.Column("kg_per_meter", sa.Numeric(12, 4), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.CheckConstraint("cost_per_meter >= 0", name="ck_cores_cost_nonneg"),
        sa.CheckConstraint("kg_per_meter >= 0", name="ck_cores_kg_nonneg"),
    )

    # Printing rates
    op.create_table(
        "printing_rates",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("method", sa.Enum(name="printing_method", native_enum=False), nullable=False),
        sa.Column("min_meters", sa.Numeric(12, 2), nullable=False),
        sa.Column("cost_per_1000m", sa.Numeric(12, 4), nullable=False),
        sa.Column("setup_minutes", sa.Integer, nullable=False),
        sa.Column("duplex_supported", sa.Boolean, nullable=False, server_default=sa.text("FALSE")),
        sa.CheckConstraint("min_meters >= 0", name="ck_printing_rates_min_m_ge0"),
        sa.CheckConstraint("cost_per_1000m >= 0", name="ck_printing_rates_cost_nonneg"),
        sa.CheckConstraint("setup_minutes >= 0", name="ck_printing_rates_setup_nonneg"),
    )

    # Conversion rates
    op.create_table(
        "conversion_rates",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("min_gauge_um", sa.Integer, nullable=False),
        sa.Column("max_gauge_um", sa.Integer, nullable=False),
        sa.Column("min_length_mm", sa.Integer, nullable=False),
        sa.Column("max_length_mm", sa.Integer, nullable=False),
        sa.Column("bags_per_hour", sa.Integer, nullable=False),
        sa.Column("setup_minutes", sa.Integer, nullable=False),
        sa.CheckConstraint("min_gauge_um >= 0", name="ck_conv_min_gauge_ge0"),
        sa.CheckConstraint("max_gauge_um >= min_gauge_um", name="ck_conv_gauge_range"),
        sa.CheckConstraint("min_length_mm >= 0", name="ck_conv_min_len_ge0"),
        sa.CheckConstraint("max_length_mm >= min_length_mm", name="ck_conv_len_range"),
        sa.CheckConstraint("bags_per_hour > 0", name="ck_conv_bph_pos"),
        sa.CheckConstraint("setup_minutes >= 0", name="ck_conv_setup_nonneg"),
    )

    # Waste adders
    op.create_table(
        "waste_adders",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("condition", sa.Text, nullable=False, unique=True),
        sa.Column("waste_minutes", sa.Integer, nullable=False),
        sa.UniqueConstraint("condition", name="uq_waste_adders_condition"),
        sa.CheckConstraint("waste_minutes >= 0", name="ck_waste_minutes_nonneg"),
    )


def downgrade() -> None:
    op.drop_table("waste_adders")
    op.drop_table("conversion_rates")
    op.drop_table("printing_rates")
    op.drop_table("cores")
    op.drop_table("colours")
    op.drop_table("additives")
    op.drop_table("resins")
    # Drop enum type only on PostgreSQL
    conn = op.get_bind()
    if _is_postgres(conn):
        op.execute(sa.text("DROP TYPE IF EXISTS printing_method"))


