from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List, Tuple

from sqlalchemy import select, text, func, desc, and_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.db.models.domain import InventoryTransaction as InventoryTransactionModel, InventoryItem
from app.db.models.enums import InventoryCategory
from app.inventory.schemas import (
    ReceiveInventoryRequest,
    AdjustInventoryRequest,
    InventorySnapshot,
    InventoryTransactionDTO,
    TransactionFilters,
)


def _as_dto(row: InventoryTransactionModel) -> InventoryTransactionDTO:
    return InventoryTransactionDTO(
        id=row.id,
        category=row.category,
        quantity=Decimal(str(row.quantity)),
        uom=row.uom,
        item_id=row.item_id,
        job_id=row.job_id,
        run_id=row.run_id,
        created_by=row.created_by,
        created_at=str(row.created_at),
        reason=row.reason,
    )


def receive(payload: ReceiveInventoryRequest, created_by: str, db: Session | None = None) -> InventoryTransactionDTO:
    own_session = False
    if db is None:
        db = SessionLocal()
        own_session = True
    try:
        # Validate UOM if item_id provided
        if payload.item_id:
            item = db.get(InventoryItem, payload.item_id)
            if item is None:
                raise ValueError("Invalid item_id")
            if item.category != InventoryCategory.RAW_MATERIAL:
                raise ValueError("Item category must be raw_material")
            if item.uom.lower() != payload.uom.lower():
                raise ValueError("UOM must match item.uom")
        # Create ledger row: receipts are positive
        row = InventoryTransactionModel(
            item_id=payload.item_id,
            category=InventoryCategory(payload.category),
            quantity=Decimal(payload.quantity),
            uom=payload.uom,
            created_by=created_by or "unknown",
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return _as_dto(row)
    finally:
        if own_session:
            db.close()


def adjust(payload: AdjustInventoryRequest, created_by: str, db: Session | None = None) -> InventoryTransactionDTO:
    own_session = False
    if db is None:
        db = SessionLocal()
        own_session = True
    try:
        # Validate UOM if item_id provided
        if payload.item_id:
            item = db.get(InventoryItem, payload.item_id)
            if item is None:
                raise ValueError("Invalid item_id")
            if item.uom.lower() != payload.uom.lower():
                raise ValueError("UOM must match item.uom")
        row = InventoryTransactionModel(
            item_id=payload.item_id,
            category=payload.category,
            quantity=Decimal(payload.quantity),  # signed; negative allowed
            uom=payload.uom,
            reason=payload.note,
            created_by=created_by or "unknown",
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return _as_dto(row)
    finally:
        if own_session:
            db.close()


def get_dashboard(db: Session | None = None) -> InventorySnapshot:
    own_session = False
    if db is None:
        db = SessionLocal()
        own_session = True
    try:
        # Try views first
        raw_kg: Decimal = Decimal("0")
        wip_extrusion_kg: Decimal = Decimal("0")
        wip_printing_kg: Decimal = Decimal("0")
        fg_units: Decimal = Decimal("0")
        try:
            # Single-row WIP balances view
            res = db.execute(text("SELECT wip_extrusion_kg, wip_printing_kg, fg_on_hand_units FROM v_wip_stage_balances"))
            row = res.first()
            if row:
                wip_extrusion_kg = Decimal(str(row[0] or 0))
                wip_printing_kg = Decimal(str(row[1] or 0))
                fg_units = Decimal(str(row[2] or 0))
            # Category balances for raw material
            res2 = db.execute(
                text(
                    "SELECT qty FROM v_inventory_balances_by_category WHERE inventory_category = :cat"
                ),
                {"cat": InventoryCategory.RAW_MATERIAL.value},
            )
            row2 = res2.first()
            if row2:
                raw_kg = Decimal(str(row2[0] or 0))
            else:
                raw_kg = Decimal("0")
        except SQLAlchemyError:
            # Fallback aggregation from ledger
            q = db.execute(
                select(InventoryTransactionModel.category, func.coalesce(func.sum(InventoryTransactionModel.quantity), 0))
                .group_by(InventoryTransactionModel.category)
            )
            sums: Dict[InventoryCategory, Decimal] = {}
            for cat, qty in q:
                sums[InventoryCategory(cat)] = Decimal(str(qty or 0))
            raw_kg = sums.get(InventoryCategory.RAW_MATERIAL, Decimal("0"))
            wip_extrusion_kg = sums.get(InventoryCategory.WIP_EXTRUDED_ROLL, Decimal("0"))
            wip_printing_kg = sums.get(InventoryCategory.WIP_PRINTED_ROLL, Decimal("0"))
            fg_units = sums.get(InventoryCategory.FINISHED_GOODS, Decimal("0"))
        return InventorySnapshot(
            raw_kg=raw_kg,
            wip_extrusion_kg=wip_extrusion_kg,
            wip_printing_kg=wip_printing_kg,
            fg_units=fg_units,
        )
    finally:
        if own_session:
            db.close()


def list_transactions(
    filters: TransactionFilters,
    db: Session | None = None,
) -> Tuple[List[InventoryTransactionDTO], int]:
    own_session = False
    if db is None:
        db = SessionLocal()
        own_session = True
    try:
        stmt = select(InventoryTransactionModel)
        conditions = []
        if filters.category:
            conditions.append(InventoryTransactionModel.category == filters.category)
        if filters.item_id:
            conditions.append(InventoryTransactionModel.item_id == filters.item_id)
        if filters.job_id:
            conditions.append(InventoryTransactionModel.job_id == filters.job_id)
        if filters.run_id:
            conditions.append(InventoryTransactionModel.run_id == filters.run_id)
        if filters.created_from:
            conditions.append(InventoryTransactionModel.created_at >= filters.created_from)
        if filters.created_to:
            conditions.append(InventoryTransactionModel.created_at <= filters.created_to)
        if conditions:
            stmt = stmt.where(and_(*conditions))
        stmt = stmt.order_by(desc(InventoryTransactionModel.created_at))
        # Pagination
        page = max(1, int(filters.page or 1))
        page_size = max(1, min(100, int(filters.page_size or 25)))
        total = db.execute(
            select(func.count()).select_from(stmt.subquery())
        ).scalar_one()
        stmt = stmt.offset((page - 1) * page_size).limit(page_size)
        rows = db.execute(stmt).scalars().all()
        dtos = [_as_dto(r) for r in rows]
        return dtos, int(total)
    finally:
        if own_session:
            db.close()


