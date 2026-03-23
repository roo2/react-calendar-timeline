from __future__ import annotations

import uuid
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.auth.deps import csrf_protect, require_roles
from app.db.models.enums import MachineType
from app.exceptions import DomainError
from app.machines import admin_service as MachineAdminService

router = APIRouter(prefix="/api/admin/machines", tags=["admin_machines"])

MachineTypeParam = Literal["extruder", "printer_uteco", "converter_bagger"]


def _parse_type(t: str) -> MachineType:
	try:
		return MachineType(t)
	except ValueError:
		raise HTTPException(status_code=400, detail=f"Invalid machine_type: {t}")


class MachineDTO(BaseModel):
	id: str
	code: str
	machine_type: str
	capability: dict[str, Any] = Field(default_factory=dict)
	active: bool


class MachineCreateRequest(BaseModel):
	code: str = Field(..., min_length=1, max_length=32)
	machine_type: MachineTypeParam
	capability: dict[str, Any] = Field(default_factory=dict)
	active: bool = True


class MachinePatchRequest(BaseModel):
	code: Optional[str] = Field(None, min_length=1, max_length=32)
	capability: Optional[dict[str, Any]] = None
	active: Optional[bool] = None


@router.get("", dependencies=[Depends(require_roles("SYS_ADMIN"))])
async def list_machines(
	machine_type: str = Query(..., description="extruder | printer_uteco | converter_bagger"),
):
	mt = _parse_type(machine_type)
	rows = MachineAdminService.list_machines_by_type(mt, include_inactive=True)
	return [MachineDTO(**row) for row in rows]


@router.post("", dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())])
async def create_machine(payload: MachineCreateRequest):
	mt = _parse_type(payload.machine_type)
	try:
		row = MachineAdminService.create_machine(payload.code, mt, payload.capability, payload.active)
		return MachineDTO(**row)
	except DomainError as e:
		raise HTTPException(status_code=400, detail=str(e)) from e


@router.patch("/{machine_id}", dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())])
async def patch_machine(machine_id: str, payload: MachinePatchRequest):
	try:
		uid = uuid.UUID(machine_id)
	except ValueError as e:
		raise HTTPException(status_code=400, detail="Invalid machine id") from e
	try:
		row = MachineAdminService.update_machine(
			uid,
			code=payload.code,
			capability=payload.capability,
			active=payload.active,
		)
		return MachineDTO(**row)
	except DomainError as e:
		raise HTTPException(status_code=400, detail=str(e)) from e
