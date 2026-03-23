"""Resolve schedule lanes: extrusion = `extruders` rate card; Uteco / bagging = dedicated tables."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.domain import BaggingMachine, UtecoPrinter
from app.db.models.rate_cards import Extruder
from app.exceptions import DomainError

_UUID_RE = re.compile(
	r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I
)


@dataclass
class ScheduleLane:
	"""One schedulable lane (Gantt row / queue)."""

	lane_id: str
	kind: Literal["extrusion", "uteco", "bagging"]
	extruder: Optional[Extruder] = None
	uteco_printer: Optional[UtecoPrinter] = None
	bagging_machine: Optional[BaggingMachine] = None


def resolve_schedule_lane(session: Session, lane_id: str) -> ScheduleLane:
	"""Map API lane id → rate-card extruder or Uteco / bagging row."""
	lid = str(lane_id).strip()
	if not lid:
		raise DomainError("lane id is required")

	# UUID-shaped ids are Uteco printers or baggers (not extruder codes).
	if _UUID_RE.match(lid):
		u = session.get(UtecoPrinter, lid)
		if u is not None:
			if not u.active:
				raise DomainError("Uteco printer is inactive")
			return ScheduleLane(lane_id=lid, kind="uteco", uteco_printer=u)
		b = session.get(BaggingMachine, lid)
		if b is not None:
			if not b.active:
				raise DomainError("Bagging machine is inactive")
			return ScheduleLane(lane_id=lid, kind="bagging", bagging_machine=b)
		raise DomainError("Unknown schedule lane")

	ext = session.get(Extruder, lid)
	if ext is None:
		raise DomainError("Unknown extruder code or lane id")
	return ScheduleLane(lane_id=lid, kind="extrusion", extruder=ext)


def list_active_lanes(session: Session) -> list[ScheduleLane]:
	"""Ordered lanes for Gantt / overview: all extruders (rate card), then Uteco, then baggers."""
	out: list[ScheduleLane] = []
	# Same order as public ratebook (`/rate-cards/ratebook`): decision width ascending, nulls last, then code.
	for ext in session.execute(
		select(Extruder).order_by(
			Extruder.decision_width_mm.asc().nulls_last(),
			Extruder.extruder_code.asc(),
		)
	).scalars().all():
		out.append(ScheduleLane(lane_id=ext.extruder_code, kind="extrusion", extruder=ext))
	for u in session.execute(
		select(UtecoPrinter).where(UtecoPrinter.active.is_(True)).order_by(UtecoPrinter.code.asc())
	).scalars().all():
		out.append(ScheduleLane(lane_id=str(u.id), kind="uteco", uteco_printer=u))
	for b in session.execute(
		select(BaggingMachine).where(BaggingMachine.active.is_(True)).order_by(BaggingMachine.code.asc())
	).scalars().all():
		out.append(ScheduleLane(lane_id=str(b.id), kind="bagging", bagging_machine=b))
	return out
