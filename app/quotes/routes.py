from fastapi import APIRouter, Depends, status, Request
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from app.auth.deps import require_roles, allow_roles_any, csrf_protect
from app.quotes.schemas import QuoteCalculateRequest
from app.quotes.service import calculate_preview as svc_calculate_preview

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
    payload: QuoteCalculateRequest,
    product_service=Depends(get_product_service),
    ratecard_service=Depends(get_ratecard_service),
):
    preview = svc_calculate_preview(payload, product_service=product_service, ratecard_service=ratecard_service)
    return templates.TemplateResponse("quotes/preview.html", {"request": request, "preview": preview})

