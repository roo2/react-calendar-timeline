"""Product type + finish mode short code (e.g. PBR, CFC) — first segment of generated product codes."""

from __future__ import annotations

from typing import Any

PRODUCT_TYPE_PREFIX: dict[str, str] = {
    "BAG": "PB",
    "TUBE": "PT",
    "SLEEVE": "SV",
    "SHEET": "ST",
    "CENTERFOLD": "CF",
    "U-FILM": "UF",
    "UFILM": "UF",
    "J-FILM": "JF",
    "JFILM": "JF",
}


def _up(v: Any) -> str:
    if v is None:
        return ""
    s = str(v).strip()
    if "." in s:
        s = s.split(".")[-1]
    return s.upper()


def product_type_prefix(product_type: Any) -> str:
    return PRODUCT_TYPE_PREFIX.get(_up(product_type), "XX")


def finish_mode_char(finish_mode: Any) -> str:
    return "C" if _up(finish_mode) == "CARTONS" else "R"


def product_type_finish_shortcode(*, product_type: Any, finish_mode: Any) -> str:
    """e.g. Bag + Rolls → ``PBR``; Centerfold + Cartons → ``CFC``."""
    return f"{product_type_prefix(product_type)}{finish_mode_char(finish_mode)}"


def product_type_finish_shortcode_from_spec(spec_payload: Any) -> str:
    if not isinstance(spec_payload, dict):
        return "XXR"
    identity = spec_payload.get("identity") if isinstance(spec_payload.get("identity"), dict) else {}
    return product_type_finish_shortcode(
        product_type=identity.get("product_type"),
        finish_mode=identity.get("finish_mode"),
    )
