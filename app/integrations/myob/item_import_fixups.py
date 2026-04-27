"""MYOB inventory item tweaks applied during order import (and UOM cache projection)."""

from __future__ import annotations

from typing import Any

# MYOB item "- ROLLS" / "Used for Quotes": incorrectly flagged IsBought in MYOB; treat as manufactured.
QUOTE_ROLL_PLACEHOLDER_ITEM_UID = "c305b11b-562f-4584-b934-9d562f97f458"


def normalize_myob_item_json_for_order_import(
    item_json: dict[str, Any] | None,
    *,
    item_uid: str | None = None,
) -> dict[str, Any]:
    """
    Return a shallow copy of ``item_json`` with import-time overrides.

    Placeholder roll item is forced to ``IsBought: false`` so it follows job-sheet / manufacturing
    import logic instead of resell.
    """
    out = dict(item_json) if isinstance(item_json, dict) else {}
    uid = (item_uid or out.get("UID") or "")
    uid_s = str(uid).strip().lower()
    if uid_s == QUOTE_ROLL_PLACEHOLDER_ITEM_UID.lower():
        out["IsBought"] = False
    return out
