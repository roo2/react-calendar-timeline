from __future__ import annotations

from decimal import Decimal
from typing import Optional
from .models import (
    SpecDTO,
    Dimensions,
    RateBook,
    MaterialBreakdown,
    PrintingBreakdown,
    ConversionBreakdown,
    WasteBreakdown,
    QuotePreviewResult,
    CostBreakdown,
    QuantityRequest,
    PrintMethod,
)
from .selectors import (
    blend_density,
    lookup_compound_material_cost_per_kg,
    lookup_resin_price_per_kg,
    lookup_colour_cost_per_kg,
    lookup_additives_cost_per_kg,
    select_printing_rate,
    select_printing_pricing_tier,
    select_conversion_rate,
)


def _mm_to_m(mm: Decimal) -> Decimal:
    return (mm / Decimal("1000"))


def _um_to_m(um: Decimal) -> Decimal:
    return (um / Decimal("1000000"))


def compute_dimensions(spec: SpecDTO) -> Dimensions:
    # Layflat per SDS-3 §3.2
    if spec.product_type == "U-Film":
        l = spec.ufilm_left_width_mm or Decimal("0")
        r = spec.ufilm_right_width_mm or Decimal("0")
        layflat_mm = spec.base_width_mm + l + r
    elif spec.geometry == "flat":
        layflat_mm = spec.base_width_mm
    elif spec.geometry == "gusset":
        g = spec.gusset_mm or Decimal("0")
        layflat_mm = spec.base_width_mm + (g * 2)
    elif spec.geometry == "bottom_gusset":
        layflat_mm = spec.base_width_mm
    elif spec.geometry == "centre_fold":
        layflat_mm = spec.base_width_mm / Decimal("2")
    else:
        layflat_mm = spec.base_width_mm

    unit_length_mm = None if spec.continuous_roll else (spec.base_length_mm or Decimal("0"))
    effective_length_m = Decimal("1") if spec.continuous_roll else _mm_to_m(unit_length_mm or Decimal("0"))

    area_per_unit_m2 = effective_length_m * _mm_to_m(layflat_mm)

    # Mass per unit: kg/m2 = density * thickness_m
    density = blend_density(list(spec.blend)) if spec.blend else Decimal("920")  # default LDPE density ~920 kg/m3
    thickness_m = _um_to_m(spec.thickness_um)
    kg_per_m2 = density * thickness_m
    kg_per_unit = area_per_unit_m2 * kg_per_m2

    return Dimensions(
        layflat_mm=layflat_mm,
        unit_length_mm=unit_length_mm,
        area_per_unit_m2=area_per_unit_m2,
        kg_per_unit=kg_per_unit,
    )


def compute_material_costs(spec: SpecDTO, dims: Dimensions, ratebook: RateBook, quantity_units: Optional[int], total_kg: Optional[Decimal]) -> MaterialBreakdown:
    resin_cost_per_kg = lookup_resin_price_per_kg(list(spec.blend), ratebook) if spec.blend else Decimal("0")
    colour_cost_per_kg = lookup_colour_cost_per_kg(spec.colour_code, spec.colour_strength_pct, ratebook)
    additives_cost_per_kg = lookup_additives_cost_per_kg(spec.additives, ratebook)
    material_cost_per_kg = lookup_compound_material_cost_per_kg(
        components=list(spec.blend),
        colour_code=spec.colour_code,
        strength_pct=spec.colour_strength_pct,
        additives=spec.additives,
        ratebook=ratebook,
    )

    if total_kg is not None:
        kg_total = total_kg
    elif quantity_units is not None:
        kg_total = dims.kg_per_unit * Decimal(quantity_units)
    else:
        kg_total = Decimal("0")

    total_material_cost = material_cost_per_kg * kg_total

    return MaterialBreakdown(
        kg_total=kg_total,
        resin_cost_per_kg=resin_cost_per_kg,
        colour_cost_per_kg=colour_cost_per_kg,
        additives_cost_per_kg=additives_cost_per_kg,
        total_material_cost=total_material_cost,
    )


def compute_printing_cost(spec: SpecDTO, web_length_m: Decimal, ratebook: RateBook) -> PrintingBreakdown:
    if spec.print_method == "none":
        return PrintingBreakdown(enabled=False, method="none", total_cost=Decimal("0"), setup_cost=Decimal("0"), rate_cost=Decimal("0"))

    # Prefer tiered pricing if configured (per-width/per-colour; includes min-length gating).
    if ratebook.printing_pricing_tiers:
        tier = select_printing_pricing_tier(
            method=spec.print_method,
            print_width_mm=spec.base_width_mm,
            num_colours=int(spec.num_colours or 0),
            web_length_m=web_length_m,
            ratebook=ratebook,
        )
        if not tier:
            return PrintingBreakdown(
                enabled=False,
                method=spec.print_method,
                total_cost=Decimal("0"),
                setup_cost=Decimal("0"),
                rate_cost=Decimal("0"),
            )

        rate_cost = (web_length_m / Decimal("1000")) * tier.cost_per_1000m
        if tier.method == "inline":
            min_charge = tier.min_charge or Decimal("0")
            total = max(min_charge, rate_cost)
            setup_cost = Decimal("0")
        else:
            setup_cost = tier.setup_fee or Decimal("0")
            total = setup_cost + rate_cost
        return PrintingBreakdown(
            enabled=True,
            method=spec.print_method,
            total_cost=total,
            setup_cost=setup_cost,
            rate_cost=rate_cost,
        )

    # Fallback to legacy single-row printing_rates.
    rate = select_printing_rate(spec.print_method, ratebook)
    setup = rate.setup_cost
    # Scale setup by colour count as a simple heuristic (can be refined)
    if spec.num_colours and spec.num_colours > 0:
        setup = setup + (Decimal(spec.num_colours - 1) * (rate.setup_cost / Decimal("2")))

    rate_cost = (web_length_m / Decimal("1000")) * rate.cost_per_1000m
    total = max(setup + rate_cost, rate.minimum_charge)

    return PrintingBreakdown(enabled=True, method=spec.print_method, total_cost=total, setup_cost=setup, rate_cost=rate_cost)


def compute_conversion_cost(spec: SpecDTO, quantity_units: Optional[int], ratebook: RateBook) -> ConversionBreakdown:
    if spec.finish_mode != "Cartons" or not quantity_units:
        return ConversionBreakdown(enabled=False, total_minutes=Decimal("0"), total_cost=Decimal("0"))
    rate = select_conversion_rate(ratebook)
    minutes = (Decimal(quantity_units) / rate.bags_per_minute) + rate.setup_minutes
    # Costing model left generic; treat as labour rate baked into setup conversion (tests can assert totals)
    # For MVP calculator, conversion rate does not include explicit $/min; assume 1 monetary unit per minute for predictability in tests unless extended via ratebook.
    cost_per_min = Decimal("1")
    total_cost = minutes * cost_per_min
    return ConversionBreakdown(enabled=True, total_minutes=minutes, total_cost=total_cost)


def compute_core_cost(web_length_m: Optional[Decimal], ratebook: RateBook) -> Decimal:
    if not ratebook.core or web_length_m is None:
        return Decimal("0")
    return ratebook.core.cost_per_meter * web_length_m


def compute_waste(material_cost_per_kg: Decimal, ratebook: RateBook) -> WasteBreakdown:
    total_minutes = sum((w.waste_minutes for w in ratebook.waste_adders), Decimal("0"))
    if total_minutes <= 0 or ratebook.extrusion_throughput_kg_per_hr <= 0:
        return WasteBreakdown(total_minutes=Decimal("0"), waste_kg=Decimal("0"), waste_cost=Decimal("0"))
    waste_kg = (total_minutes / Decimal("60")) * ratebook.extrusion_throughput_kg_per_hr
    waste_cost = waste_kg * material_cost_per_kg
    return WasteBreakdown(total_minutes=total_minutes, waste_kg=waste_kg, waste_cost=waste_cost)


def derive_totals_from_request(dims: Dimensions, req: QuantityRequest) -> tuple[Optional[int], Optional[Decimal], Optional[Decimal]]:
    units = req.units
    total_kg = req.total_kg
    total_m = req.total_m
    if units is not None and total_kg is None:
        total_kg = dims.kg_per_unit * Decimal(units)
    if total_m is None and not req.units and not req.total_kg and req.rolls:
        # Treat rolls as 1m per roll for MVP; tests can override with total_m in request for precision
        total_m = Decimal(req.rolls)
    return units, total_kg, total_m


def price_and_totals(
    dims: Dimensions,
    material: MaterialBreakdown,
    printing: PrintingBreakdown,
    conversion: ConversionBreakdown,
    core_cost: Decimal,
    waste: WasteBreakdown,
    margin: Decimal,
    units: Optional[int],
) -> QuotePreviewResult:
    material_cost = material.total_material_cost
    printing_cost = printing.total_cost
    conversion_cost = conversion.total_cost
    waste_cost = waste.waste_cost
    total_cost = material_cost + printing_cost + conversion_cost + core_cost + waste_cost
    final_price = (total_cost / (Decimal("1") - margin)) if margin < Decimal("1") else total_cost
    unit_price = (final_price / Decimal(units)) if units else None

    return QuotePreviewResult(
        kg_per_unit=dims.kg_per_unit if units else None,
        units_per_roll=None,
        totals_kg=material.kg_total,
        totals_units=units,
        cost_breakdown=CostBreakdown(
            material_cost=material_cost,
            printing_cost=printing_cost,
            conversion_cost=conversion_cost,
            core_cost=core_cost,
            waste_cost=waste_cost,
        ),
        total_cost=total_cost,
        margin=margin,
        # Do not quantize final_price/unit_price here; frontend derives price_per_kg from them and rounds to 2dp for display.
        final_price=final_price,
        unit_price=unit_price,
    )


def preview_quote(spec: SpecDTO, ratebook: RateBook, req: QuantityRequest, margin: Decimal) -> QuotePreviewResult:
    dims = compute_dimensions(spec)
    units, total_kg, total_m = derive_totals_from_request(dims, req)
    material = compute_material_costs(spec, dims, ratebook, units, total_kg)
    web_length_m = total_m if total_m is not None else Decimal("0")
    printing = compute_printing_cost(spec, web_length_m, ratebook)
    conversion = compute_conversion_cost(spec, units, ratebook)
    core_cost = compute_core_cost(web_length_m, ratebook)
    material_cost_per_kg = Decimal("0")
    if material.kg_total > 0:
        material_cost_per_kg = material.total_material_cost / material.kg_total
    waste = compute_waste(material_cost_per_kg, ratebook)
    return price_and_totals(
        dims=dims,
        material=material,
        printing=printing,
        conversion=conversion,
        core_cost=core_cost,
        waste=waste,
        margin=margin,
        units=units,
    )


