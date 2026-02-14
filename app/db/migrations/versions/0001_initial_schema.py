from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def _is_postgres(conn) -> bool:
    return conn.dialect.name == "postgresql"


def _create_pg_enum(name: str, values: list[str]) -> None:
    # PostgreSQL has no CREATE TYPE IF NOT EXISTS for ENUM in many versions.
    escaped = ",".join([f"'{v}'" for v in values])
    op.execute(
        sa.text(
            f"""
            DO $$
            BEGIN
              CREATE TYPE {name} AS ENUM ({escaped});
            EXCEPTION
              WHEN duplicate_object THEN NULL;
            END $$;
            """
        )
    )


def upgrade() -> None:
    conn = op.get_bind()

    # Create enum types up-front (PostgreSQL only).
    # Note: most columns use native_enum=False for portability, but having the types
    # defined keeps the DB ready if we switch to native enums later.
    if _is_postgres(conn):
        _create_pg_enum(
            "operation_type",
            ["extrusion", "printing_inline", "printing_uteco", "conversion", "packaging_dispatch"],
        )
        _create_pg_enum(
            "job_status",
            ["planned", "scheduled", "running", "paused", "completed", "dispatched", "cancelled"],
        )
        _create_pg_enum("order_status", ["draft", "confirmed", "dispatched", "closed", "cancelled"])
        _create_pg_enum("run_status", ["running", "paused", "completed"])
        _create_pg_enum("qc_check_result", ["pass", "fail", "na"])
        _create_pg_enum("qc_source", ["manual", "sensor"])
        _create_pg_enum(
            "inventory_category",
            [
                "raw_material",
                "wip_extruded_roll",
                "wip_printed_roll",
                "finished_goods",
                "packaging_material",
                "scrap",
            ],
        )
        _create_pg_enum("dispatch_status", ["pending", "ready", "dispatched"])
        _create_pg_enum("tool_reservation_status", ["planned", "conflicted", "cancelled", "fulfilled"])
        _create_pg_enum(
            "job_qc_summary_status",
            ["draft", "final_pass", "final_fail", "final_pass_with_deviation"],
        )
        _create_pg_enum("machine_type", ["extruder", "printer_uteco", "converter_bagger"])
        _create_pg_enum(
            "sensor_type",
            ["temperature", "pressure", "speed", "humidity", "thickness", "other"],
        )
        _create_pg_enum("sensor_protocol", ["opcua", "modbus", "mqtt", "http", "file", "other"])
        _create_pg_enum("queue_status", ["queued", "running", "completed", "removed"])
        _create_pg_enum("printing_method", ["none", "inline", "uteco"])

    # Customers
    op.create_table(
        "customers",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("code", sa.String(length=4), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("abn", sa.String(length=50), nullable=True),
        sa.Column("tax_id", sa.String(length=50), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False, server_default=sa.text("'Active'")),
        sa.Column(
            "contacts",
            sa.JSON,
            nullable=False,
            # App stores contacts as {"items": [...]}
            server_default=sa.text("'{\"items\": []}'"),
        ),
        sa.Column(
            "delivery_addresses",
            sa.JSON,
            nullable=False,
            server_default=sa.text("'{\"items\": []}'"),
        ),
        sa.Column("delivery_preferences", sa.JSON, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("payment_terms", sa.String(length=255), nullable=True),
        sa.Column("credit_limit", sa.Numeric(18, 2), nullable=True),
        sa.Column(
            "currency_preference", sa.String(length=3), nullable=False, server_default=sa.text("'AUD'")
        ),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("internal_notes", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.CheckConstraint("length(code) BETWEEN 2 AND 4", name="ck_customers_code_len"),
        sa.UniqueConstraint("code", name="uq_customer_code"),
    )
    op.create_index("ix_customers_code", "customers", ["code"], unique=True)

    # Products
    op.create_table(
        "products",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("code", sa.String(length=32), nullable=False, unique=True),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column(
            "customer_id",
            sa.String(length=36),
            sa.ForeignKey("customers.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("active_version_id", sa.String(length=36), nullable=True),
        sa.Column("lifecycle_status", sa.String(length=50), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint("code", name="uq_product_code"),
    )
    op.create_index("ix_products_code", "products", ["code"], unique=True)
    op.create_index("ix_products_customer", "products", ["customer_id"], unique=False)

    # Product Versions
    op.create_table(
        "product_versions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "product_id",
            sa.String(length=36),
            sa.ForeignKey("products.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("version_number", sa.Integer, nullable=False),
        sa.Column("created_by", sa.String(length=100), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("spec_payload", sa.JSON, nullable=False),
        sa.UniqueConstraint("product_id", "version_number", name="uq_product_version"),
    )
    op.create_index("ix_product_versions_product", "product_versions", ["product_id"], unique=False)

    # products.active_version_id FK after product_versions exists
    if conn.dialect.name == "sqlite":
        with op.batch_alter_table("products", schema=None) as batch_op:
            batch_op.create_foreign_key(
                "fk_products_active_version",
                "product_versions",
                ["active_version_id"],
                ["id"],
                ondelete="RESTRICT",
            )
    else:
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
        sa.Column(
            "product_id",
            sa.String(length=36),
            sa.ForeignKey("products.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column(
            "product_version_id",
            sa.String(length=36),
            sa.ForeignKey("product_versions.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("category", sa.String(length=100), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=True),
        sa.Column("resolved_by", sa.String(length=100), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.String(length=100), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index("ix_operator_suggestions_product", "operator_suggestions", ["product_id"], unique=False)
    op.create_index(
        "ix_operator_suggestions_product_version",
        "operator_suggestions",
        ["product_version_id"],
        unique=False,
    )

    # Machines
    op.create_table(
        "machines",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("code", sa.String(length=32), nullable=False, unique=True),
        sa.Column("type", sa.Enum(name="machine_type", native_enum=False), nullable=False),
        sa.Column("capability", sa.JSON, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.text("TRUE")),
        sa.UniqueConstraint("code", name="uq_machine_code"),
    )
    op.create_index("ix_machines_code", "machines", ["code"], unique=True)

    # Orders
    op.create_table(
        "orders",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("code", sa.String(length=32), nullable=False, unique=True),
        sa.Column(
            "customer_id",
            sa.String(length=36),
            sa.ForeignKey("customers.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "product_version_id",
            sa.String(length=36),
            sa.ForeignKey("product_versions.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("quote_id", sa.String(length=36), nullable=True),
        sa.Column("status", sa.Enum(name="order_status", native_enum=False), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint("code", name="uq_order_code"),
    )
    op.create_index("ix_orders_code", "orders", ["code"], unique=True)
    op.create_index("ix_orders_customer", "orders", ["customer_id"], unique=False)
    op.create_index("ix_orders_product_version", "orders", ["product_version_id"], unique=False)

    # Order items (multi-product orders)
    op.create_table(
        "order_items",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "order_id",
            sa.String(length=36),
            sa.ForeignKey("orders.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "product_version_id",
            sa.String(length=36),
            sa.ForeignKey("product_versions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("quantity", sa.Numeric(18, 6), nullable=False),
        sa.UniqueConstraint("order_id", "product_version_id", name="uq_order_item_order_version"),
    )
    op.create_index("ix_order_items_order", "order_items", ["order_id"], unique=False)
    op.create_index("ix_order_items_version", "order_items", ["product_version_id"], unique=False)

    # Jobs (includes allocated_order_units)
    op.create_table(
        "jobs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "order_id",
            sa.String(length=36),
            sa.ForeignKey("orders.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("job_code", sa.Integer, nullable=False),
        sa.Column("run_index", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("planned_qty", sa.Numeric(18, 6), nullable=False),
        sa.Column("produced_qty", sa.Numeric(18, 6), nullable=False, server_default=sa.text("0")),
        sa.Column("allocated_order_units", sa.Numeric(18, 6), nullable=True),
        sa.Column("status", sa.Enum(name="job_status", native_enum=False), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint("order_id", "job_code", name="uq_job_order_jobcode"),
    )
    op.create_index("ix_jobs_order", "jobs", ["order_id"], unique=False)

    # Operation runs
    op.create_table(
        "operation_runs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "job_id",
            sa.String(length=36),
            sa.ForeignKey("jobs.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("operation_type", sa.Enum(name="operation_type", native_enum=False), nullable=False),
        sa.Column(
            "machine_id",
            sa.String(length=36),
            sa.ForeignKey("machines.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("status", sa.Enum(name="run_status", native_enum=False), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_operation_runs_job", "operation_runs", ["job_id"], unique=False)
    op.create_index("ix_operation_runs_machine", "operation_runs", ["machine_id"], unique=False)

    # Run outputs (append-only)
    op.create_table(
        "run_output_entries",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "run_id",
            sa.String(length=36),
            sa.ForeignKey("operation_runs.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("timestamp", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("quantity", sa.Numeric(18, 6), nullable=False),
        sa.Column("uom", sa.String(length=32), nullable=False),
        sa.Column("good_or_scrap", sa.Boolean, nullable=False),
        sa.Column("finished_goods", sa.Boolean, nullable=False, server_default=sa.text("FALSE")),
        sa.Column("note", sa.Text, nullable=True),
    )
    op.create_index("ix_run_output_entries_run", "run_output_entries", ["run_id"], unique=False)

    # Inventory items
    op.create_table(
        "inventory_items",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("category", sa.Enum(name="inventory_category", native_enum=False), nullable=False),
        sa.Column("uom", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.text("TRUE")),
    )

    # Inventory transactions (append-only ledger)
    op.create_table(
        "inventory_transactions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "item_id",
            sa.String(length=36),
            sa.ForeignKey("inventory_items.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("category", sa.Enum(name="inventory_category", native_enum=False), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 6), nullable=False),
        sa.Column("uom", sa.String(length=32), nullable=False),
        sa.Column(
            "job_id",
            sa.String(length=36),
            sa.ForeignKey("jobs.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column(
            "run_id",
            sa.String(length=36),
            sa.ForeignKey("operation_runs.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("reason", sa.String(length=255), nullable=True),
        sa.Column("created_by", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_inventory_tx_item", "inventory_transactions", ["item_id"], unique=False)
    op.create_index("ix_inventory_tx_job", "inventory_transactions", ["job_id"], unique=False)
    op.create_index("ix_inventory_tx_run", "inventory_transactions", ["run_id"], unique=False)

    # QC readings (sensor_id FK added after sensors table exists)
    op.create_table(
        "qc_readings",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "operation_run_id",
            sa.String(length=36),
            sa.ForeignKey("operation_runs.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("sensor_id", sa.String(length=36), nullable=True),
        sa.Column("check_type", sa.String(length=100), nullable=False),
        sa.Column("value", sa.JSON, nullable=False),
        sa.Column("result", sa.Enum(name="qc_check_result", native_enum=False), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column(
            "source",
            sa.Enum(name="qc_source", native_enum=False),
            nullable=False,
            server_default=sa.text("'sensor'"),
        ),
    )
    op.create_index("ix_qc_readings_run", "qc_readings", ["operation_run_id"], unique=False)
    op.create_index("ix_qc_readings_sensor", "qc_readings", ["sensor_id"], unique=False)

    # QC checks
    op.create_table(
        "qc_checks",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "operation_run_id",
            sa.String(length=36),
            sa.ForeignKey("operation_runs.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("check_type", sa.String(length=100), nullable=False),
        sa.Column("required", sa.Boolean, nullable=False, server_default=sa.text("TRUE")),
        sa.Column("result", sa.Enum(name="qc_check_result", native_enum=False), nullable=True),
        sa.Column("numeric_values", sa.JSON, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("measured_by", sa.String(length=100), nullable=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("source", sa.Enum(name="qc_source", native_enum=False), nullable=False),
        sa.Column(
            "reading_ref",
            sa.String(length=36),
            sa.ForeignKey("qc_readings.id", ondelete="RESTRICT"),
            nullable=True,
        ),
    )
    op.create_index("ix_qc_checks_run", "qc_checks", ["operation_run_id"], unique=False)

    # Job QC summaries
    op.create_table(
        "job_qc_summaries",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "job_id",
            sa.String(length=36),
            sa.ForeignKey("jobs.id", ondelete="RESTRICT"),
            nullable=False,
            unique=True,
        ),
        sa.Column("totals", sa.JSON, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("aggregates", sa.JSON, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("final_checklist", sa.JSON, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("deviations", sa.JSON, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("status", sa.Enum(name="job_qc_summary_status", native_enum=False), nullable=False),
        sa.Column("created_by", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("finalized_by", sa.String(length=100), nullable=True),
        sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("job_id", name="uq_job_qc_summary_job"),
    )
    op.create_index("ix_job_qc_summaries_job", "job_qc_summaries", ["job_id"], unique=True)

    # Dispatch records
    op.create_table(
        "dispatch_records",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "job_id",
            sa.String(length=36),
            sa.ForeignKey("jobs.id", ondelete="RESTRICT"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "order_id",
            sa.String(length=36),
            sa.ForeignKey("orders.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("dispatch_status", sa.Enum(name="dispatch_status", native_enum=False), nullable=False),
        sa.Column("packaging", sa.JSON, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("dispatch_metadata", sa.JSON, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("first_run_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("job_id", name="uq_dispatch_job"),
    )
    op.create_index("ix_dispatch_records_order", "dispatch_records", ["order_id"], unique=False)
    op.create_index("ix_dispatch_records_job", "dispatch_records", ["job_id"], unique=True)

    # Tool types
    op.create_table(
        "tool_types",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("code", sa.String(length=64), nullable=False, unique=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("icon_ref", sa.String(length=255), nullable=True),
        sa.Column("unique_per_machine", sa.Boolean, nullable=False, server_default=sa.text("FALSE")),
        sa.UniqueConstraint("code", name="uq_tool_type_code"),
    )
    op.create_index("ix_tool_types_code", "tool_types", ["code"], unique=True)

    # Tools
    op.create_table(
        "tools",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "tool_type_id",
            sa.String(length=36),
            sa.ForeignKey("tool_types.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("serial_code", sa.String(length=64), nullable=False, unique=True),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.text("TRUE")),
        sa.Column("notes", sa.Text, nullable=True),
        sa.UniqueConstraint("serial_code", name="uq_tool_serial"),
    )
    op.create_index("ix_tools_tool_type", "tools", ["tool_type_id"], unique=False)
    op.create_index("ix_tools_serial", "tools", ["serial_code"], unique=True)

    # Tool mounts (append-only)
    op.create_table(
        "tool_mounts",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "tool_id",
            sa.String(length=36),
            sa.ForeignKey("tools.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "machine_id",
            sa.String(length=36),
            sa.ForeignKey("machines.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("mounted_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("mounted_to", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("mounted_to IS NULL OR mounted_to >= mounted_from", name="ck_tool_mount_window"),
    )
    op.create_index("ix_tool_mounts_tool", "tool_mounts", ["tool_id"], unique=False)
    op.create_index("ix_tool_mounts_machine", "tool_mounts", ["machine_id"], unique=False)

    # Tool reservations
    op.create_table(
        "tool_reservations",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "tool_type_id",
            sa.String(length=36),
            sa.ForeignKey("tool_types.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "tool_id",
            sa.String(length=36),
            sa.ForeignKey("tools.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column(
            "machine_id",
            sa.String(length=36),
            sa.ForeignKey("machines.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("planned_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("planned_to", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.Enum(name="tool_reservation_status", native_enum=False), nullable=False),
        sa.Column(
            "job_id",
            sa.String(length=36),
            sa.ForeignKey("jobs.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("operation_type", sa.Enum(name="operation_type", native_enum=False), nullable=False),
        sa.CheckConstraint("planned_to >= planned_from", name="ck_tool_reservation_window"),
    )
    op.create_index("ix_tool_reservations_tool_type", "tool_reservations", ["tool_type_id"], unique=False)
    op.create_index("ix_tool_reservations_tool", "tool_reservations", ["tool_id"], unique=False)
    op.create_index(
        "ix_tool_reservations_machine", "tool_reservations", ["machine_id"], unique=False
    )
    op.create_index("ix_tool_reservations_job", "tool_reservations", ["job_id"], unique=False)

    # Sensors
    op.create_table(
        "sensors",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "machine_id",
            sa.String(length=36),
            sa.ForeignKey("machines.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("type", sa.Enum(name="sensor_type", native_enum=False), nullable=False),
        sa.Column("protocol", sa.Enum(name="sensor_protocol", native_enum=False), nullable=False),
        sa.Column("unit", sa.String(length=32), nullable=True),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.text("TRUE")),
        sa.Column("metadata", sa.JSON, nullable=False, server_default=sa.text("'{}'")),
    )
    op.create_index("ix_sensors_machine", "sensors", ["machine_id"], unique=False)

    # Sensor assignments
    op.create_table(
        "sensor_assignments",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "sensor_id",
            sa.String(length=36),
            sa.ForeignKey("sensors.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "machine_id",
            sa.String(length=36),
            sa.ForeignKey("machines.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("effective_to", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "effective_to IS NULL OR effective_to >= effective_from",
            name="ck_sensor_assignment_window",
        ),
    )
    op.create_index("ix_sensor_assignments_sensor", "sensor_assignments", ["sensor_id"], unique=False)
    op.create_index(
        "ix_sensor_assignments_machine", "sensor_assignments", ["machine_id"], unique=False
    )

    # Telemetry events
    op.create_table(
        "telemetry_events",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "sensor_id",
            sa.String(length=36),
            sa.ForeignKey("sensors.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "machine_id",
            sa.String(length=36),
            sa.ForeignKey("machines.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("value", sa.JSON, nullable=False),
        sa.Column("quality_flag", sa.String(length=32), nullable=True),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False, unique=True),
        sa.UniqueConstraint("idempotency_key", name="uq_telemetry_idempotency"),
    )
    op.create_index("ix_telemetry_events_sensor", "telemetry_events", ["sensor_id"], unique=False)
    op.create_index("ix_telemetry_events_machine", "telemetry_events", ["machine_id"], unique=False)

    # Add FK qc_readings.sensor_id -> sensors.id
    if conn.dialect.name == "sqlite":
        with op.batch_alter_table("qc_readings", schema=None) as batch_op:
            batch_op.create_foreign_key(
                "fk_qc_readings_sensor",
                "sensors",
                ["sensor_id"],
                ["id"],
                ondelete="RESTRICT",
            )
    else:
        op.create_foreign_key(
            "fk_qc_readings_sensor",
            "qc_readings",
            "sensors",
            ["sensor_id"],
            ["id"],
            ondelete="RESTRICT",
        )

    # Machine queue items
    op.create_table(
        "machine_queue_items",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "machine_id",
            sa.String(length=36),
            sa.ForeignKey("machines.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "job_id",
            sa.String(length=36),
            sa.ForeignKey("jobs.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("status", sa.Enum(name="queue_status", native_enum=False), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("machine_id", "position", name="uq_queue_machine_position"),
    )
    op.create_index("ix_queue_machine", "machine_queue_items", ["machine_id"], unique=False)
    op.create_index("ix_queue_job", "machine_queue_items", ["job_id"], unique=False)

    # Auth tables (schema only; roles/users seeding happens later)
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("username", sa.String(length=80), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    op.create_table(
        "roles",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("code", sa.String(length=32), nullable=False, unique=True),
    )
    op.create_index("ix_roles_code", "roles", ["code"], unique=True)

    op.create_table(
        "user_roles",
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("role_id", sa.Integer(), sa.ForeignKey("roles.id"), primary_key=True),
    )

    op.create_table(
        "sessions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("csrf_token", sa.String(length=64), nullable=False),
        sa.UniqueConstraint("user_id", "id", name="uq_user_session"),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])

    # Rate-card tables
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

    op.create_table(
        "additives",
        sa.Column("additive_code", sa.String(length=32), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("price_per_kg", sa.Numeric(12, 4), nullable=False),
        sa.Column("category", sa.String(length=64), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.CheckConstraint("price_per_kg >= 0", name="ck_additives_price_nonneg"),
    )

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

    op.create_table(
        "inks",
        sa.Column("ink_code", sa.String(length=32), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
    )

    op.create_table(
        "plates",
        sa.Column(
            "customer_id",
            sa.String(length=36),
            sa.ForeignKey("customers.id", ondelete="RESTRICT"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("plate_code", sa.String(length=32), primary_key=True, nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
    )
    op.create_index("ix_plates_customer_id", "plates", ["customer_id"])

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

    op.create_table(
        "waste_adders",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("condition", sa.Text, nullable=False, unique=True),
        sa.Column("waste_minutes", sa.Integer, nullable=False),
        sa.UniqueConstraint("condition", name="uq_waste_adders_condition"),
        sa.CheckConstraint("waste_minutes >= 0", name="ck_waste_minutes_nonneg"),
    )


def downgrade() -> None:
    conn = op.get_bind()

    # Rate cards
    op.drop_table("waste_adders")
    op.drop_table("conversion_rates")
    op.drop_table("printing_rates")
    op.drop_table("cores")
    op.drop_index("ix_plates_customer_id", table_name="plates")
    op.drop_table("plates")
    op.drop_table("inks")
    op.drop_table("colours")
    op.drop_table("additives")
    op.drop_table("resins")

    # Auth
    op.drop_index("ix_sessions_user_id", table_name="sessions")
    op.drop_table("sessions")
    op.drop_table("user_roles")
    op.drop_index("ix_roles_code", table_name="roles")
    op.drop_table("roles")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_table("users")

    # Scheduling
    op.drop_index("ix_queue_job", table_name="machine_queue_items")
    op.drop_index("ix_queue_machine", table_name="machine_queue_items")
    op.drop_table("machine_queue_items")

    # Telemetry + FK
    if conn.dialect.name == "sqlite":
        with op.batch_alter_table("qc_readings", schema=None) as batch_op:
            batch_op.drop_constraint("fk_qc_readings_sensor", type_="foreignkey")
    else:
        op.drop_constraint("fk_qc_readings_sensor", "qc_readings", type_="foreignkey")
    op.drop_index("ix_telemetry_events_machine", table_name="telemetry_events")
    op.drop_index("ix_telemetry_events_sensor", table_name="telemetry_events")
    op.drop_table("telemetry_events")
    op.drop_index("ix_sensor_assignments_machine", table_name="sensor_assignments")
    op.drop_index("ix_sensor_assignments_sensor", table_name="sensor_assignments")
    op.drop_table("sensor_assignments")
    op.drop_index("ix_sensors_machine", table_name="sensors")
    op.drop_table("sensors")

    # Tooling
    op.drop_index("ix_tool_reservations_job", table_name="tool_reservations")
    op.drop_index("ix_tool_reservations_machine", table_name="tool_reservations")
    op.drop_index("ix_tool_reservations_tool", table_name="tool_reservations")
    op.drop_index("ix_tool_reservations_tool_type", table_name="tool_reservations")
    op.drop_table("tool_reservations")
    op.drop_index("ix_tool_mounts_machine", table_name="tool_mounts")
    op.drop_index("ix_tool_mounts_tool", table_name="tool_mounts")
    op.drop_table("tool_mounts")
    op.drop_index("ix_tools_serial", table_name="tools")
    op.drop_index("ix_tools_tool_type", table_name="tools")
    op.drop_table("tools")
    op.drop_index("ix_tool_types_code", table_name="tool_types")
    op.drop_table("tool_types")

    # Dispatch
    op.drop_index("ix_dispatch_records_job", table_name="dispatch_records")
    op.drop_index("ix_dispatch_records_order", table_name="dispatch_records")
    op.drop_table("dispatch_records")

    # QC
    op.drop_index("ix_job_qc_summaries_job", table_name="job_qc_summaries")
    op.drop_table("job_qc_summaries")
    op.drop_index("ix_qc_checks_run", table_name="qc_checks")
    op.drop_table("qc_checks")
    op.drop_index("ix_qc_readings_sensor", table_name="qc_readings")
    op.drop_index("ix_qc_readings_run", table_name="qc_readings")
    op.drop_table("qc_readings")

    # Inventory
    op.drop_index("ix_inventory_tx_run", table_name="inventory_transactions")
    op.drop_index("ix_inventory_tx_job", table_name="inventory_transactions")
    op.drop_index("ix_inventory_tx_item", table_name="inventory_transactions")
    op.drop_table("inventory_transactions")
    op.drop_table("inventory_items")

    # Runs
    op.drop_index("ix_run_output_entries_run", table_name="run_output_entries")
    op.drop_table("run_output_entries")
    op.drop_index("ix_operation_runs_machine", table_name="operation_runs")
    op.drop_index("ix_operation_runs_job", table_name="operation_runs")
    op.drop_table("operation_runs")

    # Jobs/orders/machines
    op.drop_index("ix_jobs_order", table_name="jobs")
    op.drop_table("jobs")
    op.drop_index("ix_order_items_version", table_name="order_items")
    op.drop_index("ix_order_items_order", table_name="order_items")
    op.drop_table("order_items")
    op.drop_index("ix_orders_product_version", table_name="orders")
    op.drop_index("ix_orders_customer", table_name="orders")
    op.drop_index("ix_orders_code", table_name="orders")
    op.drop_table("orders")
    op.drop_index("ix_machines_code", table_name="machines")
    op.drop_table("machines")

    # Products
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

    # Customers
    op.drop_index("ix_customers_code", table_name="customers")
    op.drop_table("customers")

    # Drop enum types (PostgreSQL only)
    if _is_postgres(conn):
        for t in [
            "printing_method",
            "queue_status",
            "sensor_protocol",
            "sensor_type",
            "machine_type",
            "job_qc_summary_status",
            "tool_reservation_status",
            "dispatch_status",
            "inventory_category",
            "qc_source",
            "qc_check_result",
            "run_status",
            "order_status",
            "job_status",
            "operation_type",
        ]:
            op.execute(sa.text(f"DROP TYPE IF EXISTS {t}"))

