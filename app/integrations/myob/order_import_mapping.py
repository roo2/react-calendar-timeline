"""
Map MYOB AccountRight ``Inventory/Item`` JSON to Production order-line quantity fields.

MYOB ``SellingDetails.SellingUnitOfMeasure`` values are normalized using statistics from live files
(1000, ROLL, CTN, KG, nulls, etc.). Manufacturing lines that need job sheets map into ``kg``,
``rolls``, ``cartons``, ``1000``, etc.; typical resell supplies map to ``ea``; outsourced manufactured
resell (see :func:`myob_resell_catalog_kind`) uses the same manufacturing-style mapping when the
caller passes ``requires_job_sheet=True``. Outsourced resell is detected from known income-account
UIDs and from configured ``IncomeAccount.DisplayID`` codes (stable across company files).
"""

from __future__ import annotations

from typing import Any

from app.integrations.myob.item_selling_uom_cache import (
    is_bought_from_item_json,
    is_inventoried_from_item_json,
    is_sold_from_item_json,
)

# Income accounts that classify a bought MYOB line as outsourced manufacturing (resell catalog).
OUTSOURCED_MANUFACTURING_INCOME_ACCOUNT_UIDS: frozenset[str] = frozenset(
    {
        "613ed84d-3545-462e-83f7-a5c83dc80605",  # 4-0003 Income - Sales - Outsoured - Manufacturing
        "fd93417d-f1e2-4c09-8697-b177a04176f4",  # 4-0007 Income - Resale - Imported items (not inc cores) (CP & AP)
    }
)
# MYOB ``IncomeAccount.DisplayID`` values (company file may use different UIDs than above).
OUTSOURCED_MANUFACTURING_INCOME_ACCOUNT_DISPLAY_IDS: frozenset[str] = frozenset(
    {
        "4-1112",
        "4-1111",
        "4-0008",
        "4-1113",
        "5-0010",
    }
)
# Backwards compat for tests / callers that only referenced the original outsourced account.
OUTSOURCED_MANUFACTURING_INCOME_ACCOUNT_UID = "613ed84d-3545-462e-83f7-a5c83dc80605"


def _str_norm(x: Any) -> str:
    if x is None:
        return ""
    return str(x).strip().lower()


def _income_display_id_from_item_json(item_json: dict[str, Any] | None) -> str:
    """MYOB ``Inventory/Item.IncomeAccount.DisplayID`` (trimmed)."""
    if not isinstance(item_json, dict):
        return ""
    inc = item_json.get("IncomeAccount")
    if not isinstance(inc, dict):
        return ""
    v = inc.get("DisplayID")
    if v is None:
        v = inc.get("DisplayId")
    if v is None or not str(v).strip():
        return ""
    return str(v).strip()


def _raw_selling_uom_from_item_json(item_json: dict[str, Any]) -> str | None:
    selling = item_json.get("SellingDetails")
    if isinstance(selling, dict):
        u = (
            selling.get("SellingUnitOfMeasure")
            or selling.get("ItemSalesUnit")
            or selling.get("BaseSellingUnit")
        )
        if u is not None and str(u).strip():
            return str(u).strip()
    buying = item_json.get("BuyingDetails")
    if isinstance(buying, dict):
        u = (
            buying.get("BuyingUnitOfMeasure")
            or buying.get("PurchasingUnitOfMeasure")
            or buying.get("ItemPurchasesUnit")
            or buying.get("BasePurchasesUnit")
        )
        if u is not None and str(u).strip():
            return str(u).strip()
    return None


def map_myob_item_to_app_quantity(
    item_json: dict[str, Any] | None,
    *,
    requires_job_sheet: bool = True,
) -> tuple[str, str, str | None]:
    """
    Return ``(quantity_unit, qty_type, myob_item_sales_unit_raw)`` for ``OrderMyobLine`` placeholders.

    ``quantity_unit`` aligns with :class:`app.job_sheets.schemas` where applicable
    (``kg``, ``rolls``, ``cartons``, ``1000``, ``meters``) and uses ``ea`` for each / unknown MYOB UOM.

    ``qty_type`` matches ``QtyType`` (``kg``, ``units``, ``total_rolls``).

    When ``requires_job_sheet`` is False (typical resell supplies, fees, pallets, etc.), MYOB UOM is
    not used for manufacturing semantics: we store ``ea`` / ``units`` while still recording the raw
    MYOB string in ``myob_item_sales_unit_raw`` when present.

    For **outsourced manufactured** MYOB items (see :func:`myob_resell_catalog_kind`), callers pass
    ``requires_job_sheet=True`` so selling UOM maps to ``kg`` / ``rolls`` / ``1000`` / etc.
    """
    if not isinstance(item_json, dict):
        return "ea", "units", None

    raw_display = _raw_selling_uom_from_item_json(item_json)
    s = _str_norm(raw_display) if raw_display else ""

    if not requires_job_sheet:
        return "ea", "units", raw_display

    # --- Manufacturing / needs job sheet: map into kg | rolls | cartons | 1000; else "UNIT" → ea ---
    if not s:
        return "ea", "units", raw_display

    # Ignore odd MYOB count tokens until product rules exist (treat as unknown → ea).
    if s in ("100", "500"):
        return "ea", "units", raw_display

    if s == "1000":
        return "1000", "units", raw_display

    if "roll" in s:
        return "rolls", "total_rolls", raw_display

    if s in (
        "ctn",
        "ctns",
        "carton",
        "cartons",
        "box",
        "boxes",
        "bag",
        "bags",
        "pack",
        "packs",
        "pallet",
        "pallets",
        "sheet",
        "sheets",
    ):
        return "cartons", "units", raw_display

    if s in ("kg", "kgs", "kilo", "kilos") or "kilo" in s or s.endswith(" kg") or s == "g":
        return "kg", "kg", raw_display

    if "met" in s or s == "m" or "meter" in s:
        return "meters", "kg", raw_display

    if s in (
        "unit",
        "units",
        "ea",
        "each",
        "core",
        "cores",
        "cans",
        "can",
        "gst",
        "item",
        "items",
    ):
        return "ea", "units", raw_display

    # Unknown MYOB code (e.g. one-off typos): default each / UNIT.
    return "ea", "units", raw_display


def myob_resell_catalog_kind(item_json: dict[str, Any] | None) -> str:
    """
    Classify MYOB ``Inventory/Item`` rows that are imported as **resell** (``IsBought``).

    ``outsourced_manufacturing``: bought + sold + not inventoried AND mapped to the dedicated
    outsourced manufacturing income account.

    ``supply``: consumables, fees, bought stock items, or anything that does not match the rule above.
    """
    if is_bought_from_item_json(item_json) is not True:
        return "supply"
    if is_sold_from_item_json(item_json) is not True:
        return "supply"
    if is_inventoried_from_item_json(item_json) is not False:
        return "supply"
    income = item_json.get("IncomeAccount") if isinstance(item_json, dict) else None
    inc_uid = str((income or {}).get("UID") or "").strip().lower() if isinstance(income, dict) else ""
    disp = _income_display_id_from_item_json(item_json)
    uid_ok = inc_uid in OUTSOURCED_MANUFACTURING_INCOME_ACCOUNT_UIDS
    display_ok = bool(disp) and disp in OUTSOURCED_MANUFACTURING_INCOME_ACCOUNT_DISPLAY_IDS
    if not uid_ok and not display_ok:
        return "supply"
    return "outsourced_manufacturing"
