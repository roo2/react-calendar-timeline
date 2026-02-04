from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends
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
	machine_id = uuid.UUID(payload["machine_id"])
	job_id = uuid.UUID(payload["job_id"])
	position = payload.get("position")
	if position is not None:
		position = int(position)
	lane: LaneDTO = SchedulingService.add_job(machine_id=machine_id, job_id=job_id, position=position)
	return {"lane": lane}


@router.post("/queue/reorder", dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())])
async def queue_reorder(payload: dict):
	machine_id = uuid.UUID(payload["machine_id"])
	job_id = uuid.UUID(payload["job_id"])
	new_position = int(payload["new_position"])
	lane: LaneDTO = SchedulingService.reorder(machine_id=machine_id, job_id=job_id, new_position=new_position)
	return {"lane": lane}


@router.post("/queue/remove", dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())])
async def queue_remove(payload: dict):
	machine_id = uuid.UUID(payload["machine_id"])
	job_id = uuid.UUID(payload["job_id"])
	lane: LaneDTO = SchedulingService.remove(machine_id=machine_id, job_id=job_id)
	return {"lane": lane}


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
	return {"move": move}


