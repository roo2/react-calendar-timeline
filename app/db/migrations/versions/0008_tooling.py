from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0008_tooling"
down_revision = "0007_dispatch"
branch_labels = None
depends_on = None


def upgrade() -> None:
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
        sa.Column("tool_type_id", sa.String(length=36), sa.ForeignKey("tool_types.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("serial_code", sa.String(length=64), nullable=False, unique=True),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.text("TRUE")),
        sa.Column("notes", sa.Text, nullable=True),
        sa.UniqueConstraint("serial_code", name="uq_tool_serial"),
    )
    op.create_index("ix_tools_tool_type", "tools", ["tool_type_id"], unique=False)
    op.create_index("ix_tools_serial", "tools", ["serial_code"], unique=True)

    # Tool mounts (append-only history)
    op.create_table(
        "tool_mounts",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("tool_id", sa.String(length=36), sa.ForeignKey("tools.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("machine_id", sa.String(length=36), sa.ForeignKey("machines.id", ondelete="RESTRICT"), nullable=False),
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
        sa.Column("tool_type_id", sa.String(length=36), sa.ForeignKey("tool_types.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("tool_id", sa.String(length=36), sa.ForeignKey("tools.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("machine_id", sa.String(length=36), sa.ForeignKey("machines.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("planned_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("planned_to", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.Enum(name="tool_reservation_status", native_enum=False), nullable=False),
        sa.Column("job_id", sa.String(length=36), sa.ForeignKey("jobs.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("operation_type", sa.Enum(name="operation_type", native_enum=False), nullable=False),
        sa.CheckConstraint("planned_to >= planned_from", name="ck_tool_reservation_window"),
    )
    op.create_index("ix_tool_reservations_tool_type", "tool_reservations", ["tool_type_id"], unique=False)
    op.create_index("ix_tool_reservations_tool", "tool_reservations", ["tool_id"], unique=False)
    op.create_index("ix_tool_reservations_machine", "tool_reservations", ["machine_id"], unique=False)
    op.create_index("ix_tool_reservations_job", "tool_reservations", ["job_id"], unique=False)


def downgrade() -> None:
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


