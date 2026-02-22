from decimal import Decimal
from typing import Optional, List
from pydantic import BaseModel
from enum import Enum


class QuantityRequest(BaseModel):
    units: Optional[int] = None
    total_kg: Optional[Decimal] = None
    total_m: Optional[Decimal] = None
    rolls: Optional[int] = None


class QuoteCalculateRequest(BaseModel):
    product_version_id: int | str
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
    kg_per_unit: Optional[Decimal] = None
    units_per_roll: Optional[Decimal] = None
    totals_kg: Optional[Decimal] = None
    totals_units: Optional[int] = None
    cost_breakdown: CostBreakdown
    total_cost: Decimal
    margin: Decimal
    final_price: Decimal
    unit_price: Optional[Decimal] = None


class QuickPrintMethod(str, Enum):
    none = "None"
    inline = "Inline"
    uteco = "Uteco"


class QuickGeometry(str, Enum):
    flat = "Flat"
    gusset = "Gusset"
    bottom_gusset = "BottomGusset"
    centre_fold = "CentreFold"


class QuickFinishMode(str, Enum):
    rolls = "Rolls"
    cartons = "Cartons"


class QuickBlendComponent(BaseModel):
    resin_code: str
    pct: Decimal


class QuickColourComponent(BaseModel):
    colour_code: str
    strength_pct: Optional[Decimal] = None


class QuickAdditiveComponent(BaseModel):
    additive_code: str
    pct: Optional[Decimal] = None


class QuickQuoteCalculateRequest(BaseModel):
    # Dimensions (essential)
    product_type: str
    base_width_mm: int
    thickness_um: int
    geometry: QuickGeometry = QuickGeometry.flat
    continuous_roll: bool = False
    base_length_mm: Optional[int] = None
    gusset_mm: Optional[int] = None
    length_units: Optional[str] = None
    trim_pct: Optional[Decimal] = None
    # Materials (optional)
    resin_code: Optional[str] = None
    blend: List[QuickBlendComponent] = []
    colour_code: Optional[str] = None
    colour_strength_pct: Optional[Decimal] = None
    colour_components: List[QuickColourComponent] = []
    opaque: bool = False
    additive_code: Optional[str] = None
    additive_pct: Optional[Decimal] = None
    additives: List[QuickAdditiveComponent] = []
    # Printing (optional)
    print_method: QuickPrintMethod = QuickPrintMethod.none
    num_colours: Optional[int] = 0
    # Packaging (optional)
    finish_mode: QuickFinishMode = QuickFinishMode.rolls
    core_type: Optional[str] = None
    roll_weight_billing: Optional[str] = None
    bags_per_carton: Optional[int] = None
    pallet_type: Optional[str] = None
    # Run requirements (optional; kept for future Product/Job Sheet compatibility)
    inline_perforation: Optional[bool] = None
    inline_seal: Optional[bool] = None
    hole_punched: Optional[bool] = None
    # Quantity & Pricing (essential)
    quantity: QuantityRequest
    requested_margin: Decimal = Decimal("0.2")
