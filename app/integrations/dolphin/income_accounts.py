"""Upsert :class:`MyobIncomeAccount` rows from Dolphin TSV (account code as ``display_id``)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.domain import MyobIncomeAccount

DOLPHIN_BRAND = "dolphin"


def _dolphin_synthetic_income_id(display_id: str) -> str:
    """Stable id for Dolphin-sourced GL rows (no MYOB ``IncomeAccount.UID``)."""
    s = f"crownpack:dolphin-income:{(display_id or '').strip()}"
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, s))


def upsert_dolphin_income_account(
    db: Session,
    *,
    account_code: str,
    account_name: str | None,
) -> str | None:
    """
    Upsert by **display_id** + **brand_source=dolphin** (Dolphin / ``Account Code`` column).
    Set ``name`` from the ``Account`` / account name column. ``myob_account_uid`` is always None.

    Returns the local :attr:`MyobIncomeAccount.id` to store on line JSON, or None if no code.
    """
    disp = (account_code or "").strip()[:64]
    if not disp:
        return None
    name = (account_name or "").strip() or None
    now = datetime.now(UTC)

    row = db.scalar(
        select(MyobIncomeAccount).where(
            MyobIncomeAccount.display_id == disp,
            MyobIncomeAccount.brand_source == DOLPHIN_BRAND,
        )
    )
    if row is not None:
        if name is not None:
            row.name = name
        row.brand_source = DOLPHIN_BRAND
        row.myob_account_uid = None
        row.synced_at = now
        db.add(row)
        db.flush()
        return str(row.id)

    iid = _dolphin_synthetic_income_id(disp)
    existing = db.get(MyobIncomeAccount, iid)
    if existing is not None:
        if name is not None:
            existing.name = name
        if existing.display_id != disp:
            existing.display_id = disp
        existing.brand_source = DOLPHIN_BRAND
        existing.myob_account_uid = None
        existing.synced_at = now
        db.add(existing)
        db.flush()
        return str(existing.id)

    db.add(
        MyobIncomeAccount(
            id=iid,
            myob_account_uid=None,
            brand_source=DOLPHIN_BRAND,
            name=name,
            display_id=disp,
            synced_at=now,
        )
    )
    db.flush()
    return iid
