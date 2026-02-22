from __future__ import annotations

from decimal import Decimal
from typing import Optional
from .models import (
    ResinComponent,
    RateBook,
    PrintingRate,
    ConversionRate,
    PrintMethod,
)


class MissingRateError(Exception):
    pass


def blend_density(components: list[ResinComponent]) -> Decimal:
    if not components:
        raise ValueError("Blend must have at least one component")
    # Weighted harmonic-like approach is not intended; SDS implies simple weighted average by pct
    total_pct = sum((c.pct for c in components), Decimal("0"))
    if total_pct != Decimal("100"):
        raise ValueError("Resin blend percentages must sum to 100")
    return sum((c.density * (c.pct / Decimal("100")) for c in components), Decimal("0"))


def lookup_resin_price_per_kg(components: list[ResinComponent], ratebook: RateBook) -> Decimal:
    if not components:
        return Decimal("0")
    total = Decimal("0")
    for c in components:
        price = ratebook.resins_price_per_kg.get(c.code)
        if price is None:
            raise MissingRateError(f"Missing resin price for code={c.code}")
        total += price * (c.pct / Decimal("100"))
    return total


def lookup_colour_cost_per_kg(
    colour_code: Optional[str],
    strength_pct: Optional[Decimal],
    ratebook: RateBook,
) -> Decimal:
    if not colour_code or strength_pct is None:
        return Decimal("0")
    price = ratebook.colours_price_per_kg.get(colour_code)
    if price is None:
        raise MissingRateError(f"Missing colour price for code={colour_code}")
    base = price * (strength_pct / Decimal("100"))
    return base


def lookup_additives_cost_per_kg(additives: dict[str, Decimal], ratebook: RateBook) -> Decimal:
    if not additives:
        return Decimal("0")
    total = Decimal("0")
    for code, pct in additives.items():
        price = ratebook.additives_price_per_kg.get(code)
        if price is None:
            raise MissingRateError(f"Missing additive price for code={code}")
        total += price * (pct / Decimal("100"))
    return total


def lookup_compound_material_cost_per_kg(
    components: list[ResinComponent],
    colour_code: Optional[str],
    strength_pct: Optional[Decimal],
    additives: dict[str, Decimal],
    ratebook: RateBook,
) -> Decimal:
    """
    Compound batching rule:
    - Resin blend totals 100%
    - Colours/additives are added on top (e.g. +2% additive => 102% total)
    So effective $/kg of compound is normalized by (1 + extras).
    """
    resin_base = lookup_resin_price_per_kg(components, ratebook) if components else Decimal("0")

    colour_extra = Decimal("0")
    colour_num = Decimal("0")
    if colour_code and strength_pct is not None:
        price = ratebook.colours_price_per_kg.get(colour_code)
        if price is None:
            raise MissingRateError(f"Missing colour price for code={colour_code}")
        strength_frac = strength_pct / Decimal("100")
        colour_extra = strength_frac
        colour_num = price * colour_extra

    additives_extra = Decimal("0")
    additives_num = Decimal("0")
    for code, pct in (additives or {}).items():
        if pct is None:
            continue
        price = ratebook.additives_price_per_kg.get(code)
        if price is None:
            raise MissingRateError(f"Missing additive price for code={code}")
        pct_frac = pct / Decimal("100")
        additives_extra += pct_frac
        additives_num += price * pct_frac

    denom = Decimal("1") + colour_extra + additives_extra
    if denom <= 0:
        return Decimal("0")
    return (resin_base + colour_num + additives_num) / denom


def select_printing_rate(method: PrintMethod, ratebook: RateBook) -> PrintingRate:
    if method == "none":
        return PrintingRate(method="none", cost_per_1000m=Decimal("0"))
    rate = ratebook.printing_rates.get(method)
    if rate is None:
        raise MissingRateError(f"Missing printing rate for method={method}")
    return rate


def select_conversion_rate(ratebook: RateBook) -> ConversionRate:
    if not ratebook.conversion_rate:
        raise MissingRateError("Missing conversion rate")
    return ratebook.conversion_rate


