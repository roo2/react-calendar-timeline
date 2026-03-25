from __future__ import annotations

from datetime import date
from typing import List, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.domain import ProductionCalendarException, ProductionOperatingSettings
from app.production_calendar.logic import (
	CalendarExceptionData,
	DEFAULT_GANTT_PREVIEW_WEEKS,
	DEFAULT_WEEK_JSON,
	FACTORY_TIMEZONE,
	OperatingContext,
	operating_context_from_settings,
)


def load_operating_context(session: Session) -> OperatingContext:
	row = session.get(ProductionOperatingSettings, 1)
	exc_rows: List[ProductionCalendarException] = list(
		session.scalars(
			select(ProductionCalendarException).order_by(ProductionCalendarException.exception_date.asc())
		).all()
	)
	exc_data: List[Tuple[date, CalendarExceptionData]] = [
		(
			e.exception_date,
			CalendarExceptionData(closed=bool(e.closed), open_time=e.open_time, close_time=e.close_time),
		)
		for e in exc_rows
	]
	if row is None:
		return operating_context_from_settings(
			FACTORY_TIMEZONE, DEFAULT_WEEK_JSON, DEFAULT_GANTT_PREVIEW_WEEKS, exc_data
		)
	return operating_context_from_settings(
		FACTORY_TIMEZONE,
		row.week_json if isinstance(row.week_json, dict) else DEFAULT_WEEK_JSON,
		int(row.gantt_preview_weeks or DEFAULT_GANTT_PREVIEW_WEEKS),
		exc_data,
	)
