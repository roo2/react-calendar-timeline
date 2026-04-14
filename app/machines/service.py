from __future__ import annotations

from typing import Any, List, Optional, TYPE_CHECKING

from app.exceptions import DomainError
from app.scheduling.spec_payload import _compute_gauge_um_from_spec

if TYPE_CHECKING:
    from app.db.models.domain import Machine, ProductVersion
    from app.db.models.enums import OperationType
    from app.db.models.rate_cards import Extruder


def _compute_width_mm_from_spec(spec: Any) -> Optional[float]:
    """
    Compute machine "web width" (mm) from a spec payload.

    Rules mirror the frontend quoteCalculator / SpecPayloadForm:
    - CentreFold: layflat = 0.5 * base_width_mm
    - Gusset: layflat = base_width_mm + gusset_mm (gusset is additional layflat once)
    - BottomGusset: layflat = base_width_mm (matches quotes UI geometry for bottom gusset)
    - Otherwise: layflat = base_width_mm
    """
    if not isinstance(spec, dict):
        return None

    dims = spec.get("dimensions") or {}
    if not isinstance(dims, dict):
        return None

    width = dims.get("base_width_mm")
    gusset = dims.get("gusset_mm") or 0
    geometry = dims.get("geometry")

    try:
        if width is None:
            return None
        if geometry == "CentreFold":
            return float(width) / 2.0
        if geometry == "Gusset":
            return float(width) + float(gusset or 0)
        if geometry == "BottomGusset":
            return float(width)
        return float(width)
    except Exception:
        return None


def validate_machine_capability(
    machine: "Machine",
    product_version: Optional["ProductVersion"],
    operation_type: Optional["OperationType"] = None,  # reserved for future checks
) -> None:
    spec = (product_version.spec_payload if product_version else {}) or {}
    validate_machine_capability_from_spec(machine, spec, operation_type=operation_type)


def validate_capability_dict(
    cap: Any,
    spec: Any,
    operation_type: Optional["OperationType"] = None,  # reserved for future checks
) -> None:
    """Validate optional JSON `capability` (width/gauge ranges) against product spec."""
    width_mm = _compute_width_mm_from_spec(spec)
    gauge_um = _compute_gauge_um_from_spec(spec)

    if not isinstance(cap, dict):
        cap = {}
    if width_mm is not None and "width_range_mm" in cap:
        min_w, max_w = cap["width_range_mm"][0], cap["width_range_mm"][1]
        if not (min_w <= float(width_mm) <= max_w):
            raise DomainError("Machine width capability out of range for this job")

    if gauge_um is not None and "gauge_range_um" in cap:
        min_g, max_g = cap["gauge_range_um"][0], cap["gauge_range_um"][1]
        if not (min_g <= float(gauge_um) <= max_g):
            raise DomainError("Machine gauge capability out of range for this job")


def validate_machine_capability_from_spec(
    machine: "Machine",
    spec: Any,
    operation_type: Optional["OperationType"] = None,  # reserved for future checks
) -> None:
    validate_capability_dict(machine.capability or {}, spec, operation_type=operation_type)


def layflat_width_mm_from_product_version(product_version: Optional["ProductVersion"]) -> Optional[float]:
    """Layflat / web width (mm) from the active product version spec — same basis as extruder width checks."""
    spec = (product_version.spec_payload if product_version else {}) or {}
    return _compute_width_mm_from_spec(spec)


def extruder_layflat_advisory_warnings(extruder: "Extruder", spec: Any) -> List[str]:
    """
    Layflat below the extruder’s rate-book minimum is allowed (narrow webs can run on wider lines).
    Surface as Gantt warnings so planners see it next to overlap-style advisories.
    """
    width_mm = _compute_width_mm_from_spec(spec)
    if width_mm is None or extruder.film_width_min_mm is None:
        return []
    lo = float(extruder.film_width_min_mm)
    if width_mm + 1e-6 < lo:
        return [
            f"Layflat is {width_mm:.1f} mm, below this extruder’s minimum rated width ({extruder.film_width_min_mm} mm). "
            "Narrow jobs can often still run on wider extruders — confirm if unsure."
        ]
    return []


def validate_extruder_for_spec(
    extruder: "Extruder",
    spec: Any,
    operation_type: Optional["OperationType"] = None,
) -> None:
    """Extrusion lanes use rate-card `extruders` columns (not generic machine capability JSON)."""
    width_mm = _compute_width_mm_from_spec(spec)
    gauge_um = _compute_gauge_um_from_spec(spec)
    # Hard stop only when wider than the line’s maximum; below minimum is advisory (see extruder_layflat_advisory_warnings).
    if width_mm is not None and extruder.film_width_max_mm is not None:
        hi = float(extruder.film_width_max_mm)
        if width_mm > hi + 1e-6:
            raise DomainError(
                f"This extruder accepts up to {extruder.film_width_max_mm} mm film width; "
                f"this job’s layflat from the product spec is {width_mm:.1f} mm."
            )
    if gauge_um is not None and extruder.decision_width_mm is not None:
        # Optional tie-break: if spec has gauge, extruder rate card may still use generic cap JSON later
        pass

