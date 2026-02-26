from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import case, delete, select
from sqlalchemy.exc import IntegrityError
import re
import uuid

from app.auth.deps import require_roles, csrf_protect
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
    PrintingPricingTier,
    Resin,
    ResinBlend,
    ResinBlendComponent,
)
from app.db.session import SessionLocal


router = APIRouter(prefix="/api/admin/rate-cards", tags=["admin_ratecards"])

_WASTE_FACTOR_SLUG_OVERRIDES: dict[str, str] = {
    # Stable slugs for custom logic lookups.
    "Colour (not clear)": "colour_not_clear",
    "Simple Job": "simple_job",
    "Gusset": "gusset",
    "Non standard Resin": "non_standard_resin",
    "Non standard Resin or Colour": "non_standard_resin_or_colour",
}


def _slugify_waste_factor(factor: str) -> str:
    s = (factor or "").strip()
    if s in _WASTE_FACTOR_SLUG_OVERRIDES:
        return _WASTE_FACTOR_SLUG_OVERRIDES[s]
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s[:64] if s else "waste_factor"


class ResinDTO(BaseModel):
    resin_code: str
    name: str
    density: float
    price_per_kg: float


class ResinUpsertRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    density: float = Field(..., gt=0)
    price_per_kg: float = Field(..., ge=0)


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
    notes: str | None = None


class AdditiveUpsertRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    price_per_kg: float = Field(..., ge=0)
    notes: str | None = None


class ColourDTO(BaseModel):
    colour_code: str
    name: str
    price_per_kg: float


class ColourUpsertRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    price_per_kg: float = Field(..., ge=0)


class CoreDTO(BaseModel):
    core_type: str
    description: str | None = None
    cost_per_meter: float
    kg_per_meter: float


class CoreUpsertRequest(BaseModel):
    description: str | None = None
    cost_per_meter: float = Field(..., ge=0)
    kg_per_meter: float = Field(..., ge=0)


class ConversionSpeedDTO(BaseModel):
    min_gauge_um: int
    max_gauge_um: int
    min_length_mm: int
    max_length_mm: int
    bags_per_minute: float


class ConversionSpeedUpsertRequest(BaseModel):
    bags_per_minute: float = Field(..., gt=0)


class ConversionFactorDTO(BaseModel):
    slug: str
    name: str
    value: float


class ConversionFactorUpsertRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    value: float


class InkDTO(BaseModel):
    ink_code: str
    name: str
    printer_type: str


class InkUpsertRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    printer_type: str = Field(default="inline", min_length=1, max_length=16)


class PlateDTO(BaseModel):
    customer_id: str
    plate_code: str
    description: str | None = None
    cylinder: str | None = None


class PlateUpsertRequest(BaseModel):
    description: str | None = Field(default=None, max_length=255)
    cylinder: str | None = Field(default=None, max_length=64)


class ExtruderDTO(BaseModel):
    extruder_code: str
    model: str | None = None
    film_width_min_mm: int | None = None
    film_width_max_mm: int | None = None
    decision_width_mm: int | None = None
    average_kg_hr: int | None = None
    ave_width: float | None = None


class ExtruderUpsertRequest(BaseModel):
    model: str | None = Field(default=None, max_length=64)
    film_width_min_mm: int | None = None
    film_width_max_mm: int | None = None
    decision_width_mm: int | None = None
    average_kg_hr: int | None = None
    ave_width: float | None = None


class ExtrusionWasteFactorDTO(BaseModel):
    factor: str
    minutes: int


class ExtrusionWasteFactorUpsertRequest(BaseModel):
    minutes: int = Field(..., ge=0)


class PrintingPricingTierDTO(BaseModel):
    method: str
    max_print_width_mm: int
    num_colours: int
    min_meters: int
    min_charge: float | None = None
    setup_fee: float | None = None
    cost_per_1000m: float


class PrintingPricingTierUpsertRequest(BaseModel):
    min_meters: int = Field(..., ge=0)
    min_charge: float | None = Field(default=None, ge=0)
    setup_fee: float | None = Field(default=None, ge=0)
    cost_per_1000m: float = Field(..., ge=0)


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
            r = Resin(resin_code=code, name=payload.name, density=payload.density, price_per_kg=payload.price_per_kg)
            db.add(r)
            created = True
        else:
            r.name = payload.name
            r.density = payload.density
            r.price_per_kg = payload.price_per_kg

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
        )


@router.delete(
    "/resins/{resin_code}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def delete_resin(resin_code: str):
    code = (resin_code or "").strip()
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="resin_code is required")
    try:
        with SessionLocal.begin() as db:
            row = db.get(Resin, code)
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="resin not found")
            db.delete(row)
    except IntegrityError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot delete resin (in use)")



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


@router.delete(
    "/resin-blends/{blend_code}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def delete_resin_blend(blend_code: str):
    code = (blend_code or "").strip()
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="blend_code is required")
    try:
        with SessionLocal.begin() as db:
            b = db.get(ResinBlend, code)
            if not b:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="resin blend not found")
            db.execute(delete(ResinBlendComponent).where(ResinBlendComponent.blend_code == code))
            db.delete(b)
    except IntegrityError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot delete resin blend (in use)")


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
                notes=payload.notes,
            )
            db.add(a)
        else:
            a.name = payload.name
            a.price_per_kg = payload.price_per_kg
            a.notes = payload.notes

    with SessionLocal() as db:
        a2 = db.get(Additive, code)
        assert a2 is not None
        return AdditiveDTO(
            additive_code=a2.additive_code,
            name=a2.name,
            price_per_kg=float(a2.price_per_kg),
            notes=a2.notes,
        )


@router.delete(
    "/additives/{additive_code}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def delete_additive(additive_code: str):
    code = (additive_code or "").strip()
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="additive_code is required")
    try:
        with SessionLocal.begin() as db:
            row = db.get(Additive, code)
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="additive not found")
            db.delete(row)
    except IntegrityError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot delete additive (in use)")



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
            )
            db.add(c)
        else:
            c.name = payload.name
            c.price_per_kg = payload.price_per_kg

    with SessionLocal() as db:
        c2 = db.get(Colour, code)
        assert c2 is not None
        return ColourDTO(
            colour_code=c2.colour_code,
            name=c2.name,
            price_per_kg=float(c2.price_per_kg),
        )


@router.delete(
    "/colours/{colour_code}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def delete_colour(colour_code: str):
    code = (colour_code or "").strip()
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="colour_code is required")
    try:
        with SessionLocal.begin() as db:
            row = db.get(Colour, code)
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="colour not found")
            db.delete(row)
    except IntegrityError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot delete colour (in use)")



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
            )
            db.add(c)
        else:
            c.description = payload.description
            c.cost_per_meter = payload.cost_per_meter
            c.kg_per_meter = payload.kg_per_meter

    with SessionLocal() as db:
        c2 = db.get(Core, code)
        assert c2 is not None
        return CoreDTO(
            core_type=c2.core_type,
            description=c2.description,
            cost_per_meter=float(c2.cost_per_meter),
            kg_per_meter=float(c2.kg_per_meter),
        )


@router.delete(
    "/cores/{core_type}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def delete_core(core_type: str):
    code = (core_type or "").strip()
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="core_type is required")
    try:
        with SessionLocal.begin() as db:
            row = db.get(Core, code)
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="core not found")
            db.delete(row)
    except IntegrityError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot delete core (in use)")



@router.get(
    "/conversion-speeds",
    response_model=List[ConversionSpeedDTO],
    dependencies=[Depends(require_roles("SYS_ADMIN"))],
)
async def list_conversion_speeds():
    with SessionLocal() as db:
        rows = (
            db.execute(
                select(ConversionSpeed).order_by(
                    ConversionSpeed.min_gauge_um.asc(),
                    ConversionSpeed.max_gauge_um.asc(),
                    ConversionSpeed.min_length_mm.asc(),
                    ConversionSpeed.max_length_mm.asc(),
                )
            )
            .scalars()
            .all()
        )
        return [
            ConversionSpeedDTO(
                min_gauge_um=r.min_gauge_um,
                max_gauge_um=r.max_gauge_um,
                min_length_mm=r.min_length_mm,
                max_length_mm=r.max_length_mm,
                bags_per_minute=float(r.bags_per_minute),
            )
            for r in rows
        ]


@router.put(
    "/conversion-speeds/{min_gauge_um}/{max_gauge_um}/{min_length_mm}/{max_length_mm}",
    response_model=ConversionSpeedDTO,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def upsert_conversion_speed(
    min_gauge_um: int,
    max_gauge_um: int,
    min_length_mm: int,
    max_length_mm: int,
    payload: ConversionSpeedUpsertRequest,
):
    if min_gauge_um < 0 or max_gauge_um < 0 or min_length_mm < 0 or max_length_mm < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ranges must be >= 0")
    if max_gauge_um < min_gauge_um:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="max_gauge_um must be >= min_gauge_um")
    if max_length_mm < min_length_mm:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="max_length_mm must be >= min_length_mm")

    with SessionLocal.begin() as db:
        row = (
            db.execute(
                select(ConversionSpeed).where(
                    ConversionSpeed.min_gauge_um == min_gauge_um,
                    ConversionSpeed.max_gauge_um == max_gauge_um,
                    ConversionSpeed.min_length_mm == min_length_mm,
                    ConversionSpeed.max_length_mm == max_length_mm,
                )
            )
            .scalars()
            .first()
        )
        if not row:
            row = ConversionSpeed(
                id=str(uuid.uuid4()),
                min_gauge_um=min_gauge_um,
                max_gauge_um=max_gauge_um,
                min_length_mm=min_length_mm,
                max_length_mm=max_length_mm,
                bags_per_minute=payload.bags_per_minute,
            )
            db.add(row)
        else:
            row.bags_per_minute = payload.bags_per_minute

    with SessionLocal() as db:
        row2 = (
            db.execute(
                select(ConversionSpeed).where(
                    ConversionSpeed.min_gauge_um == min_gauge_um,
                    ConversionSpeed.max_gauge_um == max_gauge_um,
                    ConversionSpeed.min_length_mm == min_length_mm,
                    ConversionSpeed.max_length_mm == max_length_mm,
                )
            )
            .scalars()
            .first()
        )
        assert row2 is not None
        return ConversionSpeedDTO(
            min_gauge_um=row2.min_gauge_um,
            max_gauge_um=row2.max_gauge_um,
            min_length_mm=row2.min_length_mm,
            max_length_mm=row2.max_length_mm,
            bags_per_minute=float(row2.bags_per_minute),
        )


@router.delete(
    "/conversion-speeds/{min_gauge_um}/{max_gauge_um}/{min_length_mm}/{max_length_mm}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def delete_conversion_speed(min_gauge_um: int, max_gauge_um: int, min_length_mm: int, max_length_mm: int):
    try:
        with SessionLocal.begin() as db:
            row = (
                db.execute(
                    select(ConversionSpeed).where(
                        ConversionSpeed.min_gauge_um == min_gauge_um,
                        ConversionSpeed.max_gauge_um == max_gauge_um,
                        ConversionSpeed.min_length_mm == min_length_mm,
                        ConversionSpeed.max_length_mm == max_length_mm,
                    )
                )
                .scalars()
                .first()
            )
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="conversion speed not found")
            db.delete(row)
    except IntegrityError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot delete conversion speed (in use)")


@router.get(
    "/conversion-factors",
    response_model=List[ConversionFactorDTO],
    dependencies=[Depends(require_roles("SYS_ADMIN"))],
)
async def list_conversion_factors():
    with SessionLocal() as db:
        rows = db.execute(select(ConversionFactor).order_by(ConversionFactor.slug.asc())).scalars().all()
        return [ConversionFactorDTO(slug=r.slug, name=r.name, value=float(r.value)) for r in rows]


@router.put(
    "/conversion-factors/{slug}",
    response_model=ConversionFactorDTO,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def upsert_conversion_factor(slug: str, payload: ConversionFactorUpsertRequest):
    s = (slug or "").strip()
    if not s:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="slug is required")

    with SessionLocal.begin() as db:
        row = db.get(ConversionFactor, s)
        if not row:
            row = ConversionFactor(slug=s, name=payload.name, value=payload.value)
            db.add(row)
        else:
            row.name = payload.name
            row.value = payload.value

    with SessionLocal() as db:
        r2 = db.get(ConversionFactor, s)
        assert r2 is not None
        return ConversionFactorDTO(slug=r2.slug, name=r2.name, value=float(r2.value))


@router.delete(
    "/conversion-factors/{slug}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def delete_conversion_factor(slug: str):
    s = (slug or "").strip()
    if not s:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="slug is required")
    try:
        with SessionLocal.begin() as db:
            row = db.get(ConversionFactor, s)
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="conversion factor not found")
            db.delete(row)
    except IntegrityError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot delete conversion factor (in use)")


@router.get(
    "/inks",
    response_model=List[InkDTO],
    dependencies=[Depends(require_roles("SYS_ADMIN"))],
)
async def list_inks():
    with SessionLocal() as db:
        rows = db.execute(select(Ink).order_by(Ink.ink_code.asc())).scalars().all()
        return [InkDTO(ink_code=i.ink_code, name=i.name, printer_type=getattr(i, "printer_type", "inline") or "inline") for i in rows]


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
            row = Ink(ink_code=code, name=payload.name, printer_type=(payload.printer_type or "inline"))
            db.add(row)
        else:
            row.name = payload.name
            row.printer_type = (payload.printer_type or getattr(row, "printer_type", None) or "inline")

    with SessionLocal() as db:
        i2 = db.get(Ink, code)
        assert i2 is not None
        return InkDTO(ink_code=i2.ink_code, name=i2.name, printer_type=getattr(i2, "printer_type", "inline") or "inline")


@router.delete(
    "/inks/{ink_code}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def delete_ink(ink_code: str):
    code = (ink_code or "").strip()
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ink_code is required")
    try:
        with SessionLocal.begin() as db:
            row = db.get(Ink, code)
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ink not found")
            db.delete(row)
    except IntegrityError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot delete ink (in use)")



@router.get(
    "/plates",
    response_model=List[PlateDTO],
    dependencies=[Depends(require_roles("SYS_ADMIN"))],
)
async def list_plates():
    with SessionLocal() as db:
        rows = db.execute(select(Plate).order_by(Plate.customer_id.asc(), Plate.plate_code.asc())).scalars().all()
        return [PlateDTO(customer_id=p.customer_id, plate_code=p.plate_code, description=p.description, cylinder=p.cylinder) for p in rows]


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
            row = Plate(customer_id=cid, plate_code=code, description=payload.description, cylinder=payload.cylinder)
            db.add(row)
        else:
            row.description = payload.description
            row.cylinder = payload.cylinder

    with SessionLocal() as db:
        p2 = db.get(Plate, {"customer_id": cid, "plate_code": code})
        assert p2 is not None
        return PlateDTO(customer_id=p2.customer_id, plate_code=p2.plate_code, description=p2.description, cylinder=p2.cylinder)


@router.delete(
    "/plates/{customer_id}/{plate_code}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def delete_plate(customer_id: str, plate_code: str):
    cid = (customer_id or "").strip()
    code = (plate_code or "").strip()
    if not cid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="customer_id is required")
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="plate_code is required")
    try:
        with SessionLocal.begin() as db:
            row = db.get(Plate, {"customer_id": cid, "plate_code": code})
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="plate not found")
            db.delete(row)
    except IntegrityError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot delete plate (in use)")



@router.get(
    "/extruders",
    response_model=List[ExtruderDTO],
    dependencies=[Depends(require_roles("SYS_ADMIN"))],
)
async def list_extruders():
    with SessionLocal() as db:
        rows = (
            db.execute(
                select(Extruder).order_by(
                    Extruder.decision_width_mm.desc(),
                    Extruder.extruder_code.asc(),
                )
            )
            .scalars()
            .all()
        )
        return [
            ExtruderDTO(
                extruder_code=e.extruder_code,
                model=e.model,
                film_width_min_mm=e.film_width_min_mm,
                film_width_max_mm=e.film_width_max_mm,
                decision_width_mm=e.decision_width_mm,
                average_kg_hr=e.average_kg_hr,
                ave_width=float(e.ave_width) if e.ave_width is not None else None,
            )
            for e in rows
        ]


@router.put(
    "/extruders/{extruder_code}",
    response_model=ExtruderDTO,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def upsert_extruder(extruder_code: str, payload: ExtruderUpsertRequest):
    code = (extruder_code or "").strip()
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="extruder_code is required")

    with SessionLocal.begin() as db:
        row = db.get(Extruder, code)
        if not row:
            row = Extruder(extruder_code=code)
            db.add(row)
        row.model = payload.model
        row.film_width_min_mm = payload.film_width_min_mm
        row.film_width_max_mm = payload.film_width_max_mm
        row.decision_width_mm = payload.decision_width_mm
        row.average_kg_hr = payload.average_kg_hr
        row.ave_width = payload.ave_width

    with SessionLocal() as db:
        e2 = db.get(Extruder, code)
        assert e2 is not None
        return ExtruderDTO(
            extruder_code=e2.extruder_code,
            model=e2.model,
            film_width_min_mm=e2.film_width_min_mm,
            film_width_max_mm=e2.film_width_max_mm,
            decision_width_mm=e2.decision_width_mm,
            average_kg_hr=e2.average_kg_hr,
            ave_width=float(e2.ave_width) if e2.ave_width is not None else None,
        )


@router.delete(
    "/extruders/{extruder_code}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def delete_extruder(extruder_code: str):
    code = (extruder_code or "").strip()
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="extruder_code is required")
    try:
        with SessionLocal.begin() as db:
            row = db.get(Extruder, code)
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="extruder not found")
            db.delete(row)
    except IntegrityError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot delete extruder (in use)")



@router.get(
    "/extrusion-waste-factors",
    response_model=List[ExtrusionWasteFactorDTO],
    dependencies=[Depends(require_roles("SYS_ADMIN"))],
)
async def list_extrusion_waste_factors():
    with SessionLocal() as db:
        rows = (
            db.execute(
                select(ExtrusionWasteFactor).order_by(
                    case((ExtrusionWasteFactor.slug == "simple_job", 0), else_=1),
                    ExtrusionWasteFactor.factor.asc(),
                )
            )
            .scalars()
            .all()
        )
        return [ExtrusionWasteFactorDTO(factor=w.factor, minutes=int(w.minutes)) for w in rows]


@router.put(
    "/extrusion-waste-factors/{factor}",
    response_model=ExtrusionWasteFactorDTO,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def upsert_extrusion_waste_factor(factor: str, payload: ExtrusionWasteFactorUpsertRequest):
    key = (factor or "").strip()
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="factor is required")

    with SessionLocal.begin() as db:
        row = db.get(ExtrusionWasteFactor, key)
        if not row:
            row = ExtrusionWasteFactor(factor=key, slug=_slugify_waste_factor(key), minutes=payload.minutes)
            db.add(row)
        else:
            row.minutes = payload.minutes
            if not getattr(row, "slug", None):
                row.slug = _slugify_waste_factor(key)

    with SessionLocal() as db:
        w2 = db.get(ExtrusionWasteFactor, key)
        assert w2 is not None
        return ExtrusionWasteFactorDTO(factor=w2.factor, minutes=int(w2.minutes))


@router.delete(
    "/extrusion-waste-factors/{factor}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def delete_extrusion_waste_factor(factor: str):
    key = (factor or "").strip()
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="factor is required")
    try:
        with SessionLocal.begin() as db:
            row = db.get(ExtrusionWasteFactor, key)
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="waste factor not found")
            db.delete(row)
    except IntegrityError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot delete waste factor (in use)")



@router.get(
    "/printing-pricing-tiers",
    response_model=List[PrintingPricingTierDTO],
    dependencies=[Depends(require_roles("SYS_ADMIN"))],
)
async def list_printing_pricing_tiers():
    with SessionLocal() as db:
        rows = (
            db.execute(
                select(PrintingPricingTier).order_by(
                    PrintingPricingTier.method.asc(),
                    PrintingPricingTier.max_print_width_mm.asc(),
                    PrintingPricingTier.num_colours.asc(),
                )
            )
            .scalars()
            .all()
        )
        return [
            PrintingPricingTierDTO(
                method=str(r.method),
                max_print_width_mm=int(r.max_print_width_mm),
                num_colours=int(r.num_colours),
                min_meters=int(r.min_meters),
                min_charge=float(r.min_charge) if r.min_charge is not None else None,
                setup_fee=float(r.setup_fee) if r.setup_fee is not None else None,
                cost_per_1000m=float(r.cost_per_1000m),
            )
            for r in rows
        ]


@router.put(
    "/printing-pricing-tiers/{method}/{max_print_width_mm}/{num_colours}",
    response_model=PrintingPricingTierDTO,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def upsert_printing_pricing_tier(
    method: str,
    max_print_width_mm: int,
    num_colours: int,
    payload: PrintingPricingTierUpsertRequest,
):
    m = (method or "").strip().lower()
    if m not in {"inline", "uteco"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="method must be inline or uteco")
    if max_print_width_mm <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="max_print_width_mm must be > 0")
    if num_colours < 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="num_colours must be >= 1")

    with SessionLocal.begin() as db:
        row = (
            db.execute(
                select(PrintingPricingTier).where(
                    PrintingPricingTier.method == m,
                    PrintingPricingTier.max_print_width_mm == max_print_width_mm,
                    PrintingPricingTier.num_colours == num_colours,
                )
            )
            .scalars()
            .first()
        )
        if not row:
            row = PrintingPricingTier(method=m, max_print_width_mm=max_print_width_mm, num_colours=num_colours)
            db.add(row)
        row.min_meters = payload.min_meters
        row.min_charge = payload.min_charge
        row.setup_fee = payload.setup_fee
        row.cost_per_1000m = payload.cost_per_1000m

    with SessionLocal() as db:
        r2 = (
            db.execute(
                select(PrintingPricingTier).where(
                    PrintingPricingTier.method == m,
                    PrintingPricingTier.max_print_width_mm == max_print_width_mm,
                    PrintingPricingTier.num_colours == num_colours,
                )
            )
            .scalars()
            .first()
        )
        assert r2 is not None
        return PrintingPricingTierDTO(
            method=str(r2.method),
            max_print_width_mm=int(r2.max_print_width_mm),
            num_colours=int(r2.num_colours),
            min_meters=int(r2.min_meters),
            min_charge=float(r2.min_charge) if r2.min_charge is not None else None,
            setup_fee=float(r2.setup_fee) if r2.setup_fee is not None else None,
            cost_per_1000m=float(r2.cost_per_1000m),
        )


@router.delete(
    "/printing-pricing-tiers/{method}/{max_print_width_mm}/{num_colours}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def delete_printing_pricing_tier(method: str, max_print_width_mm: int, num_colours: int):
    m = (method or "").strip().lower()
    if m not in {"inline", "uteco"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="method must be inline or uteco")
    if max_print_width_mm <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="max_print_width_mm must be > 0")
    if num_colours < 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="num_colours must be >= 1")
    try:
        with SessionLocal.begin() as db:
            row = (
                db.execute(
                    select(PrintingPricingTier).where(
                        PrintingPricingTier.method == m,
                        PrintingPricingTier.max_print_width_mm == max_print_width_mm,
                        PrintingPricingTier.num_colours == num_colours,
                    )
                )
                .scalars()
                .first()
            )
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="printing tier not found")
            db.delete(row)
    except IntegrityError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot delete printing tier (in use)")

