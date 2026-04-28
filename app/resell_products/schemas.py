from __future__ import annotations

from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


class ResellProductDTO(BaseModel):
    id: str
    description: str
    unit_price: Decimal
    default_quantity_unit: Optional[str] = None
    active: bool = True
    catalog_kind: str = "supply"
    customer_id: Optional[str] = None
    myob_item_uid: Optional[str] = None
    myob_income_account_uid: Optional[str] = None
    income_account_display_id: Optional[str] = None
    income_account_name: Optional[str] = None


class ResellProductCreate(BaseModel):
    description: str = Field(..., min_length=1, max_length=2000)
    unit_price: Decimal = Field(..., ge=0)
    default_quantity_unit: Optional[str] = Field(default=None, max_length=16)
    active: bool = True


class ResellProductUpdate(BaseModel):
    description: Optional[str] = Field(None, min_length=1, max_length=2000)
    unit_price: Optional[Decimal] = Field(None, ge=0)
    default_quantity_unit: Optional[str] = Field(default=None, max_length=16)
    active: Optional[bool] = None
