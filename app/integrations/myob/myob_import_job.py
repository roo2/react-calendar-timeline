"""Background MYOB import pipeline: thread worker + **database** job state for polling and resume.

State is stored in ``myob_import_jobs`` so any worker can serve ``GET /import/jobs/{id}`` and restarts can mark
stale ``running`` jobs. Use ``POST /import/jobs/{id}/resume`` to continue after ``interrupted`` / failed when
earlier steps were already committed.
"""

from __future__ import annotations

import threading
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.domain import MyobImportJob
from app.db.session import SessionLocal
from app.integrations.myob.myob_import_pipeline import run_myob_import_pipeline
from app.integrations.myob.service import MyobApiError, MyobConfigError, MyobOAuthError

_lock = threading.Lock()


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.isoformat()


def _row_to_dict(row: MyobImportJob) -> dict[str, Any]:
    return {
        "job_id": row.id,
        "status": row.status,
        "phase": row.phase,
        "message": row.message,
        "orders_mode": row.orders_mode,
        "orders_top": row.orders_top,
        "orders_skip": row.orders_skip,
        "created_at": _iso(row.created_at) if row.created_at else _iso(datetime.now(UTC)),
        "updated_at": _iso(row.updated_at) if row.updated_at else _iso(datetime.now(UTC)),
        "partial": row.step_partial if isinstance(row.step_partial, dict) else {},
        "result": row.result,
        "error": row.error,
    }


def get_import_job(job_id: str) -> dict[str, Any] | None:
    with SessionLocal() as db:
        row = db.get(MyobImportJob, job_id)
        return _row_to_dict(row) if row else None


def get_running_import_job() -> dict[str, Any] | None:
    with SessionLocal() as db:
        row = db.scalars(
            select(MyobImportJob)
            .where(MyobImportJob.status == "running")
            .order_by(MyobImportJob.updated_at.desc(), MyobImportJob.created_at.desc())
            .limit(1)
        ).first()
        return _row_to_dict(row) if row else None


def _strip_myob_json(customers: Any) -> Any:
    if not isinstance(customers, dict):
        return customers
    return {k: v for k, v in customers.items() if k != "myob_json"}


def _resume_from_partial(partial: Any) -> Literal["item_cache", "orders"] | None:
    """Derive pipeline resume point from persisted per-step results."""
    if not isinstance(partial, dict):
        return None
    if "item_cache" in partial and "customers" in partial:
        return "orders"
    if "customers" in partial:
        return "item_cache"
    return None


def mark_interrupted_jobs_on_startup() -> int:
    """
    Mark in-flight ``running`` jobs as interrupted (process died or deploy) so a new import can start
    and the old job can be **resumed** via ``POST /import/jobs/{id}/resume``.
    """
    with SessionLocal() as db:
        rows = db.scalars(select(MyobImportJob).where(MyobImportJob.status == "running")).all()
        n = 0
        for row in rows:
            row.status = "interrupted"
            row.message = "Import was interrupted (worker or deploy restarted) before completion."
            row.error = "interrupted"
            row.updated_at = datetime.now(UTC)
            n += 1
        if n:
            db.commit()
        return n


def _apply_on_step(
    db: Session,
    job_id: str,
    step: Literal["customers", "item_cache", "orders"],
    detail: dict[str, Any],
) -> None:
    row = db.get(MyobImportJob, job_id)
    if row is None:
        return
    row.phase = step
    row.message = {
        "customers": "Syncing customers from MYOB…",
        "item_cache": "Rebuilding MYOB item UOM cache…",
        "orders": "Importing sale orders…",
    }.get(step, step)
    r = detail.get("result")
    if isinstance(r, dict):
        p = dict(row.step_partial) if isinstance(row.step_partial, dict) else {}
        p[step] = r
        row.step_partial = p
    row.updated_at = datetime.now(UTC)


def _run_job(
    job_id: str,
    orders: Literal["all", "page"],
    orders_top: int,
    orders_skip: int,
    skip_customers: bool,
    skip_item_cache: bool,
    resume_from: Literal["item_cache", "orders"] | None,
) -> None:
    def on_step(step: Literal["customers", "item_cache", "orders"], detail: dict[str, Any]) -> None:
        with SessionLocal() as db:
            _apply_on_step(db, job_id, step, detail)
            db.commit()

    try:
        with SessionLocal() as db:
            out = run_myob_import_pipeline(
                db,
                orders=orders,
                orders_top=orders_top,
                orders_skip=orders_skip,
                skip_customers=skip_customers,
                skip_item_cache=skip_item_cache,
                on_step=on_step,
                resume_from=resume_from,
            )
        with SessionLocal() as db:
            row = db.get(MyobImportJob, job_id)
            if row is not None:
                row.status = "completed"
                row.phase = "done"
                row.message = "Import pipeline finished."
                row.result = {
                    "ok": out["ok"],
                    "orders_mode": out["orders_mode"],
                    "customers": _strip_myob_json(out.get("customers")),
                    "item_cache": out.get("item_cache"),
                    "orders": out.get("orders"),
                }
                row.error = None
                row.updated_at = datetime.now(UTC)
                db.commit()
    except (MyobConfigError, MyobOAuthError, MyobApiError) as e:
        with SessionLocal() as db:
            row = db.get(MyobImportJob, job_id)
            if row is not None:
                row.status = "failed"
                row.message = "Import failed."
                row.error = str(e)
                row.updated_at = datetime.now(UTC)
                db.commit()
    except Exception as e:  # pragma: no cover - defensive
        with SessionLocal() as db:
            row = db.get(MyobImportJob, job_id)
            if row is not None:
                row.status = "failed"
                row.message = "Import failed (unexpected error)."
                row.error = str(e)
                row.updated_at = datetime.now(UTC)
                db.commit()


def start_import_job(
    *,
    orders: Literal["all", "page"],
    orders_top: int,
    orders_skip: int,
    skip_customers: bool = False,
    skip_item_cache: bool = False,
) -> tuple[str | None, dict[str, Any] | None]:
    """Insert a new job row and start a daemon thread (full pipeline)."""
    with _lock:
        with SessionLocal() as db:
            other = db.scalars(select(MyobImportJob).where(MyobImportJob.status == "running").limit(1)).first()
            if other is not None:
                return None, _row_to_dict(other)

        now = datetime.now(UTC)
        job_id = str(uuid.uuid4())
        with SessionLocal() as db:
            row = MyobImportJob(
                id=job_id,
                status="running",
                phase="customers",
                message="Starting import pipeline…",
                orders_mode=orders,
                orders_top=orders_top,
                orders_skip=orders_skip,
                step_partial={},
            )
            row.created_at = now
            row.updated_at = now
            db.add(row)
            db.commit()

    threading.Thread(
        target=_run_job,
        args=(job_id, orders, orders_top, orders_skip, skip_customers, skip_item_cache, None),
        name=f"myob-import-{job_id[:8]}",
        daemon=True,
    ).start()
    return job_id, None


def resume_import_job(job_id: str) -> tuple[str | None, dict[str, Any] | None, str | None]:
    """
    Re-queue a **failed** or **interrupted** job using the same id (poll URL stable).

    Returns ``(job_id, None, None)`` on success, ``(None, conflict_dict, err)`` on conflict, or
    ``(None, None, err)`` for invalid state.
    """
    with _lock:
        with SessionLocal() as db:
            running = db.scalars(select(MyobImportJob).where(MyobImportJob.status == "running").limit(1)).first()
            if running is not None and running.id != job_id:
                return None, _row_to_dict(running), "Another import is already running."

        with SessionLocal() as db:
            row = db.get(MyobImportJob, job_id)
            if row is None:
                return None, None, "Unknown import job id."
            if row.status not in ("failed", "interrupted"):
                return None, _row_to_dict(row), "Only failed or interrupted jobs can be resumed."

            partial = row.step_partial if isinstance(row.step_partial, dict) else {}
            resume: Literal["item_cache", "orders"] | None = _resume_from_partial(partial)
            o_mode: Literal["all", "page"] = row.orders_mode if row.orders_mode in ("all", "page") else "all"  # type: ignore[assignment]
            o_top = int(row.orders_top or 200)
            o_skip = int(row.orders_skip or 0)

            row.status = "running"
            row.phase = "customers"
            row.message = "Resuming import pipeline…" if resume else "Restarting import pipeline…"
            row.error = None
            if resume is None:
                row.step_partial = {}
            row.updated_at = datetime.now(UTC)
            db.commit()

    threading.Thread(
        target=_run_job,
        args=(job_id, o_mode, o_top, o_skip, False, False, resume),
        name=f"myob-import-resume-{job_id[:8]}",
        daemon=True,
    ).start()
    return job_id, None, None
