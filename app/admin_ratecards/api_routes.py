from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select

from app.auth.deps import require_roles, csrf_protect
from app.db.models.rate_cards import Additive, Colour, Core, Ink, Plate, Resin, ResinBlend, ResinBlendComponent
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


class AdditiveDTO(BaseModel):
    additive_code: str
    name: str
    price_per_kg: float
    category: str | None = None
    notes: str | None = None


class AdditiveUpsertRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    price_per_kg: float = Field(..., ge=0)
    category: str | None = Field(default=None, max_length=64)
    notes: str | None = None


class ColourDTO(BaseModel):
    colour_code: str
    name: str
    price_per_kg: float
    opacity_multiplier: float
    currency: str


class ColourUpsertRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    price_per_kg: float = Field(..., ge=0)
    opacity_multiplier: float = Field(default=0, ge=0)
    currency: str = Field(..., min_length=3, max_length=3)


class CoreDTO(BaseModel):
    core_type: str
    description: str | None = None
    cost_per_meter: float
    kg_per_meter: float
    currency: str


class CoreUpsertRequest(BaseModel):
    description: str | None = None
    cost_per_meter: float = Field(..., ge=0)
    kg_per_meter: float = Field(..., ge=0)
    currency: str = Field(..., min_length=3, max_length=3)


class InkDTO(BaseModel):
    ink_code: str
    name: str


class InkUpsertRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


class PlateDTO(BaseModel):
    customer_id: str
    plate_code: str
    description: str | None = None


class PlateUpsertRequest(BaseModel):
    description: str | None = Field(default=None, max_length=255)


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


@router.get(
    "/additives",
    response_model=List[AdditiveDTO],
    dependencies=[Depends(require_roles("SYS_ADMIN"))],
)
async def list_additives():
    with SessionLocal() as db:
        rows = db.execute(select(Additive).order_by(Additive.additive_code.asc())).scalars().all()
        return [
            AdditiveDTO(
                additive_code=a.additive_code,
                name=a.name,
                price_per_kg=float(a.price_per_kg),
                category=a.category,
                notes=a.notes,
            )
            for a in rows
        ]


@router.put(
    "/additives/{additive_code}",
    response_model=AdditiveDTO,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def upsert_additive(additive_code: str, payload: AdditiveUpsertRequest):
    code = (additive_code or "").strip()
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="additive_code is required")

    with SessionLocal.begin() as db:
        a = db.get(Additive, code)
        if not a:
            a = Additive(
                additive_code=code,
                name=payload.name,
                price_per_kg=payload.price_per_kg,
                category=payload.category,
                notes=payload.notes,
            )
            db.add(a)
        else:
            a.name = payload.name
            a.price_per_kg = payload.price_per_kg
            a.category = payload.category
            a.notes = payload.notes

    with SessionLocal() as db:
        a2 = db.get(Additive, code)
        assert a2 is not None
        return AdditiveDTO(
            additive_code=a2.additive_code,
            name=a2.name,
            price_per_kg=float(a2.price_per_kg),
            category=a2.category,
            notes=a2.notes,
        )


@router.get(
    "/colours",
    response_model=List[ColourDTO],
    dependencies=[Depends(require_roles("SYS_ADMIN"))],
)
async def list_colours():
    with SessionLocal() as db:
        rows = db.execute(select(Colour).order_by(Colour.colour_code.asc())).scalars().all()
        return [
            ColourDTO(
                colour_code=c.colour_code,
                name=c.name,
                price_per_kg=float(c.price_per_kg),
                opacity_multiplier=float(c.opacity_multiplier),
                currency=c.currency,
            )
            for c in rows
        ]


@router.put(
    "/colours/{colour_code}",
    response_model=ColourDTO,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def upsert_colour(colour_code: str, payload: ColourUpsertRequest):
    code = (colour_code or "").strip()
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="colour_code is required")

    with SessionLocal.begin() as db:
        c = db.get(Colour, code)
        if not c:
            c = Colour(
                colour_code=code,
                name=payload.name,
                price_per_kg=payload.price_per_kg,
                opacity_multiplier=payload.opacity_multiplier,
                currency=payload.currency,
            )
            db.add(c)
        else:
            c.name = payload.name
            c.price_per_kg = payload.price_per_kg
            c.opacity_multiplier = payload.opacity_multiplier
            c.currency = payload.currency

    with SessionLocal() as db:
        c2 = db.get(Colour, code)
        assert c2 is not None
        return ColourDTO(
            colour_code=c2.colour_code,
            name=c2.name,
            price_per_kg=float(c2.price_per_kg),
            opacity_multiplier=float(c2.opacity_multiplier),
            currency=c2.currency,
        )


@router.get(
    "/cores",
    response_model=List[CoreDTO],
    dependencies=[Depends(require_roles("SYS_ADMIN"))],
)
async def list_cores():
    with SessionLocal() as db:
        rows = db.execute(select(Core).order_by(Core.core_type.asc())).scalars().all()
        return [
            CoreDTO(
                core_type=c.core_type,
                description=c.description,
                cost_per_meter=float(c.cost_per_meter),
                kg_per_meter=float(c.kg_per_meter),
                currency=c.currency,
            )
            for c in rows
        ]


@router.put(
    "/cores/{core_type}",
    response_model=CoreDTO,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def upsert_core(core_type: str, payload: CoreUpsertRequest):
    code = (core_type or "").strip()
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="core_type is required")

    with SessionLocal.begin() as db:
        c = db.get(Core, code)
        if not c:
            c = Core(
                core_type=code,
                description=payload.description,
                cost_per_meter=payload.cost_per_meter,
                kg_per_meter=payload.kg_per_meter,
                currency=payload.currency,
            )
            db.add(c)
        else:
            c.description = payload.description
            c.cost_per_meter = payload.cost_per_meter
            c.kg_per_meter = payload.kg_per_meter
            c.currency = payload.currency

    with SessionLocal() as db:
        c2 = db.get(Core, code)
        assert c2 is not None
        return CoreDTO(
            core_type=c2.core_type,
            description=c2.description,
            cost_per_meter=float(c2.cost_per_meter),
            kg_per_meter=float(c2.kg_per_meter),
            currency=c2.currency,
        )


@router.get(
    "/inks",
    response_model=List[InkDTO],
    dependencies=[Depends(require_roles("SYS_ADMIN"))],
)
async def list_inks():
    with SessionLocal() as db:
        rows = db.execute(select(Ink).order_by(Ink.ink_code.asc())).scalars().all()
        return [InkDTO(ink_code=i.ink_code, name=i.name) for i in rows]


@router.put(
    "/inks/{ink_code}",
    response_model=InkDTO,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def upsert_ink(ink_code: str, payload: InkUpsertRequest):
    code = (ink_code or "").strip()
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ink_code is required")

    with SessionLocal.begin() as db:
        row = db.get(Ink, code)
        if not row:
            row = Ink(ink_code=code, name=payload.name)
            db.add(row)
        else:
            row.name = payload.name

    with SessionLocal() as db:
        i2 = db.get(Ink, code)
        assert i2 is not None
        return InkDTO(ink_code=i2.ink_code, name=i2.name)


@router.get(
    "/plates",
    response_model=List[PlateDTO],
    dependencies=[Depends(require_roles("SYS_ADMIN"))],
)
async def list_plates():
    with SessionLocal() as db:
        rows = db.execute(select(Plate).order_by(Plate.customer_id.asc(), Plate.plate_code.asc())).scalars().all()
        return [PlateDTO(customer_id=p.customer_id, plate_code=p.plate_code, description=p.description) for p in rows]


@router.put(
    "/plates/{customer_id}/{plate_code}",
    response_model=PlateDTO,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def upsert_plate(customer_id: str, plate_code: str, payload: PlateUpsertRequest):
    cid = (customer_id or "").strip()
    code = (plate_code or "").strip()
    if not cid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="customer_id is required")
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="plate_code is required")

    with SessionLocal.begin() as db:
        row = db.get(Plate, {"customer_id": cid, "plate_code": code})
        if not row:
            row = Plate(customer_id=cid, plate_code=code, description=payload.description)
            db.add(row)
        else:
            row.description = payload.description

    with SessionLocal() as db:
        p2 = db.get(Plate, {"customer_id": cid, "plate_code": code})
        assert p2 is not None
        return PlateDTO(customer_id=p2.customer_id, plate_code=p2.plate_code, description=p2.description)

