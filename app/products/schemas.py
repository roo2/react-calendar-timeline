from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator, root_validator, validator


class ProductType(str, Enum):
    BAG = "Bag"
    TUBE = "Tube"
    SLEEVE = "Sleeve"
    SHEET = "Sheet"
    CENTERFOLD = "Centerfold"
    U_FILM = "U-Film"
    J_FILM = "J-Film"


class FinishMode(str, Enum):
    ROLLS = "Rolls"
    CARTONS = "Cartons"


class Geometry(str, Enum):
    FLAT = "Flat"
    GUSSET = "Gusset"
    BOTTOM_GUSSET = "BottomGusset"
    CENTRE_FOLD = "CentreFold"
    # Single wound sheet (SWS); used when product type is Sheet.
    SHEET = "Sheet"


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
    # Free-text colour label (e.g. handwritten job sheet); optional alongside ink_code.
    ink_text: Optional[str] = None


class PrintingArtworkFile(BaseModel):
    """PDF artwork attached to printing; binary lives in S3 (see app/storage/printing_artwork_service)."""

    id: str = Field(..., min_length=4, max_length=120)
    filename: str = Field(..., min_length=1, max_length=255)
    byte_size: Optional[int] = Field(None, ge=0)


class TreatIO(str, Enum):
    INSIDE = "inside"
    OUTSIDE = "outside"
    BOTH_SIDES = "both_sides"
    NONE = "none"


class OrderDefaultsSpec(BaseModel):
    """Per-product order defaults (re-used on re-order); totals stay on each job sheet."""

    qty_type: Optional[Literal["kg", "units", "total_rolls", "rolls_units"]] = None
    quantity_unit: Optional[Literal["kg", "rolls", "bags", "meters", "cartons", "1000"]] = None
    weight_per_roll_kg: Optional[float] = Field(None, ge=0)
    customer_facing_description: Optional[str] = None
    customer_overproduction_handling: Optional[
        Literal["send_exact_quantity", "send_all_products", "send_full_cartons"]
    ] = None


class IdentitySpec(BaseModel):
    product_type: ProductType
    finish_mode: FinishMode
    trim_pct: Optional[float] = Field(None, ge=0, le=100)
    # Deprecated: use quality_expectations.flags (e.g. food_contact). Kept for legacy JSON only.
    industry_flags: List[Literal["food_contact", "non_food"]] = []
    notes: Optional[str] = None

    @validator("industry_flags", pre=True)
    def _filter_industry_flags(cls, v: Any) -> List[str]:
        if not isinstance(v, list):
            return []
        allowed = {"food_contact", "non_food"}
        return [str(x) for x in v if str(x) in allowed]
    # Customer-facing product code override (UI label); persisted on the version spec.
    customer_code: Optional[str] = Field(None, max_length=64)
    # Roll weight billing for extrusion (job sheet UI); optional for older stored specs.
    roll_weight_billing: Optional[Literal["core_included", "core_off", "core_half_off"]] = "core_off"


class DimensionsSpec(BaseModel):
    base_width_mm: int = Field(..., gt=0)
    width_tolerance_mm: Optional[float] = Field(None, ge=0)
    base_length_mm: Optional[int] = Field(None, gt=0)
    thickness_um: int = Field(..., gt=0)
    geometry: Geometry
    gusset_mm: Optional[int] = Field(None, gt=0)
    # For U-Film, left/right widths can differ; middle width uses base_width_mm.
    # For J-Film, only left/right widths apply (no middle); base_width_mm is the total layflat (left+right).
    ufilm_left_width_mm: Optional[int] = Field(None, gt=0)
    ufilm_right_width_mm: Optional[int] = Field(None, gt=0)
    length_units: Optional[Literal["mm", "M", "Continuous"]] = "mm"

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
    # Optional: operators often know an additive is required (e.g. UV) without a dosage %.
    pct: Optional[float] = Field(default=None, ge=0)


class FormulationSpec(BaseModel):
    # Free-form label/code (e.g. "Custom" or a preset blend_code like "LD").
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
    artwork_files: List[PrintingArtworkFile] = []
    front_ink_plate: List[InkPlatePair] = []
    back_ink_plate: List[InkPlatePair] = []
    # Uteco-only: cylinder (width) in mm.
    cylinder_size_mm: Optional[float] = None
    # Job sheet / printing production notes (optional).
    barcode: Optional[str] = None
    print_registration: Literal["random", "registered"] = "random"
    print_position_notes: Optional[str] = None
    # Plate layout on cylinder (1–3 around × 1–3 across).
    plates_around: Optional[int] = Field(None, ge=1, le=3)
    plates_across: Optional[int] = Field(None, ge=1, le=3)
    seal_type: Optional[Literal["side", "end"]] = None
    eye_spot: Optional[Literal["yes", "no"]] = None


class QualityExpectationsSpec(BaseModel):
    flags: List[Literal["tight_gauge", "seal_integrity", "cosmetic", "colour", "food_contact"]] = []
    known_issues: Optional[str] = None

    @validator("flags", pre=True)
    def _filter_quality_flags(cls, v: Any) -> List[str]:
        if not isinstance(v, list):
            return []
        allowed = {"tight_gauge", "seal_integrity", "cosmetic", "colour", "food_contact"}
        retired = {"medical", "chemical_industrial", "non_food"}
        return [str(x) for x in v if str(x) in allowed and str(x) not in retired]


_DEPRECATED_CONVERSION_FLAG_KEYS = frozenset({"send_all_bags", "sendAllBags", "inner_pack", "qty_to_stock"})


class ConversionSpec(BaseModel):
    """Conversion / finishing options stored on job sheet specs under ``run_requirements.conversion``."""

    model_config = ConfigDict(extra="allow")

    carton_size: Optional[str] = None
    packing_mode: Optional[Literal["loose_lay_flat", "loose_folded", "in_pack"]] = None
    pack_lay_flat: Optional[bool] = False
    tag_packs: Optional[bool] = False
    tag_ctn: Optional[bool] = False
    # Conversion punch (hole punch machine).
    punched_conversion_enabled: Optional[bool] = False
    punched_conversion_hole_size_mm: Optional[int] = Field(6, ge=0)
    punched_conversion_holes_across: Optional[int] = Field(None, ge=0)
    punched_conversion_holes_along: Optional[int] = Field(None, ge=0)
    punched_conversion_hole_position_description: Optional[str] = None
    # Conversion vent (pinprick).
    vented_enabled: Optional[bool] = False
    # Legacy vent fields (read/migrate only).
    vent_enabled: Optional[bool] = False
    vent_hole_size_mm: Optional[int] = Field(6, ge=0)
    vent_holes_across: Optional[int] = Field(None, ge=0)
    vent_holes_along: Optional[int] = Field(None, ge=0)
    vent_hole_position_description: Optional[str] = None
    vent_rows: Optional[int] = Field(None, ge=0)
    vent_holes_per_row: Optional[int] = Field(None, ge=0)
    vent_description: Optional[str] = None
    pack_size: Optional[int] = Field(None, ge=0)
    qty_per_fold: Optional[int] = Field(None, ge=0)
    loose: Optional[bool] = False
    handle: Optional[bool] = False
    lined_cartons: Optional[bool] = False
    notes: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def _strip_deprecated_conversion_flags(cls, data: Any) -> Any:
        """Remove retired UI flags so they are not persisted on the product version spec."""
        if not isinstance(data, dict):
            return data
        out = {k: v for k, v in data.items() if k not in _DEPRECATED_CONVERSION_FLAG_KEYS}
        # Legacy vent hole fields were historically used for conversion punching.
        if out.get("punched_conversion_holes_across") is None:
            if out.get("vent_holes_across") is not None:
                out["punched_conversion_holes_across"] = out["vent_holes_across"]
            elif out.get("vent_holes_per_row") is not None:
                out["punched_conversion_holes_across"] = out["vent_holes_per_row"]
        if out.get("punched_conversion_holes_along") is None:
            if out.get("vent_holes_along") is not None:
                out["punched_conversion_holes_along"] = out["vent_holes_along"]
            elif out.get("vent_rows") is not None:
                out["punched_conversion_holes_along"] = out["vent_rows"]
        if out.get("punched_conversion_hole_position_description") is None:
            if out.get("vent_hole_position_description"):
                out["punched_conversion_hole_position_description"] = out["vent_hole_position_description"]
            elif out.get("vent_description"):
                out["punched_conversion_hole_position_description"] = out["vent_description"]
        if out.get("punched_conversion_hole_size_mm") is None:
            out["punched_conversion_hole_size_mm"] = out.get("vent_hole_size_mm", 6)
        if out.get("vented_enabled") is None:
            hole_detail = any(
                out.get(k) not in (None, "", 0)
                for k in (
                    "punched_conversion_holes_across",
                    "punched_conversion_holes_along",
                    "punched_conversion_hole_position_description",
                )
            )
            if out.get("vent_enabled") is True and not hole_detail:
                out["vented_enabled"] = True
            else:
                out["vented_enabled"] = False
        if out.get("punched_conversion_enabled") is None:
            has_punch_detail = any(
                out.get(k) not in (None, "", 0)
                for k in (
                    "punched_conversion_holes_across",
                    "punched_conversion_holes_along",
                    "punched_conversion_hole_position_description",
                )
            )
            out["punched_conversion_enabled"] = bool(has_punch_detail or out.get("vent_enabled") is True)
        return out

    @model_validator(mode="after")
    def _normalize_vent_fields(self) -> "ConversionSpec":
        if self.punched_conversion_hole_size_mm is None or int(self.punched_conversion_hole_size_mm) not in (6, 8, 10):
            self.punched_conversion_hole_size_mm = 6
        if self.vent_hole_size_mm is None or int(self.vent_hole_size_mm) not in (6, 8, 10):
            self.vent_hole_size_mm = 6
        return self

    @model_validator(mode="after")
    def _packing_mode_rules(self) -> "ConversionSpec":
        mode = self.packing_mode
        if mode is None:
            if self.pack_size is not None and int(self.pack_size) > 0:
                mode = "in_pack"
            elif self.qty_per_fold is not None and int(self.qty_per_fold) > 0:
                mode = "loose_folded"
        if mode == "loose_lay_flat":
            self.packing_mode = "loose_lay_flat"
            self.pack_lay_flat = True
            self.loose = True
            self.pack_size = None
            self.qty_per_fold = None
            self.tag_packs = False
        elif mode == "loose_folded":
            self.packing_mode = "loose_folded"
            self.pack_lay_flat = False
            self.loose = True
            self.pack_size = None
            self.tag_packs = False
        elif mode == "in_pack":
            self.packing_mode = "in_pack"
            self.pack_lay_flat = False
            self.loose = False
            self.qty_per_fold = None
            if not (self.pack_size is not None and int(self.pack_size) > 0):
                self.tag_packs = False
        else:
            self.packing_mode = None
            self.pack_lay_flat = False
            self.loose = False
            if self.pack_size is not None and int(self.pack_size) > 0:
                self.loose = False
            if not (self.pack_size is not None and int(self.pack_size) > 0):
                self.tag_packs = False
        return self


class RunRequirementsSpec(BaseModel):
    preferred_extruders: List[str] = []
    preferred_printer: Optional[str] = None
    preferred_converter: Optional[str] = None
    run_up: Optional[Literal["none", "2up", "4up", "6up"]] = "none"
    slit: Optional[Literal["none", "one_side", "both_sides", "middle"]] = "none"
    treat_inside_outside: Optional[TreatIO] = TreatIO.NONE
    inline_perforation: Optional[bool] = False
    # Inline punched (extrusion hole punch machine).
    hole_punched: Optional[bool] = False
    inline_punch_hole_size_mm: Optional[int] = Field(6, ge=0)
    inline_punch_holes_across: Optional[int] = Field(None, ge=0)
    inline_punch_holes_along: Optional[int] = Field(None, ge=0)
    inline_punch_hole_position_description: Optional[str] = None
    inline_seal: Optional[bool] = False
    notes: Optional[str] = None
    # Seal for conversion (job sheet); distinct from ``printing.seal_type`` when migrating.
    seal_type: Optional[Literal["end", "side", "none"]] = None
    shrink: Optional[bool] = False
    conversion: Optional[ConversionSpec] = None

    @model_validator(mode="after")
    def _normalize_inline_punch(self) -> "RunRequirementsSpec":
        if self.inline_punch_hole_size_mm is None or int(self.inline_punch_hole_size_mm) not in (6, 8, 10):
            self.inline_punch_hole_size_mm = 6
        return self


class PackagingSpec(BaseModel):
    pack_mode: FinishMode
    core_type: Literal["7mm", "13mm", "PVC", "None"]
    core_policy: Literal["Include", "Half", "Exclude"]
    bags_per_carton: Optional[int] = Field(None, gt=0)
    pallet_type: Literal["Chep", "Plain", "Resin", "None"]
    # User-entered packing: used with order quantity on job sheet print to derive pallet count / checklist.
    rolls_per_pallet: Optional[int] = Field(None, gt=0)
    cartons_per_pallet: Optional[int] = Field(None, gt=0)
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
    order_defaults: Optional[OrderDefaultsSpec] = None
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
            lu = dimensions.length_units or "mm"
            pt = identity.product_type
            if lu == "Continuous" and pt in (ProductType.BAG, ProductType.SLEEVE):
                raise ValueError("Continuous length is not available for Bag or Sleeve products")
            if pt == ProductType.TUBE and lu != "Continuous":
                raise ValueError("Tube products must use Continuous length units")
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


class UpdateProductRequest(BaseModel):
    description: Optional[str] = None
    production_extruder_code: Optional[str] = Field(default=None, max_length=64)
    die_size: Optional[str] = None


class OperatorSuggestionRequest(BaseModel):
    product_id: Optional[str] = None
    version_id: Optional[str] = None
    suggestion_text: str
    category: Optional[str] = None


class ProductListQuery(BaseModel):
    q: Optional[str] = None

