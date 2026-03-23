from __future__ import annotations

import statistics
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple
import logging

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.db.models.domain import (
    Job,
    JobQCSummary,
    OperationRun,
    ProductVersion,
    QCCheck,
    QCReading,
    RunOutputEntry,
)
from app.job_context import resolve_job_context
from app.db.models.enums import JobQCSummaryStatus, QCCheckResult, QCSource
from app.exceptions import DomainError

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _extract_numeric(v: Any) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, dict):
        # common shapes: {"value": 23.4} or {"raw": 23.4}
        for key in ("value", "raw", "avg", "mean"):
            if key in v and isinstance(v[key], (int, float)):
                return float(v[key])
    try:
        return float(str(v))
    except Exception:
        return None


def _collect_job_qc_observations(session: Session, job_id: uuid.UUID) -> Dict[str, Dict[str, Any]]:
    """
    Returns a mapping:
      check_type -> {
        "values": [float, ...],       # numeric observations from readings/checks
        "pass_count": int,
        "fail_count": int,
        "na_count": int,
      }
    Combines QCReading.value and QCCheck.numeric_values for flexibility.
    """
    obs: Dict[str, Dict[str, Any]] = {}

    # From readings via runs
    q_readings = (
        select(QCReading.check_type, QCReading.value, QCReading.result)
        .join(OperationRun, OperationRun.id == QCReading.operation_run_id)
        .where(OperationRun.job_id == job_id)
    )
    for ct, val, res in session.execute(q_readings).all():
        bucket = obs.setdefault(ct, {"values": [], "pass_count": 0, "fail_count": 0, "na_count": 0})
        num = _extract_numeric(val)
        if num is not None:
            bucket["values"].append(num)
        if res == QCCheckResult.PASS_:
            bucket["pass_count"] += 1
        elif res == QCCheckResult.FAIL:
            bucket["fail_count"] += 1
        else:
            bucket["na_count"] += 1

    # From manual checks (numeric_values may contain e.g. {"value": 25.2})
    q_checks = (
        select(QCCheck.check_type, QCCheck.numeric_values, QCCheck.result)
        .join(OperationRun, OperationRun.id == QCCheck.operation_run_id)
        .where(OperationRun.job_id == job_id)
    )
    for ct, val, res in session.execute(q_checks).all():
        bucket = obs.setdefault(ct, {"values": [], "pass_count": 0, "fail_count": 0, "na_count": 0})
        num = _extract_numeric(val)
        if num is not None:
            bucket["values"].append(num)
        if res == QCCheckResult.PASS_:
            bucket["pass_count"] += 1
        elif res == QCCheckResult.FAIL:
            bucket["fail_count"] += 1
        else:
            bucket["na_count"] += 1

    return obs


def _get_acceptance_expectations(product_version: Optional[ProductVersion]) -> Dict[str, Dict[str, Any]]:
    spec = (product_version.spec_payload if product_version else {}) or {}
    return (spec.get("quality_expectations") or {}).get("checks") or {}


def _compute_worst_deviation(values: list[float], cfg: Dict[str, Any]) -> Optional[float]:
    if not values:
        return None
    min_v = cfg.get("min")
    max_v = cfg.get("max")
    if min_v is None and max_v is None:
        return None
    worst = 0.0
    for v in values:
        dev = 0.0
        if min_v is not None and v < float(min_v):
            dev = float(min_v) - v
        elif max_v is not None and v > float(max_v):
            dev = v - float(max_v)
        if dev > worst:
            worst = dev
    return float(worst)


def _compute_aggregates(obs: Dict[str, Dict[str, Any]], expectations: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    aggregates: Dict[str, Any] = {}
    for ct, bucket in obs.items():
        values = [v for v in bucket["values"] if isinstance(v, (int, float))]
        aggr: Dict[str, Any] = {
            "pass_count": bucket.get("pass_count", 0),
            "fail_count": bucket.get("fail_count", 0),
            "na_count": bucket.get("na_count", 0),
        }
        if values:
            aggr["min"] = float(min(values))
            aggr["max"] = float(max(values))
            try:
                aggr["avg"] = float(statistics.fmean(values))
            except Exception:
                aggr["avg"] = float(sum(values) / len(values))
        # Worst-case deviation based on acceptance bounds (0 if within bounds)
        cfg = expectations.get(ct) or {}
        worst_dev = _compute_worst_deviation([float(v) for v in values], cfg) if values else None
        if worst_dev is not None:
            aggr["worst_deviation"] = worst_dev
        total_eval = aggr["pass_count"] + aggr["fail_count"]
        if total_eval > 0:
            aggr["compliance_rate"] = aggr["pass_count"] / total_eval
        else:
            aggr["compliance_rate"] = None
        aggregates[ct] = aggr
    return aggregates


def _compute_totals(session: Session, job_id: uuid.UUID) -> Dict[str, float]:
    totals: Dict[str, float] = {}
    q = (
        select(RunOutputEntry.uom, RunOutputEntry.good_or_scrap, func.coalesce(func.sum(RunOutputEntry.quantity), 0))
        .join(OperationRun, OperationRun.id == RunOutputEntry.run_id)
        .where(OperationRun.job_id == job_id)
        .group_by(RunOutputEntry.uom, RunOutputEntry.good_or_scrap)
    )
    for uom, is_good, total in session.execute(q).all():
        key = "good" if is_good else "scrap"
        totals[f"{key}_{uom.lower()}"] = float(total)
    return totals


def _default_final_checklist(product_version: Optional[ProductVersion]) -> Dict[str, Any]:
    # Pull from product spec if available; otherwise provide placeholders
    spec = (product_version.spec_payload if product_version else {}) or {}
    wi = (spec.get("work_instructions") or {})  # WI references may live here
    return {
        "raw_material_spec": {"wi": wi.get("raw_material") or "WI-01", "required": True, "status": None},
        "dimensions_to_spec": {"wi": wi.get("dimensions") or "WI-01", "required": True, "status": None},
        "film_quality": {"wi": wi.get("film_quality") or "WI-09/10", "required": True, "status": None},
        "colour_film_ink": {"wi": wi.get("colour") or "WI-01/41", "required": True, "status": None},
        "venting": {"wi": wi.get("venting") or "WI-39", "required": False, "status": None},
    }


def aggregate_job_qc(job_id: uuid.UUID, created_by: str) -> JobQCSummary:
    with SessionLocal.begin() as session:
        job, _order, product_version = resolve_job_context(session, job_id)

        obs = _collect_job_qc_observations(session, job_id)
        expectations = _get_acceptance_expectations(product_version)
        aggregates = _compute_aggregates(obs, expectations)
        totals = _compute_totals(session, job_id)
        checklist = _default_final_checklist(product_version)

        # Upsert JobQCSummary in draft
        existing: Optional[JobQCSummary] = session.execute(
            select(JobQCSummary).where(JobQCSummary.job_id == job.id)
        ).scalars().first()
        if existing:
            existing.totals = totals
            existing.aggregates = aggregates
            existing.final_checklist = checklist
            existing.status = JobQCSummaryStatus.DRAFT
            # keep deviations as-is; manager may have drafted notes
            summary = existing
        else:
            summary = JobQCSummary(
                job_id=job.id,
                totals=totals,
                aggregates=aggregates,
                final_checklist=checklist,
                deviations={},
                status=JobQCSummaryStatus.DRAFT,
                created_by=created_by,
            )
            session.add(summary)
        session.flush()
        logger.info("QCSummaryAggregated job_id=%s summary_id=%s", job.id, summary.id)
        return summary


def finalize_job_qc(
    job_id: uuid.UUID,
    checklist_updates: Dict[str, Any],
    deviations: Optional[Dict[str, Any]],
    finalized_by: str,
) -> JobQCSummary:
    with SessionLocal.begin() as session:
        summary: Optional[JobQCSummary] = session.execute(
            select(JobQCSummary).where(JobQCSummary.job_id == job_id)
        ).scalars().first()
        if not summary:
            raise DomainError("Aggregate QC summary not found; run aggregation first")

        # Apply checklist updates
        final_checklist = summary.final_checklist or {}
        for key, val in (checklist_updates or {}).items():
            if key in final_checklist and isinstance(val, dict):
                final_checklist[key].update(val)
        summary.final_checklist = final_checklist

        # Apply deviations if provided
        if deviations is not None:
            summary.deviations = deviations

        # Determine status
        required_items = [k for k, v in final_checklist.items() if v.get("required")]
        all_required_pass = all((final_checklist[k].get("status") == "pass") for k in required_items)
        any_required_fail = any((final_checklist[k].get("status") == "fail") for k in required_items)

        # If there are deviations, require approvals on each to pass-with-deviation
        has_deviation = bool(summary.deviations)
        deviations_approved = True
        if has_deviation:
            devs = summary.deviations or {}
            for d in devs if isinstance(devs, list) else devs.values():
                approved_by = (d or {}).get("approved_by")
                approved_at = (d or {}).get("approved_at")
                if not approved_by or not approved_at:
                    deviations_approved = False
                    break

        if all_required_pass and not has_deviation:
            new_status = JobQCSummaryStatus.FINAL_PASS
        elif all_required_pass and has_deviation and deviations_approved:
            new_status = JobQCSummaryStatus.FINAL_PASS_WITH_DEVIATION
        else:
            # Either a required fail exists or deviations unapproved
            new_status = JobQCSummaryStatus.FINAL_FAIL

        summary.status = new_status
        summary.finalized_by = finalized_by
        summary.finalized_at = _now()
        session.flush()
        logger.info(
            "QCSummaryFinalized job_id=%s summary_id=%s status=%s by=%s",
            job_id,
            summary.id,
            new_status.value,
            finalized_by,
        )
        return summary


__all__ = ["aggregate_job_qc", "finalize_job_qc"]


