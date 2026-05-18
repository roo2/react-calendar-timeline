from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

UTC = timezone.utc


def datetime_to_api_iso(value: Any) -> str:
    """Serialize a datetime for JSON APIs as UTC ISO-8601 (``…Z`` when offset is +00:00)."""
    if value is None:
        return ""
    if not isinstance(value, datetime):
        return str(value)
    dt = value
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    else:
        dt = dt.astimezone(UTC)
    return dt.isoformat().replace("+00:00", "Z")
