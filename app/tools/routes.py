"""Admin CRUD for physical tools (scheduling pool)."""

from __future__ import annotations

import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.auth.deps import csrf_protect, require_roles
from app.db.models.domain import Tool, ToolType
from app.db.session import SessionLocal

router = APIRouter(prefix="/api/admin/tools", tags=["admin_tools"])


class ToolTypeDTO(BaseModel):
    id: str
    code: str
    name: str
    unique_per_machine: bool = False


class ToolDTO(BaseModel):
    id: str
    tool_type_id: str
    tool_type_code: str = ""
    serial_code: str
    active: bool = True
    notes: Optional[str] = None


class ToolCreateRequest(BaseModel):
    tool_type_id: str
    serial_code: str = Field(..., min_length=1, max_length=64)
    active: bool = True
    notes: Optional[str] = None


class ToolUpdateRequest(BaseModel):
    serial_code: Optional[str] = Field(default=None, min_length=1, max_length=64)
    active: Optional[bool] = None
    notes: Optional[str] = None


def _tool_to_dto(session, t: Tool) -> ToolDTO:
    tt = session.get(ToolType, str(t.tool_type_id))
    return ToolDTO(
        id=str(t.id),
        tool_type_id=str(t.tool_type_id),
        tool_type_code=tt.code if tt else "",
        serial_code=t.serial_code,
        active=bool(t.active),
        notes=t.notes,
    )


@router.get(
    "/bootstrap",
    dependencies=[Depends(require_roles("SYS_ADMIN"))],
)
def tools_bootstrap():
    with SessionLocal() as session:
        types = list(session.execute(select(ToolType).order_by(ToolType.code.asc())).scalars().all())
        tools = list(session.execute(select(Tool).order_by(Tool.serial_code.asc())).scalars().all())
        return {
            "tool_types": [
                ToolTypeDTO(
                    id=str(x.id),
                    code=x.code,
                    name=x.name,
                    unique_per_machine=bool(x.unique_per_machine),
                )
                for x in types
            ],
            "tools": [_tool_to_dto(session, t) for t in tools],
        }


@router.post(
    "",
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
def create_tool(payload: ToolCreateRequest):
    try:
        tid = str(uuid.UUID(payload.tool_type_id))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid tool_type_id")
    with SessionLocal.begin() as session:
        tt = session.get(ToolType, tid)
        if not tt:
            raise HTTPException(status_code=400, detail="Tool type not found")
        t = Tool(
            id=str(uuid.uuid4()),
            tool_type_id=tid,
            serial_code=payload.serial_code.strip(),
            active=payload.active,
            notes=payload.notes,
        )
        session.add(t)
        try:
            session.flush()
        except IntegrityError as e:
            raise HTTPException(status_code=400, detail="Serial code must be unique") from e
        return {"ok": True, "tool": _tool_to_dto(session, t)}


@router.put(
    "/{tool_id}",
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
def update_tool(tool_id: str, payload: ToolUpdateRequest):
    with SessionLocal.begin() as session:
        t = session.get(Tool, tool_id)
        if not t:
            raise HTTPException(status_code=404, detail="Tool not found")
        if payload.serial_code is not None:
            t.serial_code = payload.serial_code.strip()
        if payload.active is not None:
            t.active = payload.active
        if payload.notes is not None:
            t.notes = payload.notes
        try:
            session.flush()
        except IntegrityError as e:
            raise HTTPException(status_code=400, detail="Serial code must be unique") from e
        return {"ok": True, "tool": _tool_to_dto(session, t)}


@router.delete(
    "/{tool_id}",
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
def delete_tool(tool_id: str):
    """Soft-delete: mark inactive (keeps history / FK integrity)."""
    with SessionLocal.begin() as session:
        t = session.get(Tool, tool_id)
        if not t:
            raise HTTPException(status_code=404, detail="Tool not found")
        t.active = False
        return {"ok": True}
