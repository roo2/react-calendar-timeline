"""
Interpret machine-generated MYOB / Dolphin line descriptions. Start with UOM: ``(UOM = CTN)``, etc.
"""

from __future__ import annotations

import re
from typing import Any

from app.integrations.myob.order_import_mapping import map_myob_item_to_app_quantity

# e.g. ``... (UOM = CTN)``, ``(UOM=kg)``, ``(UOM = ROLL)``
DOLPHIN_UOM_PAREN_RE = re.compile(
    r"\(\s*UOM\s*=\s*([^)]+?)\s*\)\s*",
    re.IGNORECASE,
)

# Secondary: ``$/CTN`` token near end (weak signal)
DOLPHIN_UOM_DOLLAR_SLASH = re.compile(r"\$/\s*([A-Z0-9]{1,8})\b", re.IGNORECASE)


def parse_uom_from_dolphin_description(description: str | None) -> str | None:
    """
    Return raw UOM string from a Dolphin / MYOB export description, or None.

    Primary pattern: ``(UOM = CTN)`` → ``CTN`` (trimmed).
    """
    if not (description or "").strip():
        return None
    s = str(description)
    m = DOLPHIN_UOM_PAREN_RE.search(s)
    if m:
        u = m.group(1).strip()
        return u or None
    m2 = DOLPHIN_UOM_DOLLAR_SLASH.search(s)
    if m2:
        u = m2.group(1).strip()
        if u and u.lower() not in ("aud", "gst"):
            return u
    return None


def build_synthetic_item_json_for_dolphin_uom(
    *,
    raw_uom: str | None,
    income_display_id: str | None = None,
) -> dict[str, Any]:
    """
    Minimal ``Inventory/Item``-shaped JSON for :func:`map_myob_item_to_app_quantity` UOM rules.
    """
    inc: dict[str, Any] = {}
    disp = (income_display_id or "").strip()
    if disp:
        inc["DisplayID"] = disp
    u = (raw_uom or "").strip()
    out: dict[str, Any] = {}
    if inc:
        out["IncomeAccount"] = inc
    if u:
        out["SellingDetails"] = {"SellingUnitOfMeasure": u}
    return out


def dolphin_line_quantity_from_description(
    description: str | None,
    *,
    income_display_id: str | None,
    map_quantities_as_manufacturing: bool,
) -> tuple[str, str, str | None]:
    """
    Parse UOM from ``description`` and run the same mapping as MYOB import.

    When ``map_quantities_as_manufacturing`` is False, behaviour matches
    :func:`map_myob_item_to_app_quantity` with ``requires_job_sheet=False``
    (typically ``ea`` / ``units``).
    """
    raw = parse_uom_from_dolphin_description(description)
    item = build_synthetic_item_json_for_dolphin_uom(
        raw_uom=raw,
        income_display_id=income_display_id,
    )
    return map_myob_item_to_app_quantity(
        item,
        requires_job_sheet=bool(map_quantities_as_manufacturing),
    )
