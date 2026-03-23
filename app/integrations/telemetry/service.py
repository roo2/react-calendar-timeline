from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple
import logging

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.db.models.domain import (
    OperationRun,
    ProductVersion,
    QCCheck,
    QCReading,
    Sensor,
    TelemetryEvent as TelemetryEventModel,
)
from app.job_context import resolve_job_context
from app.db.models.enums import QCCheckResult, QCSource, RunStatus
from app.exceptions import DomainError


logger = logging.getLogger(__name__)

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(ts: Optional[str]) -> datetime:
    if not ts:
        return _now()
    try:
        # FastAPI/Pydantic commonly uses ISO8601 with 'Z'
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return _now()


def _get_product_version_for_run(session: Session, run: OperationRun) -> Optional[ProductVersion]:
    _, _, pv = resolve_job_context(session, run.job_id)
    return pv


def _evaluate_against_acceptance(
    product_version: Optional[ProductVersion],
    check_type: str,
    value: Any,
) -> QCCheckResult:
    spec = (product_version.spec_payload if product_version else {}) or {}
    expectations = (spec.get("quality_expectations") or {}).get("checks") or {}
    cfg = expectations.get(check_type) or {}

    # Numeric bounds support: {"min": 20, "max": 30}
    num: Optional[float] = None
    if isinstance(value, (int, float)):
        num = float(value)
    elif isinstance(value, dict):
        for k in ("value", "raw", "avg", "mean"):
            if k in value and isinstance(value[k], (int, float)):
                num = float(value[k])
                break

    if "equals" in cfg and value is not None:
        return QCCheckResult.PASS_ if value == cfg.get("equals") else QCCheckResult.FAIL

    min_v = cfg.get("min")
    max_v = cfg.get("max")
    if num is None and (min_v is not None or max_v is not None):
        return QCCheckResult.NA
    if num is None:
        return QCCheckResult.PASS_ if cfg else QCCheckResult.NA

    if min_v is not None and num < float(min_v):
        return QCCheckResult.FAIL
    if max_v is not None and num > float(max_v):
        return QCCheckResult.FAIL
    return QCCheckResult.PASS_


def _find_active_run(session: Session, machine_id: uuid.UUID, at_ts: datetime) -> Optional[OperationRun]:
    """Runs are keyed by extruder_code / Uteco / bagging ids, not legacy `machines.id`."""
    del machine_id, at_ts, session
    return None


def ingest(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Minimal ingestion for MVP:
      - Validate sensor exists and is active
      - Resolve machine_id from sensor if not provided
      - Persist TelemetryEvent with idempotency guard
      - Correlate to active OperationRun
      - Evaluate QC result against ProductVersion spec
      - Create QCReading (append-only) and, if PASS, create a linked QCCheck (required=True, source=SENSOR)
    Expected payload shape (flexible):
      {
        "sensor_id": "...",            # UUID string
        "machine_id": "...",           # optional, UUID string
        "recorded_at": "iso8601",      # optional
        "check_type": "thickness_um",  # required for correlation
        "value": 25.3,                 # or {"value": 25.3, "unit": "um"}
        "idempotency_key": "uniq-123"  # required
      }
    """
    sensor_id = payload.get("sensor_id")
    if not sensor_id:
        raise DomainError("sensor_id is required")
    idemp = payload.get("idempotency_key")
    if not idemp:
        raise DomainError("idempotency_key is required")
    check_type = payload.get("check_type")
    if not check_type:
        raise DomainError("check_type is required")

    recorded_at = _parse_dt(payload.get("recorded_at"))

    with SessionLocal.begin() as session:
        sensor: Optional[Sensor] = session.get(Sensor, uuid.UUID(sensor_id))
        if not sensor or not sensor.active:
            raise DomainError("Sensor not found or inactive")
        machine_id = uuid.UUID(payload.get("machine_id") or str(sensor.machine_id))

        # Idempotency guard
        existing_event = session.execute(
            select(TelemetryEventModel).where(TelemetryEventModel.idempotency_key == idemp)
        ).scalars().first()
        if existing_event:
            return {"status": "duplicate", "event_id": str(existing_event.id)}

        # Persist raw telemetry event
        event = TelemetryEventModel(
            sensor_id=sensor.id,
            machine_id=machine_id,
            recorded_at=recorded_at,
            value={"raw": payload.get("value")},
            quality_flag=None,
            idempotency_key=idemp,
        )
        session.add(event)
        session.flush()

        # Find active run
        run = _find_active_run(session, machine_id, recorded_at)
        if not run:
            # buffer-only behavior for MVP: no run, no QC reading
            logger.info("TelemetryIngested(no_active_run) event_id=%s machine_id=%s", event.id, machine_id)
            return {"status": "no_active_run", "event_id": str(event.id)}

        # Evaluate
        product_version = _get_product_version_for_run(session, run)
        result = _evaluate_against_acceptance(product_version, str(check_type), payload.get("value"))

        # Create QCReading append-only
        reading = QCReading(
            operation_run_id=run.id,
            sensor_id=sensor.id,
            check_type=str(check_type),
            value={"raw": payload.get("value")},
            result=result,
            recorded_at=recorded_at,
            source=QCSource.SENSOR,
        )
        session.add(reading)
        session.flush()
        logger.info(
            "QCReadingCreated reading_id=%s run_id=%s check_type=%s result=%s",
            reading.id,
            run.id,
            check_type,
            result.value,
        )

        # If this satisfies a required check, create a linked QCCheck entry (append-only)
        if result == QCCheckResult.PASS_:
            session.add(
                QCCheck(
                    operation_run_id=run.id,
                    check_type=str(check_type),
                    required=True,
                    result=QCCheckResult.PASS_,
                    numeric_values={"raw": payload.get("value")},
                    measured_by="sensor",
                    source=QCSource.SENSOR,
                    reading_ref=reading.id,
                )
            )

        return {"status": "ok", "event_id": str(event.id), "reading_id": str(reading.id), "result": result.value}


