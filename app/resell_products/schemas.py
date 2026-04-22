from __future__ import annotations

from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


class ResellProductDTO(BaseModel):
    id: str
    description: str
    unit_price: Decimal
    active: bool = True


class ResellProductCreate(BaseModel):
    description: str = Field(..., min_length=1, max_length=2000)
    unit_price: Decimal = Field(..., ge=0)
    active: bool = True


class ResellProductUpdate(BaseModel):
    description: Optional[str] = Field(None, min_length=1, max_length=2000)
    unit_price: Optional[Decimal] = Field(None, ge=0)
    active: Optional[bool] = None
