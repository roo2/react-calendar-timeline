from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional, Literal, Dict, Any

from pydantic import BaseModel, Field, validator

from app.db.models.enums import DispatchStatus


class JobDispatchListItem(BaseModel):
    job_id: uuid.UUID
    job_code: int
    order_id: uuid.UUID
    order_code: str
    customer_name: str
    product_code: Optional[str] = None
    product_name: Optional[str] = None
    status: str
    qc_status: Optional[str] = None
    produced_summary: Dict[str, Decimal] = Field(default_factory=dict)  # e.g., {"good_units": 12000}
    packaging_req: Dict[str, Any] = Field(default_factory=dict)  # from ProductVersion (pack mode, pallet, wrap)


class DispatchDetailDTO(BaseModel):
    job_id: uuid.UUID
    job_code: int
    order_id: uuid.UUID
    order_code: str
    customer_name: str
    product_code: Optional[str] = None
    product_name: Optional[str] = None
    qc_status: Optional[str] = None
    final_checklist: Dict[str, Any] = Field(default_factory=dict)
    produced_summary: Dict[str, Decimal] = Field(default_factory=dict)
    packaging_req: Dict[str, Any] = Field(default_factory=dict)
    dispatch_status: DispatchStatus = DispatchStatus.PENDING
    dispatch_record_id: Optional[uuid.UUID] = None
    packaging_confirmation: Dict[str, Any] = Field(default_factory=dict)
    dispatch_metadata: Dict[str, Any] = Field(default_factory=dict)
    # Preconditions and actions
    preconditions: Dict[str, bool] = Field(default_factory=dict)  # runs_completed, qc_finalized, has_outputs, packaging_known
    can_mark_ready: bool = False
    can_confirm: bool = False
    # KPI timing
    first_run_started_at: Optional[datetime] = None
    last_run_completed_at: Optional[datetime] = None
    dispatched_at: Optional[datetime] = None
    kpi_durations: Dict[str, str] = Field(default_factory=dict)  # job_flow_time, run_to_dispatch


class MarkReadyRequest(BaseModel):
    cartons_count: int = Field(ge=0, default=0)
    pallets_count: int = Field(ge=0, default=0)
    pallet_type: Optional[str] = None
    wrapped: bool = False
    notes: Optional[str] = None


class ConfirmDispatchRequest(BaseModel):
    dispatch_date: Optional[datetime] = None
    carrier: Optional[str] = None
    delivery_ref: Optional[str] = None


class DispatchRecordDTO(BaseModel):
    id: uuid.UUID
    job_id: uuid.UUID
    order_id: uuid.UUID
    status: DispatchStatus
    packaging: Dict[str, Any]
    metadata: Dict[str, Any]
    first_run_started_at: Optional[datetime] = None
    last_run_completed_at: Optional[datetime] = None
    dispatched_at: Optional[datetime] = None


__all__ = [
    "JobDispatchListItem",
    "DispatchDetailDTO",
    "MarkReadyRequest",
    "ConfirmDispatchRequest",
    "DispatchRecordDTO",
]


