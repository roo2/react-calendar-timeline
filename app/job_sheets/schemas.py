from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.products.schemas import SpecPayload


QuantityUnit = Literal["kg", "rolls", "bags", "meters"]


class JobSheetCreateRequest(BaseModel):
    customer_id: str
    product_id: str
    job_no: str = Field(..., min_length=1, max_length=64)
    due_date: Optional[date] = None
    quantity_value: float = Field(..., gt=0)
    quantity_unit: QuantityUnit
    spec: SpecPayload


class JobSheetSummary(BaseModel):
    id: str
    job_no: str
    customer_id: str
    product_id: str
    product_version_id: str
    version_number: int
    due_date: Optional[str] = None
    quantity_value: float
    quantity_unit: str
    created_by: str
    created_at: Optional[str] = None
    # Product summary fields (denormalized for listing UI)
    product_code: str
    product_description: Optional[str] = None
    customer_name: Optional[str] = None


class JobSheetDetail(BaseModel):
    job_sheet: JobSheetSummary
    spec_payload: dict

