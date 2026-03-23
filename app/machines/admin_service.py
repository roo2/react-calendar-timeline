"""CRUD helpers for production machines (schedule lanes)."""

from __future__ import annotations

import uuid
from typing import Any, List, Optional

from sqlalchemy import select

from app.db.models.domain import (
	BaggingMachine,
	BaggingQueueItem,
	ExtrusionQueueItem,
	Machine,
	UtecoPrinter,
	UtecoQueueItem,
)
from app.db.models.enums import MachineType
from app.db.session import SessionLocal
from app.exceptions import DomainError


def _str_id(value: uuid.UUID | str) -> str:
	return str(value)


def machine_to_dict(m: Machine) -> dict[str, Any]:
	mt = m.type.value if hasattr(m.type, "value") else str(m.type)
	return {
		"id": m.id,
		"code": m.code,
		"machine_type": mt,
		"capability": dict(m.capability or {}),
		"active": bool(m.active),
	}


def list_machines_by_type(machine_type: MachineType, *, include_inactive: bool = True) -> List[dict[str, Any]]:
	with SessionLocal() as session:
		q = select(Machine).where(Machine.type == machine_type)
		if not include_inactive:
			q = q.where(Machine.active.is_(True))
		q = q.order_by(Machine.code.asc())
		rows = list(session.execute(q).scalars().all())
		return [machine_to_dict(m) for m in rows]


def create_machine(code: str, machine_type: MachineType, capability: dict, active: bool = True) -> dict[str, Any]:
	code = (code or "").strip()
	if not code:
		raise DomainError("Machine code is required")
	if len(code) > 32:
		raise DomainError("Machine code too long (max 32)")
	with SessionLocal.begin() as session:
		exists = session.execute(select(Machine.id).where(Machine.code == code)).first()
		if exists:
			raise DomainError(f"Machine code '{code}' already exists")
		m = Machine(
			id=str(uuid.uuid4()),
			code=code,
			type=machine_type,
			capability=dict(capability or {}),
			active=bool(active),
		)
		session.add(m)
		session.flush()
		return machine_to_dict(m)


def update_machine(
	machine_id: uuid.UUID | str,
	*,
	code: Optional[str] = None,
	capability: Optional[dict] = None,
	active: Optional[bool] = None,
) -> dict[str, Any]:
	mid = _str_id(machine_id)
	with SessionLocal.begin() as session:
		m: Machine | None = session.get(Machine, mid)
		if not m:
			raise DomainError("Machine not found")
		if code is not None:
			new_code = code.strip()
			if not new_code:
				raise DomainError("Machine code cannot be empty")
			if len(new_code) > 32:
				raise DomainError("Machine code too long (max 32)")
			if new_code != m.code:
				dup = session.execute(select(Machine.id).where(Machine.code == new_code)).first()
				if dup:
					raise DomainError(f"Machine code '{new_code}' already exists")
				has_queue = None
				if m.type == MachineType.EXTRUDER:
					has_queue = session.execute(
						select(ExtrusionQueueItem.id).where(ExtrusionQueueItem.extruder_code == m.code).limit(1)
					).first()
				elif m.type == MachineType.PRINTER_UTECO:
					has_queue = session.execute(
						select(UtecoQueueItem.id)
						.join(UtecoPrinter, UtecoQueueItem.uteco_printer_id == UtecoPrinter.id)
						.where(UtecoPrinter.code == m.code)
						.limit(1)
					).first()
				elif m.type == MachineType.CONVERTER_BAGGER:
					has_queue = session.execute(
						select(BaggingQueueItem.id)
						.join(BaggingMachine, BaggingQueueItem.bagging_machine_id == BaggingMachine.id)
						.where(BaggingMachine.code == m.code)
						.limit(1)
					).first()
				if has_queue:
					raise DomainError(
						"Cannot change code while the machine has queue history; deactivate and create a new machine instead"
					)
				m.code = new_code
		if capability is not None:
			m.capability = dict(capability)
		if active is not None:
			m.active = bool(active)
		session.flush()
		return machine_to_dict(m)
