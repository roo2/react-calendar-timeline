from __future__ import annotations

import uuid
from typing import Optional, Any, Dict

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth.deps import require_roles, allow_roles_any, csrf_protect, current_identity
from app.db.models.enums import OperationType, QCCheckResult
from app.exceptions import DomainError
from app.production import service as ProductionService
from app.production import qc_service as QCService
from app.production.schemas import QCEntryRequest

router = APIRouter(prefix="/api/production", tags=["production"])


def _run_summary(run) -> dict:
    return {
        "id": str(run.id),
        "job_id": str(run.job_id),
        "machine_id": str(run.machine_id),
        "operation_type": run.operation_type.value if hasattr(run.operation_type, "value") else str(run.operation_type),
        "status": run.status.value if hasattr(run.status, "value") else str(run.status),
        "started_at": run.started_at.isoformat() if getattr(run, "started_at", None) else None,
        "ended_at": run.ended_at.isoformat() if getattr(run, "ended_at", None) else None,
    }


@router.post("/runs/start", dependencies=[Depends(allow_roles_any("OPERATOR", "PROD_MANAGER")), Depends(csrf_protect())])
async def start_run(payload: dict, identity=Depends(current_identity)):
    try:
        run = ProductionService.start_run(
            job_id=uuid.UUID(payload["job_id"]),
            machine_id=uuid.UUID(payload["machine_id"]),
            operation_type=OperationType(payload["operation_type"]),
        )
        return {"ok": True, "run": _run_summary(run)}
    except (KeyError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.post("/runs/{run_id}/pause", dependencies=[Depends(allow_roles_any("OPERATOR", "PROD_MANAGER")), Depends(csrf_protect())])
async def pause_run(run_id: str):
    try:
        run = ProductionService.pause_run(uuid.UUID(run_id))
        return {"ok": True, "run": _run_summary(run)}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.post("/runs/{run_id}/resume", dependencies=[Depends(allow_roles_any("OPERATOR", "PROD_MANAGER")), Depends(csrf_protect())])
async def resume_run(run_id: str):
    try:
        run = ProductionService.resume_run(uuid.UUID(run_id))
        return {"ok": True, "run": _run_summary(run)}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.post("/runs/{run_id}/record_output", dependencies=[Depends(allow_roles_any("OPERATOR", "PROD_MANAGER")), Depends(csrf_protect())])
async def record_output(run_id: str, payload: dict, identity=Depends(current_identity)):
    created_by = getattr(identity.get("user"), "username", identity.get("user")) or "api"
    try:
        totals = ProductionService.record_output(
            run_id=uuid.UUID(run_id),
            quantity=str(payload["quantity"]),
            uom=str(payload["uom"]),
            good_or_scrap=bool(payload["good_or_scrap"]),
            finished_goods=payload.get("finished_goods"),
            note=payload.get("note"),
            created_by=str(created_by),
        )
        return {"ok": True, "totals": totals}
    except (KeyError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.post("/runs/{run_id}/qc_check", dependencies=[Depends(allow_roles_any("OPERATOR", "PROD_MANAGER")), Depends(csrf_protect())])
async def record_qc(run_id: str, payload: QCEntryRequest, identity=Depends(current_identity)):
    measured_by = getattr(identity.get("user"), "username", identity.get("user")) or "api"
    try:
        checklist = ProductionService.record_qc(
            run_id=uuid.UUID(run_id),
            check_type=payload.check_type,
            required=payload.required,
            result=QCCheckResult(payload.result),
            values=payload.values or {},
            measured_by=str(measured_by),
        )
        return {"ok": True, "checklist": checklist}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.get("/runs/{run_id}/qc_required", dependencies=[Depends(allow_roles_any("OPERATOR", "PROD_MANAGER"))])
async def get_qc_required(run_id: str):
    # This uses internal helper in the original HTML implementation; keep as best-effort.
    checklist_fn = getattr(ProductionService, "_compute_checklist", None)
    session_factory = getattr(ProductionService, "SessionLocal", None)
    if not checklist_fn or not session_factory:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="QC checklist not available")
    with session_factory.begin() as session:
        data = checklist_fn(session, uuid.UUID(run_id))
    return {"checklist": data}


@router.post("/runs/{run_id}/complete", dependencies=[Depends(allow_roles_any("OPERATOR", "PROD_MANAGER")), Depends(csrf_protect())])
async def complete_run(run_id: str):
    try:
        run = ProductionService.complete_run(uuid.UUID(run_id))
        return {"ok": True, "run": _run_summary(run)}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.post("/jobs/{job_id}/qc-summary/aggregate", dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())])
async def aggregate_job_qc(job_id: str, identity=Depends(current_identity)):
    created_by = getattr(identity.get("user"), "username", identity.get("user")) or "api"
    try:
        summary = QCService.aggregate_job_qc(uuid.UUID(job_id), created_by=str(created_by))
        return {"ok": True, "summary": summary}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.post("/jobs/{job_id}/qc-summary/finalize", dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())])
async def finalize_job_qc(job_id: str, payload: dict, identity=Depends(current_identity)):
    finalized_by = getattr(identity.get("user"), "username", identity.get("user")) or "api"
    checklist_updates: Dict[str, Any] = payload.get("checklist") or {}
    deviations: Optional[Dict[str, Any]] = payload.get("deviations")
    try:
        summary = QCService.finalize_job_qc(
            uuid.UUID(job_id),
            checklist_updates=checklist_updates,
            deviations=deviations,
            finalized_by=str(finalized_by),
        )
        return {"ok": True, "summary": summary}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)

