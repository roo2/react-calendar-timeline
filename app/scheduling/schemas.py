from __future__ import annotations

import uuid
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class MachineQueueItemDTO(BaseModel):
	id: uuid.UUID
	machine_id: uuid.UUID
	job_id: uuid.UUID
	position: int
	status: str


class ToolConflictDTO(BaseModel):
	tool_type_code: str
	from_: Optional[datetime] = None
	to: Optional[datetime] = None
	reason: str

	class Config:
		fields = {"from_": "from"}


class LaneDTO(BaseModel):
	machine_id: uuid.UUID
	items: List[MachineQueueItemDTO]
	warnings: Optional[List[str]] = None
	conflicts: Optional[List[ToolConflictDTO]] = None


class MoveResult(BaseModel):
	source_lane: LaneDTO
	target_lane: LaneDTO


class OperationEstimateDTO(BaseModel):
	operation_type: str
	estimated_duration_hours: float
	estimated_kg: Optional[float] = None
	estimated_metres: Optional[float] = None
	estimated_units: Optional[float] = None


class JobEstimatesDTO(BaseModel):
	job_id: uuid.UUID
	operations: List[OperationEstimateDTO]


class GanttBarDTO(BaseModel):
	job_id: uuid.UUID
	job_code: str
	operation_type: str
	customer: str
	product_code: str
	planned_qty: float
	estimated_duration_hours: float
	tentative_start: Optional[datetime] = None
	tentative_finish: Optional[datetime] = None
	status: str  # "queued", "running", "completed"
	readiness: str  # "blocked", "ready", "running", "completed"
	requires_uteco: bool
	requires_inline_print: bool
	num_colours: int
	warnings: List[str]
	tool_conflicts: List[ToolConflictDTO]


class GanttLaneDTO(BaseModel):
	machine_id: uuid.UUID
	machine_code: str
	machine_type: str
	bars: List[GanttBarDTO]


class GanttOverviewDTO(BaseModel):
	lanes: List[GanttLaneDTO]
	calendar: dict  # start, end, days, hours_per_day

