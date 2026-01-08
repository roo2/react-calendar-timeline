from __future__ import annotations

import uuid
from typing import Any, Dict, Optional
import json

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select

from app.auth.deps import require_roles, allow_roles_any, csrf_protect, current_identity
from app.db.models.domain import Job, Machine, MachineQueueItem, OperationRun, Order
from app.db.models.enums import OperationType, QCCheckResult, QueueStatus, RunStatus
from app.db.session import SessionLocal
from app.production.schemas import ChecklistDTO, QCEntryRequest, TotalsDTO
from app.production import service as ProductionService
from app.production import qc_service as QCService
from app.scheduling.service import _operation_type_for_machine

router = APIRouter(prefix="/production", tags=["production"])
templates = Jinja2Templates(directory="app/templates")


def _machine_overview(session, machine: Machine) -> Dict[str, Any]:
    q_run = select(OperationRun).where(
        OperationRun.machine_id == machine.id, OperationRun.status == RunStatus.RUNNING
    )
    run = session.execute(q_run).scalars().first()
    current = None
    if run:
        job = session.get(Job, run.job_id)
        order = session.get(Order, job.order_id) if job else None
        current = {
            "run_id": str(run.id),
            "job_code": job.job_code if job else None,
            "operation_type": run.operation_type.value,
            "started_at": run.started_at,
            "order_code": order.code if order else None,
        }
    q_next = (
        select(MachineQueueItem)
        .where(MachineQueueItem.machine_id == machine.id, MachineQueueItem.status == QueueStatus.QUEUED)
        .order_by(MachineQueueItem.position.asc())
    )
    next_item = session.execute(q_next).scalars().first()
    next_job = None
    if next_item:
        job = session.get(Job, next_item.job_id)
        next_job = {"job_code": job.job_code if job else None, "position": next_item.position}
    return {"machine": machine, "current": current, "next_job": next_job}


@router.get("", response_class=HTMLResponse, dependencies=[Depends(require_roles("PROD_MANAGER"))])
async def production_overview(request: Request, identity=Depends(current_identity)) -> HTMLResponse:
    csrf = identity.get("csrf")
    with SessionLocal.begin() as session:
        machines = session.query(Machine).order_by(Machine.code.asc()).all()
        overview = [_machine_overview(session, m) for m in machines]
    return templates.TemplateResponse(
        "production/index.html",
        {"request": request, "title": "Production Overview", "overview": overview, "csrf": csrf},
    )


@router.get("/my-machine", response_class=HTMLResponse, dependencies=[Depends(allow_roles_any("OPERATOR", "PROD_MANAGER"))])
async def my_machine(request: Request, machine_id: Optional[str] = None, identity=Depends(current_identity)) -> HTMLResponse:
    csrf = identity.get("csrf")
    with SessionLocal.begin() as session:
        machines = session.query(Machine).order_by(Machine.code.asc()).all()
        machine = None
        if machine_id:
            machine = session.get(Machine, uuid.UUID(machine_id))
        if not machine and machines:
            machine = machines[0]
        current_run = None
        queued_items = []
        op_type = None
        if machine:
            q_run = select(OperationRun).where(
                OperationRun.machine_id == machine.id, OperationRun.status == RunStatus.RUNNING
            )
            current_run = session.execute(q_run).scalars().first()
            q_items = (
                select(MachineQueueItem)
                .where(MachineQueueItem.machine_id == machine.id, MachineQueueItem.status == QueueStatus.QUEUED)
                .order_by(MachineQueueItem.position.asc())
            )
            for itm in session.execute(q_items).scalars().all():
                job = session.get(Job, itm.job_id)
                queued_items.append({"job_id": str(job.id), "job_code": job.job_code, "position": itm.position})
            op = _operation_type_for_machine(machine)
            op_type = op.value if op else None
    return templates.TemplateResponse(
        "production/my_machine.html",
        {
            "request": request,
            "title": "My Machine",
            "machines": machines,
            "machine": machine,
            "current_run": current_run,
            "queued_items": queued_items,
            "op_type": op_type,
            "csrf": csrf,
        },
    )


@router.post("/runs/start", response_class=HTMLResponse, dependencies=[Depends(allow_roles_any("OPERATOR", "PROD_MANAGER")), Depends(csrf_protect())])
async def start_run(
    request: Request,
    job_id: str = Form(...),
    machine_id: str = Form(...),
    operation_type: str = Form(...),
    identity=Depends(current_identity),
) -> HTMLResponse:
    run = ProductionService.start_run(
        job_id=uuid.UUID(job_id),
        machine_id=uuid.UUID(machine_id),
        operation_type=OperationType(operation_type),
    )
    return await my_machine(request, machine_id=str(run.machine_id), identity=identity)  # type: ignore[arg-type]


@router.post("/runs/{run_id}/pause", response_class=HTMLResponse, dependencies=[Depends(allow_roles_any("OPERATOR", "PROD_MANAGER")), Depends(csrf_protect())])
async def pause_run(request: Request, run_id: str, identity=Depends(current_identity)) -> HTMLResponse:
    run = ProductionService.pause_run(uuid.UUID(run_id))
    return await my_machine(request, machine_id=str(run.machine_id), identity=identity)  # type: ignore[arg-type]


@router.post("/runs/{run_id}/resume", response_class=HTMLResponse, dependencies=[Depends(allow_roles_any("OPERATOR", "PROD_MANAGER")), Depends(csrf_protect())])
async def resume_run(request: Request, run_id: str, identity=Depends(current_identity)) -> HTMLResponse:
    run = ProductionService.resume_run(uuid.UUID(run_id))
    return await my_machine(request, machine_id=str(run.machine_id), identity=identity)  # type: ignore[arg-type]


@router.post("/runs/{run_id}/record_output", response_class=HTMLResponse, dependencies=[Depends(allow_roles_any("OPERATOR", "PROD_MANAGER")), Depends(csrf_protect())])
async def record_output(
    request: Request,
    run_id: str,
    quantity: str = Form(...),
    uom: str = Form(...),
    good_or_scrap: str = Form(...),
    finished_goods: Optional[str] = Form(default=None),
    note: Optional[str] = Form(default=None),
    identity=Depends(current_identity),
) -> HTMLResponse:
    created_by = str(identity.get("user") or "api")
    good_flag = good_or_scrap.lower() in ("good", "true", "1", "on", "yes")
    fg_flag: Optional[bool] = None
    if finished_goods is not None:
        fg_flag = finished_goods.lower() in ("true", "1", "on", "yes")
    totals: TotalsDTO = ProductionService.record_output(
        run_id=uuid.UUID(run_id),
        quantity=quantity,
        uom=uom,
        good_or_scrap=good_flag,
        finished_goods=fg_flag,
        note=note,
        created_by=created_by,
    )
    return templates.TemplateResponse(
        "production/_totals.html",
        {"request": request, "totals": totals},
    )


@router.post(
    "/runs/{run_id}/qc_check",
    response_class=HTMLResponse,
    dependencies=[Depends(allow_roles_any("OPERATOR", "PROD_MANAGER")), Depends(csrf_protect())],
)
async def record_qc(request: Request, run_id: str, payload: QCEntryRequest, identity=Depends(current_identity)):
    measured_by = str(identity.get("user") or "api")
    checklist = ProductionService.record_qc(
        run_id=uuid.UUID(run_id),
        check_type=payload.check_type,
        required=payload.required,
        result=QCCheckResult(payload.result),
        values=payload.values or {},
        measured_by=measured_by,
    )
    return templates.TemplateResponse(
        "production/_qc_checklist.html",
        {"request": request, "checklist": checklist},
    )


@router.get(
    "/runs/{run_id}/qc_required",
    response_class=HTMLResponse,
    dependencies=[Depends(allow_roles_any("OPERATOR", "PROD_MANAGER"))],
)
async def get_qc_required(request: Request, run_id: str):
    # Build checklist from current evidence
    checklist = ProductionService._compute_checklist  # type: ignore[attr-defined]
    # mypy: using internal helper; acceptable for internal routes
    with ProductionService.SessionLocal.begin() as session:  # type: ignore[attr-defined]
        data: ChecklistDTO = checklist(session, uuid.UUID(run_id))  # type: ignore[call-arg]
    return templates.TemplateResponse(
        "production/_qc_checklist.html",
        {"request": request, "checklist": data},
    )


@router.post("/runs/{run_id}/complete", response_class=HTMLResponse, dependencies=[Depends(allow_roles_any("OPERATOR", "PROD_MANAGER")), Depends(csrf_protect())])
async def complete_run(request: Request, run_id: str, identity=Depends(current_identity)) -> HTMLResponse:
    run = ProductionService.complete_run(uuid.UUID(run_id))
    return await my_machine(request, machine_id=str(run.machine_id), identity=identity)  # type: ignore[arg-type]


@router.get(
    "/jobs/{job_id}/qc-summary",
    response_class=HTMLResponse,
    dependencies=[Depends(require_roles("PROD_MANAGER"))],
)
async def job_qc_summary_page(request: Request, job_id: str, identity=Depends(current_identity)):
    csrf = identity.get("csrf")
    # Load job context
    with SessionLocal.begin() as session:
        job = session.get(Job, uuid.UUID(job_id))
        order = session.get(Order, job.order_id) if job else None
        # Basic context fields; product/customer names can be derived on the UI later if needed
        ctx = {
            "job_code": job.job_code if job else None,
            "order_code": order.code if order else None,
        }
    return templates.TemplateResponse(
        "production/qc_summary.html",
        {"request": request, "job_id": job_id, "ctx": ctx, "csrf": csrf},
    )


@router.post(
    "/jobs/{job_id}/qc-summary/aggregate",
    response_class=HTMLResponse,
    dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())],
)
async def aggregate_job_qc(request: Request, job_id: str, identity=Depends(current_identity)):
    created_by = str(identity.get("user") or "api")
    summary = QCService.aggregate_job_qc(uuid.UUID(job_id), created_by=created_by)
    return templates.TemplateResponse(
        "production/_qc_summary_panel.html",
        {"request": request, "summary": summary, "csrf": identity.get("csrf")},
    )


@router.post(
    "/jobs/{job_id}/qc-summary/finalize",
    response_class=HTMLResponse,
    dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())],
)
async def finalize_job_qc(request: Request, job_id: str, identity=Depends(current_identity)):
    finalized_by = str(identity.get("user") or "api")
    checklist_updates: Dict[str, Any] = {}
    deviations: Optional[Dict[str, Any]] = None

    # Accept either form-encoded fields (checklist_json, deviations_json) or JSON body
    try:
        form = await request.form()
        cl_json = form.get("checklist_json")
        dv_json = form.get("deviations_json")
        if cl_json:
            checklist_updates = json.loads(cl_json)  # type: ignore[assignment]
        if dv_json:
            deviations = json.loads(dv_json)  # type: ignore[assignment]
    except Exception:
        try:
            payload = await request.json()
            checklist_updates = payload.get("checklist") or {}
            deviations = payload.get("deviations")
        except Exception:
            checklist_updates = {}
            deviations = None

    summary = QCService.finalize_job_qc(
        uuid.UUID(job_id),
        checklist_updates=checklist_updates,
        deviations=deviations,
        finalized_by=finalized_by,
    )
    return templates.TemplateResponse(
        "production/_qc_summary_panel.html",
        {"request": request, "summary": summary, "csrf": identity.get("csrf")},
    )

