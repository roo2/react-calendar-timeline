from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.db.models.enums import JobStatus
from app.products.schemas import SpecPayload


QuantityUnit = Literal["kg", "rolls", "bags", "meters", "cartons", "1000"]
QtyType = Literal["kg", "units", "total_rolls", "rolls_units"]


class JobSheetCreateRequest(BaseModel):
    customer_id: str
    product_id: str
    job_no: Optional[str] = None  # Assigned when job is queued; optional on create
    due_date: Optional[date] = None
    order_date: Optional[date] = None  # Stored on linked draft order when created
    quantity_value: float = Field(..., gt=0)
    quantity_unit: QuantityUnit
    qty_type: QtyType = "kg"
    num_product_units: Optional[float] = None
    weight_per_roll_kg: Optional[float] = None
    num_rolls: int = Field(..., ge=1, description="Roll count for scheduling (required for production Gantt).")
    spec: SpecPayload
    production_status: Optional[JobStatus] = None
    """Initial linked production `Job.status` after create (job row is ensured server-side)."""
    production_started_at: Optional[datetime] = None
    production_finished_at: Optional[datetime] = None
    customer_facing_description: Optional[str] = None
    """Short description shown to the customer; optional on create."""
    production_extruder_code: Optional[str] = Field(default=None, max_length=64)
    """Ratebook extruder code; stored on the linked ``Product`` (shared across job sheets)."""
    die_size: Optional[str] = None
    """Extrusion die on the extruder; stored on the linked ``Product``."""


class JobSheetSummary(BaseModel):
    id: str
    job_no: str
    job_seq: int
    customer_id: str
    product_id: str
    product_version_id: str
    version_number: int
    is_import_draft: bool = False
    """True when this sheet is a MYOB import placeholder (no production job yet)."""
    due_date: Optional[str] = None
    quantity_value: float
    quantity_unit: str
    qty_type: str = "kg"
    num_product_units: Optional[float] = None
    weight_per_roll_kg: Optional[float] = None
    num_rolls: int = 1
    created_by: str
    created_at: Optional[str] = None
    # Product summary fields (denormalized for listing UI)
    product_code: str
    product_description: Optional[str] = None
    customer_name: Optional[str] = None
    # From order when this job sheet is attached to an order line
    order_id: Optional[str] = None
    invoice_no: Optional[str] = None
    order_date: Optional[str] = None
    order_status: Optional[str] = None
    """Commercial order lifecycle (draft → confirmed → …). From linked Order when present."""
    production_status: Optional[str] = None
    """Manufacturing Job status for this line (planned → … → dispatched) when a Job row exists."""
    production_started_at: Optional[str] = None
    """When manufacturing entered the running state (first transition to `running`)."""
    production_finished_at: Optional[str] = None
    """When manufacturing ended (`dispatched` or `cancelled` after production started)."""
    status_label: Optional[str] = None
    """Single-line summary for lists: order + production."""
    unit_rate: Optional[float] = None
    line_total: Optional[float] = None
    price_per_kg: Optional[float] = None
    customer_facing_description: Optional[str] = None
    """Optional text override; when unset, UIs use import line (MYOB) / product spec."""
    production_extruder_code: Optional[str] = None
    """From linked product (same for all job sheets on that product)."""
    die_size: Optional[str] = None
    """From linked product."""


class JobSheetDetail(BaseModel):
    job_sheet: JobSheetSummary
    spec_payload: dict
    myob_import_line_description: Optional[str] = None
    """Original MYOB line description when this job sheet is linked from a MYOB import order line."""


class JobSheetUpdateRequest(BaseModel):
    """
    Partial update: omit qty_type / num_rolls / num_product_units / weight_per_roll_kg to leave
    existing job sheet values unchanged (e.g. order line save only sends quantity + pricing).
    quantity_value and quantity_unit are always required so the order line and job sheet stay aligned.
    """

    due_date: Optional[date] = None
    order_date: Optional[date] = None  # Updates linked order header
    quantity_value: float = Field(..., gt=0)
    quantity_unit: QuantityUnit
    qty_type: Optional[QtyType] = None
    num_product_units: Optional[float] = None
    weight_per_roll_kg: Optional[float] = None
    num_rolls: Optional[int] = Field(default=None, ge=1)
    # If provided, a new ProductVersion is created and the job sheet is updated
    # to reference it (and the product's active version is advanced).
    spec: Optional[SpecPayload] = None
    unit_rate: Optional[float] = None
    line_total: Optional[float] = None
    """When set, updates the linked production `Job.status` (job is created if missing)."""
    production_status: Optional[JobStatus] = None
    production_started_at: Optional[datetime] = None
    """Explicit start instant (UTC). Send `null` to clear. Applied after status-driven defaults."""
    production_finished_at: Optional[datetime] = None
    """Explicit finish instant (UTC). Send `null` to clear. Applied after status-driven defaults."""
    customer_facing_description: Optional[str] = None
    """Set or clear (send null / empty) the customer-facing description for this job sheet."""
    production_extruder_code: Optional[str] = Field(default=None, max_length=64)
    """Updates the linked ``Product`` (not the job sheet row)."""
    die_size: Optional[str] = None
    """Updates the linked ``Product``."""

