from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from app.auth.deps import require_roles, allow_roles_any, csrf_protect
try:
    from app.auth.deps import current_identity  # type: ignore
except Exception:
    async def current_identity(_request: Request):  # type: ignore
        return {"user": None, "roles": [], "csrf": None}
from app.quotes.schemas import QuoteCalculateRequest, QuickQuoteCalculateRequest, QuotePreviewResult
from app.quotes.service import calculate_preview as svc_calculate_preview, quick_calculate_preview as svc_quick_calc
from app.db.session import SessionLocal
from sqlalchemy import select
from app.db.models.domain import Product, ProductVersion, Customer
from app.db.models.rate_cards import Resin, Colour, Additive, Core
from app.products.schemas import ProductType, Geometry, PrintMethod, FinishMode

router = APIRouter(prefix="/api/quotes", tags=["quotes"])


@router.post("/{quote_id}/approve", dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())])
async def approve_quote(quote_id: int):
    # Business logic is out-of-scope; this endpoint exists to demonstrate guard wiring.
    return {"ok": True, "approved_quote_id": quote_id}


def get_product_service():
    class _Stub:
        def get_version(self, product_version_id: int):
            raise NotImplementedError("ProductService.get_version not implemented")
    return _Stub()


def get_ratecard_service():
    class _Stub:
        def get_ratebook(self, currency: str):
            raise NotImplementedError("RateCardService.get_ratebook not implemented")
    return _Stub()


@router.post(
    "/calculate",
    response_model=QuotePreviewResult,
    dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())],
)
async def calculate_quote_preview(
    payload: QuoteCalculateRequest,
    product_service=Depends(get_product_service),
    ratecard_service=Depends(get_ratecard_service),
):
    return svc_calculate_preview(payload, product_service=product_service, ratecard_service=ratecard_service)


@router.post(
    "/quick/calculate",
    response_model=QuotePreviewResult,
    dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())],
)
async def quick_quote_calculate(payload: QuickQuoteCalculateRequest, ratecard_service=Depends(get_ratecard_service)):
    return svc_quick_calc(payload, ratecard_service=ratecard_service)


@router.get("/bootstrap", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))])
async def quotes_bootstrap(identity=Depends(current_identity)):
    product_versions: list[dict] = []
    resins: list[dict] = []
    colours: list[dict] = []
    additives: list[dict] = []
    cores: list[dict] = []
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
        colours = [{"code": c[0], "name": c[1]} for c in db.execute(select(Colour.colour_code, Colour.name).order_by(Colour.colour_code)).all()]
        additives = [
            {"code": a[0], "name": a[1], "category": a[2] or ""}
            for a in db.execute(select(Additive.additive_code, Additive.name, Additive.category).order_by(Additive.category, Additive.additive_code)).all()
        ]
        cores = [{"type": c[0], "description": c[1] or ""} for c in db.execute(select(Core.core_type, Core.description).order_by(Core.core_type)).all()]

    return {
        "product_versions": product_versions,
        "resins": resins,
        "colours": colours,
        "additives": additives,
        "cores": cores,
        **enums,
    }
