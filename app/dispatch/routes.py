from __future__ import annotations

import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from app.auth.deps import require_roles, csrf_protect, current_identity
from app.dispatch.schemas import MarkReadyRequest, ConfirmDispatchRequest
from app.dispatch import service as DispatchService
from app.exceptions import DomainError

router = APIRouter(prefix="/api/dispatch", tags=["dispatch"])


@router.get("", dependencies=[Depends(require_roles("PROD_MANAGER"))])
async def list_ready_for_dispatch():
    items = DispatchService.list_ready()
    return {"items": items}


@router.get("/{job_id}", dependencies=[Depends(require_roles("PROD_MANAGER"))])
async def dispatch_detail(job_id: str):
    dto = DispatchService.get(uuid.UUID(job_id))
    return {"detail": dto}


@router.post("/{job_id}/mark_ready", dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())])
async def mark_ready(job_id: str, payload: MarkReadyRequest, identity=Depends(current_identity)):
    actor = getattr(identity.get("user"), "username", identity.get("user")) or "api"
    try:
        dto = DispatchService.mark_ready(uuid.UUID(job_id), payload, actor=str(actor))
        return {"ok": True, "dispatch_record": dto}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.post("/{job_id}/confirm", dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())])
async def confirm_dispatch(job_id: str, payload: ConfirmDispatchRequest, identity=Depends(current_identity)):
    user = identity.get("user")
    user_id = getattr(user, "id", None) or (getattr(user, "username", None) if user else None)
    try:
        dto = DispatchService.confirm_dispatch(uuid.UUID(job_id), payload, actor_user_id=str(user_id) if user_id else None)
        return {"ok": True, "dispatch_record": dto}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


