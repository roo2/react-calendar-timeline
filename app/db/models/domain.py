from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
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
from app.db.models.rate_cards import Extruder
from app.db.models.sql_types import OrderStatusColumn
from app.db.models.enums import (
    DispatchStatus,
    InventoryCategory,
    JobQCSummaryStatus,
    JobStatus,
    MachineType,
    OperationType,
    OrderStatus,
    QCCheckResult,
    QCSource,
    QueueStatus,
    RunStatus,
    SensorProtocol,
    SensorType,
    ToolReservationStatus,
    enum_db_values,
)


# Core parties and products
class Brand(Base):
    """Commercial brand (e.g. Crown Pack vs Dolphin) for reporting and customer grouping."""

    __tablename__ = "brands"
    __table_args__ = (UniqueConstraint("code", name="uq_brands_code"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    code: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)

    customers: Mapped[list["Customer"]] = relationship(back_populates="brand")


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255))
    brand_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("brands.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Lower number = higher priority (e.g. from sales spreadsheet); optional.
    priority_rank: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    abn: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    contact_phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="Active")
    contacts: Mapped[dict] = mapped_column(JSON, default=dict)
    delivery_addresses: Mapped[dict] = mapped_column(JSON, default=dict)
    delivery_preferences: Mapped[dict] = mapped_column(JSON, default=dict)
    # MYOB-style: { "payment_is_due": str, "balance_due_date"?: int } (legacy rows may still have discount_date)
    payment_terms: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # MYOB AccountRight Contact/Customer (UID). Unique when set; used for idempotent one-way import.
    myob_customer_uid: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, unique=True, index=True)
    myob_display_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    myob_last_modified: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    myob_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # MYOB Notes field only; app-edited free-text stays in `notes`.
    myob_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    brand: Mapped[Optional["Brand"]] = relationship(back_populates="customers")
    products: Mapped[list["Product"]] = relationship(back_populates="customer")
    orders: Mapped[list["Order"]] = relationship(back_populates="customer")
    quotes: Mapped[list["SavedQuote"]] = relationship(back_populates="customer")


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
    qty_type: Mapped[str] = mapped_column(String(16), nullable=False, default="kg")
    num_product_units: Mapped[Optional[float]] = mapped_column(Numeric(18, 6), nullable=True)
    weight_per_roll_kg: Mapped[Optional[float]] = mapped_column(Numeric(18, 6), nullable=True)
    num_rolls: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    unit_rate: Mapped[Optional[float]] = mapped_column(Numeric(18, 6), nullable=True)
    line_total: Mapped[Optional[float]] = mapped_column(Numeric(18, 6), nullable=True)
    created_by: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())

    customer: Mapped["Customer"] = relationship()
    product: Mapped["Product"] = relationship()
    version: Mapped["ProductVersion"] = relationship()
    standalone_jobs: Mapped[list["Job"]] = relationship(
        back_populates="job_sheet", foreign_keys="Job.job_sheet_id"
    )


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
    type: Mapped[MachineType] = mapped_column(
        SAEnum(MachineType, name="machine_type", native_enum=False, values_callable=enum_db_values)
    )
    capability: Mapped[dict] = mapped_column(JSON, default=dict)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


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
    status: Mapped[OrderStatus] = mapped_column(OrderStatusColumn(), nullable=False)
    created_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())
    order_date: Mapped[Optional[str]] = mapped_column(Date, nullable=True)  # editable; display instead of created_at when set

    customer: Mapped["Customer"] = relationship(back_populates="orders")
    jobs: Mapped[list["Job"]] = relationship(back_populates="order", foreign_keys="Job.order_id")
    items: Mapped[list["OrderItem"]] = relationship(back_populates="order")
    resell_lines: Mapped[list["OrderResellLine"]] = relationship(back_populates="order")


class SavedQuote(Base):
    """Saved quote attached to a customer. Stores form payload + cost/price per kg; margin is recomputed on edit."""
    __tablename__ = "saved_quotes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id", ondelete="RESTRICT"), index=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)  # form state for re-hydration
    cost_per_kg: Mapped[Optional[float]] = mapped_column(Numeric(18, 10), nullable=True)
    price_per_kg: Mapped[Optional[float]] = mapped_column(Numeric(18, 10), nullable=True)
    created_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    customer: Mapped["Customer"] = relationship(back_populates="quotes")


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


class ResellProduct(Base):
    """Catalog of non-manufactured lines resold on orders (e.g. cores, pallets)."""

    __tablename__ = "resell_products"
    __table_args__ = (Index("ix_resell_products_active", "active"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    description: Mapped[str] = mapped_column(Text, nullable=False)
    unit_price: Mapped[float] = mapped_column(Numeric(18, 6), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), server_default=func.now())

    lines: Mapped[list["OrderResellLine"]] = relationship(back_populates="resell_product")


class OrderResellLine(Base):
    """Order line for a resell / supplies catalog item (no job sheet)."""

    __tablename__ = "order_resell_lines"
    __table_args__ = (Index("ix_order_resell_lines_order", "order_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"), index=True)
    resell_product_id: Mapped[str] = mapped_column(ForeignKey("resell_products.id", ondelete="RESTRICT"), nullable=False)
    description_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    quantity_value: Mapped[float] = mapped_column(Numeric(18, 6), nullable=False)
    quantity_unit: Mapped[str] = mapped_column(String(16), nullable=False, default="ea")
    unit_rate: Mapped[Optional[float]] = mapped_column(Numeric(18, 6), nullable=True)
    line_total: Mapped[Optional[float]] = mapped_column(Numeric(18, 6), nullable=True)
    due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    order: Mapped["Order"] = relationship(back_populates="resell_lines")
    resell_product: Mapped["ResellProduct"] = relationship(back_populates="lines")


class Job(Base):
    """Manufacturing job. Either tied to an order line (order_id + job_code) or standalone (job_sheet_id only)."""

    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    order_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("orders.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    job_sheet_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("job_sheets.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    job_code: Mapped[int] = mapped_column(Integer)
    run_index: Mapped[int] = mapped_column(Integer, default=0)
    planned_qty: Mapped[float] = mapped_column(Numeric(18, 6))
    produced_qty: Mapped[float] = mapped_column(Numeric(18, 6), default=0)
    allocated_order_units: Mapped[Optional[float]] = mapped_column(Numeric(18, 6), nullable=True)
    # Gantt chain: operating-hours delta from extrusion scheduled start → downstream queue starts (persisted).
    schedule_chain_uteco_offset_operating_hours: Mapped[Optional[float]] = mapped_column(
        Numeric(18, 6), nullable=True
    )
    schedule_chain_bagging_offset_operating_hours: Mapped[Optional[float]] = mapped_column(
        Numeric(18, 6), nullable=True
    )
    status: Mapped[JobStatus] = mapped_column(
        SAEnum(JobStatus, name="job_status", native_enum=False, values_callable=enum_db_values)
    )
    production_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    production_finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())

    order: Mapped[Optional["Order"]] = relationship(back_populates="jobs", foreign_keys=[order_id])
    job_sheet: Mapped[Optional["JobSheet"]] = relationship(
        back_populates="standalone_jobs", foreign_keys=[job_sheet_id]
    )
    runs: Mapped[list["OperationRun"]] = relationship(back_populates="job")


class OperationRun(Base):
    __tablename__ = "operation_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="RESTRICT"), index=True)
    operation_type: Mapped[OperationType] = mapped_column(
        SAEnum(OperationType, name="operation_type", native_enum=False, values_callable=enum_db_values)
    )
    # Exactly one lane target should be set per run (extrusion rate card vs Uteco printer vs bagging machine).
    extruder_code: Mapped[Optional[str]] = mapped_column(
        ForeignKey("extruders.extruder_code", ondelete="RESTRICT"), nullable=True, index=True
    )
    uteco_printer_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("uteco_printers.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    bagging_machine_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("bagging_machines.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    status: Mapped[RunStatus] = mapped_column(
        SAEnum(RunStatus, name="run_status", native_enum=False, values_callable=enum_db_values)
    )
    started_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), nullable=True)

    job: Mapped["Job"] = relationship(back_populates="runs")
    extruder: Mapped[Optional["Extruder"]] = relationship(foreign_keys=[extruder_code])
    uteco_printer: Mapped[Optional["UtecoPrinter"]] = relationship(foreign_keys=[uteco_printer_id])
    bagging_machine: Mapped[Optional["BaggingMachine"]] = relationship(foreign_keys=[bagging_machine_id])
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


# Scheduling lanes (extrusion uses rate-card extruders; Uteco / bagging have dedicated tables)
class UtecoPrinter(Base):
    __tablename__ = "uteco_printers"
    __table_args__ = (UniqueConstraint("code", name="uq_uteco_printers_code"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    capability: Mapped[dict] = mapped_column(JSON, default=dict)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class BaggingMachine(Base):
    __tablename__ = "bagging_machines"
    __table_args__ = (UniqueConstraint("code", name="uq_bagging_machines_code"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    capability: Mapped[dict] = mapped_column(JSON, default=dict)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class ExtrusionQueueItem(Base):
    __tablename__ = "extrusion_queue_items"
    __table_args__ = (
        UniqueConstraint("extruder_code", "position", name="uq_extrusion_queue_lane_position"),
        Index("ix_extrusion_queue_extruder", "extruder_code"),
        Index("ix_extrusion_queue_job", "job_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    extruder_code: Mapped[str] = mapped_column(
        ForeignKey("extruders.extruder_code", ondelete="RESTRICT"), index=True
    )
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="RESTRICT"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    status: Mapped[QueueStatus] = mapped_column(
        SAEnum(QueueStatus, name="queue_status", native_enum=False, values_callable=enum_db_values)
    )
    operating_hours_lead_before: Mapped[float] = mapped_column(Numeric(14, 4), default=0, server_default="0")
    scheduled_start_utc: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())

    extruder: Mapped["Extruder"] = relationship(back_populates="extrusion_queue_items", foreign_keys=[extruder_code])


class UtecoQueueItem(Base):
    __tablename__ = "uteco_queue_items"
    __table_args__ = (
        UniqueConstraint("uteco_printer_id", "position", name="uq_uteco_queue_lane_position"),
        Index("ix_uteco_queue_printer", "uteco_printer_id"),
        Index("ix_uteco_queue_job", "job_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    uteco_printer_id: Mapped[str] = mapped_column(ForeignKey("uteco_printers.id", ondelete="RESTRICT"), index=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="RESTRICT"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    status: Mapped[QueueStatus] = mapped_column(
        SAEnum(QueueStatus, name="queue_status", native_enum=False, values_callable=enum_db_values)
    )
    operating_hours_lead_before: Mapped[float] = mapped_column(Numeric(14, 4), default=0, server_default="0")
    scheduled_start_utc: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())

    uteco_printer: Mapped["UtecoPrinter"] = relationship(foreign_keys=[uteco_printer_id])


class BaggingQueueItem(Base):
    __tablename__ = "bagging_queue_items"
    __table_args__ = (
        UniqueConstraint("bagging_machine_id", "position", name="uq_bagging_queue_lane_position"),
        Index("ix_bagging_queue_machine", "bagging_machine_id"),
        Index("ix_bagging_queue_job", "job_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    bagging_machine_id: Mapped[str] = mapped_column(ForeignKey("bagging_machines.id", ondelete="RESTRICT"), index=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="RESTRICT"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    status: Mapped[QueueStatus] = mapped_column(
        SAEnum(QueueStatus, name="queue_status", native_enum=False, values_callable=enum_db_values)
    )
    operating_hours_lead_before: Mapped[float] = mapped_column(Numeric(14, 4), default=0, server_default="0")
    scheduled_start_utc: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())

    bagging_machine: Mapped["BaggingMachine"] = relationship(foreign_keys=[bagging_machine_id])


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
    result: Mapped[QCCheckResult] = mapped_column(
        SAEnum(QCCheckResult, name="qc_check_result", native_enum=False, values_callable=enum_db_values)
    )
    recorded_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())
    source: Mapped[QCSource] = mapped_column(
        SAEnum(QCSource, name="qc_source", native_enum=False, values_callable=enum_db_values),
        default=QCSource.SENSOR,
    )


class QCCheck(Base):
    __tablename__ = "qc_checks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    operation_run_id: Mapped[str] = mapped_column(
        ForeignKey("operation_runs.id", ondelete="RESTRICT"), index=True
    )
    check_type: Mapped[str] = mapped_column(String(100))
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    result: Mapped[Optional[QCCheckResult]] = mapped_column(
        SAEnum(QCCheckResult, name="qc_check_result", native_enum=False, values_callable=enum_db_values),
        nullable=True,
    )
    numeric_values: Mapped[dict] = mapped_column(JSON, default=dict)
    measured_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    timestamp: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())
    source: Mapped[QCSource] = mapped_column(
        SAEnum(QCSource, name="qc_source", native_enum=False, values_callable=enum_db_values)
    )
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
        SAEnum(JobQCSummaryStatus, name="job_qc_summary_status", native_enum=False, values_callable=enum_db_values)
    )
    created_by: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finalized_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    finalized_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), nullable=True)


# Inventory
class InventoryItem(Base):
    __tablename__ = "inventory_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    category: Mapped[InventoryCategory] = mapped_column(
        SAEnum(InventoryCategory, name="inventory_category", native_enum=False, values_callable=enum_db_values)
    )
    uom: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(255))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class InventoryTransaction(Base):
    __tablename__ = "inventory_transactions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    item_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("inventory_items.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    category: Mapped[InventoryCategory] = mapped_column(
        SAEnum(InventoryCategory, name="inventory_category", native_enum=False, values_callable=enum_db_values)
    )
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
    dispatch_status: Mapped[DispatchStatus] = mapped_column(
        SAEnum(DispatchStatus, name="dispatch_status", native_enum=False, values_callable=enum_db_values)
    )
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
    extruder_code: Mapped[str] = mapped_column(
        ForeignKey("extruders.extruder_code", ondelete="RESTRICT"), index=True
    )
    mounted_from: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True))
    mounted_to: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("mounted_to IS NULL OR mounted_to >= mounted_from", name="ck_tool_mount_window"),
    )

    extruder: Mapped["Extruder"] = relationship(foreign_keys=[extruder_code])


class ToolReservation(Base):
    __tablename__ = "tool_reservations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tool_type_id: Mapped[str] = mapped_column(ForeignKey("tool_types.id", ondelete="RESTRICT"), index=True)
    tool_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("tools.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    extruder_code: Mapped[Optional[str]] = mapped_column(
        ForeignKey("extruders.extruder_code", ondelete="RESTRICT"), nullable=True, index=True
    )
    uteco_printer_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("uteco_printers.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    bagging_machine_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("bagging_machines.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    planned_from: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True))
    planned_to: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True))
    status: Mapped[ToolReservationStatus] = mapped_column(
        SAEnum(
            ToolReservationStatus,
            name="tool_reservation_status",
            native_enum=False,
            values_callable=enum_db_values,
        ),
        default=ToolReservationStatus.PLANNED,
    )
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="RESTRICT"), index=True)
    operation_type: Mapped[OperationType] = mapped_column(
        SAEnum(OperationType, name="operation_type", native_enum=False, values_callable=enum_db_values)
    )

    __table_args__ = (
        CheckConstraint("planned_to >= planned_from", name="ck_tool_reservation_window"),
    )

    extruder: Mapped[Optional["Extruder"]] = relationship(foreign_keys=[extruder_code])
    uteco_printer: Mapped[Optional["UtecoPrinter"]] = relationship(foreign_keys=[uteco_printer_id])
    bagging_machine: Mapped[Optional["BaggingMachine"]] = relationship(foreign_keys=[bagging_machine_id])


# MVP+ Sensors/Telemetry
class Sensor(Base):
    __tablename__ = "sensors"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    machine_id: Mapped[str] = mapped_column(ForeignKey("machines.id", ondelete="RESTRICT"), index=True)
    type: Mapped[SensorType] = mapped_column(
        SAEnum(SensorType, name="sensor_type", native_enum=False, values_callable=enum_db_values)
    )
    protocol: Mapped[SensorProtocol] = mapped_column(
        SAEnum(SensorProtocol, name="sensor_protocol", native_enum=False, values_callable=enum_db_values)
    )
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


class ProductionOperatingSettings(Base):
    """Singleton (id=1): default weekly hours + timezone for Gantt / scheduling."""

    __tablename__ = "production_operating_settings"
    __table_args__ = (CheckConstraint("id = 1", name="ck_production_operating_settings_singleton"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False, default=1)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Australia/Brisbane")
    gantt_preview_weeks: Mapped[int] = mapped_column(Integer, nullable=False, default=26)
    week_json: Mapped[dict] = mapped_column(JSON, nullable=False)


class ProductionCalendarException(Base):
    """Per-date overrides: public holiday (closed), early close, late open."""

    __tablename__ = "production_calendar_exceptions"
    __table_args__ = (UniqueConstraint("exception_date", name="uq_production_calendar_exception_date"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    exception_date: Mapped[date] = mapped_column(Date, nullable=False)
    closed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    open_time: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    close_time: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)


class MyobOAuthState(Base):
    """Short-lived CSRF/state token for the MYOB OAuth authorize redirect."""

    __tablename__ = "myob_oauth_states"

    state: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[Optional[str]] = mapped_column(
        DateTime(timezone=True),
        server_default=func.current_timestamp(),
    )
    expires_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False)


class MyobConnection(Base):
    """Singleton (id=1): stored MYOB OAuth tokens for the tenant."""

    __tablename__ = "myob_connection"
    __table_args__ = (CheckConstraint("id = 1", name="ck_myob_connection_singleton"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False, default=1)
    refresh_token: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    access_token: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    access_token_expires_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), nullable=True)
    business_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    scope: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    myob_user_uid: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    myob_username: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    last_refreshed_at: Mapped[Optional[str]] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[Optional[str]] = mapped_column(
        DateTime(timezone=True),
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
    )


