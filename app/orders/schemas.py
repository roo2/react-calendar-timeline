from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import List, Optional

from app.job_sheets.schemas import QuantityUnit

from pydantic import BaseModel, Field


class CreateOrderItemRequest(BaseModel):
    product_id: uuid.UUID
    due_date: Optional[date] = None
    quantity_value: Decimal = Field(gt=0)
    quantity_unit: QuantityUnit


class CreateOrderRequest(BaseModel):
    customer_id: uuid.UUID
    items: List[CreateOrderItemRequest] = []
    currency: str = Field(min_length=3, max_length=3, default="AUD")
    quote_id: Optional[uuid.UUID] = None  # optional for MVP creation from approved quote
    # Orders are always created as DRAFT; publishing is a separate action.
    status: str = "draft"


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


class OrderListItemDTO(BaseModel):
    id: uuid.UUID
    code: str
    status: str
    customer_id: uuid.UUID
    product_version_id: Optional[uuid.UUID] = None
    currency: str
    customer_name: Optional[str] = None
    product_code: Optional[str] = None
    version_number: Optional[int] = None
    item_count: int = 0
    created_at: Optional[str] = None


class OrderDetailDTO(OrderListItemDTO):
    jobs: List[JobDTO] = []
    items: list[dict] = []

