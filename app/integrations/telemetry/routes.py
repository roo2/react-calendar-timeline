from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.auth.deps import csrf_protect
from app.integrations.telemetry import service as TelemetryService

router = APIRouter(prefix="/integrations/telemetry", tags=["telemetry"])


@router.post("/ingest", dependencies=[Depends(csrf_protect())])
async def ingest(request: Request):
    payload = await request.json()
    result = TelemetryService.ingest(payload)
    return JSONResponse(content=result)


