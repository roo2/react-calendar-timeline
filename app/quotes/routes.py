from fastapi import APIRouter, Depends, status, Request, Form
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, RedirectResponse
from app.auth.deps import require_roles, allow_roles_any, csrf_protect
try:
    from app.auth.deps import current_identity  # type: ignore
except Exception:
    async def current_identity(_request: Request):  # type: ignore
        return {"user": None, "roles": [], "csrf": None}
from app.quotes.schemas import QuoteCalculateRequest, QuickQuoteCalculateRequest
from app.quotes.service import calculate_preview as svc_calculate_preview, quick_calculate_preview as svc_quick_calc

router = APIRouter(prefix="/quotes", tags=["quotes"])
templates = Jinja2Templates(directory="app/templates")


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


@router.post("/calculate", response_class=HTMLResponse, dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def calculate_quote_preview(
    request: Request,
    payload: QuoteCalculateRequest | None = None,
    product_service=Depends(get_product_service),
    ratecard_service=Depends(get_ratecard_service),
):
    try:
        if payload is None:
            # Accept form-encoded submissions (HTMX)
            form = await request.form()
            product_version_id = form.get("product_version_id")
            currency = form.get("currency") or "AUD"
            requested_margin_raw = form.get("requested_margin") or "0.2"
            # Quantity fields (only include populated ones)
            qty: dict = {}
            for key in ("units", "total_kg", "total_m", "rolls"):
                v = form.get(f"quantity.{key}")
                if v not in (None, "", "None"):
                    qty[key] = v
            payload = QuoteCalculateRequest(
                product_version_id=product_version_id,
                currency=currency,
                requested_margin=requested_margin_raw,
                quantity=qty,  # type: ignore[arg-type]
            )
        preview = svc_calculate_preview(payload, product_service=product_service, ratecard_service=ratecard_service)  # type: ignore[arg-type]
        return templates.TemplateResponse("quotes/preview.html", {"request": request, "preview": preview})
    except Exception as e:
        # Return a lightweight error block for HTMX swap
        return HTMLResponse(
            f"<div class='error-message'><strong>Error:</strong> {str(e)}</div>",
            status_code=400,
        )


@router.get("/new", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))], response_class=HTMLResponse)
async def new_quote(request: Request, identity=Depends(current_identity)):
    """
    Render quote creation form:
    - ProductVersion dropdown
    - Quantity intent
    - Currency & margin
    - HTMX preview
    """
    import logging
    logger = logging.getLogger("quotes")
    try:
        from sqlalchemy import select
        from app.db.session import SessionLocal
        from app.db.models.domain import Product, ProductVersion, Customer
        from app.db.models.rate_cards import Resin, Colour, Additive, Core
        from app.products.schemas import ProductType, Geometry, PrintMethod, FinishMode

        product_versions: list[dict] = []
        # Quick quote dropdown data
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

        try:
            with SessionLocal() as db:
                # List active product versions via Product.active_version_id
                stmt = (
                    select(ProductVersion, Product, Customer)
                    .join(Product, ProductVersion.id == Product.active_version_id, isouter=False)
                    .join(Customer, Product.customer_id == Customer.id, isouter=True)
                    .order_by(Product.code, ProductVersion.version_number.desc())
                )
                results = db.execute(stmt).all()
                for pv, p, c in results:
                    customer_name = getattr(c, "name", None) or "Unknown"
                    product_versions.append(
                        {
                            "version_id": str(pv.id),
                            "display_name": f"{p.code} - v{pv.version_number} ({customer_name})",
                            "product_code": p.code,
                            "version_number": pv.version_number,
                        }
                    )

                # Populate quick-quote dropdowns
                resins = [{"code": r[0], "name": r[1]} for r in db.execute(
                    select(Resin.resin_code, Resin.name).order_by(Resin.resin_code)
                ).all()]
                colours = [{"code": c[0], "name": c[1]} for c in db.execute(
                    select(Colour.colour_code, Colour.name).order_by(Colour.colour_code)
                ).all()]
                additives = [{"code": a[0], "name": a[1], "category": a[2] or ""} for a in db.execute(
                    select(Additive.additive_code, Additive.name, Additive.category).order_by(Additive.category, Additive.additive_code)
                ).all()]
                cores = [{"type": c[0], "description": c[1] or ""} for c in db.execute(
                    select(Core.core_type, Core.description).order_by(Core.core_type)
                ).all()]
        except Exception as db_error:
            # Log and proceed with an empty list to keep the page usable
            logger.warning(f"Error fetching product versions: {db_error}")
            product_versions = []
            resins, colours, additives, cores = [], [], [], []

        return templates.TemplateResponse(
            "quotes/new.html",
            {
                "request": request,
                "title": "New Quote",
                "identity": identity,
                "product_versions": product_versions,
                "resins": resins,
                "colours": colours,
                "additives": additives,
                "cores": cores,
                **enums,
                "error": None,
            },
        )
    except Exception as e:
        # Last-resort: return a 500 with a friendly message
        logger.error(f"Error in new_quote route: {e}", exc_info=True)
        from fastapi import HTTPException

        raise HTTPException(status_code=500, detail=f"Error loading quote form: {str(e)}")


@router.get("/quick", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))], response_class=HTMLResponse)
async def quick_quote_form(request: Request, identity=Depends(current_identity)):
    """
    Redirect to unified page with quick section.
    """
    return RedirectResponse(url="/quotes/new#quick", status_code=303)


@router.post("/quick/calculate", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())], response_class=HTMLResponse)
async def quick_quote_calculate(request: Request, ratecard_service=Depends(get_ratecard_service)):
    """
    Accept quick-quote form fields, convert to SpecDTO, and return preview partial.
    """
    try:
        form = await request.form()
        # Build QuickQuoteCalculateRequest from form
        qty: dict = {}
        for key in ("units", "total_kg", "total_m", "rolls"):
            v = form.get(f"quantity.{key}")
            if v not in (None, "", "None"):
                qty[key] = v
        payload = QuickQuoteCalculateRequest(
            product_type=form.get("product_type") or "Bag",
            base_width_mm=int(form.get("base_width_mm") or 0),
            thickness_um=int(form.get("thickness_um") or 0),
            geometry=(form.get("geometry") or "Flat"),
            continuous_roll=(form.get("continuous_roll") in ("true", "on", "1")),
            base_length_mm=int(form.get("base_length_mm")) if form.get("base_length_mm") else None,
            gusset_mm=int(form.get("gusset_mm")) if form.get("gusset_mm") else None,
            resin_code=(form.get("resin_code") or None),
            colour_code=(form.get("colour_code") or None) if form.get("colour_code") not in ("", "None") else None,
            colour_strength_pct=form.get("colour_strength_pct") or None,
            opaque=(form.get("opaque") in ("on", "true", "1")),
            additive_code=(form.get("additive_code") or None),
            additive_pct=form.get("additive_pct") or None,
            print_method=(form.get("print_method") or "None"),
            num_colours=int(form.get("num_colours") or 0),
            finish_mode=(form.get("finish_mode") or "Rolls"),
            core_type=(form.get("core_type") or None),
            quantity=qty,  # type: ignore[arg-type]
            currency=form.get("currency") or "AUD",
            requested_margin=form.get("requested_margin") or "0.2",
        )
        preview = svc_quick_calc(payload, ratecard_service=ratecard_service)
        return templates.TemplateResponse("quotes/preview.html", {"request": request, "preview": preview})
    except Exception as e:
        return HTMLResponse(
            f"<div class='error-message'><strong>Error:</strong> {str(e)}</div>",
            status_code=400,
        )
