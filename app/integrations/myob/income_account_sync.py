"""Upsert MYOB General Ledger income accounts seen on ``Inventory/Item.IncomeAccount``."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.db.models.domain import MyobIncomeAccount


def parse_income_account_fields(
    item_json: dict[str, Any] | None,
) -> tuple[str | None, str | None, str | None]:
    if not isinstance(item_json, dict):
        return None, None, None
    ia = item_json.get("IncomeAccount")
    if not isinstance(ia, dict):
        return None, None, None
    uid = str(ia.get("UID") or "").strip() or None
    name = str(ia.get("Name") or "").strip() or None
    disp = str(ia.get("DisplayID") or "").strip() or None
    return uid, name, disp


def sync_income_account_from_item_json(db: Session, item_json: dict[str, Any] | None) -> str | None:
    """
    Read ``IncomeAccount`` from a full ``Inventory/Item`` JSON object, upsert ``myob_income_accounts``,
    and return the MYOB account UID (or ``None`` if the payload has no income account).
    """
    uid, name, disp = parse_income_account_fields(item_json)
    if not uid:
        return None
    disp_s = disp[:64] if disp else None
    now = datetime.now(UTC)
    row = db.get(MyobIncomeAccount, uid)
    if row is None:
        db.add(
            MyobIncomeAccount(
                myob_account_uid=uid,
                name=name,
                display_id=disp_s,
                synced_at=now,
            )
        )
    else:
        if name is not None:
            row.name = name
        if disp_s is not None:
            row.display_id = disp_s
        row.synced_at = now
        db.add(row)
    db.flush()
    return uid
