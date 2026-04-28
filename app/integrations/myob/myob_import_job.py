"""Background MYOB import pipeline job (thread + in-memory status for polling).

Job state lives in process memory: suitable for a single worker (typical dev / small deploy). With multiple
Gunicorn/Uvicorn workers, poll the same worker that accepted ``POST …/import/pipeline/start`` or use sticky sessions.
"""

from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

from app.db.session import SessionLocal
from app.integrations.myob.myob_import_pipeline import run_myob_import_pipeline
from app.integrations.myob.service import MyobApiError, MyobConfigError, MyobOAuthError

_jobs: dict[str, "ImportJobRecord"] = {}
_lock = threading.Lock()
_active_job_id: str | None = None


@dataclass
class ImportJobRecord:
    job_id: str
    status: Literal["running", "completed", "failed"]
    phase: Literal["customers", "item_cache", "orders", "done"]
    message: str
    orders_mode: Literal["all", "page"]
    orders_top: int
    orders_skip: int
    created_at: datetime
    updated_at: datetime
    partial: dict[str, Any] = field(default_factory=dict)
    result: dict[str, Any] | None = None
    error: str | None = None


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.isoformat()


def _serialize(job: ImportJobRecord) -> dict[str, Any]:
    return {
        "job_id": job.job_id,
        "status": job.status,
        "phase": job.phase,
        "message": job.message,
        "orders_mode": job.orders_mode,
        "orders_top": job.orders_top,
        "orders_skip": job.orders_skip,
        "created_at": _iso(job.created_at),
        "updated_at": _iso(job.updated_at),
        "partial": job.partial,
        "result": job.result,
        "error": job.error,
    }


def get_import_job(job_id: str) -> dict[str, Any] | None:
    with _lock:
        j = _jobs.get(job_id)
        return _serialize(j) if j else None


def _strip_myob_json(customers: Any) -> Any:
    if not isinstance(customers, dict):
        return customers
    return {k: v for k, v in customers.items() if k != "myob_json"}


def _prune_jobs_unlocked(max_completed: int = 40) -> None:
    done = [(jid, j) for jid, j in _jobs.items() if j.status in ("completed", "failed")]
    if len(done) <= max_completed:
        return
    done.sort(key=lambda x: x[1].updated_at)
    for jid, _ in done[: len(done) - max_completed]:
        _jobs.pop(jid, None)


def _run_job(
    job_id: str,
    orders: Literal["all", "page"],
    orders_top: int,
    orders_skip: int,
) -> None:
    global _active_job_id

    def on_step(step: Literal["customers", "item_cache", "orders"], detail: dict[str, Any]) -> None:
        with _lock:
            j = _jobs.get(job_id)
            if j is None:
                return
            j.phase = step
            j.message = {
                "customers": "Syncing customers from MYOB…",
                "item_cache": "Rebuilding MYOB item UOM cache…",
                "orders": "Importing sale orders…",
            }.get(step, step)
            r = detail.get("result")
            if isinstance(r, dict):
                j.partial[step] = r
            j.updated_at = datetime.now(UTC)

    try:
        with SessionLocal() as db:
            out = run_myob_import_pipeline(
                db,
                orders=orders,
                orders_top=orders_top,
                orders_skip=orders_skip,
                on_step=on_step,
            )
        with _lock:
            j = _jobs.get(job_id)
            if j is not None:
                j.status = "completed"
                j.phase = "done"
                j.message = "Import pipeline finished."
                j.result = {
                    "ok": out["ok"],
                    "orders_mode": out["orders_mode"],
                    "customers": _strip_myob_json(out.get("customers")),
                    "item_cache": out.get("item_cache"),
                    "orders": out.get("orders"),
                }
                j.updated_at = datetime.now(UTC)
    except (MyobConfigError, MyobOAuthError, MyobApiError) as e:
        with _lock:
            j = _jobs.get(job_id)
            if j is not None:
                j.status = "failed"
                j.message = "Import failed."
                j.error = str(e)
                j.updated_at = datetime.now(UTC)
    except Exception as e:  # pragma: no cover - defensive
        with _lock:
            j = _jobs.get(job_id)
            if j is not None:
                j.status = "failed"
                j.message = "Import failed (unexpected error)."
                j.error = str(e)
                j.updated_at = datetime.now(UTC)
    finally:
        with _lock:
            if _active_job_id == job_id:
                _active_job_id = None
            _prune_jobs_unlocked()


def start_import_job(
    *,
    orders: Literal["all", "page"],
    orders_top: int,
    orders_skip: int,
) -> tuple[str | None, dict[str, Any] | None]:
    """
    Start a background import on a daemon thread.

    Returns ``(job_id, None)`` on success, or ``(None, running_job_payload)`` if another job is already running
    on this process.
    """
    global _active_job_id
    now = datetime.now(UTC)
    with _lock:
        if _active_job_id:
            other = _jobs.get(_active_job_id)
            return None, (_serialize(other) if other else {"job_id": _active_job_id, "error": "Active job not found."})
        job_id = str(uuid.uuid4())
        record = ImportJobRecord(
            job_id=job_id,
            status="running",
            phase="customers",
            message="Starting import pipeline…",
            orders_mode=orders,
            orders_top=orders_top,
            orders_skip=orders_skip,
            created_at=now,
            updated_at=now,
        )
        _jobs[job_id] = record
        _active_job_id = job_id

    threading.Thread(
        target=_run_job,
        args=(job_id, orders, orders_top, orders_skip),
        name=f"myob-import-{job_id[:8]}",
        daemon=True,
    ).start()
    return job_id, None
