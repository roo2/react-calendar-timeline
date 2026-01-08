from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.engine import Result
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.db.models.enums import InventoryCategory, OperationType, RunStatus, JobStatus
from app.dashboard.schemas import DashboardWindow, InventorySnapshot, ThroughputWeekly


_TTL_SECONDS = 60


@dataclass
class _CacheEntry:
    value: Any
    expires_at: float


class _TTLCache:
    def __init__(self):
        self._store: Dict[Tuple[str, Tuple[Any, ...]], _CacheEntry] = {}

    def get(self, key: Tuple[str, Tuple[Any, ...]]) -> Optional[Any]:
        entry = self._store.get(key)
        now = datetime.now(tz=timezone.utc).timestamp()
        if entry and entry.expires_at > now:
            return entry.value
        if entry:
            self._store.pop(key, None)
        return None

    def set(self, key: Tuple[str, Tuple[Any, ...]], value: Any, ttl: int = _TTL_SECONDS) -> None:
        expires_at = datetime.now(tz=timezone.utc).timestamp() + ttl
        self._store[key] = _CacheEntry(value=value, expires_at=expires_at)


_cache = _TTLCache()


def _iso_week_to_dates(iso_week: str) -> DashboardWindow:
    """
    Parse 'YYYY-Www' to a [start_date, end_date) window where start is Monday.
    """
    year_str, week_str = iso_week.split("-W")
    year = int(year_str)
    week = int(week_str)
    # ISO week: Monday is 1
    start = date.fromisocalendar(year, week, 1)
    end = start + timedelta(days=7)
    return DashboardWindow(start_date=start, end_date=end)


def _default_this_week() -> DashboardWindow:
    today = datetime.now(tz=timezone.utc).date()
    iso_year, iso_week, _ = today.isocalendar()
    return _iso_week_to_dates(f"{iso_year}-W{iso_week:02d}")


class KPIService:
    @staticmethod
    def get_inventory_snapshot(db: Session) -> InventorySnapshot:
        cache_key = ("inventory_snapshot", tuple())
        cached = _cache.get(cache_key)
        if cached is not None:
            return cached

        raw = Decimal("0")
        wip_ex = Decimal("0")
        wip_pr = Decimal("0")
        fg = Decimal("0")

        # Prefer views if present
        try:
            res_bal: Result = db.execute(text("select category, quantity from v_inventory_balances_by_category"))
            for row in res_bal.mappings():
                cat = str(row["category"])
                qty = Decimal(str(row["quantity"] or 0))
                if cat in (InventoryCategory.RAW_MATERIAL.value, "raw", "raw_material"):
                    raw += qty
                elif cat in (InventoryCategory.WIP_EXTRUDED_ROLL.value, "wip_extrusion", "wip_extruded_roll"):
                    wip_ex += qty
                elif cat in (InventoryCategory.WIP_PRINTED_ROLL.value, "wip_printing", "wip_printed_roll"):
                    wip_pr += qty
                elif cat in (InventoryCategory.FINISHED_GOODS.value, "finished_goods", "fg_units"):
                    fg += qty
        except Exception:
            # Fallback: derive from inventory_transactions ledger
            res_fallback: Result = db.execute(
                text(
                    """
                    select category, sum(quantity) as qty
                    from inventory_transactions
                    group by category
                    """
                )
            )
            for row in res_fallback.mappings():
                cat = str(row["category"])
                qty = Decimal(str(row["qty"] or 0))
                if cat == InventoryCategory.RAW_MATERIAL.value:
                    raw += qty
                elif cat == InventoryCategory.WIP_EXTRUDED_ROLL.value:
                    wip_ex += qty
                elif cat == InventoryCategory.WIP_PRINTED_ROLL.value:
                    wip_pr += qty
                elif cat == InventoryCategory.FINISHED_GOODS.value:
                    fg += qty

        # Prefer WIP per stage view if present to refine WIP
        try:
            res_wip: Result = db.execute(text("select stage, quantity from v_wip_stage_balances"))
            for row in res_wip.mappings():
                stage = str(row["stage"])
                qty = Decimal(str(row["quantity"] or 0))
                if stage.lower().startswith("extrusion"):
                    wip_ex = qty
                elif stage.lower().startswith("printing"):
                    wip_pr = qty
        except Exception:
            pass

        snapshot = InventorySnapshot(
            raw_kg=raw,
            wip_extrusion_kg=wip_ex,
            wip_printing_kg=wip_pr,
            fg_units=fg,
        )
        _cache.set(cache_key, snapshot)
        return snapshot

    @staticmethod
    def get_weekly_throughput(db: Session, window: DashboardWindow) -> ThroughputWeekly:
        cache_key = ("throughput_weekly", (window.start_date.isoformat(), window.end_date.isoformat()))
        cached = _cache.get(cache_key)
        if cached is not None:
            return cached

        start_iso = datetime.combine(window.start_date, datetime.min.time(), tzinfo=timezone.utc)
        end_iso = datetime.combine(window.end_date, datetime.min.time(), tzinfo=timezone.utc)

        # Outputs by operation type and uom
        # kg_extruded
        kg_extruded = Decimal(
            str(
                db.execute(
                    text(
                        """
                        select coalesce(sum(o.quantity), 0) as total
                        from run_output_entries o
                        join operation_runs r on r.id = o.run_id
                        where r.operation_type = :op
                          and o.uom = 'kg'
                          and o.timestamp >= :start and o.timestamp < :end
                          and o.good_or_scrap = true
                        """
                    ),
                    {"op": OperationType.EXTRUSION.value, "start": start_iso, "end": end_iso},
                ).scalar()
                or 0
            )
        )
        # metres printed: consider both printing types
        m_printed = Decimal(
            str(
                db.execute(
                    text(
                        """
                        select coalesce(sum(o.quantity), 0) as total
                        from run_output_entries o
                        join operation_runs r on r.id = o.run_id
                        where r.operation_type in (:op1, :op2)
                          and o.uom = 'm'
                          and o.timestamp >= :start and o.timestamp < :end
                          and o.good_or_scrap = true
                        """
                    ),
                    {
                        "op1": OperationType.PRINTING_INLINE.value,
                        "op2": OperationType.PRINTING_UTECO.value,
                        "start": start_iso,
                        "end": end_iso,
                    },
                ).scalar()
                or 0
            )
        )
        # units converted: conversion uom units/bags
        units_converted = Decimal(
            str(
                db.execute(
                    text(
                        """
                        select coalesce(sum(o.quantity), 0) as total
                        from run_output_entries o
                        join operation_runs r on r.id = o.run_id
                        where r.operation_type = :op
                          and o.uom in ('units','bags')
                          and o.timestamp >= :start and o.timestamp < :end
                          and o.good_or_scrap = true
                        """
                    ),
                    {"op": OperationType.CONVERSION.value, "start": start_iso, "end": end_iso},
                ).scalar()
                or 0
            )
        )
        # jobs completed: last run completed within window
        jobs_completed = int(
            db.execute(
                text(
                    """
                    select count(distinct j.id) as cnt
                    from jobs j
                    join operation_runs r on r.job_id = j.id
                    where r.status = :completed
                      and r.ended_at is not null
                      and r.ended_at >= :start and r.ended_at < :end
                    """
                ),
                {"completed": RunStatus.COMPLETED.value, "start": start_iso, "end": end_iso},
            ).scalar()
            or 0
        )

        result = ThroughputWeekly(
            kg_extruded=kg_extruded,
            m_printed=m_printed,
            units_converted=units_converted,
            jobs_completed=jobs_completed,
        )
        _cache.set(cache_key, result)
        return result


class DashboardService:
    @staticmethod
    def get_overview(window: Optional[DashboardWindow] = None) -> Dict[str, Any]:
        if window is None:
            window = _default_this_week()
        return {
            "window": window,
            "roles": [],  # caller can augment from identity
        }

    @staticmethod
    def get_card(card: str, window: Optional[DashboardWindow] = None) -> Dict[str, Any]:
        if window is None:
            window = _default_this_week()
        with SessionLocal() as db:
            if card == "inventory_snapshot":
                snapshot = KPIService.get_inventory_snapshot(db)
                return {"card": card, "snapshot": snapshot, "window": window, "refreshed_at": datetime.now(tz=timezone.utc)}
            if card == "throughput_weekly":
                tp = KPIService.get_weekly_throughput(db, window)
                return {"card": card, "throughput": tp, "window": window, "refreshed_at": datetime.now(tz=timezone.utc)}
        raise ValueError(f"Unknown card: {card}")

    @staticmethod
    def resolve_window_from_params(start_week: Optional[str]) -> DashboardWindow:
        if start_week:
            try:
                return _iso_week_to_dates(start_week)
            except Exception:
                return _default_this_week()
        return _default_this_week()


