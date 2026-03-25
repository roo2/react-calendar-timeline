from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.auth.deps import csrf_protect, require_roles
from app.db.models.domain import ProductionCalendarException, ProductionOperatingSettings
from app.db.session import SessionLocal
from app.production_calendar.logic import (
	DEFAULT_GANTT_PREVIEW_WEEKS,
	DEFAULT_WEEK_JSON,
	FACTORY_TIMEZONE,
	WEEKDAY_KEYS,
)
from app.production_calendar.schemas import (
	CalendarExceptionCreate,
	CalendarExceptionResponse,
	CalendarExceptionUpdate,
	OperatingSettingsResponse,
	OperatingSettingsUpdate,
	WeekdayHoursDTO,
)

router = APIRouter(prefix="/api/admin/production-calendar", tags=["production_calendar"])


def _row_to_settings_response(row: ProductionOperatingSettings) -> OperatingSettingsResponse:
	wj = row.week_json if isinstance(row.week_json, dict) else {}
	weekdays = {}
	for k in WEEKDAY_KEYS:
		raw = wj.get(k) or DEFAULT_WEEK_JSON.get(k) or {}
		weekdays[k] = WeekdayHoursDTO(
			enabled=bool(raw.get("enabled", False)),
			start=str(raw.get("start", "00:00")),
			end=str(raw.get("end", "24:00")),
		)
	return OperatingSettingsResponse(
		timezone=FACTORY_TIMEZONE,
		gantt_preview_weeks=int(row.gantt_preview_weeks),
		weekdays=weekdays,
	)


@router.get("/settings", dependencies=[Depends(require_roles("SYS_ADMIN"))])
async def get_production_calendar_settings():
	with SessionLocal() as session:
		row = session.get(ProductionOperatingSettings, 1)
		if row is None:
			return _row_to_settings_response(
				ProductionOperatingSettings(
					id=1,
					timezone=FACTORY_TIMEZONE,
					gantt_preview_weeks=DEFAULT_GANTT_PREVIEW_WEEKS,
					week_json=dict(DEFAULT_WEEK_JSON),
				)
			)
		return _row_to_settings_response(row)


@router.put("/settings", dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())])
async def put_production_calendar_settings(payload: OperatingSettingsUpdate):
	week_json = {k: payload.weekdays[k].model_dump() for k in WEEKDAY_KEYS}
	with SessionLocal.begin() as session:
		row = session.get(ProductionOperatingSettings, 1)
		if row is None:
			row = ProductionOperatingSettings(
				id=1, timezone=FACTORY_TIMEZONE, gantt_preview_weeks=payload.gantt_preview_weeks, week_json=week_json
			)
			session.add(row)
		else:
			row.timezone = FACTORY_TIMEZONE
			row.gantt_preview_weeks = payload.gantt_preview_weeks
			row.week_json = week_json
	return await get_production_calendar_settings()


@router.get("/exceptions", dependencies=[Depends(require_roles("SYS_ADMIN"))])
async def list_calendar_exceptions():
	with SessionLocal() as session:
		rows = list(session.scalars(select(ProductionCalendarException).order_by(ProductionCalendarException.exception_date)).all())
	return {
		"exceptions": [
			CalendarExceptionResponse(
				id=uuid.UUID(row.id),
				exception_date=row.exception_date,
				closed=row.closed,
				open_time=row.open_time,
				close_time=row.close_time,
				note=row.note,
			)
			for row in rows
		]
	}


@router.post("/exceptions", dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())])
async def create_calendar_exception(payload: CalendarExceptionCreate):
	new_id = str(uuid.uuid4())
	with SessionLocal.begin() as session:
		exists = session.scalars(
			select(ProductionCalendarException).where(ProductionCalendarException.exception_date == payload.exception_date)
		).first()
		if exists:
			raise HTTPException(status_code=409, detail="An exception already exists for this date")
		row = ProductionCalendarException(
			id=new_id,
			exception_date=payload.exception_date,
			closed=payload.closed,
			open_time=payload.open_time,
			close_time=payload.close_time,
			note=payload.note,
		)
		session.add(row)
	return {
		"exception": CalendarExceptionResponse(
			id=uuid.UUID(new_id),
			exception_date=payload.exception_date,
			closed=payload.closed,
			open_time=payload.open_time,
			close_time=payload.close_time,
			note=payload.note,
		)
	}


@router.patch("/exceptions/{exception_id}", dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())])
async def update_calendar_exception(exception_id: uuid.UUID, payload: CalendarExceptionUpdate):
	with SessionLocal.begin() as session:
		row = session.get(ProductionCalendarException, str(exception_id))
		if not row:
			raise HTTPException(status_code=404, detail="Not found")
		if payload.closed is not None:
			row.closed = payload.closed
		if payload.open_time is not None:
			row.open_time = payload.open_time
		if payload.close_time is not None:
			row.close_time = payload.close_time
		if payload.note is not None:
			row.note = payload.note
	return {
		"exception": CalendarExceptionResponse(
			id=uuid.UUID(row.id),
			exception_date=row.exception_date,
			closed=row.closed,
			open_time=row.open_time,
			close_time=row.close_time,
			note=row.note,
		)
	}


@router.delete("/exceptions/{exception_id}", dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())])
async def delete_calendar_exception(exception_id: uuid.UUID):
	with SessionLocal.begin() as session:
		row = session.get(ProductionCalendarException, str(exception_id))
		if not row:
			raise HTTPException(status_code=404, detail="Not found")
		session.delete(row)
	return {"ok": True}
