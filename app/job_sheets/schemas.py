from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.products.schemas import SpecPayload


QuantityUnit = Literal["kg", "rolls", "bags", "meters", "cartons"]
QtyType = Literal["kg", "units", "total_rolls"]


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


class JobSheetSummary(BaseModel):
    id: str
    job_no: str
    job_seq: int
    customer_id: str
    product_id: str
    product_version_id: str
    version_number: int
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
    customer_code: Optional[str] = None
    # From order when this job sheet is attached to an order line
    order_id: Optional[str] = None
    invoice_no: Optional[str] = None
    order_date: Optional[str] = None


class JobSheetDetail(BaseModel):
    job_sheet: JobSheetSummary
    spec_payload: dict


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

