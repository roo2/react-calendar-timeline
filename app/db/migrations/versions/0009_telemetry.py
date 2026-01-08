from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0009_telemetry"
down_revision = "0008_tooling"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Sensors (MVP+ optional)
    op.create_table(
        "sensors",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("machine_id", sa.String(length=36), sa.ForeignKey("machines.id", ondelete="RESTRICT"), nullable=False),
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
        sa.Column("sensor_id", sa.String(length=36), sa.ForeignKey("sensors.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("machine_id", sa.String(length=36), sa.ForeignKey("machines.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("effective_to", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("effective_to IS NULL OR effective_to >= effective_from", name="ck_sensor_assignment_window"),
    )
    op.create_index("ix_sensor_assignments_sensor", "sensor_assignments", ["sensor_id"], unique=False)
    op.create_index("ix_sensor_assignments_machine", "sensor_assignments", ["machine_id"], unique=False)

    # Telemetry events
    op.create_table(
        "telemetry_events",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("sensor_id", sa.String(length=36), sa.ForeignKey("sensors.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("machine_id", sa.String(length=36), sa.ForeignKey("machines.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("value", sa.JSON, nullable=False),
        sa.Column("quality_flag", sa.String(length=32), nullable=True),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False, unique=True),
        sa.UniqueConstraint("idempotency_key", name="uq_telemetry_idempotency"),
    )
    op.create_index("ix_telemetry_events_sensor", "telemetry_events", ["sensor_id"], unique=False)
    op.create_index("ix_telemetry_events_machine", "telemetry_events", ["machine_id"], unique=False)

    # Add FK from qc_readings.sensor_id to sensors now that sensors exist
    conn = op.get_bind()
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


def downgrade() -> None:
    conn = op.get_bind()
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


