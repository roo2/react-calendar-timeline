from __future__ import annotations

from alembic import op
import sqlalchemy as sa
import uuid

# revision identifiers, used by Alembic.
revision = "0015_rate_card_seeds"
down_revision = "0014_kpi_views"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Resins
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

    # Additives
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

    # Colours
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

    # Cores
    conn.execute(
        sa.text(
            "INSERT INTO cores (core_type, description, cost_per_meter, kg_per_meter, currency) "
            "VALUES ('STD', 'Standard core', 0.1500, 0.0500, 'AUD') "
            "ON CONFLICT (core_type) DO NOTHING"
        )
    )

    # Printing rates
    conn.execute(
        sa.text(
            "INSERT INTO printing_rates (id, method, min_meters, cost_per_1000m, setup_minutes, duplex_supported) "
            "VALUES (:id, 'inline', 0, 45.0000, 30, FALSE)"
        ),
        {"id": str(uuid.uuid4())},
    )
    conn.execute(
        sa.text(
            "INSERT INTO printing_rates (id, method, min_meters, cost_per_1000m, setup_minutes, duplex_supported) "
            "VALUES (:id, 'uteco', 0, 85.0000, 60, TRUE)"
        ),
        {"id": str(uuid.uuid4())},
    )
    conn.execute(
        sa.text(
            "INSERT INTO printing_rates (id, method, min_meters, cost_per_1000m, setup_minutes, duplex_supported) "
            "VALUES (:id, 'none', 0, 0.0000, 0, FALSE)"
        ),
        {"id": str(uuid.uuid4())},
    )

    # Conversion rates
    conn.execute(
        sa.text(
            "INSERT INTO conversion_rates (id, min_gauge_um, max_gauge_um, min_length_mm, max_length_mm, bags_per_hour, setup_minutes) "
            "VALUES (:id, 20, 100, 200, 1200, 18000, 30)"
        ),
        {"id": str(uuid.uuid4())},
    )

    # Waste adders
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
    conn.execute(sa.text("DELETE FROM waste_adders WHERE condition IN ('default','duplex_print')"))
    conn.execute(sa.text("DELETE FROM conversion_rates"))
    conn.execute(sa.text("DELETE FROM printing_rates"))
    conn.execute(sa.text("DELETE FROM cores WHERE core_type IN ('STD')"))
    conn.execute(sa.text("DELETE FROM colours WHERE colour_code IN ('WHT','BLK')"))
    conn.execute(sa.text("DELETE FROM additives WHERE additive_code IN ('SLIP','AB')"))
    conn.execute(sa.text("DELETE FROM resins WHERE resin_code IN ('LD','MD')"))


