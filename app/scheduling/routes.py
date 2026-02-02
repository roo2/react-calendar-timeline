from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from app.auth.deps import require_roles, csrf_protect
from pydantic import BaseModel

from app.db.models.enums import OperationType
from app.scheduling import service as SchedulingService
from app.scheduling.schemas import LaneDTO, MoveResult
from app.auth.deps import current_identity

router = APIRouter(prefix="/schedule", tags=["schedule"])
templates = Jinja2Templates(directory="app/templates")


@router.get("", response_class=HTMLResponse, dependencies=[Depends(require_roles("PROD_MANAGER"))])
async def schedule_overview(request: Request):
	overview = SchedulingService.get_overview()
	ctx = {"request": request, **overview}
	return templates.TemplateResponse("scheduling/index.html", ctx)


@router.post("/queue/add", response_class=HTMLResponse, dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())])
async def queue_add(request: Request, payload: dict):
	machine_id = uuid.UUID(payload["machine_id"])
	job_id = uuid.UUID(payload["job_id"])
	position = payload.get("position")
	if position is not None:
		position = int(position)
	lane: LaneDTO = SchedulingService.add_job(machine_id=machine_id, job_id=job_id, position=position)
	return templates.TemplateResponse("scheduling/lane.html", {"request": request, "lane": lane})


@router.post("/queue/reorder", response_class=HTMLResponse, dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())])
async def queue_reorder(request: Request, payload: dict):
	machine_id = uuid.UUID(payload["machine_id"])
	job_id = uuid.UUID(payload["job_id"])
	new_position = int(payload["new_position"])
	lane: LaneDTO = SchedulingService.reorder(machine_id=machine_id, job_id=job_id, new_position=new_position)
	return templates.TemplateResponse("scheduling/lane.html", {"request": request, "lane": lane})


@router.post("/queue/remove", response_class=HTMLResponse, dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())])
async def queue_remove(request: Request, payload: dict):
	machine_id = uuid.UUID(payload["machine_id"])
	job_id = uuid.UUID(payload["job_id"])
	lane: LaneDTO = SchedulingService.remove(machine_id=machine_id, job_id=job_id)
	return templates.TemplateResponse("scheduling/lane.html", {"request": request, "lane": lane})


@router.get("/gantt", response_class=HTMLResponse, dependencies=[Depends(require_roles("PROD_MANAGER"))])
async def gantt_view(request: Request, identity=Depends(current_identity)):
	"""
	Render Gantt chart page with timeline and machine lanes.
	"""
	gantt_data = SchedulingService.get_gantt_overview(operating_calendar=None)  # Use default calendar
	return templates.TemplateResponse(
		"scheduling/gantt.html",
		{
			"request": request,
			"identity": identity,
			"gantt_data": gantt_data,
		},
	)


@router.get("/gantt/estimate", response_class=HTMLResponse, dependencies=[Depends(require_roles("PROD_MANAGER"))])
async def estimate_durations(request: Request, job_id: str):
	"""
	Returns estimated durations for a job's operations (HTMX endpoint).
	Returns HTML partial with duration estimates.
	"""
	estimates = SchedulingService.estimate_job_operations(job_id)
	return templates.TemplateResponse(
		"scheduling/_estimates.html",
		{"request": request, "estimates": estimates},
	)


@router.post("/gantt/move", response_class=HTMLResponse, dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())])
async def gantt_move(request: Request, payload: dict):
	job_id = uuid.UUID(payload["job_id"])
	operation_type = OperationType(payload["operation_type"])
	target_machine_id = uuid.UUID(payload["target_machine_id"])
	target_position = int(payload["target_position"])
	proposed_start = payload.get("proposed_start")
	if proposed_start:
		proposed_start = datetime.fromisoformat(proposed_start)
	else:
		proposed_start = None
	move: MoveResult = SchedulingService.move_bar(
		job_id=job_id,
		operation_type=operation_type,
		target_machine_id=target_machine_id,
		target_position=target_position,
		proposed_start=proposed_start,
	)
	return templates.TemplateResponse(
		"scheduling/move_result.html",
		{"request": request, "source_lane": move.source_lane, "target_lane": move.target_lane},
	)


