from __future__ import annotations

from datetime import date
from decimal import Decimal
from pydantic import BaseModel


class DashboardWindow(BaseModel):
    start_date: date
    end_date: date


class InventorySnapshot(BaseModel):
    raw_kg: Decimal
    wip_extrusion_kg: Decimal
    wip_printing_kg: Decimal
    fg_units: Decimal


class ThroughputWeekly(BaseModel):
    kg_extruded: Decimal
    m_printed: Decimal
    units_converted: Decimal
    jobs_completed: int


