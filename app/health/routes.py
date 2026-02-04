from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

router = APIRouter()


@router.get("/api/health/ping")
async def ping():
    now = datetime.now(tz=timezone.utc)
    return {"ok": True, "now": now.isoformat()}


