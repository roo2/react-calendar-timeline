"""Product code / description for order lines from the job sheet's pinned product version."""

from __future__ import annotations

from typing import Any, Optional

from app.products.service import compute_product_code_full, compute_product_description


def product_code_for_version(p: Any, pv: Any) -> str:
    if p is None:
        return ""
    spec = getattr(pv, "spec_payload", None) if pv is not None else None
    if isinstance(spec, dict):
        computed = compute_product_code_full(p, spec)
        if computed and str(computed).strip():
            return str(computed).strip()
    return str(getattr(p, "code", "") or "").strip()


def product_display_name_for_line(
    *,
    p: Any,
    pv: Any,
    js: Any = None,
    import_line_description: Any = None,
) -> Optional[str]:
    myob = str(import_line_description or "").strip()
    if myob:
        return myob
    if js is not None:
        cfd = getattr(js, "customer_facing_description", None)
        if cfd is not None and str(cfd).strip():
            return str(cfd).strip()
    spec = getattr(pv, "spec_payload", None) if pv is not None else None
    if isinstance(spec, dict):
        desc = compute_product_description(spec, max_len=255)
        if desc and str(desc).strip():
            return str(desc).strip()
    if p is not None:
        legacy = getattr(p, "description", None)
        if legacy is not None and str(legacy).strip():
            return str(legacy).strip()
    return None
