from __future__ import annotations

import uuid
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, Optional, Tuple, List

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session, joinedload

from app.db.session import SessionLocal
from app.db.models.domain import (
	Customer,
	DispatchRecord,
	Job,
	JobQCSummary,
	OperationRun,
	Order,
	ProductVersion,
	RunOutputEntry,
)
from app.db.models.enums import (
	DispatchStatus,
	JobQCSummaryStatus,
	JobStatus,
	OrderStatus,
	OperationType,
	RunStatus,
)
from app.dispatch.schemas import (
	JobDispatchListItem,
	DispatchRecordDTO,
	DispatchDetailDTO,
	MarkReadyRequest,
	ConfirmDispatchRequest,
)
from app.exceptions import DomainError


_logger = logging.getLogger("dispatch")


def _now() -> datetime:
	return datetime.now(timezone.utc)


def _get_job_ctx(session: Session, job_id: uuid.UUID) -> Tuple[Job, Order, Optional[ProductVersion], Optional[Customer]]:
	from app.job_context import resolve_job_context

	job, order, pv = resolve_job_context(session, job_id)
	if not order:
		raise DomainError("Dispatch is only available for jobs linked to an order")
	customer: Optional[Customer] = session.get(Customer, order.customer_id)
	return job, order, pv, customer


def _printing_method(spec: Optional[dict]) -> str:
	spec = spec or {}
	method = (
		spec.get("printing_method")
		or (spec.get("printing") or {}).get("method")
		or spec.get("printingMethod")
		or spec.get("print_method")
	)
	return (str(method).lower() if method else "none")


def _finish_mode_requires_conversion(spec: Optional[dict]) -> bool:
	spec = spec or {}
	# Multiple possible places; treat anything indicating cartons as requiring conversion
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


def _packaging_requirements(spec: Optional[dict]) -> Dict[str, Any]:
	spec = spec or {}
	pack = spec.get("packaging") or {}
	# Normalize a minimal shape
	return {
		"pack_mode": pack.get("pack_mode") or spec.get("finish_mode"),
		"pallet_type": pack.get("pallet_type"),
		"wrapping_required": pack.get("wrapping_required"),
		"bags_per_carton": pack.get("bags_per_carton"),
	}


def _required_runs_completed(session: Session, job_id: uuid.UUID, product_version: Optional[ProductVersion]) -> bool:
	spec = product_version.spec_payload if product_version else {}
	# Extrusion required
	def _has(op: OperationType) -> bool:
		q = select(OperationRun).where(
			OperationRun.job_id == job_id, OperationRun.operation_type == op, OperationRun.status == RunStatus.COMPLETED
		)
		return session.execute(q).scalars().first() is not None

	if not _has(OperationType.EXTRUSION):
		return False
	pm = _printing_method(spec)
	if pm in ("uteco", "printing_uteco", "out_of_line"):
		if not _has(OperationType.PRINTING_UTECO):
			return False
	if _finish_mode_requires_conversion(spec):
		if not _has(OperationType.CONVERSION):
			return False
	return True


def _produced_quantities_summary(session: Session, job_id: uuid.UUID) -> Dict[str, Decimal]:
	# Sum good outputs across all runs for this job
	q = (
		select(RunOutputEntry.uom, func.coalesce(func.sum(RunOutputEntry.quantity), 0))
		.join(OperationRun, OperationRun.id == RunOutputEntry.run_id)
		.where(OperationRun.job_id == job_id, RunOutputEntry.good_or_scrap.is_(True))
		.group_by(RunOutputEntry.uom)
	)
	out: Dict[str, Decimal] = {}
	for uom, total in session.execute(q).all():
		key = "good_units"
		if (uom or "").lower() in ("kg", "kilogram", "kilograms"):
			key = "good_kg"
		elif (uom or "").lower() in ("m", "meter", "metre", "metres", "meters"):
			key = "good_m"
		out[key] = Decimal(str(total))
	return out


def _has_any_good_output(session: Session, job_id: uuid.UUID, *, require_finished_goods: bool) -> bool:
	q = (
		select(func.count())
		.select_from(RunOutputEntry)
		.join(OperationRun, OperationRun.id == RunOutputEntry.run_id)
		.where(
			OperationRun.job_id == job_id,
			RunOutputEntry.good_or_scrap.is_(True),
			*( [RunOutputEntry.finished_goods.is_(True)] if require_finished_goods else [] ),
		)
	)
	return session.execute(q).scalar_one() > 0


def _first_started_and_last_completed(session: Session, job_id: uuid.UUID) -> Tuple[Optional[datetime], Optional[datetime]]:
	q_first = select(func.min(OperationRun.started_at)).where(OperationRun.job_id == job_id)
	q_last = select(func.max(OperationRun.ended_at)).where(
		OperationRun.job_id == job_id, OperationRun.status == RunStatus.COMPLETED
	)
	return session.execute(q_first).scalar_one(), session.execute(q_last).scalar_one()


def list_ready() -> list[JobDispatchListItem]:
	with SessionLocal.begin() as session:
		# Jobs completed, QC finalised, not dispatched
		q_jobs = (
			select(Job, Order, ProductVersion, Customer, DispatchRecord, JobQCSummary)
			.join(Order, Order.id == Job.order_id)
			.join(Customer, Customer.id == Order.customer_id)
			.join(ProductVersion, ProductVersion.id == Order.product_version_id)
			.outerjoin(DispatchRecord, DispatchRecord.job_id == Job.id)
			.outerjoin(JobQCSummary, JobQCSummary.job_id == Job.id)
			.where(
				Job.status == JobStatus.COMPLETED,
				(JobQCSummary.status.in_([JobQCSummaryStatus.FINAL_PASS, JobQCSummaryStatus.FINAL_PASS_WITH_DEVIATION])),
				((DispatchRecord.id.is_(None)) | (DispatchRecord.dispatch_status != DispatchStatus.DISPATCHED)),
			)
		)
		items: list[JobDispatchListItem] = []
		for row in session.execute(q_jobs).all():
			job: Job = row[0]
			order: Order = row[1]
			pv: ProductVersion = row[2]
			cust: Customer = row[3]
			dr: Optional[DispatchRecord] = row[4]
			qc: Optional[JobQCSummary] = row[5]

			# Quick additional guard: required runs completed
			if not _required_runs_completed(session, job.id, pv):
				continue

			produced = _produced_quantities_summary(session, job.id)
			items.append(
				JobDispatchListItem(
					job_id=job.id,
					job_code=job.job_code,
					order_id=order.id,
					order_code=order.code,
					customer_name=cust.name,
					product_code=None,  # Product code not directly on PV; optional
					product_name=None,
					status=dr.dispatch_status.value if dr else DispatchStatus.PENDING.value,
					qc_status=qc.status.value if qc else None,
					produced_summary=produced,
					packaging_req=_packaging_requirements(pv.spec_payload if pv else {}),
				)
			)
		return items


def get(job_id: uuid.UUID) -> DispatchDetailDTO:
	with SessionLocal.begin() as session:
		job, order, pv, customer = _get_job_ctx(session, job_id)
		qc: Optional[JobQCSummary] = session.scalar(select(JobQCSummary).where(JobQCSummary.job_id == job.id))
		dr: Optional[DispatchRecord] = session.scalar(select(DispatchRecord).where(DispatchRecord.job_id == job.id))
		# Preconditions
		runs_completed = _required_runs_completed(session, job.id, pv)
		qc_finalized = bool(qc and qc.status in (JobQCSummaryStatus.FINAL_PASS, JobQCSummaryStatus.FINAL_PASS_WITH_DEVIATION))
		produced = _produced_quantities_summary(session, job.id)
		pack_req = _packaging_requirements(pv.spec_payload if pv else {})
		has_outputs = sum(produced.values(), Decimal("0")) > 0 if produced else False
		packaging_known = bool(pack_req.get("pack_mode"))
		dispatch_status = (dr.dispatch_status if dr else DispatchStatus.PENDING)
		# KPI timing
		first_started = dr.first_run_started_at if dr and dr.first_run_started_at else _first_started_and_last_completed(session, job.id)[0]
		last_completed = dr.last_run_completed_at if dr and dr.last_run_completed_at else _first_started_and_last_completed(session, job.id)[1]
		dispatched_at = dr.dispatched_at if dr else None
		def _fmt_delta(a: Optional[datetime], b: Optional[datetime]) -> str:
			if not a or not b:
				return "-"
			delta = b - a
			hours = int(delta.total_seconds() // 3600)
			return f"{hours}h"
		kpis = {
			"job_flow_time": _fmt_delta(first_started, dispatched_at),
			"run_to_dispatch": _fmt_delta(last_completed, dispatched_at),
		}
		return DispatchDetailDTO(
			job_id=job.id,
			job_code=job.job_code,
			order_id=order.id,
			order_code=order.code,
			customer_name=customer.name if customer else "",
			product_code=None,
			product_name=None,
			qc_status=qc.status.value if qc else None,
			final_checklist=(qc.final_checklist if qc else {}) or {},
			produced_summary=produced,
			packaging_req=pack_req,
			dispatch_status=dispatch_status,
			dispatch_record_id=(dr.id if dr else None),
			packaging_confirmation=(dr.packaging if dr else {}),
			dispatch_metadata=(dr.dispatch_metadata if dr else {}),
			preconditions={
				"runs_completed": runs_completed,
				"qc_finalized": qc_finalized,
				"has_outputs": has_outputs,
				"packaging_known": packaging_known,
			},
			can_mark_ready=(dispatch_status == DispatchStatus.PENDING and runs_completed and qc_finalized and has_outputs and packaging_known),
			can_confirm=(dispatch_status == DispatchStatus.READY),
			first_run_started_at=first_started,
			last_run_completed_at=last_completed,
			dispatched_at=dispatched_at,
			kpi_durations=kpis,
		)


def mark_ready(job_id: uuid.UUID, payload: MarkReadyRequest, *, actor: str) -> DispatchRecordDTO:
	with SessionLocal.begin() as session:
		job, order, pv, _ = _get_job_ctx(session, job_id)
		if job.status != JobStatus.COMPLETED:
			raise DomainError("Job is not in a completed state")

		# Preconditions
		if not _required_runs_completed(session, job.id, pv):
			raise DomainError("All required production runs must be completed")
		qc: Optional[JobQCSummary] = session.scalar(select(JobQCSummary).where(JobQCSummary.job_id == job.id))
		if not qc or qc.status not in (JobQCSummaryStatus.FINAL_PASS, JobQCSummaryStatus.FINAL_PASS_WITH_DEVIATION):
			raise DomainError("Job QC summary is not finalised with pass")
		# If deviations present, check approver metadata if available
		if qc.status == JobQCSummaryStatus.FINAL_PASS_WITH_DEVIATION:
			dev = (qc.deviations or {}) if hasattr(qc, "deviations") else {}
			# best-effort check
			for _, d in (dev.items() if isinstance(dev, dict) else []):
				if not d or not d.get("approved_by") or not d.get("approved_at"):
					raise DomainError("Deviation approvals are incomplete")

		spec = pv.spec_payload if pv else {}
		if not _packaging_requirements(spec).get("pack_mode"):
			# Must know how product is packed
			raise DomainError("Packaging requirements are missing from the Product Specification")

		# Produced quantities present
		require_fg = _finish_mode_requires_conversion(spec)
		if not _has_any_good_output(session, job.id, require_finished_goods=require_fg):
			raise DomainError("No produced quantities recorded for this job")

		# Upsert DispatchRecord (status=READY)
		record: Optional[DispatchRecord] = session.scalar(select(DispatchRecord).where(DispatchRecord.job_id == job.id))
		if record is None:
			record = DispatchRecord(
				job_id=job.id,
				order_id=order.id,
				dispatch_status=DispatchStatus.READY,
				packaging={},
				dispatch_metadata={},
			)
			session.add(record)
		else:
			if record.dispatch_status == DispatchStatus.DISPATCHED:
				raise DomainError("Job already dispatched")
			record.dispatch_status = DispatchStatus.READY

		record.packaging = {
			"cartons_count": payload.cartons_count,
			"pallets_count": payload.pallets_count,
			"pallet_type": payload.pallet_type,
			"wrapped": bool(payload.wrapped),
			"notes": payload.notes or "",
		}
		# Minimal audit trail in logs
		_logger.info("dispatch_mark_ready job_id=%s order_id=%s by=%s", job.id, order.id, actor)

		session.flush()
		return DispatchRecordDTO(
			id=record.id,
			job_id=record.job_id,
			order_id=record.order_id,
			status=record.dispatch_status,
			packaging=record.packaging or {},
			metadata=record.dispatch_metadata or {},
			first_run_started_at=record.first_run_started_at,
			last_run_completed_at=record.last_run_completed_at,
			dispatched_at=record.dispatched_at,
		)


def confirm_dispatch(job_id: uuid.UUID, payload: ConfirmDispatchRequest, *, actor_user_id: Optional[str]) -> DispatchRecordDTO:
	with SessionLocal.begin() as session:
		job, order, pv, _ = _get_job_ctx(session, job_id)
		record: Optional[DispatchRecord] = session.scalar(select(DispatchRecord).where(DispatchRecord.job_id == job.id))
		if record is None or record.dispatch_status != DispatchStatus.READY:
			raise DomainError("Dispatch record not in ready state")
		if record.dispatch_status == DispatchStatus.DISPATCHED:
			# idempotent
			return DispatchRecordDTO(
				id=record.id,
				job_id=record.job_id,
				order_id=record.order_id,
				status=record.dispatch_status,
				packaging=record.packaging or {},
				metadata=record.dispatch_metadata or {},
				first_run_started_at=record.first_run_started_at,
				last_run_completed_at=record.last_run_completed_at,
				dispatched_at=record.dispatched_at,
			)

		# Persist KPI timing fields on record
		first_started, last_completed = _first_started_and_last_completed(session, job.id)
		record.first_run_started_at = record.first_run_started_at or first_started
		record.last_run_completed_at = last_completed
		dispatched_at = payload.dispatch_date or _now()
		record.dispatched_at = dispatched_at

		# Update metadata and status
		meta = record.dispatch_metadata or {}
		meta.update(
			{
				"dispatch_date": dispatched_at.isoformat(),
				"carrier": payload.carrier,
				"delivery_ref": payload.delivery_ref,
				"dispatched_by_user_id": actor_user_id,
			}
		)
		record.dispatch_metadata = meta
		record.dispatch_status = DispatchStatus.DISPATCHED

		# Job status transition
		job.status = JobStatus.DISPATCHED

		session.flush()

		# Emit domain events (log-based placeholder)
		_logger.info("event JobDispatched job_id=%s order_id=%s at=%s", job.id, order.id, dispatched_at.isoformat())
		# If all jobs on order dispatched, emit OrderDispatched
		q_remaining = select(func.count()).select_from(Job).where(
			Job.order_id == order.id, Job.status != JobStatus.DISPATCHED
		)
		if session.execute(q_remaining).scalar_one() == 0:
			# Mark order as dispatched (administrative 'closed' remains a separate action)
			order.status = OrderStatus.DISPATCHED
			_logger.info("event OrderDispatched order_id=%s at=%s", order.id, dispatched_at.isoformat())

		return DispatchRecordDTO(
			id=record.id,
			job_id=record.job_id,
			order_id=record.order_id,
			status=record.dispatch_status,
			packaging=record.packaging or {},
			metadata=record.dispatch_metadata or {},
			first_run_started_at=record.first_run_started_at,
			last_run_completed_at=record.last_run_completed_at,
			dispatched_at=record.dispatched_at,
		)


