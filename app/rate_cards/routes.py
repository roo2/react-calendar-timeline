from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from app.auth.deps import allow_roles_any
from app.db.models.rate_cards import (
    Additive,
    Colour,
    ConversionFactor,
    ConversionSpeed,
    Core,
    Extruder,
    ExtrusionWasteFactor,
    Ink,
    Plate,
    PrintingRate,
    PrintingPricingTier,
    QuoteDefaults,
    Resin,
    ResinBlend,
    ResinBlendComponent,
    WasteAdder,
    QuotePackagingSettings,
)
from app.db.session import SessionLocal


router = APIRouter(prefix="/api/rate-cards", tags=["rate_cards"])


@router.get("/resins", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER", "OPERATOR"))])
async def list_resins():
    with SessionLocal() as db:
        rows = db.execute(select(Resin.resin_code, Resin.name).order_by(Resin.resin_code.asc())).all()
        return [{"resin_code": r[0], "name": r[1]} for r in rows]


@router.get("/resin-blends", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER", "OPERATOR"))])
async def list_resin_blends():
    with SessionLocal() as db:
        blends = db.execute(select(ResinBlend).order_by(ResinBlend.blend_code.asc())).scalars().all()
        out: list[dict] = []
        for b in blends:
            comps = (
                db.execute(
                    select(ResinBlendComponent)
                    .where(ResinBlendComponent.blend_code == b.blend_code)
                    .order_by(ResinBlendComponent.resin_code.asc())
                )
                .scalars()
                .all()
            )
            out.append(
                {
                    "blend_code": b.blend_code,
                    "name": b.name,
                    "components": [{"resin_code": c.resin_code, "pct": float(c.pct)} for c in comps],
                }
            )
        return out


@router.get("/colours", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER", "OPERATOR"))])
async def list_colours():
    with SessionLocal() as db:
        rows = db.execute(select(Colour.colour_code, Colour.name).order_by(Colour.sort_order.asc(), Colour.colour_code.asc())).all()
        return [{"colour_code": r[0], "name": r[1]} for r in rows]


@router.get("/additives", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER", "OPERATOR"))])
async def list_additives():
    with SessionLocal() as db:
        rows = db.execute(select(Additive.additive_code, Additive.name).order_by(Additive.additive_code.asc())).all()
        return [{"additive_code": r[0], "name": r[1]} for r in rows]


@router.get("/inks", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER", "OPERATOR"))])
async def list_inks(printer_type: str | None = Query(default=None)):
    with SessionLocal() as db:
        stmt = select(Ink.ink_code, Ink.name, Ink.printer_type).order_by(Ink.ink_code.asc())
        if printer_type:
            if printer_type in {"inline", "uteco"}:
                stmt = stmt.where(Ink.printer_type.in_([printer_type, "both"]))
            else:
                stmt = stmt.where(Ink.printer_type == printer_type)
        rows = db.execute(stmt).all()
        return [{"ink_code": r[0], "name": r[1], "printer_type": r[2]} for r in rows]


@router.get("/plates", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER", "OPERATOR"))])
async def list_plates(customer_id: str | None = Query(default=None)):
    with SessionLocal() as db:
        stmt = select(Plate.customer_id, Plate.plate_code, Plate.description, Plate.cylinder).order_by(Plate.plate_code.asc())
        if customer_id:
            stmt = stmt.where(Plate.customer_id == customer_id)
        rows = db.execute(stmt).all()
        return [
            {"customer_id": r[0], "plate_code": r[1], "description": r[2], "cylinder": r[3]}
            for r in rows
        ]


@router.get("/ratebook", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))])
async def get_ratebook():
    """
    Read-only pricing + rate configuration for frontend-side quote calculations.
    """
    with SessionLocal() as db:
        resins = db.execute(select(Resin.resin_code, Resin.price_per_kg, Resin.density)).all()
        additives = db.execute(select(Additive.additive_code, Additive.price_per_kg)).all()
        colours = db.execute(select(Colour.colour_code, Colour.price_per_kg)).all()
        cores = db.execute(select(Core.core_type, Core.cost_per_meter, Core.kg_per_meter)).all()
        extruders = db.execute(
            select(
                Extruder.extruder_code,
                Extruder.model,
                Extruder.decision_width_mm,
                Extruder.average_kg_hr,
                Extruder.cost_per_hr,
            ).order_by(Extruder.decision_width_mm.asc().nulls_last(), Extruder.extruder_code.asc())
        ).all()
        printing_rates = db.execute(
            select(
                PrintingRate.method,
                PrintingRate.min_meters,
                PrintingRate.cost_per_1000m,
                PrintingRate.setup_minutes,
                PrintingRate.duplex_supported,
            )
        ).all()
        printing_pricing_tiers = db.execute(
            select(
                PrintingPricingTier.method,
                PrintingPricingTier.max_print_width_mm,
                PrintingPricingTier.num_colours,
                PrintingPricingTier.min_meters,
                PrintingPricingTier.min_charge,
                PrintingPricingTier.setup_cost,
                PrintingPricingTier.setup_price,
                PrintingPricingTier.cost_per_1000m,
                PrintingPricingTier.price_per_1000m,
                PrintingPricingTier.meters_per_min,
            ).order_by(
                PrintingPricingTier.method.asc(),
                PrintingPricingTier.max_print_width_mm.asc(),
                PrintingPricingTier.num_colours.asc(),
            )
        ).all()
        qd_row = db.execute(select(QuoteDefaults).where(QuoteDefaults.id == 1)).scalar_one_or_none()
        conversion_speeds = db.execute(
            select(
                ConversionSpeed.min_gauge_um,
                ConversionSpeed.max_gauge_um,
                ConversionSpeed.min_length_mm,
                ConversionSpeed.max_length_mm,
                ConversionSpeed.bags_per_minute,
            )
        ).all()
        conversion_factors = db.execute(select(ConversionFactor.slug, ConversionFactor.value)).all()
        waste_adders = db.execute(select(WasteAdder.condition, WasteAdder.waste_minutes)).all()
        extrusion_waste_factors = db.execute(
            select(ExtrusionWasteFactor.slug, ExtrusionWasteFactor.minutes).order_by(ExtrusionWasteFactor.factor.asc())
        ).all()
        packaging_row = db.execute(
            select(QuotePackagingSettings).where(QuotePackagingSettings.id == 1)
        ).scalar_one_or_none()
        packing_factor_rolls = float(packaging_row.packing_factor_rolls) if packaging_row else 0.7
        packing_factor_cartons = float(packaging_row.packing_factor_cartons) if packaging_row else 0.5
        pallet_volume_m3 = float(packaging_row.pallet_volume_m3) if packaging_row else 1.0
        extrusion_retail_addon_per_kg = (
            float(getattr(qd_row, "extrusion_retail_addon_per_kg", 1.8) or 1.8) if qd_row is not None else 1.8
        )

    # Model assumptions (aligned with quotes UI / ratebook pricing):
    # - setup_cost is treated as 1 unit per minute
    # - minimum_charge is approximated by min_meters at the per-1000m rate (+ setup)
    out_printing: dict[str, dict] = {}
    for method, min_m, cost_1000m, setup_min, duplex in printing_rates:
        m = str(getattr(method, "value", method) or "").strip().lower()
        setup_minutes = int(setup_min or 0)
        setup_cost = float(setup_minutes)
        min_meters = float(min_m or 0)
        cost_per_1000m = float(cost_1000m or 0)
        minimum_charge = (min_meters / 1000.0) * cost_per_1000m + setup_cost
        out_printing[m] = {
            "method": m,
            "cost_per_1000m": cost_per_1000m,
            "setup_cost": setup_cost,
            "setup_minutes": setup_minutes,
            "minimum_charge": minimum_charge,
            "duplex_supported": bool(duplex),
        }

    return {
        "resins": {
            str(code): {"price_per_kg": float(ppk), "density": float(den)}
            for code, ppk, den in resins
        },
        "additives_price_per_kg": {str(code): float(ppk) for code, ppk in additives},
        "colours": {
            str(code): {
                "price_per_kg": float(ppk),
            }
            for code, ppk in colours
        },
        "cores": {
            str(ct): {"cost_per_meter": float(cpm), "kg_per_meter": float(kpm)}
            for ct, cpm, kpm in cores
        },
        "extruders": [
            {
                "extruder_code": str(code),
                "model": (str(model) if model is not None else None),
                "decision_width_mm": (int(dw) if dw is not None else None),
                "average_kg_hr": (int(avg) if avg is not None else None),
                "cost_per_hr": (float(cph) if cph is not None else None),
            }
            for code, model, dw, avg, cph in extruders
        ],
        "printing_rates": out_printing,
        "printing_pricing_tiers": [
            {
                "method": str(method),
                "max_print_width_mm": int(max_w),
                "num_colours": int(nc),
                "min_meters": int(min_m),
                "min_charge": (float(min_charge) if min_charge is not None else None),
                "setup_cost": float(setup_cost or 0),
                "setup_price": (float(setup_price) if setup_price is not None else None),
                "cost_per_1000m": float(cost_1000m),
                "price_per_1000m": float(price_1000m),
                "meters_per_min": (float(mpm) if mpm is not None else None),
            }
            for method, max_w, nc, min_m, min_charge, setup_cost, setup_price, cost_1000m, price_1000m, mpm in printing_pricing_tiers
        ],
        "extrusion_retail_addon_per_kg": extrusion_retail_addon_per_kg,
        "conversion_speeds": [
            {
                "min_gauge_um": int(min_g),
                "max_gauge_um": int(max_g),
                "min_length_mm": int(min_l),
                "max_length_mm": int(max_l),
                "bags_per_minute": float(bpm),
            }
            for min_g, max_g, min_l, max_l, bpm in conversion_speeds
        ],
        "conversion_factors": {str(slug): float(v) for slug, v in conversion_factors},
        "waste_adders": [{"condition": str(c), "waste_minutes": int(m or 0)} for c, m in waste_adders],
        "extrusion_waste_factors": [{"slug": str(slug), "minutes": int(m or 0)} for slug, m in extrusion_waste_factors],
        "extrusion_throughput_kg_per_hr": 0,
        "packing_factor_rolls": packing_factor_rolls,
        "packing_factor_cartons": packing_factor_cartons,
        "pallet_volume_m3": pallet_volume_m3,
    }
