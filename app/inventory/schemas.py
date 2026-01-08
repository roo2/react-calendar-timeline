from __future__ import annotations

from decimal import Decimal
from typing import Optional, Literal
from uuid import UUID

from pydantic import BaseModel, Field, validator

from app.db.models.enums import InventoryCategory


class ReceiveInventoryRequest(BaseModel):
    item_id: Optional[UUID] = None
    category: Literal["raw_material"] = "raw_material"
    quantity: Decimal = Field(..., gt=0)
    uom: str


class AdjustInventoryRequest(BaseModel):
    category: InventoryCategory
    quantity: Decimal  # signed; non-zero
    uom: str
    item_id: Optional[UUID] = None
    note: Optional[str] = None

    @validator("quantity")
    def quantity_non_zero(cls, v: Decimal) -> Decimal:
        if v == 0:
            raise ValueError("quantity must be non-zero")
        return v


class InventoryTransactionDTO(BaseModel):
    id: UUID
    category: InventoryCategory
    quantity: Decimal
    uom: str
    item_id: Optional[UUID] = None
    job_id: Optional[UUID] = None
    run_id: Optional[UUID] = None
    created_by: str
    created_at: str
    reason: Optional[str] = None


class InventorySnapshot(BaseModel):
    raw_kg: Decimal
    wip_extrusion_kg: Decimal
    wip_printing_kg: Decimal
    fg_units: Decimal


class TransactionFilters(BaseModel):
    category: Optional[InventoryCategory] = None
    item_id: Optional[UUID] = None
    job_id: Optional[UUID] = None
    run_id: Optional[UUID] = None
    created_from: Optional[str] = None  # ISO8601
    created_to: Optional[str] = None    # ISO8601
    page: int = 1
    page_size: int = 25



