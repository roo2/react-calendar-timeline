from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select

from app.auth.deps import allow_roles_any, csrf_protect, require_roles

try:
    from app.auth.deps import current_identity  # type: ignore
except Exception:

    async def current_identity(_request: Request):  # type: ignore
        return {"user": None, "roles": [], "csrf": None}


from app.db.models.domain import Customer, Machine, Product, ProductVersion, SavedQuote
from app.db.models.enums import MachineType
from app.db.models.rate_cards import Additive, Colour, Core, QuoteDefaults, Resin
from app.db.session import SessionLocal
from app.products.schemas import FinishMode, Geometry, PrintMethod, ProductType
from app.quotes.schemas import (
    SavedQuoteCreateRequest,
    SavedQuoteResponse,
    SavedQuoteUpdateRequest,
)

router = APIRouter(prefix="/api/quotes", tags=["quotes"])


@router.post("/{quote_id}/approve", dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())])
async def approve_quote(quote_id: int):
    # Business logic is out-of-scope; this endpoint exists to demonstrate guard wiring.
    return {"ok": True, "approved_quote_id": quote_id}


@router.get("/bootstrap", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))])
async def quotes_bootstrap(_identity=Depends(current_identity)):
    product_versions: list[dict] = []
    resins: list[dict] = []
    colours: list[dict] = []
    additives: list[dict] = []
    cores: list[dict] = []
    extruders: list[dict] = []
    customers: list[dict] = []
    enums = {
        "product_types": [pt.value for pt in ProductType],
        "geometries": [g.value for g in Geometry],
        "print_methods": [pm.value for pm in PrintMethod],
        "finish_modes": [fm.value for fm in FinishMode],
    }
    with SessionLocal() as db:
        # Active product versions (via Product.active_version_id)
        stmt = (
            select(ProductVersion, Product, Customer)
            .join(Product, ProductVersion.id == Product.active_version_id, isouter=False)
            .join(Customer, Product.customer_id == Customer.id, isouter=True)
            .order_by(Product.code, ProductVersion.version_number.desc())
        )
        for pv, p, c in db.execute(stmt).all():
            customer_name = getattr(c, "name", None) or "Unknown"
            product_versions.append(
                {
                    "version_id": str(pv.id),
                    "display_name": f"{p.code} - v{pv.version_number} ({customer_name})",
                    "product_code": p.code,
                    "version_number": pv.version_number,
                }
            )

        resins = [{"code": r[0], "name": r[1]} for r in db.execute(select(Resin.resin_code, Resin.name).order_by(Resin.resin_code)).all()]
        colours = [{"code": c[0], "name": c[1]} for c in db.execute(select(Colour.colour_code, Colour.name).order_by(Colour.sort_order.asc(), Colour.colour_code)).all()]
        additives = [
            {"code": a[0], "name": a[1]}
            for a in db.execute(select(Additive.additive_code, Additive.name).order_by(Additive.additive_code)).all()
        ]
        cores = [{"type": c[0], "description": c[1] or ""} for c in db.execute(select(Core.core_type, Core.description).order_by(Core.core_type)).all()]

        for code, cap in db.execute(
            select(Machine.code, Machine.capability)
            .where(Machine.active.is_(True))
            .where(Machine.type == MachineType.EXTRUDER)
            .order_by(Machine.code.asc())
        ).all():
            cap = cap or {}
            extruders.append(
                {
                    "code": code,
                    "width_range_mm": cap.get("width_range_mm"),
                    "gauge_range_um": cap.get("gauge_range_um"),
                }
            )
        customers = [
            {"id": str(c.id), "code": getattr(c, "code", None), "name": c.name}
            for c in db.execute(select(Customer).order_by(Customer.name)).scalars().all()
        ]

        qd = db.execute(select(QuoteDefaults).where(QuoteDefaults.id == 1)).scalar_one_or_none()
        default_margin_pct = float(qd.default_margin_pct) if qd is not None else 37.0

    return {
        "product_versions": product_versions,
        "customers": customers,
        "resins": resins,
        "colours": colours,
        "additives": additives,
        "cores": cores,
        "extruders": extruders,
        "default_margin_pct": default_margin_pct,
        **enums,
    }


def _saved_quote_to_response(q: SavedQuote, customer_name: Optional[str] = None) -> SavedQuoteResponse:
    return SavedQuoteResponse(
        id=q.id,
        customer_id=q.customer_id,
        customer_name=customer_name,
        payload=q.payload or {},
        cost_per_kg=str(q.cost_per_kg) if q.cost_per_kg is not None else None,
        price_per_kg=str(q.price_per_kg) if q.price_per_kg is not None else None,
        created_at=str(q.created_at) if getattr(q, "created_at", None) else None,
        updated_at=str(q.updated_at) if getattr(q, "updated_at", None) else None,
    )


@router.get(
    "/saved",
    response_model=list[SavedQuoteResponse],
    dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))],
)
async def list_saved_quotes(customer_id: Optional[str] = Query(default=None)):
    """List saved quotes, optionally filtered by customer_id."""
    with SessionLocal() as db:
        stmt = (
            select(SavedQuote, Customer)
            .join(Customer, SavedQuote.customer_id == Customer.id)
            .order_by(SavedQuote.created_at.desc())
        )
        if customer_id:
            stmt = stmt.where(SavedQuote.customer_id == customer_id)
        rows = db.execute(stmt).all()
        return [
            _saved_quote_to_response(q, customer_name=c.name if c else None)
            for q, c in rows
        ]


@router.get(
    "/saved/{quote_id}",
    response_model=SavedQuoteResponse,
    dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))],
)
async def get_saved_quote(quote_id: str):
    with SessionLocal() as db:
        q = db.get(SavedQuote, quote_id)
        if not q:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quote not found")
        c = db.get(Customer, q.customer_id) if q.customer_id else None
        return _saved_quote_to_response(q, customer_name=c.name if c else None)


@router.post(
    "/saved",
    response_model=SavedQuoteResponse,
    dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())],
)
async def create_saved_quote(payload: SavedQuoteCreateRequest):
    with SessionLocal.begin() as db:
        if not db.get(Customer, payload.customer_id):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Customer not found")
        q = SavedQuote(
            customer_id=payload.customer_id,
            payload=payload.payload,
            cost_per_kg=payload.cost_per_kg,
            price_per_kg=payload.price_per_kg,
        )
        db.add(q)
        db.flush()
        db.refresh(q)
        out = _saved_quote_to_response(q)
    return out


@router.put(
    "/saved/{quote_id}",
    response_model=SavedQuoteResponse,
    dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())],
)
async def update_saved_quote(quote_id: str, payload: SavedQuoteUpdateRequest):
    with SessionLocal.begin() as db:
        q = db.get(SavedQuote, quote_id)
        if not q:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quote not found")
        if payload.payload is not None:
            q.payload = payload.payload
        if payload.cost_per_kg is not None:
            q.cost_per_kg = payload.cost_per_kg
        if payload.price_per_kg is not None:
            q.price_per_kg = payload.price_per_kg
        db.flush()
        db.refresh(q)
        out = _saved_quote_to_response(q)
    return out
