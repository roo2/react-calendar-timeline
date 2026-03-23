from __future__ import annotations

import uuid
from datetime import date
from typing import Dict, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class WeekdayHoursDTO(BaseModel):
	enabled: bool = True
	start: str = Field(default="00:00", max_length=8)
	end: str = Field(default="24:00", max_length=8)


class OperatingSettingsResponse(BaseModel):
	timezone: str
	gantt_preview_weeks: int = Field(ge=1, le=52)
	weekdays: Dict[str, WeekdayHoursDTO]


class OperatingSettingsUpdate(BaseModel):
	"""Timezone is ignored by the API; factory zone is fixed to Australia/Brisbane."""
	timezone: str = Field(default="Australia/Brisbane", max_length=64)
	gantt_preview_weeks: int = Field(default=4, ge=1, le=52)
	weekdays: Dict[str, WeekdayHoursDTO]

	@field_validator("weekdays")
	@classmethod
	def _seven_keys(cls, v: Dict[str, WeekdayHoursDTO]) -> Dict[str, WeekdayHoursDTO]:
		need = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
		missing = [k for k in need if k not in v]
		if missing:
			raise ValueError(f"Missing weekday keys: {missing}")
		return v


class CalendarExceptionResponse(BaseModel):
	model_config = ConfigDict(from_attributes=True)

	id: uuid.UUID
	exception_date: date
	closed: bool
	open_time: Optional[str] = None
	close_time: Optional[str] = None
	note: Optional[str] = None


class CalendarExceptionCreate(BaseModel):
	exception_date: date
	closed: bool = False
	open_time: Optional[str] = Field(default=None, max_length=8)
	close_time: Optional[str] = Field(default=None, max_length=8)
	note: Optional[str] = Field(default=None, max_length=255)


class CalendarExceptionUpdate(BaseModel):
	closed: Optional[bool] = None
	open_time: Optional[str] = Field(default=None, max_length=8)
	close_time: Optional[str] = Field(default=None, max_length=8)
	note: Optional[str] = Field(default=None, max_length=255)
