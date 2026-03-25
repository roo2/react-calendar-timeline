from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from app.auth.deps import require_roles, csrf_protect

from app.db.models.enums import OperationType
from app.scheduling import service as SchedulingService
from app.scheduling.schemas import LaneDTO, MoveResult
from app.auth.deps import current_identity

router = APIRouter(prefix="/api/schedule", tags=["schedule"])


@router.get("", dependencies=[Depends(require_roles("PROD_MANAGER"))])
async def schedule_overview():
	overview = SchedulingService.get_overview()
	return overview


@router.post("/queue/add", dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())])
async def queue_add(payload: dict):
	machine_id = str(payload["machine_id"])
	position = payload.get("position")
	if position is not None:
		position = int(position)
	job_id = uuid.UUID(payload["job_id"]) if payload.get("job_id") else None
	job_sheet_id = uuid.UUID(payload["job_sheet_id"]) if payload.get("job_sheet_id") else None
	if not job_id and not job_sheet_id:
		raise HTTPException(status_code=400, detail="job_id or job_sheet_id is required")
	target_start = payload.get("target_start")
	if target_start:
		target_start = datetime.fromisoformat(str(target_start).replace("Z", "+00:00"))
	else:
		target_start = None
	lane: LaneDTO = SchedulingService.add_job(
		machine_id=machine_id,
		job_id=job_id,
		position=position,
		job_sheet_id=job_sheet_id,
		target_start=target_start,
	)
	return {"lane": lane}


@router.post("/queue/reorder", dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())])
async def queue_reorder(payload: dict):
	machine_id = str(payload["machine_id"])
	job_id = uuid.UUID(payload["job_id"])
	new_position = int(payload["new_position"])
	lane: LaneDTO = SchedulingService.reorder(machine_id=machine_id, job_id=job_id, new_position=new_position)
	return {"lane": lane}


@router.post("/queue/remove", dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())])
async def queue_remove(payload: dict):
	machine_id = str(payload["machine_id"])
	job_id = uuid.UUID(payload["job_id"])
	lane: LaneDTO = SchedulingService.remove(machine_id=machine_id, job_id=job_id)
	return {"lane": lane}


@router.get("/unqueued", dependencies=[Depends(require_roles("PROD_MANAGER"))])
async def schedule_unqueued():
	jobs = SchedulingService.get_unqueued_schedule_jobs()
	return {"jobs": jobs}


@router.get("/gantt", dependencies=[Depends(require_roles("PROD_MANAGER"))])
async def gantt_view(identity=Depends(current_identity)):
	gantt_data = SchedulingService.get_gantt_overview(operating_calendar=None)  # Use default calendar
	return {"gantt_data": gantt_data}


@router.get("/gantt/estimate", dependencies=[Depends(require_roles("PROD_MANAGER"))])
async def estimate_durations(job_id: str):
	estimates = SchedulingService.estimate_job_operations(job_id)
	return {"estimates": estimates}


@router.post("/gantt/move", dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())])
async def gantt_move(payload: dict):
	job_id = uuid.UUID(payload["job_id"])
	operation_type = OperationType(payload["operation_type"])
	target_machine_id = str(payload["target_machine_id"])
	proposed_start = payload.get("proposed_start")
	if proposed_start:
		proposed_start = datetime.fromisoformat(str(proposed_start).replace("Z", "+00:00"))
	else:
		proposed_start = None
	target_start = payload.get("target_start")
	if target_start:
		target_start = datetime.fromisoformat(str(target_start).replace("Z", "+00:00"))
	else:
		target_start = None
	move: MoveResult = SchedulingService.move_bar(
		job_id=job_id,
		operation_type=operation_type,
		target_machine_id=target_machine_id,
		proposed_start=proposed_start,
		target_start=target_start,
	)
	return {"move": move}


