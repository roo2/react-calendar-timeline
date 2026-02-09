from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, Optional, Tuple

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.db.models.domain import (
    InventoryTransaction,
    Job,
    Machine,
    MachineQueueItem,
    OperationRun,
    Order,
    ProductVersion,
    QCCheck,
    QCReading,
    RunOutputEntry,
    Tool,
    ToolMount,
    ToolReservation,
    ToolType,
)
from app.db.models.enums import (
    InventoryCategory,
    JobStatus,
    MachineType,
    OperationType,
    QCCheckResult,
    QCSource,
    QueueStatus,
    RunStatus,
    ToolReservationStatus,
    PrintingMethod,
)
from app.exceptions import DomainError
from app.machines.service import validate_machine_capability
from app.production.schemas import ChecklistDTO, ChecklistItem, TotalsDTO
from app.scheduling.service import _required_tool_type_codes as scheduling_required_tool_type_codes


# -------- Helpers
def _now() -> datetime:
    return datetime.now(timezone.utc)


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
    method = (
        spec.get("printing_method")
        or (spec.get("printing") or {}).get("method")
        or spec.get("printingMethod")
        or spec.get("print_method")
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


def _has_completed_run(session: Session, job_id: uuid.UUID, op_type: OperationType) -> bool:
    q = select(OperationRun).where(
        OperationRun.job_id == job_id,
        OperationRun.operation_type == op_type,
        OperationRun.status == RunStatus.COMPLETED,
    )
    return session.execute(q).scalars().first() is not None


def _tooling_ready(
    session: Session,
    job: Job,
    operation_type: OperationType,
    machine: Machine,
    product_version: Optional[ProductVersion],
) -> Tuple[bool, list[str]]:
    now = _now()
    conflicts: list[str] = []
    required_codes = scheduling_required_tool_type_codes(job, operation_type, product_version)
    if not required_codes:
        return True, []

    # 1) Planned reservation(s) exist covering "now" (or any if windows not set)
    for code in required_codes:
        # Find tool type
        tool_type: Optional[ToolType] = session.execute(select(ToolType).where(ToolType.code == code)).scalars().first()
        if not tool_type:
            conflicts.append(f"Required tool type not registered: {code}")
            continue
        res_q = select(ToolReservation).where(
            ToolReservation.tool_type_id == tool_type.id,
            ToolReservation.machine_id == machine.id,
            ToolReservation.job_id == job.id,
            ToolReservation.operation_type == operation_type,
            ToolReservation.status == ToolReservationStatus.PLANNED,
        )
        reservations = list(session.execute(res_q).scalars().all())
        if not reservations:
            conflicts.append(f"No planned reservation for required tool type: {code}")
            continue
        # If windows are present, ensure one covers now
        has_covering = any(
            (r.planned_from is None or r.planned_from <= now) and (r.planned_to is None or r.planned_to >= now)
            for r in reservations
        )
        if not has_covering:
            conflicts.append(f"No reservation covering current time for tool type: {code}")

        # 2) Active mount on machine for any tool of this type
        mount_q = (
            select(ToolMount)
            .join(Tool, Tool.id == ToolMount.tool_id)
            .where(
                Tool.tool_type_id == tool_type.id,
                ToolMount.machine_id == machine.id,
                ToolMount.mounted_from <= now,
                (ToolMount.mounted_to.is_(None)) | (ToolMount.mounted_to >= now),
            )
        )
        mounted = session.execute(mount_q).scalars().first()
        if not mounted:
            conflicts.append(f"No active mount for required tool type on this machine: {code}")

    return (len(conflicts) == 0), conflicts


# -------- Service methods
def start_run(job_id: uuid.UUID, machine_id: uuid.UUID, operation_type: OperationType) -> OperationRun:
    with SessionLocal.begin() as session:
        # Entities
        machine: Machine = session.get(Machine, machine_id)
        if not machine or not machine.active:
            raise DomainError("Machine not found or inactive")
        job, order, product_version = _get_job_with_context(session, job_id)
        if job.status not in (JobStatus.PLANNED, JobStatus.SCHEDULED, JobStatus.PAUSED, JobStatus.RUNNING):
            raise DomainError("Job not in a runnable state")

        # Machine exclusivity pre-check
        q_busy = select(OperationRun).where(OperationRun.machine_id == machine_id, OperationRun.status == RunStatus.RUNNING)
        if session.execute(q_busy).scalars().first() is not None:
            raise DomainError("Machine already has a running operation")

        # Scheduling head-of-queue (advisory enforce if present)
        q_items = select(MachineQueueItem).where(MachineQueueItem.machine_id == machine_id)
        items = list(session.execute(q_items).scalars().all())
        my_item = next((i for i in items if i.job_id == job_id), None)
        earliest_queued = min((i.position for i in items if i.status == QueueStatus.QUEUED), default=None)
        if my_item is not None and earliest_queued is not None and my_item.position != earliest_queued:
            raise DomainError("Job is not at the head of the queue for this machine")

        # Routing hard-stops
        any_run_q = select(func.count()).select_from(OperationRun).where(OperationRun.job_id == job_id)
        first_run = session.execute(any_run_q).scalar_one() == 0
        if first_run and operation_type != OperationType.EXTRUSION:
            raise DomainError("First run for a job must be extrusion")
        pm = _get_printing_method_from_spec(product_version)
        if operation_type == OperationType.PRINTING_UTECO:
            if not _has_completed_run(session, job_id, OperationType.EXTRUSION):
                raise DomainError("Uteco Printing requires at least one completed Extrusion run")
        if operation_type == OperationType.CONVERSION:
            if pm == PrintingMethod.NONE and not _has_completed_run(session, job_id, OperationType.EXTRUSION):
                raise DomainError("Conversion requires at least one completed Extrusion run")
            if pm == PrintingMethod.UTECO and not _has_completed_run(session, job_id, OperationType.PRINTING_UTECO):
                raise DomainError("Conversion requires at least one completed Uteco Printing run")

        # Tooling hard-stop
        ok, conflicts = _tooling_ready(session, job, operation_type, machine, product_version)
        if not ok:
            raise DomainError("; ".join(conflicts))

        # Capability check
        validate_machine_capability(machine, product_version)

        # Create operation run
        run = OperationRun(
            job_id=job_id,
            operation_type=operation_type,
            machine_id=machine_id,
            status=RunStatus.RUNNING,
            started_at=_now(),
        )
        session.add(run)

        # Update queue item if present
        if my_item:
            my_item.status = QueueStatus.RUNNING

        # Update job status
        if job.status in (JobStatus.PLANNED, JobStatus.SCHEDULED, JobStatus.PAUSED):
            job.status = JobStatus.RUNNING

        session.flush()
        return run


def pause_run(run_id: uuid.UUID) -> OperationRun:
    with SessionLocal.begin() as session:
        run: OperationRun = session.get(OperationRun, run_id)
        if not run:
            raise DomainError("Run not found")
        if run.status != RunStatus.RUNNING:
            raise DomainError("Run is not in a running state")
        run.status = RunStatus.PAUSED
        # Mirror job status only if no other running runs
        q_other = select(func.count()).select_from(OperationRun).where(
            OperationRun.job_id == run.job_id, OperationRun.status == RunStatus.RUNNING
        )
        if session.execute(q_other).scalar_one() == 0:
            job: Job = session.get(Job, run.job_id)
            job.status = JobStatus.PAUSED
        session.flush()
        return run


def resume_run(run_id: uuid.UUID) -> OperationRun:
    with SessionLocal.begin() as session:
        run: OperationRun = session.get(OperationRun, run_id)
        if not run:
            raise DomainError("Run not found")
        if run.status != RunStatus.PAUSED:
            raise DomainError("Run is not paused")
        run.status = RunStatus.RUNNING
        job: Job = session.get(Job, run.job_id)
        if job.status in (JobStatus.PAUSED, JobStatus.SCHEDULED, JobStatus.PLANNED):
            job.status = JobStatus.RUNNING
        session.flush()
        return run


def _post_inventory_for_output(
    session: Session,
    run: OperationRun,
    output: RunOutputEntry,
    product_version: Optional[ProductVersion],
    created_by: str,
) -> None:
    # Map according to SDS 7 / SDS 8
    quantity = float(output.quantity)
    uom = output.uom
    pm = _get_printing_method_from_spec(product_version)
    entries: list[InventoryTransaction] = []

    if output.good_or_scrap:
        # Good
        if run.operation_type == OperationType.EXTRUSION:
            entries.append(
                InventoryTransaction(
                    category=InventoryCategory.WIP_EXTRUDED_ROLL,
                    quantity=quantity,
                    uom=uom,
                    job_id=run.job_id,
                    run_id=run.id,
                    created_by=created_by,
                    reason="extrusion_good",
                )
            )
        elif run.operation_type == OperationType.PRINTING_UTECO:
            # Produce printed roll, consume extruded
            entries.append(
                InventoryTransaction(
                    category=InventoryCategory.WIP_PRINTED_ROLL,
                    quantity=quantity,
                    uom=uom,
                    job_id=run.job_id,
                    run_id=run.id,
                    created_by=created_by,
                    reason="printing_good",
                )
            )
            entries.append(
                InventoryTransaction(
                    category=InventoryCategory.WIP_EXTRUDED_ROLL,
                    quantity=-quantity,
                    uom=uom,
                    job_id=run.job_id,
                    run_id=run.id,
                    created_by=created_by,
                    reason="consume_extruded_for_print",
                )
            )
        elif run.operation_type == OperationType.CONVERSION:
            # Produce finished goods, consume upstream roll depending on print method
            entries.append(
                InventoryTransaction(
                    category=InventoryCategory.FINISHED_GOODS,
                    quantity=quantity,
                    uom=uom,
                    job_id=run.job_id,
                    run_id=run.id,
                    created_by=created_by,
                    reason="conversion_good",
                )
            )
            consume_cat = (
                InventoryCategory.WIP_PRINTED_ROLL if pm == PrintingMethod.UTECO else InventoryCategory.WIP_EXTRUDED_ROLL
            )
            entries.append(
                InventoryTransaction(
                    category=consume_cat,
                    quantity=-quantity,
                    uom=uom,
                    job_id=run.job_id,
                    run_id=run.id,
                    created_by=created_by,
                    reason="consume_upstream_for_conversion",
                )
            )
    else:
        # Scrap
        entries.append(
            InventoryTransaction(
                category=InventoryCategory.SCRAP,
                quantity=quantity,
                uom=uom,
                job_id=run.job_id,
                run_id=run.id,
                created_by=created_by,
                reason="scrap",
            )
        )

    for e in entries:
        session.add(e)


def record_output(
    run_id: uuid.UUID,
    quantity: Decimal,
    uom: str,
    good_or_scrap: bool,
    finished_goods: Optional[bool],
    note: Optional[str],
    created_by: str,
) -> TotalsDTO:
    with SessionLocal.begin() as session:
        run: OperationRun = session.get(OperationRun, run_id)
        if not run:
            raise DomainError("Run not found")
        output = RunOutputEntry(
            run_id=run_id,
            quantity=float(quantity),
            uom=uom,
            good_or_scrap=bool(good_or_scrap),
            finished_goods=bool(finished_goods) if finished_goods is not None else False,
            note=note,
        )
        session.add(output)

        # Inventory postings
        _, _, product_version = _get_job_with_context(session, run.job_id)
        _post_inventory_for_output(session, run, output, product_version, created_by=created_by)

        # Totals
        totals = _compute_totals(session, run)
        return totals


def _compute_totals(session: Session, run: OperationRun) -> TotalsDTO:
    # Run totals grouped by uom and good/scrap
    totals_run: Dict[str, Decimal] = {}
    q_run = select(RunOutputEntry.uom, RunOutputEntry.good_or_scrap, func.coalesce(func.sum(RunOutputEntry.quantity), 0)).where(
        RunOutputEntry.run_id == run.id
    ).group_by(RunOutputEntry.uom, RunOutputEntry.good_or_scrap)
    for uom, is_good, total in session.execute(q_run).all():
        key = ""
        if is_good:
            if uom.lower() in ("kg", "kilogram", "kilograms"):
                key = "good_kg"
            elif uom.lower() in ("m", "meter", "metre", "metres", "meters"):
                key = "good_m"
            else:
                key = "good_units"
        else:
            if uom.lower() in ("kg", "kilogram", "kilograms"):
                key = "scrap_kg"
            else:
                # track other scrap as generic
                key = f"scrap_{uom.lower()}"
        totals_run[key] = Decimal(str(total))

    # Job totals: sum across all runs for this job
    totals_job: Dict[str, Decimal] = {}
    q_job = (
        select(RunOutputEntry.uom, RunOutputEntry.good_or_scrap, func.coalesce(func.sum(RunOutputEntry.quantity), 0))
        .join(OperationRun, OperationRun.id == RunOutputEntry.run_id)
        .where(OperationRun.job_id == run.job_id)
        .group_by(RunOutputEntry.uom, RunOutputEntry.good_or_scrap)
    )
    for uom, is_good, total in session.execute(q_job).all():
        key = ""
        if is_good:
            if uom.lower() in ("kg", "kilogram", "kilograms"):
                key = "good_kg"
            elif uom.lower() in ("m", "meter", "metre", "metres", "meters"):
                key = "good_m"
            else:
                key = "good_units"
        else:
            if uom.lower() in ("kg", "kilogram", "kilograms"):
                key = "scrap_kg"
            else:
                key = f"scrap_{uom.lower()}"
        totals_job[key] = Decimal(str(total))

    return TotalsDTO(run_totals=totals_run, job_totals=totals_job)


def record_qc(
    run_id: uuid.UUID,
    check_type: str,
    required: bool,
    result: QCCheckResult,
    values: Optional[Dict[str, Any]],
    measured_by: str,
) -> ChecklistDTO:
    with SessionLocal.begin() as session:
        run: OperationRun = session.get(OperationRun, run_id)
        if not run:
            raise DomainError("Run not found")
        if run.status not in (RunStatus.RUNNING, RunStatus.PAUSED):
            raise DomainError("Run must be running or paused to record QC")
        check = QCCheck(
            operation_run_id=run_id,
            check_type=check_type,
            required=bool(required),
            result=result,
            numeric_values=values or {},
            measured_by=measured_by,
            source=QCSource.MANUAL,
        )
        session.add(check)
        checklist = _compute_checklist(session, run_id)
        return checklist


def _compute_checklist(session: Session, run_id: uuid.UUID) -> ChecklistDTO:
    # Collect required check types from QCCheck rows marked required for this run
    q_req = select(QCCheck.check_type).where(QCCheck.operation_run_id == run_id, QCCheck.required.is_(True)).distinct()
    required_types = [row[0] for row in session.execute(q_req).all()]
    items: list[ChecklistItem] = []

    for t in required_types:
        # Manual pass?
        q_manual = select(QCCheck).where(
            QCCheck.operation_run_id == run_id,
            QCCheck.check_type == t,
            QCCheck.result == QCCheckResult.PASS_,
        )
        manual = session.execute(q_manual).scalars().first()
        if manual:
            items.append(ChecklistItem(check_type=t, satisfied=True, source="manual"))
            continue
        # Sensor pass?
        q_sensor = select(QCReading).where(
            QCReading.operation_run_id == run_id,
            QCReading.check_type == t,
            QCReading.result == QCCheckResult.PASS_,
        )
        sensor = session.execute(q_sensor).scalars().first()
        if sensor:
            items.append(ChecklistItem(check_type=t, satisfied=True, source="sensor"))
        else:
            items.append(ChecklistItem(check_type=t, satisfied=False, source=None))

    outstanding = sum(1 for i in items if not i.satisfied)
    return ChecklistDTO(required=items, outstanding_count=outstanding)


def complete_run(run_id: uuid.UUID) -> OperationRun:
    with SessionLocal.begin() as session:
        run: OperationRun = session.get(OperationRun, run_id)
        if not run:
            raise DomainError("Run not found")
        # QC gating: if there are any required checks defined, ensure satisfied
        checklist = _compute_checklist(session, run_id)
        if checklist.required and checklist.outstanding_count > 0:
            raise DomainError("Required QC checks are not satisfied")
        run.status = RunStatus.COMPLETED
        run.ended_at = _now()

        # Update queue item if present
        q_item = select(MachineQueueItem).where(
            MachineQueueItem.machine_id == run.machine_id, MachineQueueItem.job_id == run.job_id
        )
        item = session.execute(q_item).scalars().first()
        if item:
            item.status = QueueStatus.COMPLETED

        # If no other active runs for the job, mark job completed (operational)
        q_active = select(func.count()).select_from(OperationRun).where(
            OperationRun.job_id == run.job_id, OperationRun.status.in_([RunStatus.RUNNING, RunStatus.PAUSED])
        )
        if session.execute(q_active).scalar_one() == 0:
            job: Job = session.get(Job, run.job_id)
            job.status = JobStatus.COMPLETED

        session.flush()
        return run


