from __future__ import annotations

from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CustomerPricingTierDTO(BaseModel):
    id: str
    name: str
    discount_percent: float
    sort_order: int

    model_config = ConfigDict(from_attributes=True)


class CustomerPricingTierCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    discount_percent: float = Field(..., ge=0, le=100)
    sort_order: int = Field(0, ge=-100000, le=100000)

    @field_validator("discount_percent")
    @classmethod
    def discount_finite(cls, v: float) -> float:
        if not isinstance(v, (int, float)) or v != v:
            raise ValueError("discount_percent must be a finite number")
        return float(v)


class CustomerPricingTierUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=128)
    discount_percent: Optional[float] = Field(None, ge=0, le=100)
    sort_order: Optional[int] = Field(None, ge=-100000, le=100000)

    @field_validator("discount_percent")
    @classmethod
    def discount_finite(cls, v: Optional[float]) -> Optional[float]:
        if v is None:
            return None
        if not isinstance(v, (int, float)) or v != v:
            raise ValueError("discount_percent must be a finite number")
        return float(v)


def dto_from_orm(row) -> CustomerPricingTierDTO:
    dp = row.discount_percent
    if isinstance(dp, Decimal):
        dpf = float(dp)
    else:
        dpf = float(dp or 0)
    return CustomerPricingTierDTO(
        id=str(row.id),
        name=str(row.name),
        discount_percent=dpf,
        sort_order=int(row.sort_order or 0),
    )
