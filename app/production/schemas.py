from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class StartRunRequest(BaseModel):
    job_id: uuid.UUID
    machine_id: str  # lane id: extruder_code or Uteco/bagger UUID
    operation_type: str


class OutputEntryRequest(BaseModel):
    run_id: uuid.UUID
    quantity: Decimal
    uom: str
    good_or_scrap: bool
    finished_goods: Optional[bool] = Field(default=None)
    note: Optional[str] = None


class QCEntryRequest(BaseModel):
    run_id: uuid.UUID
    check_type: str
    required: bool = True
    result: str  # 'pass' | 'fail' | 'na'
    values: Optional[Dict[str, Any]] = None


class TotalsDTO(BaseModel):
    run_totals: Dict[str, Decimal]
    job_totals: Dict[str, Decimal]


class ChecklistItem(BaseModel):
    check_type: str
    satisfied: bool
    source: Optional[str] = None  # manual | sensor | None


class ChecklistDTO(BaseModel):
    required: list[ChecklistItem]
    outstanding_count: int


__all__ = [
    "StartRunRequest",
    "OutputEntryRequest",
    "QCEntryRequest",
    "TotalsDTO",
    "ChecklistDTO",
    "ChecklistItem",
]


