from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.auth.deps import allow_roles_any
from app.db.models.rate_cards import Additive, Colour, Resin, ResinBlend, ResinBlendComponent
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

