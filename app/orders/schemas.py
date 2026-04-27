from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import List, Optional

from app.job_sheets.schemas import QuantityUnit

from pydantic import BaseModel, Field


class CreateResellOrderLineRequest(BaseModel):
    resell_product_id: uuid.UUID
    quantity_value: Decimal = Field(gt=0)
    quantity_unit: str = Field(default="ea", max_length=16)
    due_date: Optional[date] = None
    rate: Optional[Decimal] = None
    total_price: Optional[Decimal] = None


class UpdateResellOrderLineRequest(BaseModel):
    quantity_value: Optional[Decimal] = Field(default=None, gt=0)
    quantity_unit: Optional[str] = Field(default=None, max_length=16)
    due_date: Optional[date] = None
    rate: Optional[Decimal] = None
    total_price: Optional[Decimal] = None


class CreateOrderItemRequest(BaseModel):
    product_id: uuid.UUID
    due_date: Optional[date] = None
    quantity_value: Decimal = Field(gt=0)
    quantity_unit: QuantityUnit
    rate: Optional[Decimal] = None  # unit rate (e.g. price per kg)
    total_price: Optional[Decimal] = None  # line total
    # Optional: copied to job sheet when creating from quote (matches job_sheets qty fields).
    qty_type: Optional[str] = None
    num_product_units: Optional[Decimal] = None
    weight_per_roll_kg: Optional[Decimal] = None
    num_rolls: Optional[int] = Field(default=None, ge=1)


class CreateOrderRequest(BaseModel):
    customer_id: uuid.UUID
    items: List[CreateOrderItemRequest] = []
    resell_items: List[CreateResellOrderLineRequest] = []
    quote_id: Optional[uuid.UUID] = None  # optional for MVP creation from approved quote
    # Orders are always created as DRAFT; publishing is a separate action.
    status: str = "draft"
    invoice_number: Optional[str] = None  # optional; if provided (non-empty) used as order code (e.g. MYOB/Xero invoice #)
    customer_purchase_order_number: Optional[str] = None
    order_date: Optional[date] = None  # editable; displayed instead of created_at when set


class CreateJobRequest(BaseModel):
    planned_qty: Decimal
    allocated_order_units: Optional[Decimal] = None


class JobDTO(BaseModel):
    id: uuid.UUID
    job_code: int
    planned_qty: Decimal
    produced_qty: Decimal
    allocated_order_units: Optional[Decimal] = None
    status: str


class UpdateOrderRequest(BaseModel):
    """Update order header (draft or confirmed)."""
    invoice_number: Optional[str] = None
    customer_purchase_order_number: Optional[str] = None
    order_date: Optional[date] = None


class LinkMyobImportLineRequest(BaseModel):
    job_sheet_id: uuid.UUID


class OrderListItemDTO(BaseModel):
    id: uuid.UUID
    code: str  # invoice number
    customer_purchase_order_number: Optional[str] = None
    status: str
    customer_id: uuid.UUID
    product_version_id: Optional[uuid.UUID] = None
    customer_name: Optional[str] = None
    product_code: Optional[str] = None
    version_number: Optional[int] = None
    item_count: int = 0
    order_total: Optional[float] = None
    created_at: Optional[str] = None
    order_date: Optional[str] = None  # display instead of created_at when set
    import_source: Optional[str] = None
    myob_order_uid: Optional[str] = None
    myob_synced_at: Optional[str] = None
    myob_all_job_sheets_entered: Optional[bool] = None
    # Manufactured-line summary for list-page "Products" text.
    manufactured_first_product_code: Optional[str] = None
    manufactured_other_line_count: int = 0
    # Resell line breakdown (line_kind == "resell" only; for list UX).
    resell_outsourced_line_count: int = 0
    resell_supply_line_count: int = 0


class OrderDetailDTO(OrderListItemDTO):
    jobs: List[JobDTO] = []
    items: list[dict] = []
    myob_import_lines: list[dict] = []


class OrderListResponse(BaseModel):
    items: List[OrderListItemDTO]
    total: int
    page: int
    page_size: int

