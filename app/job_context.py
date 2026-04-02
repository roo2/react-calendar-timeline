"""Resolve production Job → Order / JobSheet and ProductVersion; ensure Job rows for scheduling."""

from __future__ import annotations

import uuid
from typing import Optional, Tuple

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.db.models.domain import Job, JobSheet, Order, OrderItem, ProductVersion
from app.db.models.enums import JobStatus
from app.exceptions import DomainError


def resolve_job_context(
	session: Session, job_id: uuid.UUID
) -> Tuple[Job, Optional[Order], Optional[ProductVersion]]:
	"""Load job with product version from order line job sheet, legacy order header, or standalone job sheet."""
	job: Optional[Job] = session.get(Job, str(job_id))
	if not job:
		raise DomainError("Job not found")
	if job.job_sheet_id:
		js = session.get(JobSheet, job.job_sheet_id)
		if not js:
			raise DomainError("Job sheet not found for job")
		pv = session.get(ProductVersion, js.product_version_id)
		return job, None, pv
	if job.order_id:
		order = session.get(Order, job.order_id)
		if not order:
			raise DomainError("Order not found for job")
		items = list(
			session.execute(
				select(OrderItem).where(OrderItem.order_id == order.id).order_by(OrderItem.id.asc())
			).scalars().all()
		)
		idx = int(job.job_code) - 1
		pv: Optional[ProductVersion] = None
		if 0 <= idx < len(items):
			js = session.get(JobSheet, items[idx].job_sheet_id)
			if js:
				pv = session.get(ProductVersion, js.product_version_id)
		if pv is None and order.product_version_id:
			pv = session.get(ProductVersion, order.product_version_id)
		return job, order, pv
	raise DomainError("Job has no order or job sheet link")


def ensure_scheduling_job_for_job_sheet(session: Session, job_sheet_id: str) -> Job:
	"""Create a production Job for this sheet if missing (order-line job or standalone)."""
	js = session.get(JobSheet, job_sheet_id)
	if not js:
		raise DomainError("Job sheet not found")

	oi = session.execute(select(OrderItem).where(OrderItem.job_sheet_id == job_sheet_id)).scalars().first()
	if oi:
		order = session.get(Order, oi.order_id)
		if not order:
			raise DomainError("Order not found")
		items = list(
			session.execute(
				select(OrderItem).where(OrderItem.order_id == order.id).order_by(OrderItem.id.asc())
			).scalars().all()
		)
		job_code: Optional[int] = None
		for i, row in enumerate(items):
			if str(row.job_sheet_id) == str(job_sheet_id):
				job_code = i + 1
				break
		if job_code is None:
			raise DomainError("Order line not found for job sheet")
		existing_order_job = session.execute(
			select(Job).where(Job.order_id == order.id, Job.job_code == job_code)
		).scalars().first()
		if existing_order_job:
			return existing_order_job
		standalone = session.execute(select(Job).where(Job.job_sheet_id == job_sheet_id)).scalars().first()
		if standalone:
			# Sheet was scheduled standalone; migrate row to order-backed (XOR constraint).
			standalone.order_id = str(order.id)
			standalone.job_code = job_code
			standalone.job_sheet_id = None
			session.flush()
			return standalone
		job = Job(
			order_id=str(order.id),
			job_sheet_id=None,
			job_code=job_code,
			planned_qty=float(js.quantity_value),
			produced_qty=0,
			allocated_order_units=None,
			status=JobStatus.PLANNED,
		)
		session.add(job)
		session.flush()
		return job

	existing_sheet = session.execute(select(Job).where(Job.job_sheet_id == job_sheet_id)).scalars().first()
	if existing_sheet:
		return existing_sheet

	job = Job(
		order_id=None,
		job_sheet_id=str(js.id),
		job_code=1,
		planned_qty=float(js.quantity_value),
		produced_qty=0,
		allocated_order_units=None,
		status=JobStatus.PLANNED,
	)
	session.add(job)
	session.flush()
	return job


def ensure_jobs_for_orphan_standalone_sheets(session: Session, *, limit: int = 500) -> None:
	"""Create Jobs for standalone job sheets (no order line) that do not yet have a production Job."""
	oi_exists = exists(select(1).select_from(OrderItem).where(OrderItem.job_sheet_id == JobSheet.id))
	j_exists = exists(select(1).select_from(Job).where(Job.job_sheet_id == JobSheet.id))
	q = (
		select(JobSheet.id)
		.where(~oi_exists)
		.where(~j_exists)
		.order_by(JobSheet.created_at.desc(), JobSheet.id.desc())
		.limit(limit)
	)
	for (sid,) in session.execute(q).all():
		ensure_scheduling_job_for_job_sheet(session, str(sid))


def ensure_jobs_for_order_line_job_sheets_missing_production_job(
	session: Session, *, limit: int = 500
) -> None:
	"""
	Create production Job rows for order lines (OrderItem → JobSheet) when no Job exists for that line.

	Standalone job sheets created from the UI get a draft order + line immediately, so they are not
	"orphan" sheets and were previously skipped by ensure_jobs_for_orphan_standalone_sheets. Scheduling
	lists Jobs, so we backfill missing rows here (and at job/order create time).
	"""
	ois = list(
		session.execute(select(OrderItem).order_by(OrderItem.id.desc()).limit(limit * 4)).scalars().all()
	)
	seen_sheet: set[str] = set()
	fixed = 0
	for oi in ois:
		sid = str(oi.job_sheet_id) if oi.job_sheet_id else ""
		if not sid or sid in seen_sheet:
			continue
		order = session.get(Order, oi.order_id)
		if not order:
			continue
		items = list(
			session.execute(
				select(OrderItem).where(OrderItem.order_id == order.id).order_by(OrderItem.id.asc())
			).scalars().all()
		)
		job_code: Optional[int] = None
		for i, row in enumerate(items):
			if str(row.job_sheet_id) == sid:
				job_code = i + 1
				break
		if job_code is None:
			continue
		existing = session.execute(
			select(Job).where(Job.order_id == order.id, Job.job_code == job_code)
		).scalars().first()
		if existing:
			continue
		ensure_scheduling_job_for_job_sheet(session, sid)
		seen_sheet.add(sid)
		fixed += 1
		if fixed >= limit:
			break
