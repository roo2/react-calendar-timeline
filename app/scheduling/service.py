from __future__ import annotations

import math
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, List, Optional, Tuple

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.db.models.domain import (
	BaggingQueueItem,
	Customer,
	ExtrusionQueueItem,
	Job,
	OperationRun,
	Order,
	OrderItem,
	Product,
	ProductVersion,
	Tool,
	ToolReservation,
	ToolType,
	UtecoQueueItem,
	JobSheet,
)
from app.db.models.enums import (
	JobStatus,
	OperationType,
	QueueStatus,
	RunStatus,
	ToolReservationStatus,
	PrintingMethod,
)
from app.job_context import (
	ensure_jobs_for_orphan_standalone_sheets,
	ensure_scheduling_job_for_job_sheet,
	resolve_job_context,
)
from app.db.models.rate_cards import ConversionFactor, ConversionSpeed, Extruder
from app.exceptions import DomainError
from app.machines.service import (
	_compute_gauge_um_from_spec,
	layflat_width_mm_from_product_version,
	validate_capability_dict,
	validate_extruder_for_spec,
)
from app.scheduling.lane_context import ScheduleLane, list_active_lanes, resolve_schedule_lane
from app.production_calendar.logic import (
	add_operating_hours,
	calendar_dict_for_gantt,
	inverse_add_operating_hours,
	operating_hours_between,
	snap_to_operating_instant,
)
from app.production_calendar.repository import load_operating_context
from app.scheduling.schemas import (
	LaneDTO,
	MachineQueueItemDTO,
	MoveResult,
	ToolConflictDTO,
	GanttOverviewDTO,
	GanttLaneDTO,
	GanttBarDTO,
	ToolStripDTO,
	ToolboxBalanceDTO,
	JobEstimatesDTO,
	OperationEstimateDTO,
	UnqueuedScheduleJobDTO,
)


def _str_id(value: uuid.UUID | str) -> str:
	"""SQLite binds string PK/FK columns; uuid.UUID objects are not accepted by pysqlite."""
	return str(value)


# UI colours for Gantt tool strips / toolbox (matches frontend fallback)
_TOOL_STRIP_COLORS: dict[str, str] = {
	"inline_printer_1c": "#1565c0",
	"inline_perforator": "#ed6c02",
	"inline_hole_punch": "#7b1fa2",
	"electra_punch": "#2e7d32",
}


def _dto_from_item(lane_id: str, item: ExtrusionQueueItem | UtecoQueueItem | BaggingQueueItem) -> MachineQueueItemDTO:
	status_value = item.status.value if hasattr(item.status, "value") else str(item.status)
	return MachineQueueItemDTO(
		id=item.id,
		machine_id=lane_id,
		job_id=item.job_id,
		position=item.position,
		status=status_value,
	)


def _queue_item_lead_hours(item: ExtrusionQueueItem | UtecoQueueItem | BaggingQueueItem) -> float:
	v = getattr(item, "operating_hours_lead_before", None)
	if v is None:
		return 0.0
	return float(v)


def _target_start_as_utc(target_start: datetime) -> datetime:
	if target_start.tzinfo is None:
		raise DomainError("target_start must be timezone-aware")
	return target_start.astimezone(timezone.utc)


def _scheduled_start_from_db(dt: datetime) -> datetime:
	"""
	Normalize ``scheduled_start_utc`` from the ORM.

	SQLite + ``DateTime(timezone=True)`` often returns **naive** values. Python 3.12+ interprets
	naive datetimes as *system local* in ``.astimezone(tz)``, which shifts UTC wall times when the
	app host TZ is not UTC (e.g. +10h for Australia). This column is always persisted as UTC.
	"""
	if dt.tzinfo is None:
		return dt.replace(tzinfo=timezone.utc)
	return dt.astimezone(timezone.utc)


def _default_append_scheduled_start_utc(
	session: Session,
	lane: ScheduleLane,
	items_on_lane_sorted: List[ExtrusionQueueItem | UtecoQueueItem | BaggingQueueItem],
	ctx: Any,
	anchor_local: datetime,
) -> datetime:
	"""Wall start for a new tail item: after the last queued item on the lane, else anchor."""
	if not items_on_lane_sorted:
		return anchor_local.astimezone(timezone.utc)
	last = max(items_on_lane_sorted, key=lambda x: x.position)
	ss = getattr(last, "scheduled_start_utc", None)
	if ss is None:
		return anchor_local.astimezone(timezone.utc)
	last_local = _scheduled_start_from_db(ss).astimezone(ctx.tz)
	job, _, pv = _get_job_with_context(session, uuid.UUID(str(last.job_id)))
	dur = _estimate_lane_duration_hours(session, lane, job, pv)
	finish_local = add_operating_hours(last_local, dur, ctx)
	return finish_local.astimezone(timezone.utc)


def _gantt_tentative_start_local_for_item(
	session: Session,
	lane: ScheduleLane,
	queue_item: ExtrusionQueueItem | UtecoQueueItem | BaggingQueueItem,
	ctx: Any,
	cursor_local: datetime,
) -> Tuple[datetime, datetime]:
	"""
	Return (tentative_start_local, next_cursor_local).

	If ``scheduled_start_utc`` is set, the item is independent of siblings; ``cursor_local`` is
	unchanged. Otherwise the item follows the sequential cursor + ``operating_hours_lead_before``.
	"""
	ss_utc = getattr(queue_item, "scheduled_start_utc", None)
	if ss_utc is not None:
		start_local = _scheduled_start_from_db(ss_utc).astimezone(ctx.tz)
		return start_local, cursor_local
	lead_h = _queue_item_lead_hours(queue_item)
	cur = cursor_local
	if lead_h > 0:
		cur = add_operating_hours(cur, lead_h, ctx)
	start_local = cur
	job, _, pv = _get_job_with_context(session, uuid.UUID(str(queue_item.job_id)))
	dur = _estimate_lane_duration_hours(session, lane, job, pv)
	next_cursor = add_operating_hours(cur, dur, ctx)
	return start_local, next_cursor


def backfill_queue_scheduled_starts_from_lead_model(session: Session) -> None:
	"""One-shot migration helper: derive ``scheduled_start_utc`` from anchor + legacy lead chain."""
	ctx = load_operating_context(session)
	now_utc = datetime.now(tz=timezone.utc)
	now_local = now_utc.astimezone(ctx.tz)
	anchor_local = snap_to_operating_instant(now_local, ctx)
	for lane in list_active_lanes(session):
		queue_items = [
			i
			for i in _load_lane_items_read(session, lane)
			if i.status in (QueueStatus.QUEUED, QueueStatus.RUNNING)
		]
		queue_items.sort(key=lambda x: x.position)
		cursor_local = anchor_local
		for queue_item in queue_items:
			start_local, cursor_local = _gantt_tentative_start_local_for_item(
				session, lane, queue_item, ctx, cursor_local
			)
			queue_item.scheduled_start_utc = start_local.astimezone(timezone.utc)
			queue_item.operating_hours_lead_before = 0


def _gantt_anchor_local(session: Session) -> Tuple[Any, datetime]:
	ctx = load_operating_context(session)
	now_utc = datetime.now(tz=timezone.utc)
	now_local = now_utc.astimezone(ctx.tz)
	anchor_local = snap_to_operating_instant(now_local, ctx)
	return ctx, anchor_local


def _lane_dto(lane_id: str, items: Iterable[ExtrusionQueueItem | UtecoQueueItem | BaggingQueueItem], warnings: Optional[List[str]] = None, conflicts: Optional[List[ToolConflictDTO]] = None) -> LaneDTO:
	return LaneDTO(
		machine_id=lane_id,
		items=[_dto_from_item(lane_id, i) for i in sorted(items, key=lambda x: x.position)],
		warnings=warnings or [],
		conflicts=conflicts or [],
	)


def _load_lane_items_for_update(session: Session, lane: ScheduleLane) -> List[ExtrusionQueueItem | UtecoQueueItem | BaggingQueueItem]:
	if lane.kind == "extrusion" and lane.extruder:
		q = (
			select(ExtrusionQueueItem)
			.where(ExtrusionQueueItem.extruder_code == lane.extruder.extruder_code)
			.order_by(ExtrusionQueueItem.position.asc())
			.with_for_update()
		)
	elif lane.kind == "uteco" and lane.uteco_printer:
		q = (
			select(UtecoQueueItem)
			.where(UtecoQueueItem.uteco_printer_id == lane.uteco_printer.id)
			.order_by(UtecoQueueItem.position.asc())
			.with_for_update()
		)
	elif lane.kind == "bagging" and lane.bagging_machine:
		q = (
			select(BaggingQueueItem)
			.where(BaggingQueueItem.bagging_machine_id == lane.bagging_machine.id)
			.order_by(BaggingQueueItem.position.asc())
			.with_for_update()
		)
	else:
		raise DomainError("Invalid schedule lane")
	return list(session.execute(q).scalars().all())


def _load_lane_items_read(session: Session, lane: ScheduleLane) -> List[ExtrusionQueueItem | UtecoQueueItem | BaggingQueueItem]:
	if lane.kind == "extrusion" and lane.extruder:
		q = (
			select(ExtrusionQueueItem)
			.where(ExtrusionQueueItem.extruder_code == lane.extruder.extruder_code)
			.order_by(ExtrusionQueueItem.position.asc())
		)
	elif lane.kind == "uteco" and lane.uteco_printer:
		q = (
			select(UtecoQueueItem)
			.where(UtecoQueueItem.uteco_printer_id == lane.uteco_printer.id)
			.order_by(UtecoQueueItem.position.asc())
		)
	elif lane.kind == "bagging" and lane.bagging_machine:
		q = (
			select(BaggingQueueItem)
			.where(BaggingQueueItem.bagging_machine_id == lane.bagging_machine.id)
			.order_by(BaggingQueueItem.position.asc())
		)
	else:
		raise DomainError("Invalid schedule lane")
	return list(session.execute(q).scalars().all())


# Off unique (lane, position) range so SQLite never sees two rows share a slot mid-flush.
_REINDEX_TEMP_POSITION_BASE = 10_000_000
def _reindex_lane(session: Session, items: List[ExtrusionQueueItem | UtecoQueueItem | BaggingQueueItem]) -> None:
	"""Compact positions to 1..n in sort order.

	SQLite enforces UNIQUE immediately on batched UPDATEs. Assigning 1..n in one flush can
	temporarily duplicate a slot (e.g. row A 2→3 while row B still holds 3). We first move
	every row to a high temporary position, flush, then assign finals.
	"""
	if not items:
		return
	ordered = sorted(items, key=lambda x: x.position)
	for idx, itm in enumerate(ordered):
		itm.position = _REINDEX_TEMP_POSITION_BASE + idx
	session.flush()
	for idx, itm in enumerate(ordered, start=1):
		itm.position = idx
	session.flush()


def _bump_queue_positions_from(
	items: Iterable[ExtrusionQueueItem | UtecoQueueItem | BaggingQueueItem],
	from_pos: int,
) -> None:
	"""Increment position for every item at or after ``from_pos``.

	Highest positions are updated first so two rows never briefly share the same
	``(extruder_code|printer|bagger, position)`` during flush — SQLite enforces that
	UNIQUE immediately and rejects batched UPDATEs that collide.
	"""
	need = [i for i in items if i.position >= from_pos]
	for itm in sorted(need, key=lambda x: -x.position):
		itm.position += 1


def _get_job_with_context(session: Session, job_id: uuid.UUID) -> Tuple[Job, Optional[Order], Optional[ProductVersion]]:
	return resolve_job_context(session, job_id)


def _get_printing_method_from_spec(product_version: Optional[ProductVersion]) -> PrintingMethod:
	if not product_version or not product_version.spec_payload:
		return PrintingMethod.NONE
	spec = product_version.spec_payload or {}
	# Try common keys
	method = (
		spec.get("printing_method")
		or (spec.get("printing") or {}).get("method")
		or spec.get("printingMethod")
	)
	if isinstance(method, str):
		m = method.lower()
		if m in ("none", "no_print", "no-print"):
			return PrintingMethod.NONE
		if m in ("inline", "printing_inline", "inline_print"):
			return PrintingMethod.INLINE
		if m in ("uteco", "printing_uteco", "out_of_line"):
			return PrintingMethod.UTECO
	return PrintingMethod.NONE


def _routing_warnings_for_enqueue(session: Session, lane: ScheduleLane, job: Job, product_version: Optional[ProductVersion]) -> List[str]:
	warnings: List[str] = []
	if lane.kind == "uteco":
		# Uteco queued before any Extrusion run exists
		q = select(OperationRun).where(
			OperationRun.job_id == job.id,
			OperationRun.operation_type == OperationType.EXTRUSION,
			OperationRun.status == RunStatus.COMPLETED,
		)
		has_completed_extrusion = session.execute(q).scalars().first() is not None
		if not has_completed_extrusion:
			warnings.append("Uteco queued before any Extrusion run exists for this job")
	elif lane.kind == "bagging":
		pm = _get_printing_method_from_spec(product_version)
		if pm == PrintingMethod.NONE:
			# Needs at least one completed extrusion
			q = select(OperationRun).where(
				OperationRun.job_id == job.id,
				OperationRun.operation_type == OperationType.EXTRUSION,
				OperationRun.status == RunStatus.COMPLETED,
			)
			has_ex = session.execute(q).scalars().first() is not None
			if not has_ex:
				warnings.append("Conversion queued before required Extrusion run exists")
		elif pm == PrintingMethod.UTECO:
			q = select(OperationRun).where(
				OperationRun.job_id == job.id,
				OperationRun.operation_type == OperationType.PRINTING_UTECO,
				OperationRun.status == RunStatus.COMPLETED,
			)
			has_print = session.execute(q).scalars().first() is not None
			if not has_print:
				warnings.append("Conversion queued before required Uteco Printing run exists")
	return warnings


def _spec_finish_requires_conversion(spec: Optional[dict]) -> bool:
	"""Aligned with dispatch: carton-style finishes need a conversion (bagging) run."""
	spec = spec or {}
	finish = (
		(spec.get("identity") or {}).get("finish_mode")
		or spec.get("finish_mode")
		or (spec.get("packaging") or {}).get("pack_mode")
		or spec.get("pack_mode")
	)
	if not finish:
		return False
	val = str(finish).lower()
	return val in ("carton", "cartons", "bags_cartons", "loose_bags", "box", "boxes")


def _uteco_queue_row_exists(session: Session, job_id_str: str) -> bool:
	return (
		session.execute(select(UtecoQueueItem.id).where(UtecoQueueItem.job_id == job_id_str).limit(1)).scalar_one_or_none()
		is not None
	)


def _bagging_queue_row_exists(session: Session, job_id_str: str) -> bool:
	return (
		session.execute(select(BaggingQueueItem.id).where(BaggingQueueItem.job_id == job_id_str).limit(1)).scalar_one_or_none()
		is not None
	)


def _cancel_tool_reservations_for_job_lane(
	session: Session, job_id_str: str, operation_type: OperationType, lane: ScheduleLane
) -> None:
	ex_code = lane.extruder.extruder_code if lane.kind == "extrusion" and lane.extruder else None
	ut_id = lane.uteco_printer.id if lane.kind == "uteco" and lane.uteco_printer else None
	bg_id = lane.bagging_machine.id if lane.kind == "bagging" and lane.bagging_machine else None
	rq = session.query(ToolReservation).filter(
		ToolReservation.job_id == job_id_str,
		ToolReservation.operation_type == operation_type,
		ToolReservation.status.in_([ToolReservationStatus.PLANNED, ToolReservationStatus.CONFLICTED]),
	)
	if ex_code:
		rq = rq.filter(ToolReservation.extruder_code == ex_code)
	elif ut_id:
		rq = rq.filter(ToolReservation.uteco_printer_id == ut_id)
	elif bg_id:
		rq = rq.filter(ToolReservation.bagging_machine_id == bg_id)
	rq.update({"status": ToolReservationStatus.CANCELLED})


def _preferred_uteco_printer_id_from_runs(session: Session, job_id_str: str) -> Optional[str]:
	row = session.execute(
		select(OperationRun.uteco_printer_id)
		.where(
			OperationRun.job_id == job_id_str,
			OperationRun.operation_type == OperationType.PRINTING_UTECO,
			OperationRun.uteco_printer_id.isnot(None),
		)
		.limit(1)
	).scalar_one_or_none()
	return str(row) if row else None


def _preferred_bagging_machine_id_from_runs(session: Session, job_id_str: str) -> Optional[str]:
	row = session.execute(
		select(OperationRun.bagging_machine_id)
		.where(
			OperationRun.job_id == job_id_str,
			OperationRun.operation_type == OperationType.CONVERSION,
			OperationRun.bagging_machine_id.isnot(None),
		)
		.limit(1)
	).scalar_one_or_none()
	return str(row) if row else None


def _resolve_uteco_target_lane(session: Session, job_id_str: str, job: Job, product_version: Optional[ProductVersion]) -> Optional[ScheduleLane]:
	pid = _preferred_uteco_printer_id_from_runs(session, job_id_str)
	if pid:
		try:
			lane = resolve_schedule_lane(session, pid)
			_validate_lane_for_job(lane, product_version, OperationType.PRINTING_UTECO)
			return lane
		except DomainError:
			pass
	for lane in list_active_lanes(session):
		if lane.kind != "uteco" or not lane.uteco_printer:
			continue
		try:
			_validate_lane_for_job(lane, product_version, OperationType.PRINTING_UTECO)
			return lane
		except DomainError:
			continue
	return None


def _resolve_bagging_target_lane(session: Session, job_id_str: str, job: Job, product_version: Optional[ProductVersion]) -> Optional[ScheduleLane]:
	mid = _preferred_bagging_machine_id_from_runs(session, job_id_str)
	if mid:
		try:
			lane = resolve_schedule_lane(session, mid)
			_validate_lane_for_job(lane, product_version, OperationType.CONVERSION)
			return lane
		except DomainError:
			pass
	for lane in list_active_lanes(session):
		if lane.kind != "bagging" or not lane.bagging_machine:
			continue
		try:
			_validate_lane_for_job(lane, product_version, OperationType.CONVERSION)
			return lane
		except DomainError:
			continue
	return None


def _first_roll_operating_hours_for_extrusion_lane(
	session: Session,
	extrusion_lane: ScheduleLane,
	job: Job,
	product_version: Optional[ProductVersion],
) -> float:
	if extrusion_lane.kind != "extrusion" or not extrusion_lane.extruder:
		return 1.0
	ex_dur = _estimate_lane_duration_hours(session, extrusion_lane, job, product_version)
	rolls = max(1, _num_rolls_for_job(session, job, product_version))
	return float(ex_dur) / float(rolls)


def _rebook_extrusion_tools_after_schedule_change(
	session: Session,
	job: Job,
	ex_row: ExtrusionQueueItem,
	ex_lane: ScheduleLane,
	product_version: Optional[ProductVersion],
) -> None:
	jid_str = _str_id(job.id)
	_cancel_tool_reservations_for_job_lane(session, jid_str, OperationType.EXTRUSION, ex_lane)
	ts = _scheduled_start_from_db(ex_row.scheduled_start_utc)
	_reserve_tools(
		session=session,
		job=job,
		operation_type=OperationType.EXTRUSION,
		lane=ex_lane,
		window=(ts, ts + timedelta(hours=1)),
		tool_type_codes=_required_tool_type_codes(job, OperationType.EXTRUSION, product_version),
	)


def _rebook_lane_tools_after_schedule_change(
	session: Session,
	job: Job,
	product_version: Optional[ProductVersion],
	lane: ScheduleLane,
	operation_type: OperationType,
	scheduled_start_utc: datetime,
) -> None:
	jid_str = _str_id(job.id)
	_cancel_tool_reservations_for_job_lane(session, jid_str, operation_type, lane)
	_reserve_tools(
		session=session,
		job=job,
		operation_type=operation_type,
		lane=lane,
		window=(scheduled_start_utc, scheduled_start_utc + timedelta(hours=1)),
		tool_type_codes=_required_tool_type_codes(job, operation_type, product_version),
	)


def _recompute_chain_offsets_from_queue(session: Session, job: Job, ctx: Any) -> None:
	"""Persist offsets as operating-hours from extrusion start to each satellite's actual scheduled start."""
	jid_str = _str_id(job.id)
	ex_row = session.execute(
		select(ExtrusionQueueItem).where(ExtrusionQueueItem.job_id == jid_str).limit(1)
	).scalars().first()
	if not ex_row or ex_row.scheduled_start_utc is None:
		job.schedule_chain_uteco_offset_operating_hours = None
		job.schedule_chain_bagging_offset_operating_hours = None
		return
	ex_local = _scheduled_start_from_db(ex_row.scheduled_start_utc).astimezone(ctx.tz)
	ut = session.execute(select(UtecoQueueItem).where(UtecoQueueItem.job_id == jid_str).limit(1)).scalars().first()
	bg = session.execute(select(BaggingQueueItem).where(BaggingQueueItem.job_id == jid_str).limit(1)).scalars().first()
	if ut and ut.scheduled_start_utc is not None:
		ut_local = _scheduled_start_from_db(ut.scheduled_start_utc).astimezone(ctx.tz)
		job.schedule_chain_uteco_offset_operating_hours = operating_hours_between(ex_local, ut_local, ctx)
	else:
		job.schedule_chain_uteco_offset_operating_hours = None
	if bg and bg.scheduled_start_utc is not None:
		bg_local = _scheduled_start_from_db(bg.scheduled_start_utc).astimezone(ctx.tz)
		job.schedule_chain_bagging_offset_operating_hours = operating_hours_between(ex_local, bg_local, ctx)
	else:
		job.schedule_chain_bagging_offset_operating_hours = None


def _maybe_pull_upstream_for_first_roll_constraint(
	session: Session,
	job: Job,
	product_version: Optional[ProductVersion],
	ctx: Any,
	*,
	moved_operation: OperationType,
	satellite_start_utc: datetime,
) -> None:
	"""If a satellite is placed too early, pull upstream operations earlier (independent drag)."""
	if moved_operation not in (OperationType.PRINTING_UTECO, OperationType.CONVERSION):
		return
	jid_str = _str_id(job.id)
	ex_row = session.execute(
		select(ExtrusionQueueItem).where(ExtrusionQueueItem.job_id == jid_str).limit(1)
	).scalars().first()
	if not ex_row or ex_row.scheduled_start_utc is None:
		return
	if ex_row.status == QueueStatus.RUNNING:
		return
	ex_lane = resolve_schedule_lane(session, ex_row.extruder_code)
	if ex_lane.kind != "extrusion" or not ex_lane.extruder:
		return
	sat_local = _scheduled_start_from_db(satellite_start_utc).astimezone(ctx.tz)

	def _pull_parent_if_needed(
		parent_start_utc: datetime,
		parent_roll_h: float,
		child_start_local: datetime,
	) -> Optional[datetime]:
		parent_local = _scheduled_start_from_db(parent_start_utc).astimezone(ctx.tz)
		min_roll_end = add_operating_hours(parent_local, parent_roll_h, ctx)
		if child_start_local >= min_roll_end:
			return None
		return inverse_add_operating_hours(child_start_local, parent_roll_h, ctx).astimezone(timezone.utc)

	# Conversion depends on Uteco first roll when a Uteco row exists, otherwise directly on extrusion.
	if moved_operation == OperationType.CONVERSION:
		ut_row = session.execute(
			select(UtecoQueueItem).where(UtecoQueueItem.job_id == jid_str).limit(1)
		).scalars().first()
		if (
			ut_row
			and ut_row.scheduled_start_utc is not None
			and ut_row.status != QueueStatus.RUNNING
		):
			ut_lane = resolve_schedule_lane(session, str(ut_row.uteco_printer_id))
			if ut_lane.kind == "uteco" and ut_lane.uteco_printer:
				rolls = max(1, _num_rolls_for_job(session, job, product_version))
				ut_roll_h = max(
					0.25,
					_estimate_lane_duration_hours(session, ut_lane, job, product_version) / float(rolls),
				)
				ut_new_start_utc = _pull_parent_if_needed(ut_row.scheduled_start_utc, ut_roll_h, sat_local)
				if ut_new_start_utc is not None:
					ut_row.scheduled_start_utc = ut_new_start_utc
					session.flush()
					_rebook_lane_tools_after_schedule_change(
						session,
						job,
						product_version,
						ut_lane,
						OperationType.PRINTING_UTECO,
						ut_new_start_utc,
					)
					# Cascade: if Uteco moved earlier than extrusion first roll, pull extrusion too.
					sat_local = _scheduled_start_from_db(ut_new_start_utc).astimezone(ctx.tz)

	ex_roll_h = _first_roll_operating_hours_for_extrusion_lane(session, ex_lane, job, product_version)
	ex_new_start_utc = _pull_parent_if_needed(ex_row.scheduled_start_utc, ex_roll_h, sat_local)
	if ex_new_start_utc is not None:
		ex_row.scheduled_start_utc = ex_new_start_utc
		session.flush()
		_rebook_extrusion_tools_after_schedule_change(session, job, ex_row, ex_lane, product_version)


def _maybe_push_satellite_forward_for_first_roll_constraint(
	session: Session,
	job: Job,
	product_version: Optional[ProductVersion],
	ctx: Any,
	*,
	moved_operation: OperationType,
) -> None:
	"""If a moved satellite is still early after adjustments, push it forward (never backward)."""
	if moved_operation not in (OperationType.PRINTING_UTECO, OperationType.CONVERSION):
		return
	jid_str = _str_id(job.id)
	ex_row = session.execute(
		select(ExtrusionQueueItem).where(ExtrusionQueueItem.job_id == jid_str).limit(1)
	).scalars().first()
	if not ex_row or ex_row.scheduled_start_utc is None:
		return
	ex_lane = resolve_schedule_lane(session, ex_row.extruder_code)
	if ex_lane.kind != "extrusion" or not ex_lane.extruder:
		return
	parent_start_utc = ex_row.scheduled_start_utc
	parent_roll_h = _first_roll_operating_hours_for_extrusion_lane(session, ex_lane, job, product_version)

	sat_row = None
	sat_lane = None
	if moved_operation == OperationType.PRINTING_UTECO:
		sat_row = session.execute(
			select(UtecoQueueItem).where(UtecoQueueItem.job_id == jid_str).limit(1)
		).scalars().first()
		if sat_row and sat_row.scheduled_start_utc is not None:
			sat_lane = resolve_schedule_lane(session, str(sat_row.uteco_printer_id))
			if sat_lane.kind == "uteco" and sat_lane.uteco_printer:
				pass
	elif moved_operation == OperationType.CONVERSION:
		sat_row = session.execute(
			select(BaggingQueueItem).where(BaggingQueueItem.job_id == jid_str).limit(1)
		).scalars().first()
		if sat_row and sat_row.scheduled_start_utc is not None:
			sat_lane = resolve_schedule_lane(session, str(sat_row.bagging_machine_id))
			ut_row = session.execute(
				select(UtecoQueueItem).where(UtecoQueueItem.job_id == jid_str).limit(1)
			).scalars().first()
			if ut_row and ut_row.scheduled_start_utc is not None:
				ut_lane = resolve_schedule_lane(session, str(ut_row.uteco_printer_id))
				if ut_lane.kind == "uteco" and ut_lane.uteco_printer:
					rolls = max(1, _num_rolls_for_job(session, job, product_version))
					parent_start_utc = ut_row.scheduled_start_utc
					parent_roll_h = max(
						0.25,
						_estimate_lane_duration_hours(session, ut_lane, job, product_version) / float(rolls),
					)

	if sat_row is None or sat_lane is None or sat_row.scheduled_start_utc is None:
		return
	if sat_row.status == QueueStatus.RUNNING:
		return

	parent_local = _scheduled_start_from_db(parent_start_utc).astimezone(ctx.tz)
	min_roll_end_local = add_operating_hours(parent_local, parent_roll_h, ctx)
	sat_local = _scheduled_start_from_db(sat_row.scheduled_start_utc).astimezone(ctx.tz)
	if sat_local >= min_roll_end_local:
		return

	# Forward-only: if snapping is needed, never move earlier than the minimum.
	new_sat_local = snap_to_operating_instant(min_roll_end_local, ctx)
	sat_row.scheduled_start_utc = new_sat_local.astimezone(timezone.utc)
	session.flush()
	_rebook_lane_tools_after_schedule_change(
		session,
		job,
		product_version,
		sat_lane,
		moved_operation,
		sat_row.scheduled_start_utc,
	)


def _maybe_shift_bagging_with_uteco_move(
	session: Session,
	job: Job,
	product_version: Optional[ProductVersion],
	ctx: Any,
	*,
	old_uteco_start_utc: Optional[datetime],
	new_uteco_start_utc: Optional[datetime],
) -> None:
	"""When Uteco moves, shift bagging by the same operating-time delta (if bagging is queued and movable)."""
	if old_uteco_start_utc is None or new_uteco_start_utc is None:
		return
	old_local = _scheduled_start_from_db(old_uteco_start_utc).astimezone(ctx.tz)
	new_local = _scheduled_start_from_db(new_uteco_start_utc).astimezone(ctx.tz)
	delta_h = operating_hours_between(old_local, new_local, ctx)
	if abs(delta_h) < 1e-9:
		return

	jid_str = _str_id(job.id)
	bg_row = session.execute(
		select(BaggingQueueItem).where(BaggingQueueItem.job_id == jid_str).limit(1)
	).scalars().first()
	if not bg_row or bg_row.scheduled_start_utc is None:
		return
	if bg_row.status == QueueStatus.RUNNING:
		return
	bg_lane = resolve_schedule_lane(session, str(bg_row.bagging_machine_id))
	bg_local = _scheduled_start_from_db(bg_row.scheduled_start_utc).astimezone(ctx.tz)
	bg_new_local = add_operating_hours(bg_local, float(delta_h), ctx)
	bg_row.scheduled_start_utc = bg_new_local.astimezone(timezone.utc)
	session.flush()
	_rebook_lane_tools_after_schedule_change(
		session,
		job,
		product_version,
		bg_lane,
		OperationType.CONVERSION,
		bg_row.scheduled_start_utc,
	)


def _append_tail_queue_item_with_start(
	session: Session,
	lane: ScheduleLane,
	job: Job,
	product_version: Optional[ProductVersion],
	sched_utc: datetime,
) -> None:
	"""Append one queued row at the tail with explicit ``scheduled_start_utc`` (Uteco / bagging only)."""
	jid_str = _str_id(job.id)
	items = _load_lane_items_for_update(session, lane)
	if any(_str_id(i.job_id) == jid_str for i in items):
		return
	op_lane = _operation_type_for_lane(lane)
	_validate_lane_for_job(lane, product_version, op_lane)

	insert_pos = max((i.position for i in items), default=0) + 1
	_bump_queue_positions_from(items, insert_pos)
	session.flush()

	if lane.kind == "uteco" and lane.uteco_printer:
		queue_item = UtecoQueueItem(
			uteco_printer_id=lane.uteco_printer.id,
			job_id=jid_str,
			position=insert_pos,
			status=QueueStatus.QUEUED,
			operating_hours_lead_before=0,
			scheduled_start_utc=sched_utc,
		)
	elif lane.kind == "bagging" and lane.bagging_machine:
		queue_item = BaggingQueueItem(
			bagging_machine_id=lane.bagging_machine.id,
			job_id=jid_str,
			position=insert_pos,
			status=QueueStatus.QUEUED,
			operating_hours_lead_before=0,
			scheduled_start_utc=sched_utc,
		)
	else:
		raise DomainError("Satellite enqueue supports Uteco and bagging lanes only")

	session.add(queue_item)
	session.flush()

	required_codes = _required_tool_type_codes(job, op_lane, product_version)
	window = (sched_utc, sched_utc + timedelta(hours=1))
	_reserve_tools(
		session=session,
		job=job,
		operation_type=op_lane,
		lane=lane,
		window=window,
		tool_type_codes=required_codes,
	)


def _maybe_enqueue_uteco_bagging_after_extrusion(
	session: Session,
	job: Job,
	product_version: Optional[ProductVersion],
	extrusion_lane: ScheduleLane,
	extrusion_sched_utc: datetime,
	ctx: Any,
) -> None:
	jid_str = _str_id(job.id)
	spec = (product_version.spec_payload if product_version else {}) or {}
	pm = _get_printing_method_from_spec(product_version)
	needs_uteco = pm == PrintingMethod.UTECO
	needs_bag = _spec_finish_requires_conversion(spec)
	if not needs_uteco and not needs_bag:
		job.schedule_chain_uteco_offset_operating_hours = None
		job.schedule_chain_bagging_offset_operating_hours = None
		return

	if extrusion_lane.kind != "extrusion" or not extrusion_lane.extruder:
		return

	roll_h = _first_roll_operating_hours_for_extrusion_lane(session, extrusion_lane, job, product_version)
	ex_local = _scheduled_start_from_db(extrusion_sched_utc).astimezone(ctx.tz)
	first_roll_end_local = add_operating_hours(ex_local, roll_h, ctx)

	job.schedule_chain_uteco_offset_operating_hours = None
	job.schedule_chain_bagging_offset_operating_hours = None
	if needs_uteco:
		job.schedule_chain_uteco_offset_operating_hours = operating_hours_between(ex_local, first_roll_end_local, ctx)

	bag_local = first_roll_end_local
	if needs_bag:
		if needs_uteco:
			estimates = _estimate_job_operations_core(
				session, job, product_version, extrusion_extruder=extrusion_lane.extruder
			)
			ut_est = next((e for e in estimates if e.operation_type == OperationType.PRINTING_UTECO.value), None)
			ut_dur = float(ut_est.estimated_duration_hours) if ut_est else 1.0
			bag_local = add_operating_hours(first_roll_end_local, ut_dur, ctx)
		job.schedule_chain_bagging_offset_operating_hours = operating_hours_between(ex_local, bag_local, ctx)

	if needs_uteco and not _uteco_queue_row_exists(session, jid_str):
		ut_lane = _resolve_uteco_target_lane(session, jid_str, job, product_version)
		if ut_lane:
			_append_tail_queue_item_with_start(
				session, ut_lane, job, product_version, first_roll_end_local.astimezone(timezone.utc)
			)

	if needs_bag and not _bagging_queue_row_exists(session, jid_str):
		bg_lane = _resolve_bagging_target_lane(session, jid_str, job, product_version)
		if bg_lane:
			_append_tail_queue_item_with_start(
				session, bg_lane, job, product_version, bag_local.astimezone(timezone.utc)
			)


def _sync_chain_queue_starts_from_extrusion(session: Session, job: Job, ctx: Any) -> None:
	"""Recompute Uteco/bagging ``scheduled_start_utc`` from extrusion start + persisted offsets."""
	jid_str = _str_id(job.id)
	ex_row = session.execute(
		select(ExtrusionQueueItem).where(ExtrusionQueueItem.job_id == jid_str).limit(1)
	).scalars().first()
	if not ex_row or ex_row.scheduled_start_utc is None:
		return
	ut_off = job.schedule_chain_uteco_offset_operating_hours
	bg_off = job.schedule_chain_bagging_offset_operating_hours
	if ut_off is None and bg_off is None:
		return

	ex_local = _scheduled_start_from_db(ex_row.scheduled_start_utc).astimezone(ctx.tz)
	_, _, product_version = _get_job_with_context(session, uuid.UUID(jid_str))

	if ut_off is not None:
		ut = session.execute(select(UtecoQueueItem).where(UtecoQueueItem.job_id == jid_str).limit(1)).scalars().first()
		if ut:
			ns = add_operating_hours(ex_local, float(ut_off), ctx).astimezone(timezone.utc)
			ut.scheduled_start_utc = ns
			ut.operating_hours_lead_before = 0
			session.flush()
			ut_lane = resolve_schedule_lane(session, str(ut.uteco_printer_id))
			_cancel_tool_reservations_for_job_lane(session, jid_str, OperationType.PRINTING_UTECO, ut_lane)
			_reserve_tools(
				session=session,
				job=job,
				operation_type=OperationType.PRINTING_UTECO,
				lane=ut_lane,
				window=(ns, ns + timedelta(hours=1)),
				tool_type_codes=_required_tool_type_codes(job, OperationType.PRINTING_UTECO, product_version),
			)

	if bg_off is not None:
		bg = session.execute(select(BaggingQueueItem).where(BaggingQueueItem.job_id == jid_str).limit(1)).scalars().first()
		if bg:
			ns = add_operating_hours(ex_local, float(bg_off), ctx).astimezone(timezone.utc)
			bg.scheduled_start_utc = ns
			bg.operating_hours_lead_before = 0
			session.flush()
			bg_lane = resolve_schedule_lane(session, str(bg.bagging_machine_id))
			_cancel_tool_reservations_for_job_lane(session, jid_str, OperationType.CONVERSION, bg_lane)
			_reserve_tools(
				session=session,
				job=job,
				operation_type=OperationType.CONVERSION,
				lane=bg_lane,
				window=(ns, ns + timedelta(hours=1)),
				tool_type_codes=_required_tool_type_codes(job, OperationType.CONVERSION, product_version),
			)


def _remove_satellite_queue_rows_for_job(session: Session, job_id_str: str) -> None:
	ut = session.execute(select(UtecoQueueItem).where(UtecoQueueItem.job_id == job_id_str).limit(1)).scalars().first()
	if ut:
		lane_ut = resolve_schedule_lane(session, str(ut.uteco_printer_id))
		items_ut = _load_lane_items_for_update(session, lane_ut)
		items_ut = [i for i in items_ut if i.id != ut.id]
		session.delete(ut)
		session.flush()
		_reindex_lane(session, items_ut)
		_cancel_tool_reservations_for_job_lane(session, job_id_str, OperationType.PRINTING_UTECO, lane_ut)

	bg = session.execute(select(BaggingQueueItem).where(BaggingQueueItem.job_id == job_id_str).limit(1)).scalars().first()
	if bg:
		lane_bg = resolve_schedule_lane(session, str(bg.bagging_machine_id))
		items_bg = _load_lane_items_for_update(session, lane_bg)
		items_bg = [i for i in items_bg if i.id != bg.id]
		session.delete(bg)
		session.flush()
		_reindex_lane(session, items_bg)
		_cancel_tool_reservations_for_job_lane(session, job_id_str, OperationType.CONVERSION, lane_bg)


def _required_tool_type_codes(job: Job, operation_type: OperationType, product_version: Optional[ProductVersion]) -> List[str]:
	if operation_type == OperationType.EXTRUSION:
		spec = (product_version.spec_payload if product_version else {}) or {}
		rr = spec.get("run_requirements") or {}
		if not isinstance(rr, dict):
			rr = {}
		codes: List[str] = []
		pm = _get_printing_method_from_spec(product_version)
		if pm == PrintingMethod.INLINE or rr.get("inline_print_1c") or (spec.get("extrusion") or {}).get("inline_print_1c"):
			codes.append("inline_printer_1c")
		if rr.get("inline_perforation"):
			codes.append("inline_perforator")
		if rr.get("hole_punched"):
			codes.append("inline_hole_punch")
		seen: set[str] = set()
		out: List[str] = []
		for c in codes:
			if c not in seen:
				seen.add(c)
				out.append(c)
		return out
	if operation_type == OperationType.PRINTING_UTECO:
		spec = (product_version.spec_payload if product_version else {}) or {}
		if (spec.get("printing") or {}).get("requires_electra_punch"):
			return ["electra_punch"]
		return []
	return []


def _operation_type_for_lane(lane: ScheduleLane) -> OperationType:
	if lane.kind == "extrusion":
		return OperationType.EXTRUSION
	if lane.kind == "uteco":
		return OperationType.PRINTING_UTECO
	if lane.kind == "bagging":
		return OperationType.CONVERSION
	raise DomainError("Unsupported schedule lane kind")


def _extruder_lane_sort_parts(extruder: Extruder) -> Tuple[int, int, str]:
	"""Match ratebook + list_active_lanes: decision width ascending, null widths last, then extruder_code."""
	if extruder.decision_width_mm is None:
		return (1, 0, extruder.extruder_code)
	return (0, int(extruder.decision_width_mm), extruder.extruder_code)


def _lane_sort_key(lane: ScheduleLane) -> Tuple[int, int, int, str]:
	kind_rank = {"extrusion": 0, "uteco": 1, "bagging": 2}
	k = kind_rank.get(lane.kind, 9)
	if lane.kind == "extrusion" and lane.extruder:
		g, w, code = _extruder_lane_sort_parts(lane.extruder)
		return (k, g, w, code)
	if lane.kind == "uteco" and lane.uteco_printer:
		return (k, 0, 0, lane.uteco_printer.code)
	if lane.kind == "bagging" and lane.bagging_machine:
		return (k, 0, 0, lane.bagging_machine.code)
	return (k, 0, 0, "")


def _num_rolls_for_job(session: Session, job: Job, product_version: Optional[ProductVersion]) -> int:
	"""Prefer JobSheet.num_rolls for scheduling; fall back to spec run_requirements."""
	spec = (product_version.spec_payload if product_version else {}) or {}
	fallback = _roll_count_from_spec(spec)
	jid = getattr(job, "job_sheet_id", None)
	if jid:
		js = session.get(JobSheet, str(jid))
		if js is not None:
			nr = getattr(js, "num_rolls", None)
			if nr is not None:
				try:
					v = int(nr)
					if v >= 1:
						return max(1, min(v, 500))
				except (TypeError, ValueError):
					pass
	oid = getattr(job, "order_id", None)
	if oid:
		items = list(
			session.execute(select(OrderItem).where(OrderItem.order_id == oid).order_by(OrderItem.id.asc())).scalars().all()
		)
		try:
			idx = int(job.job_code) - 1
		except (TypeError, ValueError):
			idx = -1
		if 0 <= idx < len(items) and getattr(items[idx], "job_sheet_id", None):
			js = session.get(JobSheet, str(items[idx].job_sheet_id))
			if js is not None:
				nr = getattr(js, "num_rolls", None)
				if nr is not None:
					try:
						v = int(nr)
						if v >= 1:
							return max(1, min(v, 500))
					except (TypeError, ValueError):
						pass
	return max(1, min(fallback, 500))


def _roll_count_from_spec(spec: dict) -> int:
	if not isinstance(spec, dict):
		return 1
	rr = spec.get("run_requirements") or {}
	if not isinstance(rr, dict):
		rr = {}
	for key in ("num_rolls", "rolls", "number_of_rolls"):
		v = rr.get(key)
		if v is not None:
			try:
				return max(1, min(int(float(v)), 500))
			except (TypeError, ValueError):
				pass
	dims = spec.get("dimensions") or {}
	if isinstance(dims, dict):
		v = dims.get("num_rolls")
		if v is not None:
			try:
				return max(1, min(int(float(v)), 500))
			except (TypeError, ValueError):
				pass
	return 1


def _find_extruder_for_queued_job(session: Session, job_id: uuid.UUID | str) -> Optional[Extruder]:
	"""If the job is on an extrusion lane, return that rate-card extruder (for kg/hr)."""
	jid = _str_id(job_id)
	q = (
		select(Extruder)
		.join(ExtrusionQueueItem, ExtrusionQueueItem.extruder_code == Extruder.extruder_code)
		.where(
			ExtrusionQueueItem.job_id == jid,
			ExtrusionQueueItem.status.in_([QueueStatus.QUEUED, QueueStatus.RUNNING]),
		)
		.limit(1)
	)
	return session.execute(q).scalars().first()


def _estimated_extrusion_kg(job: Job, product_version: Optional[ProductVersion]) -> float:
	planned_qty = float(job.planned_qty)
	spec = (product_version.spec_payload if product_version else {}) or {}
	rr = spec.get("run_requirements") or {}
	if isinstance(rr, dict):
		for key in ("total_kg", "extrusion_kg", "film_kg"):
			if rr.get(key) is not None:
				try:
					return max(float(rr[key]), 0.01)
				except (TypeError, ValueError):
					pass
	totals = spec.get("totals") or {}
	if isinstance(totals, dict) and totals.get("total_kg") is not None:
		try:
			return max(float(totals["total_kg"]), 0.01)
		except (TypeError, ValueError):
			pass
	return max(planned_qty * 0.5, 1.0)


def _base_length_mm_from_spec(spec: dict) -> float:
	"""Bag cut length (mm) from product spec — same basis as ``specToQuoteInputs`` / quote calculator."""
	dim = spec.get("dimensions") or {}
	if not isinstance(dim, dict):
		return 0.0
	try:
		raw = float(dim.get("base_length_mm") or 0)
	except (TypeError, ValueError):
		return 0.0
	units = str(dim.get("length_units") or "mm").lower()
	if units == "m":
		return max(0.0, raw * 1000.0)
	return max(0.0, raw)


def _pick_conversion_speed_row(
	session: Session,
	gauge_um: float,
	length_mm: float,
) -> Optional[ConversionSpeed]:
	"""Match ``conversion_speeds`` admin rows the same way as ``pickConversionSpeed`` in the quotes UI."""
	rows = list(
		session.execute(
			select(ConversionSpeed).order_by(
				ConversionSpeed.min_gauge_um.asc(),
				ConversionSpeed.max_gauge_um.asc(),
				ConversionSpeed.min_length_mm.asc(),
				ConversionSpeed.max_length_mm.asc(),
			)
		).scalars().all()
	)
	if not rows:
		return None
	g = int(round(float(gauge_um)))
	lm = int(round(float(length_mm)))
	for r in rows:
		if r.min_gauge_um <= g <= r.max_gauge_um and r.min_length_mm <= lm <= r.max_length_mm:
			return r
	return rows[0]


def _conversion_factor_value(session: Session, slug: str, default: float = 0.0) -> float:
	row = session.get(ConversionFactor, slug)
	if row is None:
		return default
	try:
		return float(row.value)
	except (TypeError, ValueError):
		return default


def _conversion_duration_hours_from_ratebook(
	session: Session,
	job: Job,
	product_version: Optional[ProductVersion],
) -> float:
	"""
	Bagging / conversion runtime from admin conversion speeds + roll-change factors.
	Mirrors ``computeQuickQuotePreview`` (Cartons): units / bags_per_minute + roll_changes × roll_change_minutes.
	"""
	spec = (product_version.spec_payload if product_version else {}) or {}
	if not isinstance(spec, dict):
		spec = {}

	gv = _compute_gauge_um_from_spec(spec)
	gauge_pick = float(gv) if gv is not None else 0.0
	length_mm = _base_length_mm_from_spec(spec)
	speed_row = _pick_conversion_speed_row(session, gauge_pick, length_mm)
	bpm = float(speed_row.bags_per_minute) if speed_row is not None else 0.0
	planned_qty = float(job.planned_qty)

	run_minutes: Optional[float] = (planned_qty / bpm) if bpm > 0 else None

	roll_avg_kg = _conversion_factor_value(session, "roll_weight_avg", 0.0)
	roll_change_mins = _conversion_factor_value(session, "roll_change_minutes", 0.0)
	derived_kg = _estimated_extrusion_kg(job, product_version)
	roll_changes = (
		math.ceil(derived_kg / roll_avg_kg) if roll_avg_kg > 0 and derived_kg > 0 else 0
	)
	roll_change_total_min = (
		float(roll_changes) * roll_change_mins if roll_changes > 0 and roll_change_mins > 0 else 0.0
	)

	if run_minutes is None:
		fallback_bph = 1000.0
		return max(0.25, 0.25 + planned_qty / fallback_bph if fallback_bph > 0 else 1.0)

	total_minutes = run_minutes + roll_change_total_min
	duration_hours = total_minutes / 60.0
	return max(0.25, duration_hours)


def _extrusion_duration_hours_for_extruder(
	session: Session, extruder: Extruder, job: Job, product_version: Optional[ProductVersion]
) -> float:
	"""
	Extrusion runtime for the Gantt bar on this lane: job weight (kg) ÷ that extruder's average kg/hr.
	Missing rate card → 100 kg/h default.
	"""
	ext = extruder
	kg_hr = float(ext.average_kg_hr) if ext and ext.average_kg_hr is not None else 100.0
	kg_hr = max(kg_hr, 1.0)
	kg = _estimated_extrusion_kg(job, product_version)
	return max(0.25, kg / kg_hr)


def _job_sheet_job_no_for_job(session: Session, job: Job) -> Optional[str]:
	if job.job_sheet_id:
		js = session.get(JobSheet, job.job_sheet_id)
		return js.job_no if js else None
	if not job.order_id:
		return None
	items = list(
		session.execute(
			select(OrderItem).where(OrderItem.order_id == job.order_id).order_by(OrderItem.id.asc())
		).scalars().all()
	)
	idx = int(job.job_code) - 1
	if idx < 0 or idx >= len(items):
		return None
	js = session.get(JobSheet, items[idx].job_sheet_id)
	return js.job_no if js else None


def _estimate_job_operations_core(
	session: Session,
	job: Job,
	product_version: Optional[ProductVersion],
	*,
	extrusion_extruder: Optional[Extruder] = None,
) -> List[OperationEstimateDTO]:
	spec = (product_version.spec_payload if product_version else {}) or {}
	operations: List[OperationEstimateDTO] = []
	printing_method = _get_printing_method_from_spec(product_version)
	requires_extrusion = True
	requires_uteco = printing_method == PrintingMethod.UTECO
	requires_conversion = True
	planned_qty = float(job.planned_qty)

	if requires_extrusion:
		estimated_kg = _estimated_extrusion_kg(job, product_version)
		if extrusion_extruder is not None:
			duration_hours = _extrusion_duration_hours_for_extruder(
				session, extrusion_extruder, job, product_version
			)
		else:
			extruder_rate_kg_per_hour = 100.0
			duration_hours = estimated_kg / extruder_rate_kg_per_hour if extruder_rate_kg_per_hour > 0 else 1.0
		operations.append(
			OperationEstimateDTO(
				operation_type=OperationType.EXTRUSION.value,
				estimated_duration_hours=max(0.5, duration_hours),
				estimated_kg=estimated_kg,
			)
		)

	if requires_uteco:
		web_length_m = planned_qty * 0.1
		printer_speed_m_per_min = 50.0
		num_colours = (spec.get("printing") or {}).get("num_colours", 1) or 1
		setup_allowance_hours = 0.5 + (num_colours * 0.1)
		runtime_hours = (web_length_m / printer_speed_m_per_min) / 60.0
		duration_hours = setup_allowance_hours + runtime_hours
		operations.append(
			OperationEstimateDTO(
				operation_type=OperationType.PRINTING_UTECO.value,
				estimated_duration_hours=max(0.5, duration_hours),
				estimated_metres=web_length_m,
			)
		)

	if requires_conversion:
		duration_hours = _conversion_duration_hours_from_ratebook(session, job, product_version)
		operations.append(
			OperationEstimateDTO(
				operation_type=OperationType.CONVERSION.value,
				estimated_duration_hours=max(0.25, duration_hours),
				estimated_units=planned_qty,
			)
		)

	return operations


def _estimate_lane_duration_hours(
	session: Session, lane: ScheduleLane, job: Job, product_version: Optional[ProductVersion]
) -> float:
	op = _operation_type_for_lane(lane)
	if op == OperationType.EXTRUSION and lane.extruder:
		return _extrusion_duration_hours_for_extruder(session, lane.extruder, job, product_version)
	estimates = _estimate_job_operations_core(session, job, product_version, extrusion_extruder=None)
	op_str = op.value if hasattr(op, "value") else str(op)
	operation_estimate = next((e for e in estimates if e.operation_type == op_str), None)
	return operation_estimate.estimated_duration_hours if operation_estimate else 1.0


def _find_tool_type(session: Session, code: str) -> Optional[ToolType]:
	q = select(ToolType).where(ToolType.code == code)
	return session.execute(q).scalars().first()


def _lane_reservation_match(lane: ScheduleLane):
	if lane.kind == "extrusion" and lane.extruder:
		return ToolReservation.extruder_code == lane.extruder.extruder_code
	if lane.kind == "uteco" and lane.uteco_printer:
		return ToolReservation.uteco_printer_id == lane.uteco_printer.id
	if lane.kind == "bagging" and lane.bagging_machine:
		return ToolReservation.bagging_machine_id == lane.bagging_machine.id
	raise DomainError("Invalid schedule lane for tool reservation")


def _pick_tool_id_for_window(
	session: Session,
	tool_type_id: str,
	lane: ScheduleLane,
	planned_from: Optional[datetime],
	planned_to: Optional[datetime],
) -> Optional[str]:
	tools = list(
		session.execute(
			select(Tool)
			.where(Tool.tool_type_id == tool_type_id, Tool.active.is_(True))
			.order_by(Tool.serial_code.asc())
		).scalars().all()
	)
	if not tools:
		return None
	if not planned_from or not planned_to:
		return str(tools[0].id)
	best_id: Optional[str] = None
	best_load = 10**9
	for t in tools:
		ov = (
			select(func.count())
			.select_from(ToolReservation)
			.where(
				ToolReservation.tool_id == t.id,
				_lane_reservation_match(lane),
				ToolReservation.status.in_([ToolReservationStatus.PLANNED, ToolReservationStatus.FULFILLED]),
				ToolReservation.planned_from.isnot(None),
				ToolReservation.planned_to.isnot(None),
				ToolReservation.planned_from <= planned_to,
				ToolReservation.planned_to >= planned_from,
			)
		)
		load = int(session.execute(ov).scalar_one() or 0)
		if load < best_load:
			best_load = load
			best_id = str(t.id)
	return best_id


def _build_tool_strips_for_extrusion(
	session: Session, job: Job, lane: ScheduleLane, product_version: Optional[ProductVersion]
) -> List[ToolStripDTO]:
	codes = _required_tool_type_codes(job, OperationType.EXTRUSION, product_version)
	out: List[ToolStripDTO] = []
	jid = _str_id(job.id)
	if not (lane.kind == "extrusion" and lane.extruder):
		return out
	ec = lane.extruder.extruder_code
	for code in codes:
		tt = _find_tool_type(session, code)
		name = tt.name if tt else code.replace("_", " ").title()
		color = _TOOL_STRIP_COLORS.get(code, "#607d8b")
		serial: Optional[str] = None
		if tt:
			tr = session.execute(
				select(ToolReservation)
				.where(
					ToolReservation.job_id == jid,
					ToolReservation.extruder_code == ec,
					ToolReservation.tool_type_id == tt.id,
					ToolReservation.operation_type == OperationType.EXTRUSION,
				)
				.limit(1)
			).scalars().first()
			if tr and tr.tool_id:
				tool = session.get(Tool, str(tr.tool_id))
				if tool:
					serial = tool.serial_code
		out.append(ToolStripDTO(tool_type_code=code, name=name, color=color, tool_serial=serial))
	return out


def _gantt_tool_conflict_dtos_for_job_lane(
	session: Session, job: Job, lane: ScheduleLane
) -> List[ToolConflictDTO]:
	if not (lane.kind == "extrusion" and lane.extruder):
		return []
	rows = session.execute(
		select(ToolReservation).where(
			ToolReservation.job_id == _str_id(job.id),
			ToolReservation.extruder_code == lane.extruder.extruder_code,
			ToolReservation.operation_type == OperationType.EXTRUSION,
			ToolReservation.status == ToolReservationStatus.CONFLICTED,
		)
	).scalars().all()
	out: List[ToolConflictDTO] = []
	for tr in rows:
		tt = session.get(ToolType, str(tr.tool_type_id))
		code = tt.code if tt else "unknown"
		out.append(
			ToolConflictDTO(
				tool_type_code=code,
				from_=tr.planned_from,
				to=tr.planned_to,
				reason="Insufficient tools of this type for the planned window",
			)
		)
	return out


def _extrusion_toolbox_balances(session: Session) -> List[ToolboxBalanceDTO]:
	n_extruders = int(
		session.execute(select(func.count()).select_from(Extruder)).scalar_one() or 0
	)
	if n_extruders == 0:
		return []
	order = ["inline_printer_1c", "inline_perforator", "inline_hole_punch"]
	out: List[ToolboxBalanceDTO] = []
	for code in order:
		tt = _find_tool_type(session, code)
		if not tt:
			continue
		total = int(
			session.execute(
				select(func.count()).select_from(Tool).where(Tool.tool_type_id == tt.id, Tool.active.is_(True))
			).scalar_one()
			or 0
		)
		reserved = int(
			session.execute(
				select(func.count())
				.select_from(ToolReservation)
				.where(
					ToolReservation.tool_type_id == tt.id,
					ToolReservation.operation_type == OperationType.EXTRUSION,
					ToolReservation.extruder_code.isnot(None),
					ToolReservation.status.in_([ToolReservationStatus.PLANNED, ToolReservationStatus.CONFLICTED]),
				)
			).scalar_one()
			or 0
		)
		avail = max(0, total - reserved)
		out.append(
			ToolboxBalanceDTO(
				tool_type_code=code,
				name=tt.name,
				color=_TOOL_STRIP_COLORS.get(code, "#607d8b"),
				total_active=total,
				reserved=reserved,
				available=avail,
			)
		)
	return out


def _reserve_tools(
	session: Session,
	job: Job,
	operation_type: OperationType,
	lane: ScheduleLane,
	window: Optional[Tuple[Optional[datetime], Optional[datetime]]],
	tool_type_codes: List[str],
) -> List[ToolConflictDTO]:
	conflicts: List[ToolConflictDTO] = []
	planned_from: Optional[datetime] = window[0] if window else None
	planned_to: Optional[datetime] = window[1] if window else None
	ex_code = lane.extruder.extruder_code if lane.kind == "extrusion" and lane.extruder else None
	ut_id = lane.uteco_printer.id if lane.kind == "uteco" and lane.uteco_printer else None
	bg_id = lane.bagging_machine.id if lane.kind == "bagging" and lane.bagging_machine else None
	for code in tool_type_codes:
		tool_type = _find_tool_type(session, code)
		if not tool_type:
			conflicts.append(ToolConflictDTO(tool_type_code=code, from_=planned_from, to=planned_to, reason="Tool type not registered"))
			continue
		# Supply
		supply_q = select(func.count()).select_from(Tool).where(
			Tool.tool_type_id == tool_type.id,
			Tool.active.is_(True),
		)
		supply = session.execute(supply_q).scalar_one()

		status = ToolReservationStatus.PLANNED
		reason = ""
		if planned_from and planned_to:
			# Count overlapping reservations for same tool_type on this lane
			overlap_q = select(func.count()).select_from(ToolReservation).where(
				ToolReservation.tool_type_id == tool_type.id,
				_lane_reservation_match(lane),
				ToolReservation.status.in_([ToolReservationStatus.PLANNED, ToolReservationStatus.FULFILLED]),
				ToolReservation.planned_from <= planned_to,
				ToolReservation.planned_to >= planned_from,
			)
			in_use = session.execute(overlap_q).scalar_one()
			if in_use >= supply:
				status = ToolReservationStatus.CONFLICTED
				reason = "Insufficient tools available in window"

		chosen_tool_id: Optional[str] = None
		if status != ToolReservationStatus.CONFLICTED and supply > 0:
			chosen_tool_id = _pick_tool_id_for_window(
				session, str(tool_type.id), lane, planned_from, planned_to
			)

		res = ToolReservation(
			tool_type_id=tool_type.id,
			tool_id=chosen_tool_id,
			extruder_code=ex_code,
			uteco_printer_id=ut_id,
			bagging_machine_id=bg_id,
			planned_from=planned_from,
			planned_to=planned_to,
			status=status,
			job_id=job.id,
			operation_type=operation_type,
		)
		session.add(res)
		if status == ToolReservationStatus.CONFLICTED:
			conflicts.append(ToolConflictDTO(tool_type_code=code, from_=planned_from, to=planned_to, reason=reason or "conflict"))
	return conflicts


def _validate_lane_for_job(
	lane: ScheduleLane, product_version: Optional[ProductVersion], operation_type: OperationType
) -> None:
	spec = (product_version.spec_payload if product_version else {}) or {}
	if lane.kind == "extrusion" and lane.extruder:
		validate_extruder_for_spec(lane.extruder, spec, operation_type)
	elif lane.kind == "uteco" and lane.uteco_printer:
		validate_capability_dict(lane.uteco_printer.capability or {}, spec, operation_type)
	elif lane.kind == "bagging" and lane.bagging_machine:
		validate_capability_dict(lane.bagging_machine.capability or {}, spec, operation_type)


def add_job(
	machine_id: str,
	job_id: Optional[uuid.UUID] = None,
	position: Optional[int] = None,
	*,
	job_sheet_id: Optional[uuid.UUID] = None,
	target_start: Optional[datetime] = None,
) -> LaneDTO:
	with SessionLocal.begin() as session:
		lane = resolve_schedule_lane(session, machine_id)

		if job_sheet_id is not None:
			job = ensure_scheduling_job_for_job_sheet(session, str(job_sheet_id))
			job_id = uuid.UUID(str(job.id))
		elif job_id is not None:
			job = session.get(Job, str(job_id))
			if not job:
				raise DomainError("Job not found")
		else:
			raise DomainError("job_id or job_sheet_id is required")

		_, order, product_version = resolve_job_context(session, job_id)
		if job.status not in (JobStatus.PLANNED, JobStatus.SCHEDULED, JobStatus.PAUSED):
			raise DomainError("Job not in a schedulable state")

		items = _load_lane_items_for_update(session, lane)
		jid_str = _str_id(job_id)
		if any(_str_id(i.job_id) == jid_str for i in items):
			raise DomainError("Job already in this machine queue")

		items_sorted = sorted(items, key=lambda x: x.position)
		insert_pos = position if position is not None else (len(items_sorted) + 1)
		insert_pos = max(1, min(insert_pos, len(items_sorted) + 1))

		ctx, anchor_local = _gantt_anchor_local(session)
		if target_start is not None:
			sched_utc = _target_start_as_utc(target_start)
		elif insert_pos > len(items_sorted):
			sched_utc = _default_append_scheduled_start_utc(session, lane, items_sorted, ctx, anchor_local)
		else:
			pred_idx = insert_pos - 2
			if pred_idx < 0:
				sched_utc = anchor_local.astimezone(timezone.utc)
			else:
				pred = items_sorted[pred_idx]
				ps = getattr(pred, "scheduled_start_utc", None)
				if ps is None:
					sched_utc = anchor_local.astimezone(timezone.utc)
				else:
					pl = _scheduled_start_from_db(ps).astimezone(ctx.tz)
					pj, _, ppv = _get_job_with_context(session, uuid.UUID(str(pred.job_id)))
					pdur = _estimate_lane_duration_hours(session, lane, pj, ppv)
					sched_utc = add_operating_hours(pl, pdur, ctx).astimezone(timezone.utc)

		_bump_queue_positions_from(items, insert_pos)
		session.flush()

		if lane.kind == "extrusion" and lane.extruder:
			queue_item = ExtrusionQueueItem(
				extruder_code=lane.extruder.extruder_code,
				job_id=jid_str,
				position=insert_pos,
				status=QueueStatus.QUEUED,
				operating_hours_lead_before=0,
				scheduled_start_utc=sched_utc,
			)
		elif lane.kind == "uteco" and lane.uteco_printer:
			queue_item = UtecoQueueItem(
				uteco_printer_id=lane.uteco_printer.id,
				job_id=jid_str,
				position=insert_pos,
				status=QueueStatus.QUEUED,
				operating_hours_lead_before=0,
				scheduled_start_utc=sched_utc,
			)
		elif lane.kind == "bagging" and lane.bagging_machine:
			queue_item = BaggingQueueItem(
				bagging_machine_id=lane.bagging_machine.id,
				job_id=jid_str,
				position=insert_pos,
				status=QueueStatus.QUEUED,
				operating_hours_lead_before=0,
				scheduled_start_utc=sched_utc,
			)
		else:
			raise DomainError("Invalid schedule lane")
		session.add(queue_item)
		# Positions are already dense 1..n+1 after _bump_queue_positions_from + insert; reindex would
		# only rewrite the same sequence and can break SQLite UNIQUE on batched UPDATEs.

		if job.status == JobStatus.PLANNED:
			job.status = JobStatus.SCHEDULED

		warnings = _routing_warnings_for_enqueue(session, lane, job, product_version)

		operation_type = _operation_type_for_lane(lane)
		_validate_lane_for_job(lane, product_version, operation_type)
		required_codes = _required_tool_type_codes(job, operation_type, product_version)
		tool_conflicts = _reserve_tools(
			session=session,
			job=job,
			operation_type=operation_type,
			lane=lane,
			window=None,
			tool_type_codes=required_codes,
		)

		if lane.kind == "extrusion" and lane.extruder:
			_maybe_enqueue_uteco_bagging_after_extrusion(session, job, product_version, lane, sched_utc, ctx)

		refreshed = _load_lane_items_for_update(session, lane)
		return _lane_dto(lane.lane_id, refreshed, warnings=warnings, conflicts=tool_conflicts)


def reorder(machine_id: str, job_id: uuid.UUID, new_position: int) -> LaneDTO:
	with SessionLocal.begin() as session:
		lane = resolve_schedule_lane(session, machine_id)

		jid_str = _str_id(job_id)
		items = _load_lane_items_for_update(session, lane)
		item = next((i for i in items if _str_id(i.job_id) == jid_str), None)
		if not item:
			raise DomainError("Queue item not found in this lane")
		if item.status == QueueStatus.RUNNING:
			raise DomainError("Cannot reorder a running item")

		items.remove(item)
		new_position = max(1, min(new_position, len(items) + 1))
		_bump_queue_positions_from(items, new_position)
		item.position = new_position
		items.append(item)
		_reindex_lane(session, items)

		refreshed = _load_lane_items_for_update(session, lane)
		return _lane_dto(lane.lane_id, refreshed)


def remove(machine_id: str, job_id: uuid.UUID) -> LaneDTO:
	with SessionLocal.begin() as session:
		lane = resolve_schedule_lane(session, machine_id)

		jid_str = _str_id(job_id)
		items = _load_lane_items_for_update(session, lane)
		item = next((i for i in items if _str_id(i.job_id) == jid_str), None)
		if not item:
			raise DomainError("Queue item not found in this lane")
		if item.status == QueueStatus.RUNNING:
			raise DomainError("Cannot remove a running item")

		items.remove(item)
		session.delete(item)
		_reindex_lane(session, items)

		if lane.kind == "extrusion" and lane.extruder:
			_remove_satellite_queue_rows_for_job(session, jid_str)
			job_row = session.get(Job, jid_str)
			if job_row is not None:
				job_row.schedule_chain_uteco_offset_operating_hours = None
				job_row.schedule_chain_bagging_offset_operating_hours = None

		ex_code = lane.extruder.extruder_code if lane.kind == "extrusion" and lane.extruder else None
		ut_id = lane.uteco_printer.id if lane.kind == "uteco" and lane.uteco_printer else None
		bg_id = lane.bagging_machine.id if lane.kind == "bagging" and lane.bagging_machine else None
		q = session.query(ToolReservation).filter(
			ToolReservation.job_id == jid_str,
			ToolReservation.status.in_([ToolReservationStatus.PLANNED, ToolReservationStatus.CONFLICTED]),
		)
		if ex_code:
			q = q.filter(ToolReservation.extruder_code == ex_code)
		elif ut_id:
			q = q.filter(ToolReservation.uteco_printer_id == ut_id)
		elif bg_id:
			q = q.filter(ToolReservation.bagging_machine_id == bg_id)
		q.update({"status": ToolReservationStatus.CANCELLED})

		refreshed = _load_lane_items_for_update(session, lane)
		return _lane_dto(lane.lane_id, refreshed)


def validate_move(job_id: uuid.UUID, operation_type: OperationType, target_machine_id: str) -> None:
	with SessionLocal.begin() as session:
		target = resolve_schedule_lane(session, str(target_machine_id))
		expected = _operation_type_for_lane(target)
		if expected != operation_type:
			raise DomainError("Target machine does not match operation type")
		job, order, product_version = _get_job_with_context(session, job_id)
		_validate_lane_for_job(target, product_version, operation_type)


def _find_queue_item_and_lane_for_op(
	session: Session, job_id_str: str, operation_type: OperationType
) -> tuple[
	ExtrusionQueueItem | UtecoQueueItem | BaggingQueueItem | None,
	ScheduleLane | None,
]:
	if operation_type == OperationType.EXTRUSION:
		row = session.execute(
			select(ExtrusionQueueItem).where(ExtrusionQueueItem.job_id == job_id_str).with_for_update()
		).scalars().first()
		if row:
			return row, resolve_schedule_lane(session, row.extruder_code)
	if operation_type == OperationType.PRINTING_UTECO:
		row = session.execute(
			select(UtecoQueueItem).where(UtecoQueueItem.job_id == job_id_str).with_for_update()
		).scalars().first()
		if row:
			return row, resolve_schedule_lane(session, str(row.uteco_printer_id))
	if operation_type == OperationType.CONVERSION:
		row = session.execute(
			select(BaggingQueueItem).where(BaggingQueueItem.job_id == job_id_str).with_for_update()
		).scalars().first()
		if row:
			return row, resolve_schedule_lane(session, str(row.bagging_machine_id))
	return None, None


def move_bar(
	job_id: uuid.UUID,
	operation_type: OperationType,
	target_machine_id: str,
	proposed_start: Optional[datetime] = None,
	target_start: Optional[datetime] = None,
) -> MoveResult:
	with SessionLocal.begin() as session:
		target = resolve_schedule_lane(session, str(target_machine_id))
		expected = _operation_type_for_lane(target)
		if expected != operation_type:
			raise DomainError("Target machine does not match operation type")

		jid_str = _str_id(job_id)
		item, source_lane = _find_queue_item_and_lane_for_op(session, jid_str, operation_type)
		if item is None or source_lane is None:
			raise DomainError("Queue item for this operation not found")
		if item.status == QueueStatus.RUNNING:
			raise DomainError("Cannot move a running item")

		if source_lane.lane_id == target.lane_id:
			items_one = _load_lane_items_for_update(session, source_lane)
			it = next((i for i in items_one if _str_id(i.job_id) == jid_str), None)
			if not it:
				raise DomainError("Queue item not found in this lane")
			if it.status == QueueStatus.RUNNING:
				raise DomainError("Cannot reorder a running item")
			if target_start is None:
				ref = _load_lane_items_for_update(session, source_lane)
				ld = _lane_dto(source_lane.lane_id, ref)
				return MoveResult(source_lane=ld, target_lane=ld)

			old_uteco_start_utc = (
				it.scheduled_start_utc
				if operation_type == OperationType.PRINTING_UTECO
				else None
			)
			it.scheduled_start_utc = _target_start_as_utc(target_start)
			it.operating_hours_lead_before = 0
			session.flush()

			job, order, product_version = _get_job_with_context(session, job_id)
			ctx_adj = load_operating_context(session)
			if operation_type in (OperationType.PRINTING_UTECO, OperationType.CONVERSION):
				_maybe_pull_upstream_for_first_roll_constraint(
					session,
					job,
					product_version,
					ctx_adj,
					moved_operation=operation_type,
					satellite_start_utc=it.scheduled_start_utc,
				)
				_maybe_push_satellite_forward_for_first_roll_constraint(
					session,
					job,
					product_version,
					ctx_adj,
					moved_operation=operation_type,
				)
				if operation_type == OperationType.PRINTING_UTECO:
					_maybe_shift_bagging_with_uteco_move(
						session,
						job,
						product_version,
						ctx_adj,
						old_uteco_start_utc=old_uteco_start_utc,
						new_uteco_start_utc=it.scheduled_start_utc,
					)
					_maybe_push_satellite_forward_for_first_roll_constraint(
						session,
						job,
						product_version,
						ctx_adj,
						moved_operation=OperationType.CONVERSION,
					)
				_recompute_chain_offsets_from_queue(session, job, ctx_adj)
			s_ex = (
				source_lane.extruder.extruder_code
				if source_lane.kind == "extrusion" and source_lane.extruder
				else None
			)
			s_ut = source_lane.uteco_printer.id if source_lane.kind == "uteco" and source_lane.uteco_printer else None
			s_bg = (
				source_lane.bagging_machine.id
				if source_lane.kind == "bagging" and source_lane.bagging_machine
				else None
			)
			rq = session.query(ToolReservation).filter(
				ToolReservation.job_id == jid_str,
				ToolReservation.operation_type == operation_type,
				ToolReservation.status.in_([ToolReservationStatus.PLANNED, ToolReservationStatus.CONFLICTED]),
			)
			if s_ex:
				rq = rq.filter(ToolReservation.extruder_code == s_ex)
			elif s_ut:
				rq = rq.filter(ToolReservation.uteco_printer_id == s_ut)
			elif s_bg:
				rq = rq.filter(ToolReservation.bagging_machine_id == s_bg)
			rq.update({"status": ToolReservationStatus.CANCELLED})

			tool_anchor = proposed_start or target_start
			window = (tool_anchor, tool_anchor + timedelta(hours=1)) if tool_anchor else None
			required_codes = _required_tool_type_codes(job, operation_type, product_version)
			tool_conflicts = _reserve_tools(
				session=session,
				job=job,
				operation_type=operation_type,
				lane=target,
				window=window,
				tool_type_codes=required_codes,
			)
			if operation_type == OperationType.EXTRUSION:
				ctx_sync = load_operating_context(session)
				_sync_chain_queue_starts_from_extrusion(session, job, ctx_sync)
			warnings = _routing_warnings_for_enqueue(session, target, job, product_version)
			ref = _load_lane_items_for_update(session, source_lane)
			ld = _lane_dto(source_lane.lane_id, ref, warnings=warnings, conflicts=tool_conflicts)
			return MoveResult(source_lane=ld, target_lane=ld)

		job, order, product_version = _get_job_with_context(session, job_id)
		_validate_lane_for_job(target, product_version, operation_type)

		source_items = _load_lane_items_for_update(session, source_lane)
		target_items = _load_lane_items_for_update(session, target)

		source_items = [i for i in source_items if i.id != item.id]
		# Delete the moved row before reindexing siblings. Otherwise SQLite UNIQUE (lane, position)
		# fires: reindex assigns 1..n while this row still holds its old position.
		session.delete(item)
		session.flush()
		_reindex_lane(session, source_items)
		session.flush()

		target_others = list(target_items)
		ordered_tgt = sorted(target_others, key=lambda x: x.position)
		insert_pos = max((i.position for i in ordered_tgt), default=0) + 1
		ctx, anchor_local = _gantt_anchor_local(session)
		if target_start is not None:
			sched_utc = _target_start_as_utc(target_start)
		else:
			sched_utc = _default_append_scheduled_start_utc(session, target, ordered_tgt, ctx, anchor_local)

		old_uteco_start_utc = (
			item.scheduled_start_utc
			if operation_type == OperationType.PRINTING_UTECO
			else None
		)
		if target.kind == "extrusion" and target.extruder:
			new_item = ExtrusionQueueItem(
				extruder_code=target.extruder.extruder_code,
				job_id=jid_str,
				position=insert_pos,
				status=QueueStatus.QUEUED,
				operating_hours_lead_before=0,
				scheduled_start_utc=sched_utc,
			)
		elif target.kind == "uteco" and target.uteco_printer:
			new_item = UtecoQueueItem(
				uteco_printer_id=target.uteco_printer.id,
				job_id=jid_str,
				position=insert_pos,
				status=QueueStatus.QUEUED,
				operating_hours_lead_before=0,
				scheduled_start_utc=sched_utc,
			)
		elif target.kind == "bagging" and target.bagging_machine:
			new_item = BaggingQueueItem(
				bagging_machine_id=target.bagging_machine.id,
				job_id=jid_str,
				position=insert_pos,
				status=QueueStatus.QUEUED,
				operating_hours_lead_before=0,
				scheduled_start_utc=sched_utc,
			)
		else:
			raise DomainError("Invalid target lane")
		session.add(new_item)
		target_others.append(new_item)
		session.flush()

		ctx_move = load_operating_context(session)
		if operation_type in (OperationType.PRINTING_UTECO, OperationType.CONVERSION):
			_maybe_pull_upstream_for_first_roll_constraint(
				session,
				job,
				product_version,
				ctx_move,
				moved_operation=operation_type,
				satellite_start_utc=new_item.scheduled_start_utc,
			)
			_maybe_push_satellite_forward_for_first_roll_constraint(
				session,
				job,
				product_version,
				ctx_move,
				moved_operation=operation_type,
			)
			if operation_type == OperationType.PRINTING_UTECO:
				_maybe_shift_bagging_with_uteco_move(
					session,
					job,
					product_version,
					ctx_move,
					old_uteco_start_utc=old_uteco_start_utc,
					new_uteco_start_utc=new_item.scheduled_start_utc,
				)
				_maybe_push_satellite_forward_for_first_roll_constraint(
					session,
					job,
					product_version,
					ctx_move,
					moved_operation=OperationType.CONVERSION,
				)
			_recompute_chain_offsets_from_queue(session, job, ctx_move)

		# Cancel prior reservations for this job/op on source lane
		s_ex = source_lane.extruder.extruder_code if source_lane.kind == "extrusion" and source_lane.extruder else None
		s_ut = source_lane.uteco_printer.id if source_lane.kind == "uteco" and source_lane.uteco_printer else None
		s_bg = source_lane.bagging_machine.id if source_lane.kind == "bagging" and source_lane.bagging_machine else None
		rq = session.query(ToolReservation).filter(
			ToolReservation.job_id == jid_str,
			ToolReservation.operation_type == operation_type,
			ToolReservation.status.in_([ToolReservationStatus.PLANNED, ToolReservationStatus.CONFLICTED]),
		)
		if s_ex:
			rq = rq.filter(ToolReservation.extruder_code == s_ex)
		elif s_ut:
			rq = rq.filter(ToolReservation.uteco_printer_id == s_ut)
		elif s_bg:
			rq = rq.filter(ToolReservation.bagging_machine_id == s_bg)
		rq.update({"status": ToolReservationStatus.CANCELLED})

		window = None
		tool_anchor = proposed_start or target_start or sched_utc
		if tool_anchor:
			window = (tool_anchor, tool_anchor + timedelta(hours=1))
		required_codes = _required_tool_type_codes(job, operation_type, product_version)
		tool_conflicts = _reserve_tools(
			session=session,
			job=job,
			operation_type=operation_type,
			lane=target,
			window=window,
			tool_type_codes=required_codes,
		)

		if operation_type == OperationType.EXTRUSION:
			ctx_sync = load_operating_context(session)
			_sync_chain_queue_starts_from_extrusion(session, job, ctx_sync)

		warnings = _routing_warnings_for_enqueue(session, target, job, product_version)

		source_ref = _load_lane_items_for_update(session, source_lane)
		target_ref = _load_lane_items_for_update(session, target)

		return MoveResult(
			source_lane=_lane_dto(source_lane.lane_id, source_ref),
			target_lane=_lane_dto(target.lane_id, target_ref, warnings=warnings, conflicts=tool_conflicts),
		)


def get_overview() -> dict:
	with SessionLocal() as session:
		lanes = list_active_lanes(session)
		lanes.sort(key=_lane_sort_key)

		def _lane_for(lane: ScheduleLane) -> LaneDTO:
			items = [
				i
				for i in _load_lane_items_read(session, lane)
				if i.status in (QueueStatus.QUEUED, QueueStatus.RUNNING)
			]
			return _lane_dto(lane.lane_id, items)

		extruders = []
		printers = []
		converters = []

		for lane in lanes:
			# Minimal machine-like dict for admin UI compatibility
			if lane.kind == "extrusion" and lane.extruder:
				m = type(
					"M",
					(),
					{
						"id": lane.lane_id,
						"code": lane.extruder.extruder_code,
						"type": "extruder",
						"active": True,
					},
				)()
				extruders.append({"machine": m, "lane": _lane_for(lane)})
			elif lane.kind == "uteco" and lane.uteco_printer:
				m = type(
					"M",
					(),
					{
						"id": lane.uteco_printer.id,
						"code": lane.uteco_printer.code,
						"type": "printer_uteco",
						"active": lane.uteco_printer.active,
					},
				)()
				printers.append({"machine": m, "lane": _lane_for(lane)})
			elif lane.kind == "bagging" and lane.bagging_machine:
				m = type(
					"M",
					(),
					{
						"id": lane.bagging_machine.id,
						"code": lane.bagging_machine.code,
						"type": "converter_bagger",
						"active": lane.bagging_machine.active,
					},
				)()
				converters.append({"machine": m, "lane": _lane_for(lane)})

		return {"extruders": extruders, "printers": printers, "converters": converters}


def estimate_job_operations(
	job_id: uuid.UUID | str,
	target_extruder_machine_id: Optional[str] = None,
) -> JobEstimatesDTO:
	"""
	Calculate estimated durations for a job's operations.
	Extrusion: same kg basis as the Gantt; uses ``target_extruder_machine_id`` when provided (Gantt drag preview),
	otherwise the extruder the job is queued on, otherwise 100 kg/h placeholder.
	"""
	with SessionLocal() as session:
		job_id_str = str(job_id)
		job, order, product_version = _get_job_with_context(session, uuid.UUID(job_id_str))
		em: Optional[Extruder] = None
		if target_extruder_machine_id:
			try:
				lane = resolve_schedule_lane(session, str(target_extruder_machine_id).strip())
				if lane.kind == "extrusion" and lane.extruder is not None:
					em = lane.extruder
			except DomainError:
				em = None
		if em is None:
			em = _find_extruder_for_queued_job(session, job.id)
		operations = _estimate_job_operations_core(session, job, product_version, extrusion_extruder=em)
		return JobEstimatesDTO(job_id=uuid.UUID(job_id_str), operations=operations)


def get_gantt_overview(operating_calendar: Optional[dict] = None) -> GanttOverviewDTO:
	"""
	Build Gantt chart overview with lanes, bars, and tentative start/finish times.
	Tentative times advance only during configured production hours (Admin → Production hours).
	"""
	with SessionLocal() as session:
		ctx = load_operating_context(session)
		now_utc = datetime.now(tz=timezone.utc)
		now_local = now_utc.astimezone(ctx.tz)
		anchor_local = snap_to_operating_instant(now_local, ctx)

		schedule_lanes = list_active_lanes(session)
		schedule_lanes.sort(key=_lane_sort_key)

		lanes: List[GanttLaneDTO] = []
		all_starts_local: List[datetime] = []
		all_ends_local: List[datetime] = []

		for lane in schedule_lanes:
			queue_items = [
				i
				for i in _load_lane_items_read(session, lane)
				if i.status in (QueueStatus.QUEUED, QueueStatus.RUNNING)
			]
			queue_items.sort(key=lambda x: x.position)

			bars: List[GanttBarDTO] = []
			cursor_local = anchor_local

			for queue_item in queue_items:
				tentative_start_local, cursor_local = _gantt_tentative_start_local_for_item(
					session, lane, queue_item, ctx, cursor_local
				)
				job, order, product_version = _get_job_with_context(session, uuid.UUID(str(queue_item.job_id)))

				if order:
					customer = session.get(Customer, order.customer_id)
					customer_name = customer.name if customer else "Unknown"
					job_code = f"{order.code}-{job.job_code}"
				else:
					js = session.get(JobSheet, job.job_sheet_id) if job.job_sheet_id else None
					customer = session.get(Customer, js.customer_id) if js else None
					customer_name = customer.name if customer else "Unknown"
					job_code = js.job_no if js else str(job.job_code)

				product = session.get(Product, product_version.product_id) if product_version else None
				product_code = product.code if product else "Unknown"

				operation_type = _operation_type_for_lane(lane)
				operation_type_str = operation_type.value if hasattr(operation_type, "value") else str(operation_type)

				duration_hours = _estimate_lane_duration_hours(session, lane, job, product_version)
				spec = (product_version.spec_payload if product_version else {}) or {}
				roll_count = _num_rolls_for_job(session, job, product_version)
				hours_per_roll = duration_hours / roll_count if roll_count > 0 else duration_hours
				job_sheet_job_no = _job_sheet_job_no_for_job(session, job)

				tentative_finish_local = add_operating_hours(tentative_start_local, duration_hours, ctx)
				all_starts_local.append(tentative_start_local)
				all_ends_local.append(tentative_finish_local)

				status_str = queue_item.status.value if hasattr(queue_item.status, "value") else str(queue_item.status)

				readiness = "running" if status_str == "running" else "ready"
				printing_method = _get_printing_method_from_spec(product_version)

				warnings = list(_routing_warnings_for_enqueue(session, lane, job, product_version))
				if warnings:
					readiness = "blocked"

				tool_strips: List[ToolStripDTO] = []
				tool_conflicts: List[ToolConflictDTO] = []
				if lane.kind == "extrusion":
					tool_strips = _build_tool_strips_for_extrusion(session, job, lane, product_version)
					tool_conflicts = _gantt_tool_conflict_dtos_for_job_lane(session, job, lane)

				requires_uteco = printing_method == PrintingMethod.UTECO
				requires_inline_print = printing_method == PrintingMethod.INLINE
				num_colours = (spec.get("printing") or {}).get("num_colours", 0) or 0
				layflat_mm = layflat_width_mm_from_product_version(product_version)

				cu = job.schedule_chain_uteco_offset_operating_hours
				cb = job.schedule_chain_bagging_offset_operating_hours
				chain_ut = float(cu) if cu is not None else None
				chain_bg = float(cb) if cb is not None else None

				bars.append(
					GanttBarDTO(
						job_id=uuid.UUID(str(job.id)),
						job_code=job_code,
						operation_type=operation_type_str,
						customer=customer_name,
						product_code=product_code,
						planned_qty=float(job.planned_qty),
						estimated_duration_hours=duration_hours,
						roll_count=roll_count,
						hours_per_roll=hours_per_roll,
						job_sheet_job_no=job_sheet_job_no,
						job_layflat_width_mm=layflat_mm,
						tentative_start=tentative_start_local.astimezone(timezone.utc),
						tentative_finish=tentative_finish_local.astimezone(timezone.utc),
						status=status_str,
						readiness=readiness,
						requires_uteco=requires_uteco,
						requires_inline_print=requires_inline_print,
						num_colours=num_colours,
						warnings=warnings,
						tool_conflicts=tool_conflicts,
						tool_strips=tool_strips,
						chain_uteco_offset_operating_hours=chain_ut,
						chain_bagging_offset_operating_hours=chain_bg,
					)
				)

			for i in range(len(bars)):
				si = bars[i].tentative_start
				fi = bars[i].tentative_finish
				if si is None or fi is None:
					continue
				for j in range(i + 1, len(bars)):
					sj = bars[j].tentative_start
					fj = bars[j].tentative_finish
					if sj is None or fj is None:
						continue
					if si < fj and sj < fi:
						other_i = bars[j].job_code
						other_j = bars[i].job_code
						bars[i] = bars[i].model_copy(
							update={
								"warnings": [
									*bars[i].warnings,
									f"Overlaps with {other_i} on this machine",
								]
							}
						)
						bars[j] = bars[j].model_copy(
							update={
								"warnings": [
									*bars[j].warnings,
									f"Overlaps with {other_j} on this machine",
								]
							}
						)

			if lane.kind == "extrusion" and lane.extruder:
				machine_code = lane.extruder.extruder_code
				machine_type_str = "extruder"
				machine_id_str = lane.lane_id
			elif lane.kind == "uteco" and lane.uteco_printer:
				machine_code = lane.uteco_printer.code
				machine_type_str = "printer_uteco"
				machine_id_str = lane.lane_id
			elif lane.kind == "bagging" and lane.bagging_machine:
				machine_code = lane.bagging_machine.code
				machine_type_str = "converter_bagger"
				machine_id_str = lane.lane_id
			else:
				continue
			film_min = lane.extruder.film_width_min_mm if lane.kind == "extrusion" and lane.extruder else None
			film_max = lane.extruder.film_width_max_mm if lane.kind == "extrusion" and lane.extruder else None
			lanes.append(GanttLaneDTO(
				machine_id=machine_id_str,
				machine_code=machine_code,
				machine_type=machine_type_str,
				film_width_min_mm=film_min,
				film_width_max_mm=film_max,
				bars=bars,
			))

		if operating_calendar is None:
			min_s = min(all_starts_local) if all_starts_local else anchor_local
			max_e = max(all_ends_local) if all_ends_local else anchor_local
			window_start_local = min(anchor_local, min_s)
			window_end_local = max(now_local + timedelta(weeks=ctx.gantt_preview_weeks), max_e + timedelta(days=1))
			tz_key = getattr(ctx.tz, "key", None) or "UTC"
			operating_calendar = calendar_dict_for_gantt(
				window_start_local.astimezone(timezone.utc),
				window_end_local.astimezone(timezone.utc),
				str(tz_key),
				ctx,
			)
		else:
			# Caller-supplied calendar (tests); still attach timezone label if missing
			if "timezone" not in operating_calendar:
				tz_key = getattr(ctx.tz, "key", None) or "UTC"
				operating_calendar = {**operating_calendar, "timezone": str(tz_key)}

		return GanttOverviewDTO(
			lanes=lanes,
			calendar=operating_calendar,
			extrusion_toolbox=_extrusion_toolbox_balances(session),
		)


def get_unqueued_schedule_jobs() -> List[UnqueuedScheduleJobDTO]:
	"""
	Jobs schedulable for extrusion, not already on an extruder queue.
	Includes all order statuses (draft, confirmed, …) and standalone job sheets (no order).
	"""
	with SessionLocal.begin() as session:
		ensure_jobs_for_orphan_standalone_sheets(session)

		extruder_queued = exists(
			select(1)
			.select_from(ExtrusionQueueItem)
			.where(
				ExtrusionQueueItem.job_id == Job.id,
				ExtrusionQueueItem.status.in_([QueueStatus.QUEUED, QueueStatus.RUNNING]),
			)
		)
		q = (
			select(Job)
			.where(
				Job.status.in_([JobStatus.PLANNED, JobStatus.SCHEDULED, JobStatus.PAUSED]),
				~extruder_queued,
			)
		)
		jobs = list(session.execute(q).scalars().all())
		out: List[UnqueuedScheduleJobDTO] = []
		for job in jobs:
			_, order, product_version = resolve_job_context(session, uuid.UUID(str(job.id)))
			rc = _num_rolls_for_job(session, job, product_version)
			product = session.get(Product, product_version.product_id) if product_version else None
			job_sheet_no = _job_sheet_job_no_for_job(session, job)
			layflat_mm = layflat_width_mm_from_product_version(product_version)
			if order:
				customer = session.get(Customer, order.customer_id)
				out.append(
					UnqueuedScheduleJobDTO(
						job_id=uuid.UUID(str(job.id)),
						order_code=order.code,
						job_code=f"{order.code}-{job.job_code}",
						customer=customer.name if customer else "Unknown",
						product_code=product.code if product else "Unknown",
						planned_qty=float(job.planned_qty),
						roll_count=rc,
						job_sheet_job_no=job_sheet_no,
						job_layflat_width_mm=layflat_mm,
					)
				)
			else:
				js = session.get(JobSheet, job.job_sheet_id) if job.job_sheet_id else None
				customer = session.get(Customer, js.customer_id) if js else None
				out.append(
					UnqueuedScheduleJobDTO(
						job_id=uuid.UUID(str(job.id)),
						order_code="",
						job_code=js.job_no if js else str(job.job_code),
						customer=customer.name if customer else "Unknown",
						product_code=product.code if product else "Unknown",
						planned_qty=float(job.planned_qty),
						roll_count=rc,
						job_sheet_job_no=job_sheet_no,
						job_layflat_width_mm=layflat_mm,
					)
				)
		out.sort(key=lambda row: (row.customer.lower(), row.job_code.lower()))
		return out
