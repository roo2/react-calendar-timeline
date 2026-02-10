from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select

from app.auth.deps import require_roles, csrf_protect
from app.db.models.rate_cards import Resin, ResinBlend, ResinBlendComponent
from app.db.session import SessionLocal


router = APIRouter(prefix="/api/admin/rate-cards", tags=["admin_ratecards"])


class ResinDTO(BaseModel):
    resin_code: str
    name: str
    density: float
    price_per_kg: float
    currency: str


class ResinUpsertRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    density: float = Field(..., gt=0)
    price_per_kg: float = Field(..., ge=0)
    currency: str = Field(..., min_length=3, max_length=3)


class ResinBlendComponentDTO(BaseModel):
    resin_code: str
    pct: float


class ResinBlendDTO(BaseModel):
    blend_code: str
    name: str
    components: List[ResinBlendComponentDTO]


class ResinBlendUpsertRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    components: List[ResinBlendComponentDTO] = Field(default_factory=list)


@router.get(
    "/resins",
    response_model=List[ResinDTO],
    dependencies=[Depends(require_roles("SYS_ADMIN"))],
)
async def list_resins():
    with SessionLocal() as db:
        rows = db.execute(select(Resin).order_by(Resin.resin_code.asc())).scalars().all()
        return [
            ResinDTO(
                resin_code=r.resin_code,
                name=r.name,
                density=float(r.density),
                price_per_kg=float(r.price_per_kg),
                currency=r.currency,
            )
            for r in rows
        ]


@router.put(
    "/resins/{resin_code}",
    response_model=ResinDTO,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def upsert_resin(resin_code: str, payload: ResinUpsertRequest):
    code = (resin_code or "").strip()
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="resin_code is required")

    with SessionLocal.begin() as db:
        r = db.get(Resin, code)
        created = False
        if not r:
            r = Resin(resin_code=code, name=payload.name, density=payload.density, price_per_kg=payload.price_per_kg, currency=payload.currency)
            db.add(r)
            created = True
        else:
            r.name = payload.name
            r.density = payload.density
            r.price_per_kg = payload.price_per_kg
            r.currency = payload.currency

    # Re-read for consistent serialization
    with SessionLocal() as db:
        r2 = db.get(Resin, code)
        assert r2 is not None
        if created:
            # FastAPI uses the response model regardless; status code remains 200 unless changed.
            # Keep behavior simple for the SPA.
            pass
        return ResinDTO(
            resin_code=r2.resin_code,
            name=r2.name,
            density=float(r2.density),
            price_per_kg=float(r2.price_per_kg),
            currency=r2.currency,
        )


@router.get(
    "/resin-blends",
    response_model=List[ResinBlendDTO],
    dependencies=[Depends(require_roles("SYS_ADMIN"))],
)
async def list_resin_blends():
    with SessionLocal() as db:
        blends = db.execute(select(ResinBlend).order_by(ResinBlend.blend_code.asc())).scalars().all()
        out: list[ResinBlendDTO] = []
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
                ResinBlendDTO(
                    blend_code=b.blend_code,
                    name=b.name,
                    components=[ResinBlendComponentDTO(resin_code=c.resin_code, pct=float(c.pct)) for c in comps],
                )
            )
        return out


@router.put(
    "/resin-blends/{blend_code}",
    response_model=ResinBlendDTO,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def upsert_resin_blend(blend_code: str, payload: ResinBlendUpsertRequest):
    code = (blend_code or "").strip()
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="blend_code is required")

    comps_in = payload.components or []
    if len(comps_in) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="components must not be empty")
    total = sum(float(c.pct or 0) for c in comps_in)
    if abs(total - 100.0) > 0.01:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="components must sum to 100")

    with SessionLocal.begin() as db:
        b = db.get(ResinBlend, code)
        if not b:
            b = ResinBlend(blend_code=code, name=payload.name)
            db.add(b)
        else:
            b.name = payload.name

        db.execute(delete(ResinBlendComponent).where(ResinBlendComponent.blend_code == code))
        for c in comps_in:
            rc = (c.resin_code or "").strip()
            if not rc:
                continue
            db.add(ResinBlendComponent(blend_code=code, resin_code=rc, pct=float(c.pct)))

    with SessionLocal() as db:
        b2 = db.get(ResinBlend, code)
        assert b2 is not None
        comps2 = (
            db.execute(
                select(ResinBlendComponent)
                .where(ResinBlendComponent.blend_code == code)
                .order_by(ResinBlendComponent.resin_code.asc())
            )
            .scalars()
            .all()
        )
        return ResinBlendDTO(
            blend_code=b2.blend_code,
            name=b2.name,
            components=[ResinBlendComponentDTO(resin_code=c.resin_code, pct=float(c.pct)) for c in comps2],
        )

