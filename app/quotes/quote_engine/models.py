from __future__ import annotations

from decimal import Decimal
from typing import Literal, Optional, Sequence
from pydantic import BaseModel, Field, validator


Currency = Literal["AUD", "USD"]
PrintMethod = Literal["none", "inline", "uteco"]
Geometry = Literal["flat", "gusset", "bottom_gusset", "centre_fold"]
GoodOrScrap = Literal["good", "scrap"]


class ResinComponent(BaseModel):
    code: str
    pct: Decimal = Field(..., ge=Decimal("0"), le=Decimal("100"))
    density: Decimal = Field(..., gt=Decimal("0"))  # kg/m3


class SpecDTO(BaseModel):
    product_type: str
    geometry: Geometry
    base_width_mm: Decimal
    thickness_um: Decimal
    base_length_mm: Optional[Decimal] = None  # bags; None for rolls
    continuous_roll: bool = False
    gusset_mm: Optional[Decimal] = None
    # U-Film: left/right can differ; middle uses base_width_mm
    ufilm_left_width_mm: Optional[Decimal] = None
    ufilm_right_width_mm: Optional[Decimal] = None
    print_method: PrintMethod = "none"
    num_colours: int = 0
    opacity_pct: Optional[Decimal] = None
    duplex_print: bool = False
    # Materials
    blend: Sequence[ResinComponent] = ()
    colour_code: Optional[str] = None
    colour_strength_pct: Optional[Decimal] = None
    additives: dict[str, Decimal] = Field(default_factory=dict)  # code -> pct
    # Packaging hints
    finish_mode: Literal["Rolls", "Cartons"] = "Rolls"

    @validator("num_colours")
    def _non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("num_colours must be >= 0")
        return v


class Dimensions(BaseModel):
    layflat_mm: Decimal
    unit_length_mm: Optional[Decimal] = None  # for bags; None for rolls
    area_per_unit_m2: Decimal
    kg_per_unit: Decimal


class MaterialBreakdown(BaseModel):
    kg_total: Decimal
    resin_cost_per_kg: Decimal
    colour_cost_per_kg: Decimal
    additives_cost_per_kg: Decimal
    total_material_cost: Decimal


class PrintingRate(BaseModel):
    method: PrintMethod
    cost_per_1000m: Decimal
    setup_cost: Decimal = Decimal("0")
    setup_minutes: Decimal = Decimal("0")
    minimum_charge: Decimal = Decimal("0")
    duplex_supported: bool = True


class ConversionRate(BaseModel):
    bags_per_minute: Decimal
    roll_change_penalty_minutes: Decimal = Decimal("0")
    setup_minutes: Decimal = Decimal("0")


class WasteAdder(BaseModel):
    condition: str
    waste_minutes: Decimal


class CoreCost(BaseModel):
    cost_per_meter: Decimal = Decimal("0")
    kg_per_meter: Decimal = Decimal("0")


class RateBook(BaseModel):
    currency: Currency = "AUD"
    resins_price_per_kg: dict[str, Decimal] = Field(default_factory=dict)
    additives_price_per_kg: dict[str, Decimal] = Field(default_factory=dict)
    colours_price_per_kg: dict[str, Decimal] = Field(default_factory=dict)
    colours_opaque_multiplier: dict[str, Decimal] = Field(default_factory=dict)
    core: Optional[CoreCost] = None
    printing_rates: dict[str, PrintingRate] = Field(default_factory=dict)  # key = method
    conversion_rate: Optional[ConversionRate] = None
    waste_adders: list[WasteAdder] = Field(default_factory=list)
    extrusion_throughput_kg_per_hr: Decimal = Decimal("0")  # used for waste calc


class PrintingBreakdown(BaseModel):
    enabled: bool
    method: PrintMethod
    total_cost: Decimal
    setup_cost: Decimal
    rate_cost: Decimal


class ConversionBreakdown(BaseModel):
    enabled: bool
    total_minutes: Decimal
    total_cost: Decimal


class WasteBreakdown(BaseModel):
    total_minutes: Decimal
    waste_kg: Decimal
    waste_cost: Decimal


class QuantityRequest(BaseModel):
    # One of the following should be provided
    units: Optional[int] = None
    total_kg: Optional[Decimal] = None
    total_m: Optional[Decimal] = None
    rolls: Optional[int] = None


class QuoteCalculateRequestDTO(BaseModel):
    product_version_id: int
    currency: Currency = "AUD"
    quantity: QuantityRequest
    requested_margin: Decimal = Decimal("0.2")  # 20% default unless overridden


class CostBreakdown(BaseModel):
    material_cost: Decimal
    printing_cost: Decimal
    conversion_cost: Decimal
    core_cost: Decimal
    waste_cost: Decimal


class QuotePreviewResult(BaseModel):
    currency: Currency
    kg_per_unit: Optional[Decimal] = None
    units_per_roll: Optional[Decimal] = None
    totals_kg: Optional[Decimal] = None
    totals_units: Optional[int] = None
    cost_breakdown: CostBreakdown
    total_cost: Decimal
    margin: Decimal
    final_price: Decimal
    unit_price: Optional[Decimal] = None


