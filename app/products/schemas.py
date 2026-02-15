from __future__ import annotations

from enum import Enum
from typing import List, Optional, Literal, Dict, Any

from pydantic import BaseModel, Field, root_validator, validator


class ProductType(str, Enum):
    BAG = "Bag"
    TUBE = "Tube"
    SLEEVE = "Sleeve"
    SHEET = "Sheet"
    CENTERFOLD = "Centerfold"
    U_FILM = "U-Film"


class FinishMode(str, Enum):
    ROLLS = "Rolls"
    CARTONS = "Cartons"


class Geometry(str, Enum):
    FLAT = "Flat"
    GUSSET = "Gusset"
    BOTTOM_GUSSET = "BottomGusset"
    CENTRE_FOLD = "CentreFold"


class PrintMethod(str, Enum):
    NONE = "None"
    INLINE = "Inline"
    UTECO = "Uteco"


class PrintSide(str, Enum):
    FRONT = "front"
    BACK = "back"
    BOTH = "both"


class InkPlatePair(BaseModel):
    ink_code: Optional[str] = None
    plate_code: Optional[str] = None


class TreatIO(str, Enum):
    INSIDE = "inside"
    OUTSIDE = "outside"
    NONE = "none"


class IdentitySpec(BaseModel):
    product_type: ProductType
    finish_mode: FinishMode
    trim_pct: Optional[float] = Field(None, ge=0, le=100)
    industry_flags: List[Literal["food_contact", "non_food", "medical", "chemical_industrial"]] = []
    notes: Optional[str] = None


class DimensionsSpec(BaseModel):
    base_width_mm: int = Field(..., gt=0)
    base_length_mm: Optional[int] = Field(None, gt=0)
    thickness_um: int = Field(..., gt=0)
    geometry: Geometry
    gusset_mm: Optional[int] = Field(None, gt=0)
    # For U-Film, left/right widths can differ. Middle width uses base_width_mm.
    ufilm_left_width_mm: Optional[int] = Field(None, gt=0)
    ufilm_right_width_mm: Optional[int] = Field(None, gt=0)
    length_units: Optional[Literal["mm", "M"]] = "mm"

    @root_validator(skip_on_failure=True)
    def validate_gusset_and_length(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        geometry = values.get("geometry")
        gusset_mm = values.get("gusset_mm")
        base_length_mm = values.get("base_length_mm")
        # Gusset is required for Gusset geometries
        if geometry in {Geometry.GUSSET, Geometry.BOTTOM_GUSSET} and not gusset_mm:
            raise ValueError("gusset_mm is required for gusset geometries")
        return values


class ResinComponent(BaseModel):
    resin_code: str
    pct: float = Field(..., ge=0)


class ColourSpec(BaseModel):
    colour_code: Optional[str] = None
    strength_pct: Optional[float] = Field(None, ge=0)
    opaque: Optional[bool] = False
    opaque_strength_pct: Optional[float] = Field(None, ge=0)


class ColourComponentSpec(BaseModel):
    colour_code: Optional[str] = None
    strength_pct: Optional[float] = Field(None, ge=0)


class AdditiveComponent(BaseModel):
    additive_code: str
    pct: float = Field(..., ge=0)


class FormulationSpec(BaseModel):
    # Free-form label/code (e.g. "Custom" or a preset blend_code like "HOUSE_LD").
    # UI only allows selecting valid options, so we don't constrain this in the schema.
    blend_type: Optional[str] = "Custom"
    blend: List[ResinComponent]
    colour: Optional[ColourSpec] = None
    colour_components: List[ColourComponentSpec] = []
    additives: List[AdditiveComponent] = []

    @validator("blend")
    def validate_blend_sum(cls, blend: List[ResinComponent]) -> List[ResinComponent]:
        total = sum(c.pct for c in blend)
        if round(total, 4) != 100.0:
            raise ValueError("Resin blend percentages must sum to 100%")
        return blend

class PrintingSpec(BaseModel):
    method: PrintMethod
    num_colours: Optional[int] = Field(0, ge=0)
    print_description: Optional[str] = None
    ink_codes: List[str] = []
    plate_codes: List[str] = []
    side: Optional[PrintSide] = None
    artwork_refs: List[str] = []
    front_ink_plate: List[InkPlatePair] = []
    back_ink_plate: List[InkPlatePair] = []


class QualityExpectationsSpec(BaseModel):
    flags: List[Literal["tight_gauge", "seal_integrity", "cosmetic", "colour"]] = []
    known_issues: Optional[str] = None


class RunRequirementsSpec(BaseModel):
    preferred_extruders: List[str] = []
    preferred_printer: Optional[str] = None
    preferred_converter: Optional[str] = None
    run_up: Optional[Literal["none", "2up", "4up", "6up"]] = "none"
    treat_inside_outside: Optional[TreatIO] = TreatIO.NONE
    inline_perforation: Optional[bool] = False
    inline_seal: Optional[bool] = False
    notes: Optional[str] = None


class PackagingSpec(BaseModel):
    pack_mode: FinishMode
    core_type: Literal["7mm", "13mm", "PVC", "None"]
    core_policy: Literal["Include", "Half", "Exclude"]
    bags_per_carton: Optional[int] = Field(None, gt=0)
    pallet_type: Literal["Chep", "Plain", "Resin", "None"]
    wrapped: Optional[bool] = False
    notes: Optional[str] = None

    @root_validator(skip_on_failure=True)
    def validate_packaging(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        pack_mode = values.get("pack_mode")
        bags_per_carton = values.get("bags_per_carton")
        if pack_mode == FinishMode.CARTONS and not bags_per_carton:
            raise ValueError("bags_per_carton is required when pack_mode = Cartons")
        return values


class SensorQCConfigSpec(BaseModel):
    sensor_eligible_checks: List[str] = []
    acceptance_criteria: Dict[str, Any] = {}
    sampling_plan: Optional[str] = None
    aggregation_window: Optional[str] = None


class WIMappingsSpec(BaseModel):
    raw_material_spec_wi: Optional[str] = "WI-01"
    dimensional_spec_wi: Optional[str] = "WI-01"
    film_quality_leak_seal_wi: Optional[str] = "WI-09/10"
    colour_film_ink_wi: Optional[str] = "WI-01/41"
    venting_spec_wi: Optional[str] = "WI-39"


class ToolRequirementSpec(BaseModel):
    stage: Literal["extrusion", "conversion"]
    tool_type: str
    quantity: int = Field(1, ge=1)
    preferred_machine_ids: List[str] = []
    notes: Optional[str] = None


class SpecPayload(BaseModel):
    identity: IdentitySpec
    dimensions: DimensionsSpec
    formulation: FormulationSpec
    printing: PrintingSpec
    quality_expectations: QualityExpectationsSpec
    run_requirements: RunRequirementsSpec
    packaging: PackagingSpec
    tool_requirements: List[ToolRequirementSpec] = []
    sensor_qc_config: Optional[SensorQCConfigSpec] = None
    wi_mappings: Optional[WIMappingsSpec] = None

    @root_validator(skip_on_failure=True)
    def validate_dimensions_vs_finish_mode(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        identity: IdentitySpec = values.get("identity")
        dimensions: DimensionsSpec = values.get("dimensions")
        if identity and dimensions:
            if identity.finish_mode == FinishMode.ROLLS:
                # length may be None in rolls
                pass
            else:
                if not dimensions.base_length_mm:
                    raise ValueError("base_length_mm is required when finish_mode != Rolls")
        return values


class CreateProductRequest(BaseModel):
    customer_id: str
    code: str
    description: Optional[str] = None
    spec: SpecPayload


class CreateProductVersionRequest(BaseModel):
    spec: SpecPayload


class OperatorSuggestionRequest(BaseModel):
    product_id: Optional[str] = None
    version_id: Optional[str] = None
    suggestion_text: str
    category: Optional[str] = None


class ProductListQuery(BaseModel):
    q: Optional[str] = None

