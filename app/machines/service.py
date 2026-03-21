from __future__ import annotations

from typing import Any, Optional, TYPE_CHECKING

from app.exceptions import DomainError

if TYPE_CHECKING:
    from app.db.models.domain import Machine, ProductVersion
    from app.db.models.enums import OperationType


def _compute_width_mm_from_spec(spec: Any) -> Optional[float]:
    """
    Compute machine "web width" (mm) from a spec payload.

    Rules mirror the frontend quoteCalculator / SpecPayloadForm:
    - CentreFold: layflat = 0.5 * base_width_mm
    - Gusset: layflat = base_width_mm + gusset_mm (gusset is additional layflat once)
    - BottomGusset: layflat = base_width_mm (matches quote_engine bottom_gusset)
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


def _compute_gauge_um_from_spec(spec: Any) -> Optional[float]:
    if not isinstance(spec, dict):
        return None
    materials = spec.get("materials") or {}
    if isinstance(materials, dict) and materials.get("gauge_um") is not None:
        try:
            return float(materials.get("gauge_um"))
        except Exception:
            return None
    if spec.get("gauge_um") is not None:
        try:
            return float(spec.get("gauge_um"))
        except Exception:
            return None
    return None


def validate_machine_capability(
    machine: "Machine",
    product_version: Optional["ProductVersion"],
    operation_type: Optional["OperationType"] = None,  # reserved for future checks
) -> None:
    spec = (product_version.spec_payload if product_version else {}) or {}
    validate_machine_capability_from_spec(machine, spec, operation_type=operation_type)


def validate_machine_capability_from_spec(
    machine: "Machine",
    spec: Any,
    operation_type: Optional["OperationType"] = None,  # reserved for future checks
) -> None:
    width_mm = _compute_width_mm_from_spec(spec)
    gauge_um = _compute_gauge_um_from_spec(spec)

    cap = machine.capability or {}
    if width_mm is not None and "width_range_mm" in cap:
        min_w, max_w = cap["width_range_mm"][0], cap["width_range_mm"][1]
        if not (min_w <= float(width_mm) <= max_w):
            raise DomainError("Machine width capability out of range for this job")

    if gauge_um is not None and "gauge_range_um" in cap:
        min_g, max_g = cap["gauge_range_um"][0], cap["gauge_range_um"][1]
        if not (min_g <= float(gauge_um) <= max_g):
            raise DomainError("Machine gauge capability out of range for this job")

