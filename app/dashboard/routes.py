from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
from fastapi.templating import Jinja2Templates

from app.auth.deps import require_roles
from app.dashboard.service import DashboardService, KPIService


router = APIRouter(tags=["dashboard"])
templates = Jinja2Templates(directory="app/templates")


@router.get("/dashboard", response_class=HTMLResponse, dependencies=[Depends(require_roles("PROD_MANAGER"))])
async def dashboard_index(request: Request, start: Optional[str] = Query(default=None, description="ISO week e.g. 2026-W01")):
    window = DashboardService.resolve_window_from_params(start)
    ctx = DashboardService.get_overview(window)
    ctx |= {"request": request}
    return templates.TemplateResponse("dashboard/index.html", ctx)


@router.get(
    "/dashboard/partial/{card}",
    response_class=HTMLResponse,
    dependencies=[Depends(require_roles("PROD_MANAGER"))],
)
async def dashboard_card_partial(
    request: Request,
    card: str,
    start: Optional[str] = Query(default=None, description="ISO week e.g. 2026-W01"),
):
    window = DashboardService.resolve_window_from_params(start)
    ctx = DashboardService.get_card(card, window)
    ctx |= {"request": request}
    if card == "inventory_snapshot":
        return templates.TemplateResponse("dashboard/_card_inventory_snapshot.html", ctx)
    if card == "throughput_weekly":
        return templates.TemplateResponse("dashboard/_card_throughput_weekly.html", ctx)
    return PlainTextResponse("Unknown card", status_code=404)


@router.get(
    "/reports/kpi/weekly",
    response_class=JSONResponse,
    dependencies=[Depends(require_roles("PROD_MANAGER"))],
)
async def kpi_weekly_report(
    start: Optional[str] = Query(default=None, description="ISO week e.g. 2026-W01"),
    weeks: int = Query(default=1, ge=1, le=8),
    format: Optional[str] = Query(default="json", pattern="^(json|csv)$"),
):
    """
    Returns weekly throughput KPIs for the requested window(s).
    For MVP: returns only the single requested start week (weeks ignored) to support the two initial cards.
    """
    window = DashboardService.resolve_window_from_params(start)
    # Use a short-lived session through service call
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        tp = KPIService.get_weekly_throughput(db, window)
    data = {
        "window": {"start_date": window.start_date.isoformat(), "end_date": window.end_date.isoformat()},
        "throughput": {
            "kg_extruded": str(tp.kg_extruded),
            "m_printed": str(tp.m_printed),
            "units_converted": str(tp.units_converted),
            "jobs_completed": tp.jobs_completed,
        },
        "generated_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    if format == "csv":
        # Minimal CSV
        csv_lines = [
            "start_date,end_date,kg_extruded,m_printed,units_converted,jobs_completed",
            f"{window.start_date.isoformat()},{window.end_date.isoformat()},{tp.kg_extruded},{tp.m_printed},{tp.units_converted},{tp.jobs_completed}",
        ]
        return PlainTextResponse("\n".join(csv_lines), media_type="text/csv")
    return JSONResponse(data)


