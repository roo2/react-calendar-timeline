from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from app.auth.deps import allow_roles_any
from app.db.models.rate_cards import (
    Additive,
    Colour,
    ConversionRate,
    Core,
    Ink,
    Plate,
    PrintingRate,
    Resin,
    ResinBlend,
    ResinBlendComponent,
    WasteAdder,
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
        rows = db.execute(select(Colour.colour_code, Colour.name).order_by(Colour.colour_code.asc())).all()
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
        printing_rates = db.execute(
            select(
                PrintingRate.method,
                PrintingRate.min_meters,
                PrintingRate.cost_per_1000m,
                PrintingRate.setup_minutes,
                PrintingRate.duplex_supported,
            )
        ).all()
        conversion_rates = db.execute(
            select(
                ConversionRate.min_gauge_um,
                ConversionRate.max_gauge_um,
                ConversionRate.min_length_mm,
                ConversionRate.max_length_mm,
                ConversionRate.bags_per_hour,
                ConversionRate.setup_minutes,
            )
        ).all()
        waste_adders = db.execute(select(WasteAdder.condition, WasteAdder.waste_minutes)).all()

    # Model assumptions (kept consistent with quote_engine defaults):
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
        "printing_rates": out_printing,
        "conversion_rates": [
            {
                "min_gauge_um": int(min_g),
                "max_gauge_um": int(max_g),
                "min_length_mm": int(min_l),
                "max_length_mm": int(max_l),
                "bags_per_hour": int(bph),
                "setup_minutes": int(setup_m or 0),
            }
            for min_g, max_g, min_l, max_l, bph, setup_m in conversion_rates
        ],
        "waste_adders": [{"condition": str(c), "waste_minutes": int(m or 0)} for c, m in waste_adders],
        "extrusion_throughput_kg_per_hr": 0,
    }
