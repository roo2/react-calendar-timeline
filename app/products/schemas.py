from __future__ import annotations

from enum import Enum
from typing import List, Optional, Literal, Dict, Any

from pydantic import BaseModel, Field, root_validator, validator


class ProductType(str, Enum):
    BAG = "Bag"
    BAG_ON_ROLL = "BagOnRoll"
    TUBE = "Tube"
    SHEET = "Sheet"
    CENTRE_FOLD = "CentreFold"
    U_FILM = "U‑Film"


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


class TreatIO(str, Enum):
    INSIDE = "inside"
    OUTSIDE = "outside"
    NONE = "none"


class IdentitySpec(BaseModel):
    product_type: ProductType
    finish_mode: FinishMode
    notes: Optional[str] = None


class DimensionsSpec(BaseModel):
    base_width_mm: int = Field(..., gt=0)
    base_length_mm: Optional[int] = Field(None, gt=0)
    thickness_um: int = Field(..., gt=0)
    geometry: Geometry
    gusset_mm: Optional[int] = Field(None, gt=0)

    @root_validator
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


class AdditiveComponent(BaseModel):
    additive_code: str
    pct: float = Field(..., ge=0)


class FormulationSpec(BaseModel):
    blend: List[ResinComponent]
    colour: Optional[ColourSpec] = None
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
    ink_codes: List[str] = []
    plate_codes: List[str] = []
    side: Optional[PrintSide] = None
    artwork_refs: List[str] = []

    @root_validator
    def validate_printing(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        method: PrintMethod = values.get("method")
        num_colours = values.get("num_colours") or 0
        artwork_refs = values.get("artwork_refs") or []
        if method != PrintMethod.NONE:
            if num_colours < 1:
                raise ValueError("num_colours must be ≥ 1 when printing is enabled")
            if len(artwork_refs) == 0:
                raise ValueError("artwork_refs required when printing is enabled")
        return values


class QualityExpectationsSpec(BaseModel):
    flags: List[Literal["tight_gauge", "seal_integrity", "cosmetic", "colour"]] = []
    known_issues: Optional[str] = None


class RunRequirementsSpec(BaseModel):
    preferred_extruders: List[str] = []
    preferred_printer: Optional[str] = None
    preferred_converter: Optional[str] = None
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

    @root_validator
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


class SpecPayload(BaseModel):
    identity: IdentitySpec
    dimensions: DimensionsSpec
    formulation: FormulationSpec
    printing: PrintingSpec
    quality_expectations: QualityExpectationsSpec
    run_requirements: RunRequirementsSpec
    packaging: PackagingSpec
    sensor_qc_config: Optional[SensorQCConfigSpec] = None
    wi_mappings: Optional[WIMappingsSpec] = None

    @root_validator
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


class DerivedDimensions(BaseModel):
    layflat_mm: float
    decision_width_mm: float
    area_per_unit_mm2: Optional[float] = None


def compute_derived_dimensions(spec: SpecPayload) -> DerivedDimensions:
    width = spec.dimensions.base_width_mm
    geometry = spec.dimensions.geometry
    gusset = spec.dimensions.gusset_mm or 0
    finish = spec.identity.finish_mode
    length = spec.dimensions.base_length_mm

    if geometry == Geometry.CENTRE_FOLD:
        decision = width / 2.0
    elif geometry in (Geometry.GUSSET, Geometry.BOTTOM_GUSSET):
        decision = width + 2.0 * gusset
    else:
        decision = float(width)

    layflat = decision
    area = None
    if finish == FinishMode.CARTONS and length:
        area = decision * float(length)
    elif finish == FinishMode.ROLLS:
        # per linear meter
        area = decision * 1000.0

    return DerivedDimensions(layflat_mm=layflat, decision_width_mm=decision, area_per_unit_mm2=area)

