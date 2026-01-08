from __future__ import annotations

from typing import List, Optional
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from app.auth.deps import require_roles, allow_roles_any, csrf_protect, current_identity
from app.orders.schemas import (
	CreateOrderRequest,
	CreateJobRequest,
	OrderListItemDTO,
	OrderDetailDTO,
	JobDTO,
)
from app.orders import service
from app.exceptions import DomainError
from app.db.session import SessionLocal
from app.db.models.domain import ProductVersion, Product
from sqlalchemy import select

router = APIRouter(prefix="/orders", tags=["orders"])
templates = Jinja2Templates(directory="app/templates")


@router.get("", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))], response_class=HTMLResponse)
async def list_orders(request: Request, identity=Depends(current_identity)):
	orders = service.list_orders()
	# Map product_version_id -> (product_code, version_number)
	version_meta = {}
	with SessionLocal() as db:
		ids = [o.product_version_id for o in orders]
		if ids:
			stmt = select(ProductVersion, Product).join(Product, Product.id == ProductVersion.product_id).where(ProductVersion.id.in_(ids))
			for pv, p in db.execute(stmt).all():  # type: ignore[assignment]
				version_meta[pv.id] = {"product_code": p.code, "version_number": pv.version_number}
	return templates.TemplateResponse(
		"orders/index.html",
		{
			"request": request,
			"orders": orders,
			"version_meta": version_meta,
			"identity": identity,
		},
	)


@router.get("/new", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))], response_class=HTMLResponse)
async def new_order(request: Request, identity=Depends(current_identity)):
	# Load customers
	from app.customers import service as customer_service  # local import to avoid cycles
	customers = customer_service.list_customers()
	# Load product versions with product code
	with SessionLocal() as db:
		stmt = select(ProductVersion, Product).join(Product, Product.id == ProductVersion.product_id).order_by(Product.code.asc(), ProductVersion.version_number.desc())
		versions = [{"id": str(pv.id), "product_code": p.code, "version_number": pv.version_number} for pv, p in db.execute(stmt).all()]  # type: ignore[misc]
	return templates.TemplateResponse(
		"orders/new.html",
		{"request": request, "customers": customers, "versions": versions, "identity": identity},
	)


@router.post("", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def create_order(
	request: Request,
	customer_id: str = Form(...),
	product_version_id: str = Form(...),
	currency: str = Form("AUD"),
	status: str = Form("confirmed"),
	quote_id: Optional[str] = Form(None),
	identity=Depends(current_identity),
):
	try:
		payload = CreateOrderRequest(
			customer_id=customer_id,  # type: ignore[arg-type]
			product_version_id=product_version_id,  # type: ignore[arg-type]
			currency=currency,
			status=status,
			quote_id=quote_id,  # type: ignore[arg-type]
		)
		o = service.create_order(payload)
		return RedirectResponse(url=f"/orders/{o.id}", status_code=303)
	except DomainError as e:
		# Re-render form with error
		from app.customers import service as customer_service
		customers = customer_service.list_customers()
		with SessionLocal() as db:
			stmt = select(ProductVersion, Product).join(Product, Product.id == ProductVersion.product_id).order_by(Product.code.asc(), ProductVersion.version_number.desc())
			versions = [{"id": str(pv.id), "product_code": p.code, "version_number": pv.version_number} for pv, p in db.execute(stmt).all()]  # type: ignore[misc]
		return templates.TemplateResponse(
			"orders/new.html",
			{
				"request": request,
				"customers": customers,
				"versions": versions,
				"error": e.message,
				"identity": identity,
			},
			status_code=400,
		)


@router.get("/{order_id}", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER", "OPERATOR"))], response_class=HTMLResponse)
async def show_order(request: Request, order_id: str, identity=Depends(current_identity)):
	o = service.get_detail(order_id)
	if not o:
		raise HTTPException(status_code=404, detail="Order not found")
	# Load product/version meta
	with SessionLocal() as db:
		pv = db.get(ProductVersion, o.product_version_id)
		product = db.get(Product, pv.product_id) if pv else None
	return templates.TemplateResponse(
		"orders/show.html",
		{
			"request": request,
			"order": o,
			"product_code": product.code if product else "-",
			"version_number": pv.version_number if pv else None,
			"identity": identity,
		},
	)


@router.get("/{order_id}/jobs/new", dependencies=[Depends(require_roles("PROD_MANAGER"))], response_class=HTMLResponse)
async def new_job(request: Request, order_id: str, identity=Depends(current_identity)):
	return templates.TemplateResponse(
		"orders/add_job.html",
		{"request": request, "order_id": order_id, "identity": identity},
	)


@router.post("/{order_id}/jobs", dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())])
async def create_job(
	request: Request,
	order_id: str,
	planned_qty: Decimal = Form(...),
	allocated_order_units: Optional[Decimal] = Form(None),
	identity=Depends(current_identity),
):
	try:
		if allocated_order_units is None:
			allocated_order_units = planned_qty
		payload = CreateJobRequest(planned_qty=planned_qty, allocated_order_units=allocated_order_units)
		j = service.create_job(order_id, payload)
		return RedirectResponse(url=f"/orders/{order_id}", status_code=303)
	except DomainError as e:
		return templates.TemplateResponse(
			"orders/add_job.html",
			{
				"request": request,
				"order_id": order_id,
				"error": e.message,
				"identity": identity,
			},
			status_code=400,
		)

