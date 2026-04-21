"""Update `Job.production_started_at` / `production_finished_at` when status changes."""

from __future__ import annotations

from datetime import datetime, timezone

from app.db.models.domain import Job
from app.db.models.enums import JobStatus


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def apply_job_production_timestamps(
    job: Job,
    new_status: JobStatus,
    *,
    at: datetime | None = None,
) -> None:
    """Set production start/finish timestamps from lifecycle transitions (idempotent)."""
    now = at or utc_now()
    if new_status == JobStatus.RUNNING and job.production_started_at is None:
        job.production_started_at = now
    if new_status == JobStatus.DISPATCHED and job.production_finished_at is None:
        job.production_finished_at = now
    if new_status == JobStatus.CANCELLED:
        if job.production_started_at is not None and job.production_finished_at is None:
            job.production_finished_at = now
    # If reverting from a terminal state (manual edit), avoid clearing timestamps — keep audit trail.
