from __future__ import annotations

from decimal import Decimal
from typing import Any
from app.quotes.schemas import QuoteCalculateRequest, QuotePreviewResult as ApiQuotePreviewResult, CostBreakdown as ApiCostBreakdown, QuickQuoteCalculateRequest
from app.quotes.quote_engine.models import (
    SpecDTO,
    ResinComponent,
    RateBook,
    PrintingRate,
    ConversionRate,
    WasteAdder,
    QuotePreviewResult,
)
from app.quotes.quote_engine.calculator import preview_quote
from app.db.session import SessionLocal
from sqlalchemy import select
from app.db.models.rate_cards import Resin as ResinModel


def _map_spec(product_version: dict[str, Any]) -> SpecDTO:
    # Expect a dict-like payload with keys analogous to SDS-3
    spec = product_version.get("spec", product_version)
    blend = [
        ResinComponent(code=item["code"], pct=Decimal(str(item["pct"])), density=Decimal(str(item["density"])))
        for item in spec.get("blend", [])
    ]
    additives = {a["code"]: Decimal(str(a["pct"])) for a in spec.get("additives", [])}
    return SpecDTO(
        product_type=spec.get("product_type", "Bag"),
        geometry=spec.get("geometry", "flat"),
        base_width_mm=Decimal(str(spec["base_width_mm"])),
        thickness_um=Decimal(str(spec["thickness_um"])),
        base_length_mm=Decimal(str(spec["base_length_mm"])) if spec.get("base_length_mm") is not None else None,
        continuous_roll=bool(spec.get("continuous_roll", False)),
        gusset_mm=Decimal(str(spec["gusset_mm"])) if spec.get("gusset_mm") is not None else None,
        ufilm_left_width_mm=Decimal(str(spec["ufilm_left_width_mm"])) if spec.get("ufilm_left_width_mm") is not None else None,
        ufilm_right_width_mm=Decimal(str(spec["ufilm_right_width_mm"])) if spec.get("ufilm_right_width_mm") is not None else None,
        print_method=spec.get("print_method", "none"),
        num_colours=int(spec.get("num_colours", 0)),
        opacity_pct=Decimal(str(spec["opacity_pct"])) if spec.get("opacity_pct") is not None else None,
        duplex_print=bool(spec.get("duplex_print", False)),
        blend=blend,
        colour_code=spec.get("colour_code"),
        colour_strength_pct=Decimal(str(spec["colour_strength_pct"])) if spec.get("colour_strength_pct") is not None else None,
        additives=additives,
        finish_mode=spec.get("finish_mode", "Rolls"),
    )


def _map_ratebook(rb: dict[str, Any]) -> RateBook:
    printing_rates = {}
    for method, rec in rb.get("printing_rates", {}).items():
        printing_rates[method] = PrintingRate(
            method=method,
            cost_per_1000m=Decimal(str(rec.get("cost_per_1000m", "0"))),
            setup_cost=Decimal(str(rec.get("setup_cost", "0"))),
            setup_minutes=Decimal(str(rec.get("setup_minutes", "0"))),
            minimum_charge=Decimal(str(rec.get("minimum_charge", "0"))),
            duplex_supported=bool(rec.get("duplex_supported", True)),
        )
    conversion_rate = rb.get("conversion_rate")
    conversion = None
    if conversion_rate:
        conversion = ConversionRate(
            bags_per_minute=Decimal(str(conversion_rate["bags_per_minute"])),
            roll_change_penalty_minutes=Decimal(str(conversion_rate.get("roll_change_penalty_minutes", "0"))),
            setup_minutes=Decimal(str(conversion_rate.get("setup_minutes", "0"))),
        )
    waste_adders = [
        WasteAdder(condition=item.get("condition", ""), waste_minutes=Decimal(str(item["waste_minutes"])))
        for item in rb.get("waste_adders", [])
    ]
    return RateBook(
        resins_price_per_kg={k: Decimal(str(v)) for k, v in rb.get("resins_price_per_kg", {}).items()},
        additives_price_per_kg={k: Decimal(str(v)) for k, v in rb.get("additives_price_per_kg", {}).items()},
        colours_price_per_kg={k: Decimal(str(v)) for k, v in rb.get("colours_price_per_kg", {}).items()},
        printing_rates=printing_rates,
        conversion_rate=conversion,
        waste_adders=waste_adders,
        extrusion_throughput_kg_per_hr=Decimal(str(rb.get("extrusion_throughput_kg_per_hr", "0"))),
    )


def calculate_preview(
    req: QuoteCalculateRequest,
    product_service: Any,
    ratecard_service: Any,
) -> ApiQuotePreviewResult:
    """
    Orchestrates map → compute → map. Pure; providers injected by the route for testability.
    """
    product_version = product_service.get_version(req.product_version_id)
    ratebook_payload = ratecard_service.get_ratebook()
    spec = _map_spec(product_version)
    ratebook = _map_ratebook(ratebook_payload)
    # Invoke pure calculator
    result: QuotePreviewResult = preview_quote(
        spec=spec,
        ratebook=ratebook,
        req=req.quantity,  # type: ignore[arg-type]
        margin=req.requested_margin,
    )
    # Map to API schema (structures align closely)
    return ApiQuotePreviewResult(
        kg_per_unit=result.kg_per_unit,
        units_per_roll=result.units_per_roll,
        totals_kg=result.totals_kg,
        totals_units=result.totals_units,
        cost_breakdown=ApiCostBreakdown(
            material_cost=result.cost_breakdown.material_cost,
            printing_cost=result.cost_breakdown.printing_cost,
            conversion_cost=result.cost_breakdown.conversion_cost,
            core_cost=result.cost_breakdown.core_cost,
            waste_cost=result.cost_breakdown.waste_cost,
        ),
        total_cost=result.total_cost,
        margin=result.margin,
        final_price=result.final_price,
        unit_price=result.unit_price,
    )


def quick_calculate_preview(
    req: QuickQuoteCalculateRequest,
    ratecard_service: Any,
) -> ApiQuotePreviewResult:
    """
    Build a SpecDTO from quick-quote fields and compute preview using the pure engine.
    Looks up resin density from rate cards table.
    """
    # Map quick fields → SpecDTO
    blend_components: list[ResinComponent] = []
    try:
        resin_items = []
        if getattr(req, "blend", None):
            resin_items = [(c.resin_code, Decimal(str(c.pct))) for c in (req.blend or []) if getattr(c, "resin_code", None)]
        elif req.resin_code:
            resin_items = [(req.resin_code, Decimal("100"))]

        if resin_items:
            codes = [code for code, _pct in resin_items]
            density_map: dict[str, Decimal] = {}
            with SessionLocal() as db:
                for rc, den in db.execute(select(ResinModel.resin_code, ResinModel.density).where(ResinModel.resin_code.in_(codes))).all():
                    if den is not None:
                        # Resin densities are stored as kg/cm^3 in DB; quote engine expects kg/m^3.
                        density_map[str(rc)] = Decimal(str(den)) * Decimal("1000000")
            for code, pct in resin_items:
                density = density_map.get(code, Decimal("920"))
                blend_components.append(ResinComponent(code=code, pct=pct, density=density))
    except Exception:
        # Best-effort: default density and fall back to single-resin legacy path
        if req.resin_code:
            blend_components = [ResinComponent(code=req.resin_code, pct=Decimal("100"), density=Decimal("920"))]

    # Additives map (list preferred; fall back to legacy single optional)
    additives: dict[str, Decimal] = {}
    if getattr(req, "additives", None):
        for a in req.additives or []:
            code = (getattr(a, "additive_code", "") or "").strip()
            if not code:
                continue
            pct = getattr(a, "pct", None)
            if pct is None:
                continue
            additives[code] = Decimal(str(pct))
    elif req.additive_code and req.additive_pct is not None:
        additives[req.additive_code] = Decimal(str(req.additive_pct))

    # Colours: engine supports a single colour; use first row if provided, else legacy fields.
    colour_code = req.colour_code or None
    colour_strength_pct = req.colour_strength_pct
    if getattr(req, "colour_components", None):
        for c in req.colour_components or []:
            cc = (getattr(c, "colour_code", "") or "").strip()
            if not cc:
                continue
            colour_code = cc
            colour_strength_pct = getattr(c, "strength_pct", None)
            break

    spec = SpecDTO(
        product_type=req.product_type,
        geometry=req.geometry.value.lower() if hasattr(req.geometry, "value") else str(req.geometry).lower(),
        base_width_mm=Decimal(str(req.base_width_mm)),
        thickness_um=Decimal(str(req.thickness_um)),
        base_length_mm=Decimal(str(req.base_length_mm)) if (not req.continuous_roll and req.base_length_mm) else None,
        continuous_roll=bool(req.continuous_roll),
        gusset_mm=Decimal(str(req.gusset_mm)) if req.gusset_mm is not None else None,
        ufilm_left_width_mm=Decimal(str(req.gusset_mm)) if (req.product_type == "U-Film" and req.gusset_mm is not None) else None,
        ufilm_right_width_mm=Decimal(str(req.gusset_mm)) if (req.product_type == "U-Film" and req.gusset_mm is not None) else None,
        print_method=req.print_method.value.lower() if hasattr(req.print_method, "value") else str(req.print_method).lower(),
        num_colours=int(req.num_colours or 0),
        opacity_pct=Decimal("1") if req.opaque else None,
        duplex_print=False,
        blend=blend_components,
        colour_code=colour_code,
        colour_strength_pct=Decimal(str(colour_strength_pct)) if colour_strength_pct is not None else None,
        additives=additives,
        finish_mode=req.finish_mode.value if hasattr(req.finish_mode, "value") else str(req.finish_mode),
    )

    ratebook_payload = ratecard_service.get_ratebook()
    ratebook = _map_ratebook(ratebook_payload)
    result: QuotePreviewResult = preview_quote(
        spec=spec,
        ratebook=ratebook,
        req=req.quantity,  # type: ignore[arg-type]
        margin=req.requested_margin,
    )
    return ApiQuotePreviewResult(
        kg_per_unit=result.kg_per_unit,
        units_per_roll=result.units_per_roll,
        totals_kg=result.totals_kg,
        totals_units=result.totals_units,
        cost_breakdown=ApiCostBreakdown(
            material_cost=result.cost_breakdown.material_cost,
            printing_cost=result.cost_breakdown.printing_cost,
            conversion_cost=result.cost_breakdown.conversion_cost,
            core_cost=result.cost_breakdown.core_cost,
            waste_cost=result.cost_breakdown.waste_cost,
        ),
        total_cost=result.total_cost,
        margin=result.margin,
        final_price=result.final_price,
        unit_price=result.unit_price,
    )

