from __future__ import annotations

import uuid
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field


class CreateOrderRequest(BaseModel):
    customer_id: uuid.UUID
    product_version_id: uuid.UUID
    currency: str = Field(min_length=3, max_length=3, default="AUD")
    quote_id: Optional[uuid.UUID] = None  # optional for MVP creation from approved quote
    status: str = "draft"  # default; PM may confirm later


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
    product_version_id: uuid.UUID
    currency: str
    customer_name: Optional[str] = None
    product_code: Optional[str] = None
    version_number: Optional[int] = None
    created_at: Optional[str] = None


class OrderDetailDTO(OrderListItemDTO):
    jobs: List[JobDTO] = []

