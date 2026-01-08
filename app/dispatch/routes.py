from __future__ import annotations

import uuid
from fastapi import APIRouter, Depends, Request, Form
from fastapi.responses import HTMLResponse, Response
from app.auth.deps import require_roles, csrf_protect, current_identity
from app.dispatch.schemas import MarkReadyRequest, ConfirmDispatchRequest
from app.dispatch import service as DispatchService
from app.main import templates

router = APIRouter(prefix="/dispatch", tags=["dispatch"])


@router.get("", response_class=HTMLResponse, dependencies=[Depends(require_roles("PROD_MANAGER"))])
async def list_ready_for_dispatch(request: Request):
	items = DispatchService.list_ready()
	return templates.TemplateResponse("dispatch/list.html", {"request": request, "items": items})


@router.get("/{job_id}", response_class=HTMLResponse, dependencies=[Depends(require_roles("PROD_MANAGER"))])
async def dispatch_detail(job_id: str, request: Request, identity=Depends(current_identity)):
	dto = DispatchService.get(uuid.UUID(job_id))
	csrf_token = identity.get("csrf")
	return templates.TemplateResponse("dispatch/detail.html", {"request": request, "dto": dto, "csrf_token": csrf_token})


@router.post("/{job_id}/mark_ready", dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())])
async def mark_ready(
	job_id: str,
	cartons_count: int = Form(0),
	pallets_count: int = Form(0),
	pallet_type: str | None = Form(None),
	wrapped: bool = Form(False),
	notes: str | None = Form(None),
	identity=Depends(current_identity),
):
	actor = str(identity.get("user") or "api")
	payload = MarkReadyRequest(
		cartons_count=cartons_count,
		pallets_count=pallets_count,
		pallet_type=pallet_type,
		wrapped=wrapped,
		notes=notes,
	)
	DispatchService.mark_ready(uuid.UUID(job_id), payload, actor=actor)
	# HTMX redirect to refresh detail
	return Response(status_code=204, headers={"HX-Redirect": f"/dispatch/{job_id}"})


@router.post("/{job_id}/confirm", dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())])
async def confirm_dispatch(
	job_id: str,
	dispatch_date: str | None = Form(None),  # datetime-local string
	carrier: str | None = Form(None),
	delivery_ref: str | None = Form(None),
	confirm_checkbox: str | None = Form(None),
	identity=Depends(current_identity),
):
	# Require explicit confirmation
	if not confirm_checkbox:
		return Response(status_code=400, content="Confirmation is required")
	parsed_date = None
	if dispatch_date:
		try:
			# FastAPI/Pydantic would parse if bound to model, handle simple ISO local
			from datetime import datetime
			parsed_date = datetime.fromisoformat(dispatch_date)
		except Exception:
			parsed_date = None
	user = identity.get("user")
	user_id = str(user) if user is not None else None
	payload = ConfirmDispatchRequest(dispatch_date=parsed_date, carrier=carrier, delivery_ref=delivery_ref)
	DispatchService.confirm_dispatch(uuid.UUID(job_id), payload, actor_user_id=user_id)
	# HTMX redirect back to list
	return Response(status_code=204, headers={"HX-Redirect": "/dispatch"})


