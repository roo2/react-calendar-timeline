from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Iterable, List, Optional, Tuple

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session, joinedload

from app.db.session import SessionLocal
from app.db.models.domain import (
	Job,
	Machine,
	MachineQueueItem,
	OperationRun,
	Order,
	ProductVersion,
	Tool,
	ToolReservation,
	ToolType,
)
from app.db.models.enums import (
	JobStatus,
	MachineType,
	OperationType,
	QueueStatus,
	RunStatus,
	ToolReservationStatus,
	PrintingMethod,
)
from app.exceptions import DomainError
from app.scheduling.schemas import (
	LaneDTO,
	MachineQueueItemDTO,
	MoveResult,
	ToolConflictDTO,
	GanttOverviewDTO,
	GanttLaneDTO,
	GanttBarDTO,
	JobEstimatesDTO,
	OperationEstimateDTO,
)


def _dto_from_item(item: MachineQueueItem) -> MachineQueueItemDTO:
	status_value = item.status.value if hasattr(item.status, "value") else str(item.status)
	return MachineQueueItemDTO(
		id=item.id,
		machine_id=item.machine_id,
		job_id=item.job_id,
		position=item.position,
		status=status_value,
	)


def _lane_dto(machine_id: uuid.UUID, items: Iterable[MachineQueueItem], warnings: Optional[List[str]] = None, conflicts: Optional[List[ToolConflictDTO]] = None) -> LaneDTO:
	return LaneDTO(
		machine_id=machine_id,
		items=[_dto_from_item(i) for i in sorted(items, key=lambda x: x.position)],
		warnings=warnings or [],
		conflicts=conflicts or [],
	)


def _load_lane_items_for_update(session: Session, machine_id: uuid.UUID) -> List[MachineQueueItem]:
	q = (
		select(MachineQueueItem)
		.where(MachineQueueItem.machine_id == machine_id)
		.order_by(MachineQueueItem.position.asc())
		.with_for_update()
	)
	return list(session.execute(q).scalars().all())


def _reindex_lane(items: List[MachineQueueItem]) -> None:
	for idx, itm in enumerate(sorted(items, key=lambda x: x.position), start=1):
		itm.position = idx


def _get_job_with_context(session: Session, job_id: uuid.UUID) -> Tuple[Job, Order, Optional[ProductVersion]]:
	job: Job = session.get(Job, job_id)
	if not job:
		raise DomainError("Job not found")
	order: Order = session.get(Order, job.order_id)
	if not order:
		raise DomainError("Order not found for job")
	product_version: Optional[ProductVersion] = session.get(ProductVersion, order.product_version_id)
	return job, order, product_version


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


def _routing_warnings_for_enqueue(session: Session, machine: Machine, job: Job, product_version: Optional[ProductVersion]) -> List[str]:
	warnings: List[str] = []
	if machine.type == MachineType.PRINTER_UTECO:
		# Uteco queued before any Extrusion run exists
		q = select(OperationRun).where(
			OperationRun.job_id == job.id,
			OperationRun.operation_type == OperationType.EXTRUSION,
			OperationRun.status == RunStatus.COMPLETED,
		)
		has_completed_extrusion = session.execute(q).scalars().first() is not None
		if not has_completed_extrusion:
			warnings.append("Uteco queued before any Extrusion run exists for this job")
	elif machine.type == MachineType.CONVERTER_BAGGER:
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


def _required_tool_type_codes(job: Job, operation_type: OperationType, product_version: Optional[ProductVersion]) -> List[str]:
	# Minimal heuristic (pluggable later)
	if operation_type == OperationType.EXTRUSION:
		spec = (product_version.spec_payload if product_version else {}) or {}
		inline_req = (spec.get("run_requirements") or {}).get("inline_print_1c") or (spec.get("extrusion") or {}).get("inline_print_1c")
		if inline_req:
			return ["inline_printer_1c"]
		return []
	if operation_type == OperationType.PRINTING_UTECO:
		# Example: electra_punch may be needed based on spec
		spec = (product_version.spec_payload if product_version else {}) or {}
		if (spec.get("printing") or {}).get("requires_electra_punch"):
			return ["electra_punch"]
		return []
	# Conversion defaults to no special tool for MVP
	return []


def _operation_type_for_machine(machine: Machine) -> OperationType:
	if machine.type == MachineType.EXTRUDER:
		return OperationType.EXTRUSION
	if machine.type == MachineType.PRINTER_UTECO:
		return OperationType.PRINTING_UTECO
	if machine.type == MachineType.CONVERTER_BAGGER:
		return OperationType.CONVERSION
	raise DomainError("Unsupported machine type for scheduling")


def _find_tool_type(session: Session, code: str) -> Optional[ToolType]:
	q = select(ToolType).where(ToolType.code == code)
	return session.execute(q).scalars().first()


def _reserve_tools(
	session: Session,
	job: Job,
	operation_type: OperationType,
	machine: Machine,
	window: Optional[Tuple[Optional[datetime], Optional[datetime]]],
	tool_type_codes: List[str],
) -> List[ToolConflictDTO]:
	conflicts: List[ToolConflictDTO] = []
	planned_from: Optional[datetime] = window[0] if window else None
	planned_to: Optional[datetime] = window[1] if window else None
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
			# Count overlapping reservations for same tool_type on this machine
			overlap_q = select(func.count()).select_from(ToolReservation).where(
				ToolReservation.tool_type_id == tool_type.id,
				ToolReservation.machine_id == machine.id,
				ToolReservation.status.in_([ToolReservationStatus.PLANNED, ToolReservationStatus.FULFILLED]),
				ToolReservation.planned_from <= planned_to,
				ToolReservation.planned_to >= planned_from,
			)
			in_use = session.execute(overlap_q).scalar_one()
			if in_use >= supply:
				status = ToolReservationStatus.CONFLICTED
				reason = "Insufficient tools available in window"

		res = ToolReservation(
			tool_type_id=tool_type.id,
			tool_id=None,
			machine_id=machine.id,
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


def add_job(machine_id: uuid.UUID, job_id: uuid.UUID, position: Optional[int] = None) -> LaneDTO:
	with SessionLocal.begin() as session:
		machine: Machine = session.get(Machine, machine_id)
		if not machine or not machine.active:
			raise DomainError("Machine not found or inactive")

		job, order, product_version = _get_job_with_context(session, job_id)
		if job.status not in (JobStatus.PLANNED, JobStatus.SCHEDULED, JobStatus.PAUSED):
			raise DomainError("Job not in a schedulable state")

		items = _load_lane_items_for_update(session, machine_id)
		if any(i.job_id == job_id for i in items):
			raise DomainError("Job already in this machine queue")

		insert_pos = position if position is not None else (len(items) + 1)
		insert_pos = max(1, min(insert_pos, len(items) + 1))

		for itm in items:
			if itm.position >= insert_pos:
				itm.position += 1

		queue_item = MachineQueueItem(
			machine_id=machine_id,
			job_id=job_id,
			position=insert_pos,
			status=QueueStatus.QUEUED,
		)
		session.add(queue_item)

		_reindex_lane(items + [queue_item])

		if job.status == JobStatus.PLANNED:
			job.status = JobStatus.SCHEDULED

		warnings = _routing_warnings_for_enqueue(session, machine, job, product_version)

		operation_type = _operation_type_for_machine(machine)
		required_codes = _required_tool_type_codes(job, operation_type, product_version)
		# Advisory-only window for add: leave None (unknown), or use a small placeholder
		tool_conflicts = _reserve_tools(
			session=session,
			job=job,
			operation_type=operation_type,
			machine=machine,
			window=None,
			tool_type_codes=required_codes,
		)

		refreshed = _load_lane_items_for_update(session, machine_id)
		return _lane_dto(machine_id, refreshed, warnings=warnings, conflicts=tool_conflicts)


def reorder(machine_id: uuid.UUID, job_id: uuid.UUID, new_position: int) -> LaneDTO:
	with SessionLocal.begin() as session:
		machine: Machine = session.get(Machine, machine_id)
		if not machine or not machine.active:
			raise DomainError("Machine not found or inactive")

		items = _load_lane_items_for_update(session, machine_id)
		item = next((i for i in items if i.job_id == job_id), None)
		if not item:
			raise DomainError("Queue item not found in this lane")
		if item.status == QueueStatus.RUNNING:
			raise DomainError("Cannot reorder a running item")

		items.remove(item)
		new_position = max(1, min(new_position, len(items) + 1))
		for itm in items:
			if itm.position >= new_position:
				itm.position += 1
		item.position = new_position
		items.append(item)
		_reindex_lane(items)

		refreshed = _load_lane_items_for_update(session, machine_id)
		return _lane_dto(machine_id, refreshed)


def remove(machine_id: uuid.UUID, job_id: uuid.UUID) -> LaneDTO:
	with SessionLocal.begin() as session:
		machine: Machine = session.get(Machine, machine_id)
		if not machine or not machine.active:
			raise DomainError("Machine not found or inactive")

		items = _load_lane_items_for_update(session, machine_id)
		item = next((i for i in items if i.job_id == job_id), None)
		if not item:
			raise DomainError("Queue item not found in this lane")
		if item.status == QueueStatus.RUNNING:
			raise DomainError("Cannot remove a running item")

		items.remove(item)
		session.delete(item)
		_reindex_lane(items)

		# Advisory: cancel planned/conflicted tool reservations for this lane item
		session.query(ToolReservation).filter(
			ToolReservation.job_id == job_id,
			ToolReservation.machine_id == machine_id,
			ToolReservation.status.in_([ToolReservationStatus.PLANNED, ToolReservationStatus.CONFLICTED]),
		).update({"status": ToolReservationStatus.CANCELLED})

		refreshed = _load_lane_items_for_update(session, machine_id)
		return _lane_dto(machine_id, refreshed)


def _validate_machine_capability(machine: Machine, product_version: Optional[ProductVersion], operation_type: OperationType) -> None:
	spec = (product_version.spec_payload if product_version else {}) or {}
	width_mm = (
		(spec.get("dimensions") or {}).get("decision_width_mm")
		or spec.get("decision_width_mm")
	)
	gauge_um = (spec.get("materials") or {}).get("gauge_um") or spec.get("gauge_um")
	cap = machine.capability or {}
	if width_mm is not None and "width_range_mm" in cap:
		min_w, max_w = cap["width_range_mm"][0], cap["width_range_mm"][1]
		if not (min_w <= float(width_mm) <= max_w):
			raise DomainError("Machine width capability out of range for this job")
	if gauge_um is not None and "gauge_range_um" in cap:
		min_g, max_g = cap["gauge_range_um"][0], cap["gauge_range_um"][1]
		if not (min_g <= float(gauge_um) <= max_g):
			raise DomainError("Machine gauge capability out of range for this job")
	# Additional operation-specific checks can be added later


def validate_move(job_id: uuid.UUID, operation_type: OperationType, target_machine_id: uuid.UUID) -> None:
	with SessionLocal.begin() as session:
		target: Machine = session.get(Machine, target_machine_id)
		if not target or not target.active:
			raise DomainError("Target machine not found or inactive")
		expected = _operation_type_for_machine(target)
		if expected != operation_type:
			raise DomainError("Target machine does not match operation type")
		job, order, product_version = _get_job_with_context(session, job_id)
		_validate_machine_capability(target, product_version, operation_type)


def move_bar(
	job_id: uuid.UUID,
	operation_type: OperationType,
	target_machine_id: uuid.UUID,
	target_position: int,
	proposed_start: Optional[datetime] = None,
) -> MoveResult:
	with SessionLocal.begin() as session:
		target: Machine = session.get(Machine, target_machine_id)
		if not target or not target.active:
			raise DomainError("Target machine not found or inactive")
		expected = _operation_type_for_machine(target)
		if expected != operation_type:
			raise DomainError("Target machine does not match operation type")

		# Find source item for this job (matching op via machine type)
		# Job may appear in multiple lanes; choose the one whose machine.type maps to operation_type
		q_items = select(MachineQueueItem, Machine).join(Machine, Machine.id == MachineQueueItem.machine_id).where(
			MachineQueueItem.job_id == job_id
		).with_for_update()
		found = None
		for row in session.execute(q_items).all():
			itm: MachineQueueItem = row[0]
			m: Machine = row[1]
			if _operation_type_for_machine(m) == operation_type:
				found = (itm, m)
				break
		if not found:
			raise DomainError("Queue item for this operation not found")
		item, source_machine = found
		if item.status == QueueStatus.RUNNING:
			raise DomainError("Cannot move a running item")

		# Capability check
		job, order, product_version = _get_job_with_context(session, job_id)
		_validate_machine_capability(target, product_version, operation_type)

		# Lock both lanes
		source_items = _load_lane_items_for_update(session, source_machine.id)
		target_items = _load_lane_items_for_update(session, target_machine_id)

		# Remove from source
		source_items = [i for i in source_items if i.id != item.id]
		_reindex_lane(source_items)

		# Insert into target
		target_position = max(1, min(target_position, len(target_items) + 1))
		for itm in target_items:
			if itm.position >= target_position:
				itm.position += 1
		item.machine_id = target_machine_id
		item.position = target_position
		target_items.append(item)
		_reindex_lane(target_items)

		# Tooling: cancel prior reservations, reserve for target (advisory)
		session.query(ToolReservation).filter(
			ToolReservation.job_id == job_id,
			ToolReservation.operation_type == operation_type,
			ToolReservation.machine_id == source_machine.id,
			ToolReservation.status.in_([ToolReservationStatus.PLANNED, ToolReservationStatus.CONFLICTED]),
		).update({"status": ToolReservationStatus.CANCELLED})

		window = None
		if proposed_start:
			window = (proposed_start, proposed_start + timedelta(hours=1))
		required_codes = _required_tool_type_codes(job, operation_type, product_version)
		tool_conflicts = _reserve_tools(
			session=session,
			job=job,
			operation_type=operation_type,
			machine=target,
			window=window,
			tool_type_codes=required_codes,
		)

		# Advisory routing warnings for target lane
		warnings = _routing_warnings_for_enqueue(session, target, job, product_version)

		source_ref = _load_lane_items_for_update(session, source_machine.id)
		target_ref = _load_lane_items_for_update(session, target_machine_id)

		return MoveResult(
			source_lane=_lane_dto(source_machine.id, source_ref),
			target_lane=_lane_dto(target_machine_id, target_ref, warnings=warnings, conflicts=tool_conflicts),
		)


def get_overview() -> dict:
	with SessionLocal() as session:
		# Load all active machines, sorted by code
		machines = session.execute(
			select(Machine).where(Machine.active.is_(True)).order_by(Machine.code.asc())
		).scalars().all()

		def _lane_for(machine_id: uuid.UUID) -> LaneDTO:
			items = session.execute(
				select(MachineQueueItem)
				.where(
					MachineQueueItem.machine_id == machine_id,
					MachineQueueItem.status.in_([QueueStatus.QUEUED, QueueStatus.RUNNING]),
				)
				.order_by(MachineQueueItem.position.asc())
			).scalars().all()
			return _lane_dto(machine_id, items)

		extruders = []
		printers = []
		converters = []

		for m in machines:
			entry = {"machine": m, "lane": _lane_for(m.id)}
			if m.type == MachineType.EXTRUDER:
				extruders.append(entry)
			elif m.type == MachineType.PRINTER_UTECO:
				printers.append(entry)
			elif m.type == MachineType.CONVERTER_BAGGER:
				converters.append(entry)

		# Already sorted by machine code due to query order
		return {"extruders": extruders, "printers": printers, "converters": converters}


def estimate_job_operations(job_id: uuid.UUID | str) -> JobEstimatesDTO:
	"""
	Calculate estimated durations for a job's operations.
	Uses placeholder rates if rate cards are not available.
	"""
	with SessionLocal() as session:
		job_id_str = str(job_id)
		job, order, product_version = _get_job_with_context(session, uuid.UUID(job_id_str))
		spec = (product_version.spec_payload if product_version else {}) or {}
		
		operations: List[OperationEstimateDTO] = []
		
		# Determine required operations
		printing_method = _get_printing_method_from_spec(product_version)
		requires_extrusion = True  # Always required
		requires_uteco = printing_method == PrintingMethod.UTECO
		requires_conversion = True  # Assume conversion is always needed
		
		# Extract quantities from spec or job
		planned_qty = float(job.planned_qty)
		
		# Extrusion estimate
		if requires_extrusion:
			# Placeholder: 100 kg/hour default rate
			# In reality, this would come from rate cards and be adjusted by width/thickness yields
			estimated_kg = planned_qty * 0.5  # Placeholder: assume 0.5 kg per unit
			extruder_rate_kg_per_hour = 100.0  # Placeholder default
			duration_hours = estimated_kg / extruder_rate_kg_per_hour if extruder_rate_kg_per_hour > 0 else 1.0
			operations.append(OperationEstimateDTO(
				operation_type="EXTRUSION",
				estimated_duration_hours=max(0.5, duration_hours),  # Minimum 0.5 hours
				estimated_kg=estimated_kg,
			))
		
		# Uteco printing estimate
		if requires_uteco:
			# Placeholder: 50 m/min default speed, 30 min setup
			web_length_m = planned_qty * 0.1  # Placeholder: assume 0.1 m per unit
			printer_speed_m_per_min = 50.0  # Placeholder default
			num_colours = (spec.get("printing") or {}).get("num_colours", 1) or 1
			setup_allowance_hours = 0.5 + (num_colours * 0.1)  # 30 min base + 6 min per colour
			runtime_hours = (web_length_m / printer_speed_m_per_min) / 60.0
			duration_hours = setup_allowance_hours + runtime_hours
			operations.append(OperationEstimateDTO(
				operation_type="PRINTING_UTECO",
				estimated_duration_hours=max(0.5, duration_hours),
				estimated_metres=web_length_m,
			))
		
		# Conversion estimate
		if requires_conversion:
			# Placeholder: 1000 units/hour default rate, 15 min setup
			bagger_rate_units_per_hour = 1000.0  # Placeholder default
			setup_allowance_hours = 0.25  # 15 minutes
			runtime_hours = planned_qty / bagger_rate_units_per_hour if bagger_rate_units_per_hour > 0 else 1.0
			duration_hours = setup_allowance_hours + runtime_hours
			operations.append(OperationEstimateDTO(
				operation_type="CONVERSION",
				estimated_duration_hours=max(0.25, duration_hours),
				estimated_units=planned_qty,
			))
		
		return JobEstimatesDTO(job_id=uuid.UUID(job_id_str), operations=operations)


def _get_default_operating_calendar() -> dict:
	"""
	Returns default operating calendar: Monday 04:30 → Friday 04:30 (96 hours total).
	24 hours/day operation, 4 days/week.
	"""
	# Get next Monday (or current Monday if today is Monday before 04:30)
	today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
	days_until_monday = (7 - today.weekday()) % 7
	if days_until_monday == 0:
		# Today is Monday, check if we're before 04:30
		now = datetime.now()
		if now.hour < 4 or (now.hour == 4 and now.minute < 30):
			days_until_monday = 0
		else:
			days_until_monday = 7
	
	start = today + timedelta(days=days_until_monday)
	start = start.replace(hour=4, minute=30, second=0, microsecond=0)
	end = start + timedelta(days=4)  # Friday 04:30
	
	return {
		"start": start,
		"end": end,
		"days": 4,
		"hours_per_day": 24,
	}


def get_gantt_overview(operating_calendar: Optional[dict] = None) -> GanttOverviewDTO:
	"""
	Build Gantt chart overview with lanes, bars, and tentative start/finish times.
	"""
	from app.db.models.domain import Product, Customer
	
	if operating_calendar is None:
		operating_calendar = _get_default_operating_calendar()
	
	calendar_start = operating_calendar["start"]
	
	with SessionLocal() as session:
		# Load all active machines, sorted by type then code
		machines = session.execute(
			select(Machine)
			.where(Machine.active.is_(True))
			.order_by(Machine.type.asc(), Machine.code.asc())
		).scalars().all()
		
		lanes: List[GanttLaneDTO] = []
		
		for machine in machines:
			# Load queue items for this machine
			queue_items = session.execute(
				select(MachineQueueItem)
				.where(
					MachineQueueItem.machine_id == machine.id,
					MachineQueueItem.status.in_([QueueStatus.QUEUED, QueueStatus.RUNNING]),
				)
				.order_by(MachineQueueItem.position.asc())
			).scalars().all()
			
			bars: List[GanttBarDTO] = []
			cumulative_hours = 0.0
			
			for queue_item in queue_items:
				# Load job context
				job, order, product_version = _get_job_with_context(session, uuid.UUID(str(queue_item.job_id)))
				
				# Load customer
				customer = session.get(Customer, order.customer_id)
				customer_name = customer.name if customer else "Unknown"
				
				# Load product
				product = session.get(Product, product_version.product_id) if product_version else None
				product_code = product.code if product else "Unknown"
				
				# Format job code
				job_code = f"{order.code}-{job.job_code}"
				
				# Determine operation type
				operation_type = _operation_type_for_machine(machine)
				operation_type_str = operation_type.value if hasattr(operation_type, "value") else str(operation_type)
				
				# Get duration estimates
				estimates = estimate_job_operations(uuid.UUID(str(job.id)))
				operation_estimate = next(
					(e for e in estimates.operations if e.operation_type == operation_type_str),
					None
				)
				duration_hours = operation_estimate.estimated_duration_hours if operation_estimate else 1.0
				
				# Calculate tentative start/finish
				tentative_start = calendar_start + timedelta(hours=cumulative_hours)
				tentative_finish = tentative_start + timedelta(hours=duration_hours)
				cumulative_hours += duration_hours
				
				# Determine status
				status_str = queue_item.status.value if hasattr(queue_item.status, "value") else str(queue_item.status)
				
				# Determine readiness
				readiness = "running" if status_str == "running" else "ready"
				spec = (product_version.spec_payload if product_version else {}) or {}
				printing_method = _get_printing_method_from_spec(product_version)
				
				# Check routing warnings
				warnings = _routing_warnings_for_enqueue(session, machine, job, product_version)
				if warnings:
					readiness = "blocked"
				
				# Check for tool conflicts
				operation_type_enum = _operation_type_for_machine(machine)
				required_codes = _required_tool_type_codes(job, operation_type_enum, product_version)
				tool_conflicts: List[ToolConflictDTO] = []
				# Note: Full conflict checking would require time window, simplified for MVP
				
				# Determine visual properties
				requires_uteco = printing_method == PrintingMethod.UTECO
				requires_inline_print = printing_method == PrintingMethod.INLINE
				num_colours = (spec.get("printing") or {}).get("num_colours", 0) or 0
				
				bars.append(GanttBarDTO(
					job_id=uuid.UUID(str(job.id)),
					job_code=job_code,
					operation_type=operation_type_str,
					customer=customer_name,
					product_code=product_code,
					planned_qty=float(job.planned_qty),
					estimated_duration_hours=duration_hours,
					tentative_start=tentative_start,
					tentative_finish=tentative_finish,
					status=status_str,
					readiness=readiness,
					requires_uteco=requires_uteco,
					requires_inline_print=requires_inline_print,
					num_colours=num_colours,
					warnings=warnings,
					tool_conflicts=tool_conflicts,
				))
			
			machine_type_str = machine.type.value if hasattr(machine.type, "value") else str(machine.type)
			lanes.append(GanttLaneDTO(
				machine_id=machine.id,
				machine_code=machine.code,
				machine_type=machine_type_str,
				bars=bars,
			))
		
		return GanttOverviewDTO(
			lanes=lanes,
			calendar=operating_calendar,
		)
