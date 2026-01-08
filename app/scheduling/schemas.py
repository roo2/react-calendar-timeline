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

