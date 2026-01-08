from decimal import Decimal
from typing import Optional
from pydantic import BaseModel


class QuantityRequest(BaseModel):
    units: Optional[int] = None
    total_kg: Optional[Decimal] = None
    total_m: Optional[Decimal] = None
    rolls: Optional[int] = None


class QuoteCalculateRequest(BaseModel):
    product_version_id: int
    currency: str = "AUD"
    quantity: QuantityRequest
    requested_margin: Decimal = Decimal("0.2")


class Quote(BaseModel):
    quote_id: int | None = None
    status: str | None = None


class CostBreakdown(BaseModel):
    material_cost: Decimal
    printing_cost: Decimal
    conversion_cost: Decimal
    core_cost: Decimal
    waste_cost: Decimal


class QuotePreviewResult(BaseModel):
    currency: str
    kg_per_unit: Optional[Decimal] = None
    units_per_roll: Optional[Decimal] = None
    totals_kg: Optional[Decimal] = None
    totals_units: Optional[int] = None
    cost_breakdown: CostBreakdown
    total_cost: Decimal
    margin: Decimal
    final_price: Decimal
    unit_price: Optional[Decimal] = None


