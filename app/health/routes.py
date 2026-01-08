from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse

templates = Jinja2Templates(directory="app/templates")

router = APIRouter()


@router.get("/partials/ping", response_class=HTMLResponse)
async def ping_partial(request: Request) -> HTMLResponse:
    now = datetime.now(tz=timezone.utc)
    return templates.TemplateResponse(
        "partials/ping.html",
        {"request": request, "now": now},
    )


