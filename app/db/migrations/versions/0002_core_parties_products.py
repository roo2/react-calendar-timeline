from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0002_core_parties_products"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def _is_postgres(connection) -> bool:
    return connection.dialect.name == "postgresql"


def upgrade() -> None:
    conn = op.get_bind()
    if _is_postgres(conn):
        # Create core enum types up-front for stability (even if used later)
        op.execute(sa.text("CREATE TYPE operation_type AS ENUM ('extrusion','printing_inline','printing_uteco','conversion','packaging_dispatch')"))
        op.execute(sa.text("CREATE TYPE job_status AS ENUM ('planned','scheduled','running','paused','completed','dispatched','cancelled')"))
        op.execute(sa.text("CREATE TYPE order_status AS ENUM ('draft','confirmed','dispatched','closed','cancelled')"))
        op.execute(sa.text("CREATE TYPE run_status AS ENUM ('running','paused','completed')"))
        op.execute(sa.text("CREATE TYPE qc_check_result AS ENUM ('pass','fail','na')"))
        op.execute(sa.text("CREATE TYPE qc_source AS ENUM ('manual','sensor')"))
        op.execute(sa.text("CREATE TYPE inventory_category AS ENUM ('raw_material','wip_extruded_roll','wip_printed_roll','finished_goods','packaging_material','scrap')"))
        op.execute(sa.text("CREATE TYPE dispatch_status AS ENUM ('pending','ready','dispatched')"))
        op.execute(sa.text("CREATE TYPE tool_reservation_status AS ENUM ('planned','conflicted','cancelled','fulfilled')"))
        op.execute(sa.text("CREATE TYPE job_qc_summary_status AS ENUM ('draft','final_pass','final_fail','final_pass_with_deviation')"))
        # Internal enums
        op.execute(sa.text("CREATE TYPE machine_type AS ENUM ('extruder','printer_uteco','converter_bagger')"))
        op.execute(sa.text("CREATE TYPE sensor_type AS ENUM ('temperature','pressure','speed','humidity','thickness','other')"))
        op.execute(sa.text("CREATE TYPE sensor_protocol AS ENUM ('opcua','modbus','mqtt','http','file','other')"))

    # Customers
    op.create_table(
        "customers",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("code", sa.String(length=32), nullable=False, unique=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("contacts", sa.JSON, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("delivery_addresses", sa.JSON, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_customers_code", "customers", ["code"], unique=True)

    # Products
    op.create_table(
        "products",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("code", sa.String(length=32), nullable=False, unique=True),
        sa.Column("customer_id", sa.String(length=36), sa.ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("active_version_id", sa.String(length=36), nullable=True),
        sa.Column("lifecycle_status", sa.String(length=50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("code", name="uq_product_code"),
    )
    op.create_index("ix_products_code", "products", ["code"], unique=True)
    op.create_index("ix_products_customer", "products", ["customer_id"], unique=False)

    # Product Versions (immutable)
    op.create_table(
        "product_versions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("product_id", sa.String(length=36), sa.ForeignKey("products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("version_number", sa.Integer, nullable=False),
        sa.Column("created_by", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("spec_payload", sa.JSON, nullable=False),
        sa.UniqueConstraint("product_id", "version_number", name="uq_product_version"),
    )
    op.create_index("ix_product_versions_product", "product_versions", ["product_id"], unique=False)

    # Add FK for products.active_version_id after product_versions exists
    if conn.dialect.name == "sqlite":
        # SQLite requires batch operations for ALTER TABLE
        with op.batch_alter_table("products", schema=None) as batch_op:
            batch_op.create_foreign_key(
                "fk_products_active_version",
                "product_versions",
                ["active_version_id"],
                ["id"],
                ondelete="RESTRICT",
            )
    else:
        # PostgreSQL supports direct ALTER TABLE
        op.create_foreign_key(
            "fk_products_active_version",
            "products",
            "product_versions",
            ["active_version_id"],
            ["id"],
            ondelete="RESTRICT",
        )

    # Operator Suggestions
    op.create_table(
        "operator_suggestions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("product_id", sa.String(length=36), sa.ForeignKey("products.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("product_version_id", sa.String(length=36), sa.ForeignKey("product_versions.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("category", sa.String(length=100), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=True),
        sa.Column("resolved_by", sa.String(length=100), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_operator_suggestions_product", "operator_suggestions", ["product_id"], unique=False)
    op.create_index("ix_operator_suggestions_product_version", "operator_suggestions", ["product_version_id"], unique=False)


def downgrade() -> None:
    conn = op.get_bind()
    op.drop_index("ix_operator_suggestions_product_version", table_name="operator_suggestions")
    op.drop_index("ix_operator_suggestions_product", table_name="operator_suggestions")
    op.drop_table("operator_suggestions")
    if conn.dialect.name == "sqlite":
        with op.batch_alter_table("products", schema=None) as batch_op:
            batch_op.drop_constraint("fk_products_active_version", type_="foreignkey")
    else:
        op.drop_constraint("fk_products_active_version", "products", type_="foreignkey")
    op.drop_index("ix_product_versions_product", table_name="product_versions")
    op.drop_table("product_versions")
    op.drop_index("ix_products_customer", table_name="products")
    op.drop_index("ix_products_code", table_name="products")
    op.drop_table("products")
    op.drop_index("ix_customers_code", table_name="customers")
    op.drop_table("customers")

    # Drop enums only for PostgreSQL
    if _is_postgres(conn):
        op.execute(sa.text("DROP TYPE IF EXISTS sensor_protocol"))
        op.execute(sa.text("DROP TYPE IF EXISTS sensor_type"))
        op.execute(sa.text("DROP TYPE IF EXISTS machine_type"))
        op.execute(sa.text("DROP TYPE IF EXISTS job_qc_summary_status"))
        op.execute(sa.text("DROP TYPE IF EXISTS tool_reservation_status"))
        op.execute(sa.text("DROP TYPE IF EXISTS dispatch_status"))
        op.execute(sa.text("DROP TYPE IF EXISTS inventory_category"))
        op.execute(sa.text("DROP TYPE IF EXISTS qc_source"))
        op.execute(sa.text("DROP TYPE IF EXISTS qc_check_result"))
        op.execute(sa.text("DROP TYPE IF EXISTS run_status"))
        op.execute(sa.text("DROP TYPE IF EXISTS order_status"))
        op.execute(sa.text("DROP TYPE IF EXISTS job_status"))
        op.execute(sa.text("DROP TYPE IF EXISTS operation_type"))


