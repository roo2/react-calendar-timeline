"""Additive short codes for product code generation and data migration."""

from __future__ import annotations

import copy
from typing import Any

# Legacy master-data / spec codes → short codes used in product codes.
ADDITIVE_CODE_LEGACY_TO_SHORT: dict[str, str] = {
    "ANTI_BLOCK": "AB",
    "ANTI_STATIC": "AS",
    "SLIP": "SP",
    "UV": "UV",
}

# (old_pk, new_pk, display_name) for DB migration.
ADDITIVE_CODE_MIGRATION_ROWS: list[tuple[str, str, str]] = [
    ("ANTI_BLOCK", "AB", "Anti Block"),
    ("ANTI_STATIC", "AS", "Anti Static"),
    ("SLIP", "SP", "Anti Slip"),
    ("UV", "UV", "UV Treatment"),
]

PRODUCT_CODE_SEGMENT_SEP = "_"
PRODUCT_CODE_ADDITIVE_SEP = "."


def normalize_additive_code_for_product_code(raw: Any) -> str:
    """Map legacy additive keys to short codes; unknown codes pass through uppercased."""
    code = str(raw or "").strip().upper()
    if not code:
        return ""
    return ADDITIVE_CODE_LEGACY_TO_SHORT.get(code, code)


def product_code_additive_segment(formulation: Any, *, max_count: int = 2) -> str:
    """
    Up to two additive short codes joined with ``.`` (e.g. ``AB.AS``).
    Returns empty string when none apply.
    """
    if not isinstance(formulation, dict):
        return ""
    additives = formulation.get("additives")
    if not isinstance(additives, list):
        return ""
    codes: list[str] = []
    for row in additives:
        if not isinstance(row, dict):
            continue
        short = normalize_additive_code_for_product_code(row.get("additive_code"))
        if short and short not in codes:
            codes.append(short)
        if len(codes) >= max_count:
            break
    if not codes:
        return ""
    return PRODUCT_CODE_ADDITIVE_SEP.join(codes)


def migrate_additive_code_in_spec_payload(spec_payload: Any, *, to_legacy: bool = False) -> Any:
    """Rewrite ``formulation.additives[].additive_code`` in a spec dict (migration helper)."""
    if not isinstance(spec_payload, dict):
        return spec_payload
    spec_payload = copy.deepcopy(spec_payload)
    formulation = spec_payload.get("formulation")
    if not isinstance(formulation, dict):
        return spec_payload
    additives = formulation.get("additives")
    if not isinstance(additives, list):
        return spec_payload

    if to_legacy:
        short_to_legacy = {new: old for old, new, _ in ADDITIVE_CODE_MIGRATION_ROWS}
        mapping = short_to_legacy
    else:
        mapping = {old: new for old, new, _ in ADDITIVE_CODE_MIGRATION_ROWS}

    for row in additives:
        if not isinstance(row, dict):
            continue
        raw = str(row.get("additive_code") or "").strip().upper()
        if raw in mapping:
            row["additive_code"] = mapping[raw]
    return spec_payload
