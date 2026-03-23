from __future__ import annotations

import uuid
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class MachineQueueItemDTO(BaseModel):
	id: uuid.UUID
	machine_id: str = Field(description="Lane id: extruder_code or Uteco/bagger UUID")
	job_id: uuid.UUID
	position: int
	status: str


class ToolConflictDTO(BaseModel):
	tool_type_code: str
	from_: Optional[datetime] = Field(default=None, alias="from")
	to: Optional[datetime] = None
	reason: str

	model_config = ConfigDict(populate_by_name=True)


class LaneDTO(BaseModel):
	machine_id: str = Field(description="Lane id: extruder_code or Uteco/bagger UUID")
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


class ToolStripDTO(BaseModel):
	"""Coloured strip on extruder bars: required tooling for this job on this machine."""

	tool_type_code: str
	name: str
	color: str = Field(description="CSS hex colour for the strip")
	tool_serial: Optional[str] = Field(default=None, description="Assigned physical tool serial, if known")


class GanttBarDTO(BaseModel):
	job_id: uuid.UUID
	job_code: str
	operation_type: str
	customer: str
	product_code: str
	planned_qty: float
	estimated_duration_hours: float
	roll_count: int = Field(default=1, description="Rolls for UI segmentation (from spec or 1)")
	hours_per_roll: float = Field(default=0.0, description="Hours per roll segment when roll_count > 1")
	job_sheet_job_no: Optional[str] = None
	tentative_start: Optional[datetime] = None
	tentative_finish: Optional[datetime] = None
	status: str  # "queued", "running", "completed"
	readiness: str  # "blocked", "ready", "running", "completed"
	requires_uteco: bool
	requires_inline_print: bool
	num_colours: int
	warnings: List[str]
	tool_conflicts: List[ToolConflictDTO]
	tool_strips: List[ToolStripDTO] = Field(default_factory=list, description="Extruder lane: required tools as bottom colour strips")
	job_layflat_width_mm: Optional[float] = Field(
		default=None,
		description="Layflat/web width mm from product spec (extrusion width check basis)",
	)


class GanttLaneDTO(BaseModel):
	machine_id: str = Field(description="Lane id: extruder_code or Uteco/bagger UUID")
	machine_code: str
	machine_type: str
	film_width_min_mm: Optional[int] = Field(default=None, description="Extruder rate card min film width (mm)")
	film_width_max_mm: Optional[int] = Field(default=None, description="Extruder rate card max film width (mm)")
	bars: List[GanttBarDTO]


class ToolboxBalanceDTO(BaseModel):
	"""Pool balance for extrusion tooling (see SDS 15.1)."""

	tool_type_code: str
	name: str
	color: str
	total_active: int
	reserved: int
	available: int


class GanttOverviewDTO(BaseModel):
	lanes: List[GanttLaneDTO]
	calendar: dict  # start, end, days, hours_per_day
	extrusion_toolbox: List[ToolboxBalanceDTO] = Field(
		default_factory=list,
		description="Available vs reserved counts for extrusion tool types",
	)


class UnqueuedScheduleJobDTO(BaseModel):
	"""Job eligible to be dragged onto an extruder (not already on an extruder queue)."""

	job_id: uuid.UUID
	order_code: str = ""
	job_code: str
	customer: str
	product_code: str
	planned_qty: float
	roll_count: int = 1
	job_sheet_job_no: Optional[str] = None
	job_layflat_width_mm: Optional[float] = Field(
		default=None,
		description="Layflat/web width mm from product spec",
	)

