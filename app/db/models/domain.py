from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Index,
)
from sqlalchemy import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.models import Base
from app.db.models.enums import (
    DispatchStatus,
    InventoryCategory,
    JobQCSummaryStatus,
    JobStatus,
    QueueStatus,
    MachineType,
    OperationType,
    OrderStatus,
    QCCheckResult,
    QCSource,
    RunStatus,
    SensorProtocol,
    SensorType,
    ToolReservationStatus,
)


# Core parties and products
class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    # 2-4 letter customer code used for job sheet numbering (manual entry).
    code: Mapped[str] = mapped_column(String(4), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    abn: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    tax_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="Active")
    contacts: Mapped[dict] = mapped_column(JSON, default=dict)
    delivery_addresses: Mapped[dict] = mapped_column(JSON, default=dict)
    delivery_preferences: Mapped[dict] = mapped_column(JSON, default=dict)
    payment_terms: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    credit_limit: Mapped[Optional[float]] = mapped_column(Numeric(18, 2), nullable=True)
    currency_preference: Mapped[str] = mapped_column(String(3), default="AUD")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    internal_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())

    products: Mapped[list["Product"]] = relationship(back_populates="customer")
    orders: Mapped[list["Order"]] = relationship(back_populates="customer")


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (UniqueConstraint("code", name="uq_product_code"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    description: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id", ondelete="RESTRICT"), index=True)
    active_version_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("product_versions.id", ondelete="RESTRICT"), nullable=True
    )
    created_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())

    customer: Mapped["Customer"] = relationship(back_populates="products")
    versions: Mapped[list["ProductVersion"]] = relationship(
        "ProductVersion", foreign_keys="[ProductVersion.product_id]", back_populates="product"
    )
    active_version: Mapped[Optional["ProductVersion"]] = relationship(
        foreign_keys=[active_version_id], viewonly=True
    )


class ProductVersion(Base):
    __tablename__ = "product_versions"
    __table_args__ = (UniqueConstraint("product_id", "version_number", name="uq_product_version"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), index=True)
    version_number: Mapped[int] = mapped_column(Integer)
    created_by: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())
    spec_payload: Mapped[dict] = mapped_column(JSON)

    product: Mapped["Product"] = relationship(
        "Product", foreign_keys="[ProductVersion.product_id]", back_populates="versions"
    )


class JobSheet(Base):
    __tablename__ = "job_sheets"
    __table_args__ = (
        UniqueConstraint("job_no", name="uq_job_sheets_job_no"),
        UniqueConstraint("customer_id", "job_seq", name="uq_job_sheets_customer_seq"),
        Index("ix_job_sheets_customer", "customer_id"),
        Index("ix_job_sheets_product", "product_id"),
        Index("ix_job_sheets_due_date", "due_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    job_no: Mapped[str] = mapped_column(String(64), nullable=False)
    job_seq: Mapped[int] = mapped_column(Integer, nullable=False)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), nullable=False)
    product_version_id: Mapped[str] = mapped_column(ForeignKey("product_versions.id", ondelete="RESTRICT"), nullable=False)
    due_date: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), nullable=True)
    quantity_value: Mapped[float] = mapped_column(Numeric(18, 6), nullable=False)
    quantity_unit: Mapped[str] = mapped_column(String(16), nullable=False)
    created_by: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())

    customer: Mapped["Customer"] = relationship()
    product: Mapped["Product"] = relationship()
    version: Mapped["ProductVersion"] = relationship()


class OperatorSuggestion(Base):
    __tablename__ = "operator_suggestions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    product_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    product_version_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("product_versions.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    text: Mapped[str] = mapped_column(Text)
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    resolved_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    resolved_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())


# Machines and orders/jobs
class Machine(Base):
    __tablename__ = "machines"
    __table_args__ = (UniqueConstraint("code", name="uq_machine_code"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    type: Mapped[MachineType] = mapped_column(SAEnum(MachineType, name="machine_type"))
    capability: Mapped[dict] = mapped_column(JSON, default=dict)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    runs: Mapped[list["OperationRun"]] = relationship(back_populates="machine")


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (UniqueConstraint("code", name="uq_order_code"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id", ondelete="RESTRICT"), index=True)
    # Deprecated in favor of OrderItem rows (kept for backward compatibility)
    product_version_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("product_versions.id", ondelete="RESTRICT"), index=True, nullable=True
    )
    quote_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    status: Mapped[OrderStatus] = mapped_column(SAEnum(OrderStatus, name="order_status"))
    created_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())

    customer: Mapped["Customer"] = relationship(back_populates="orders")
    jobs: Mapped[list["Job"]] = relationship(back_populates="order")
    items: Mapped[list["OrderItem"]] = relationship(back_populates="order")


class OrderItem(Base):
    __tablename__ = "order_items"
    __table_args__ = (
        UniqueConstraint("order_id", "job_sheet_id", name="uq_order_item_order_job_sheet"),
        Index("ix_order_items_order", "order_id"),
        Index("ix_order_items_job_sheet", "job_sheet_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"), index=True)
    job_sheet_id: Mapped[str] = mapped_column(ForeignKey("job_sheets.id", ondelete="RESTRICT"), index=True)

    order: Mapped["Order"] = relationship(back_populates="items")


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (UniqueConstraint("order_id", "job_code", name="uq_job_order_jobcode"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"), index=True)
    job_code: Mapped[int] = mapped_column(Integer)
    run_index: Mapped[int] = mapped_column(Integer, default=0)
    planned_qty: Mapped[float] = mapped_column(Numeric(18, 6))
    produced_qty: Mapped[float] = mapped_column(Numeric(18, 6), default=0)
    allocated_order_units: Mapped[Optional[float]] = mapped_column(Numeric(18, 6), nullable=True)
    status: Mapped[JobStatus] = mapped_column(SAEnum(JobStatus, name="job_status"))
    created_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())

    order: Mapped["Order"] = relationship(back_populates="jobs")
    runs: Mapped[list["OperationRun"]] = relationship(back_populates="job")

    __table_args__ = (
        UniqueConstraint("order_id", "job_code", name="uq_job_order_jobcode"),
        Index("ix_job_order", "order_id"),
    )


class OperationRun(Base):
    __tablename__ = "operation_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="RESTRICT"), index=True)
    operation_type: Mapped[OperationType] = mapped_column(SAEnum(OperationType, name="operation_type"))
    machine_id: Mapped[str] = mapped_column(ForeignKey("machines.id", ondelete="RESTRICT"), index=True)
    status: Mapped[RunStatus] = mapped_column(SAEnum(RunStatus, name="run_status"))
    started_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), nullable=True)

    job: Mapped["Job"] = relationship(back_populates="runs")
    machine: Mapped["Machine"] = relationship(back_populates="runs")
    outputs: Mapped[list["RunOutputEntry"]] = relationship(back_populates="run")


class RunOutputEntry(Base):
    __tablename__ = "run_output_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id: Mapped[str] = mapped_column(ForeignKey("operation_runs.id", ondelete="RESTRICT"), index=True)
    timestamp: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())
    quantity: Mapped[float] = mapped_column(Numeric(18, 6))
    uom: Mapped[str] = mapped_column(String(32))
    good_or_scrap: Mapped[bool] = mapped_column(Boolean)
    finished_goods: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    run: Mapped["OperationRun"] = relationship(back_populates="outputs")


# Scheduling queue
class MachineQueueItem(Base):
    __tablename__ = "machine_queue_items"
    __table_args__ = (
        UniqueConstraint("machine_id", "position", name="uq_queue_machine_position"),
        Index("ix_queue_machine", "machine_id"),
        Index("ix_queue_job", "job_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    machine_id: Mapped[str] = mapped_column(ForeignKey("machines.id", ondelete="RESTRICT"), index=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="RESTRICT"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    status: Mapped[QueueStatus] = mapped_column(SAEnum(QueueStatus, name="queue_status"))
    created_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())


# QC evidence
class QCReading(Base):
    __tablename__ = "qc_readings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    operation_run_id: Mapped[str] = mapped_column(
        ForeignKey("operation_runs.id", ondelete="RESTRICT"), index=True
    )
    sensor_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    check_type: Mapped[str] = mapped_column(String(100))
    value: Mapped[dict] = mapped_column(JSON)
    result: Mapped[QCCheckResult] = mapped_column(SAEnum(QCCheckResult, name="qc_check_result"))
    recorded_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())
    source: Mapped[QCSource] = mapped_column(SAEnum(QCSource, name="qc_source"), default=QCSource.SENSOR)


class QCCheck(Base):
    __tablename__ = "qc_checks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    operation_run_id: Mapped[str] = mapped_column(
        ForeignKey("operation_runs.id", ondelete="RESTRICT"), index=True
    )
    check_type: Mapped[str] = mapped_column(String(100))
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    result: Mapped[Optional[QCCheckResult]] = mapped_column(
        SAEnum(QCCheckResult, name="qc_check_result"), nullable=True
    )
    numeric_values: Mapped[dict] = mapped_column(JSON, default=dict)
    measured_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    timestamp: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())
    source: Mapped[QCSource] = mapped_column(SAEnum(QCSource, name="qc_source"))
    reading_ref: Mapped[Optional[str]] = mapped_column(
        ForeignKey("qc_readings.id", ondelete="RESTRICT"), nullable=True
    )


class JobQCSummary(Base):
    __tablename__ = "job_qc_summaries"
    __table_args__ = (UniqueConstraint("job_id", name="uq_job_qc_summary_job"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="RESTRICT"), index=True, unique=True)
    totals: Mapped[dict] = mapped_column(JSON, default=dict)
    aggregates: Mapped[dict] = mapped_column(JSON, default=dict)
    final_checklist: Mapped[dict] = mapped_column(JSON, default=dict)
    deviations: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[JobQCSummaryStatus] = mapped_column(
        SAEnum(JobQCSummaryStatus, name="job_qc_summary_status")
    )
    created_by: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finalized_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    finalized_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), nullable=True)


# Inventory
class InventoryItem(Base):
    __tablename__ = "inventory_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    category: Mapped[InventoryCategory] = mapped_column(SAEnum(InventoryCategory, name="inventory_category"))
    uom: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(255))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class InventoryTransaction(Base):
    __tablename__ = "inventory_transactions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    item_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("inventory_items.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    category: Mapped[InventoryCategory] = mapped_column(SAEnum(InventoryCategory, name="inventory_category"))
    quantity: Mapped[float] = mapped_column(Numeric(18, 6))
    uom: Mapped[str] = mapped_column(String(32))
    job_id: Mapped[Optional[str]] = mapped_column(ForeignKey("jobs.id", ondelete="RESTRICT"), nullable=True)
    run_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("operation_runs.id", ondelete="RESTRICT"), nullable=True
    )
    reason: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_by: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())


# Dispatch
class DispatchRecord(Base):
    __tablename__ = "dispatch_records"
    __table_args__ = (UniqueConstraint("job_id", name="uq_dispatch_job"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="RESTRICT"), unique=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"), index=True)
    dispatch_status: Mapped[DispatchStatus] = mapped_column(SAEnum(DispatchStatus, name="dispatch_status"))
    packaging: Mapped[dict] = mapped_column(JSON, default=dict)
    dispatch_metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())
    first_run_started_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_run_completed_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), nullable=True)
    dispatched_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), nullable=True)


# Tooling
class ToolType(Base):
    __tablename__ = "tool_types"
    __table_args__ = (UniqueConstraint("code", name="uq_tool_type_code"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    icon_ref: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    unique_per_machine: Mapped[bool] = mapped_column(Boolean, default=False)


class Tool(Base):
    __tablename__ = "tools"
    __table_args__ = (UniqueConstraint("serial_code", name="uq_tool_serial"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tool_type_id: Mapped[str] = mapped_column(ForeignKey("tool_types.id", ondelete="RESTRICT"), index=True)
    serial_code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class ToolMount(Base):
    __tablename__ = "tool_mounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tool_id: Mapped[str] = mapped_column(ForeignKey("tools.id", ondelete="RESTRICT"), index=True)
    machine_id: Mapped[str] = mapped_column(ForeignKey("machines.id", ondelete="RESTRICT"), index=True)
    mounted_from: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True))
    mounted_to: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("mounted_to IS NULL OR mounted_to >= mounted_from", name="ck_tool_mount_window"),
    )


class ToolReservation(Base):
    __tablename__ = "tool_reservations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tool_type_id: Mapped[str] = mapped_column(ForeignKey("tool_types.id", ondelete="RESTRICT"), index=True)
    tool_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("tools.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    machine_id: Mapped[str] = mapped_column(ForeignKey("machines.id", ondelete="RESTRICT"), index=True)
    planned_from: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True))
    planned_to: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True))
    status: Mapped[ToolReservationStatus] = mapped_column(
        SAEnum(ToolReservationStatus, name="tool_reservation_status"), default=ToolReservationStatus.PLANNED
    )
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="RESTRICT"), index=True)
    operation_type: Mapped[OperationType] = mapped_column(SAEnum(OperationType, name="operation_type"))

    __table_args__ = (
        CheckConstraint("planned_to >= planned_from", name="ck_tool_reservation_window"),
    )


# MVP+ Sensors/Telemetry
class Sensor(Base):
    __tablename__ = "sensors"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    machine_id: Mapped[str] = mapped_column(ForeignKey("machines.id", ondelete="RESTRICT"), index=True)
    type: Mapped[SensorType] = mapped_column(SAEnum(SensorType, name="sensor_type"))
    protocol: Mapped[SensorProtocol] = mapped_column(SAEnum(SensorProtocol, name="sensor_protocol"))
    unit: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sensor_metadata: Mapped[dict] = mapped_column(JSON, default=dict)


class SensorAssignment(Base):
    __tablename__ = "sensor_assignments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    sensor_id: Mapped[str] = mapped_column(ForeignKey("sensors.id", ondelete="RESTRICT"), index=True)
    machine_id: Mapped[str] = mapped_column(ForeignKey("machines.id", ondelete="RESTRICT"), index=True)
    effective_from: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True))
    effective_to: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("effective_to IS NULL OR effective_to >= effective_from", name="ck_sensor_assignment_window"),
    )


class TelemetryEvent(Base):
    __tablename__ = "telemetry_events"
    __table_args__ = (UniqueConstraint("idempotency_key", name="uq_telemetry_idempotency"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    sensor_id: Mapped[str] = mapped_column(String(36), ForeignKey("sensors.id", ondelete="RESTRICT"), index=True)
    machine_id: Mapped[str] = mapped_column(String(36), ForeignKey("machines.id", ondelete="RESTRICT"), index=True)
    recorded_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())
    value: Mapped[dict] = mapped_column(JSON)
    quality_flag: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True, index=True)


