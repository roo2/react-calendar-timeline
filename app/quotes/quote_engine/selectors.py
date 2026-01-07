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
    opaque_multiplier_enabled: bool = False,
) -> Decimal:
    if not colour_code or strength_pct is None:
        return Decimal("0")
    price = ratebook.colours_price_per_kg.get(colour_code)
    if price is None:
        raise MissingRateError(f"Missing colour price for code={colour_code}")
    base = price * (strength_pct / Decimal("100"))
    if opaque_multiplier_enabled:
        mult = ratebook.colours_opaque_multiplier.get(colour_code, Decimal("0"))
        base += price * mult
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


