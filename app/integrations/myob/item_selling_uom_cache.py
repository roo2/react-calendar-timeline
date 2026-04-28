"""
Local cache of MYOB ``Inventory/Item`` UID → ``SellingDetails.SellingUnitOfMeasure``.

Rebuild pulls all items via OData list + ``NextPageLink``. Order import reads the cache first
and only GETs a single item when the UID is not yet cached (then upserts the row).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db.models.domain import MyobIncomeAccount, MyobItemSellingUom
from app.integrations.myob.income_account_sync import sync_income_account_from_item_json
from app.integrations.myob.item_import_fixups import normalize_myob_item_json_for_order_import
from app.integrations.myob.service import (
    MYOB_ACCOUNTRIGHT_BASE,
    MyobConfigError,
    _myob_get_json,
    ensure_myob_access_token_for_api,
    effective_company_file_id,
)

MYOB_INVENTORY_ITEM_LIST_MAX_TOP = 1000
MYOB_INVENTORY_ITEM_FETCH_MAX_PAGES = 5000


def _uom_string_from_item_json(item_json: dict[str, Any]) -> str | None:
    sd = item_json.get("SellingDetails")
    if not isinstance(sd, dict):
        return None
    v = sd.get("SellingUnitOfMeasure")
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None


def _bool_root(item_json: dict[str, Any], key: str) -> bool | None:
    if not isinstance(item_json, dict):
        return None
    v = item_json.get(key)
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    s = str(v).strip().lower()
    if s in ("true", "1", "yes", "t", "y"):
        return True
    if s in ("false", "0", "no", "f", "n"):
        return False
    return None


def is_bought_from_item_json(item_json: dict[str, Any] | None) -> bool | None:
    """
    Best-effort parse of MYOB ``Inventory/Item`` root ``IsBought``.

    If missing or unrecognised, return ``None`` (caller may fall back to further IO).
    """
    return _bool_root(item_json, "IsBought") if isinstance(item_json, dict) else None


def is_sold_from_item_json(item_json: dict[str, Any] | None) -> bool | None:
    """Parse MYOB ``Inventory/Item`` root ``IsSold``."""
    return _bool_root(item_json, "IsSold") if isinstance(item_json, dict) else None


def is_inventoried_from_item_json(item_json: dict[str, Any] | None) -> bool | None:
    """Parse MYOB ``Inventory/Item`` root ``IsInventoried``."""
    return _bool_root(item_json, "IsInventoried") if isinstance(item_json, dict) else None


def get_cached_item_json_for_mapping(db: Session, *, item_uid: str) -> dict[str, Any] | None:
    """
    If a cache row exists for ``item_uid``, return a minimal item-shaped dict for
    :func:`map_myob_item_to_app_quantity`. Returns ``None`` if there is no row (caller may GET).
    """
    uid = str(item_uid or "").strip()
    if not uid:
        return None
    row = db.get(MyobItemSellingUom, uid)
    if row is None:
        return None
    u = row.selling_unit_of_measure
    out: dict[str, Any] = {}
    if u is not None and str(u).strip():
        out["SellingDetails"] = {"SellingUnitOfMeasure": str(u).strip()}
    else:
        out["SellingDetails"] = {}
    if row.is_bought is not None:
        out["IsBought"] = bool(row.is_bought)
    if getattr(row, "is_sold", None) is not None:
        out["IsSold"] = bool(row.is_sold)
    if getattr(row, "is_inventoried", None) is not None:
        out["IsInventoried"] = bool(row.is_inventoried)
    if getattr(row, "myob_income_account_uid", None):
        inc_uid = str(row.myob_income_account_uid)
        inc_obj: dict[str, Any] = {"UID": inc_uid}
        acc = db.get(MyobIncomeAccount, inc_uid)
        if acc is not None:
            disp = getattr(acc, "display_id", None)
            if disp is not None and str(disp).strip():
                inc_obj["DisplayID"] = str(disp).strip()
        out["IncomeAccount"] = inc_obj
    out = normalize_myob_item_json_for_order_import(out, item_uid=uid)
    return out


def upsert_uom_from_item_json(db: Session, *, item_uid: str, item_json: dict[str, Any]) -> None:
    """Upsert ``SellingUnitOfMeasure`` extracted from a full ``Inventory/Item`` GET response."""
    uid = str(item_uid or "").strip()
    if not uid:
        return
    item_json = normalize_myob_item_json_for_order_import(item_json, item_uid=uid)
    uom = _uom_string_from_item_json(item_json)
    bought = is_bought_from_item_json(item_json)
    sold = is_sold_from_item_json(item_json)
    inv = is_inventoried_from_item_json(item_json)
    inc_uid = sync_income_account_from_item_json(db, item_json)
    row = db.get(MyobItemSellingUom, uid)
    if row is None:
        db.add(
            MyobItemSellingUom(
                myob_item_uid=uid,
                selling_unit_of_measure=uom,
                is_bought=bought,
                is_sold=sold,
                is_inventoried=inv,
                myob_income_account_uid=inc_uid,
            )
        )
    else:
        row.selling_unit_of_measure = uom
        if bought is not None:
            row.is_bought = bought
        if sold is not None:
            row.is_sold = sold
        if inv is not None:
            row.is_inventoried = inv
        row.myob_income_account_uid = inc_uid
    db.flush()


def rebuild_myob_item_selling_uom_cache(db: Session) -> dict[str, Any]:
    """
    Replace the entire cache by paging ``GET …/Inventory/Item`` (OData ``$top`` / ``NextPageLink``).

    Uses HTTP GET only against MYOB. Run inside a transaction (e.g. ``SessionLocal.begin()``) so the
    caller commits or rolls back the delete + inserts together.
    """
    access = ensure_myob_access_token_for_api(db)
    business_id, _ = effective_company_file_id(db)
    business_id = (business_id or "").strip()
    if not business_id:
        raise MyobConfigError("MYOB company file id is missing.")

    db.execute(delete(MyobItemSellingUom))
    db.flush()

    inserted = 0
    pages = 0
    truncated = False
    url: str | None = f"{MYOB_ACCOUNTRIGHT_BASE}/{business_id}/Inventory/Item?$top={MYOB_INVENTORY_ITEM_LIST_MAX_TOP}"

    while url is not None:
        if pages >= MYOB_INVENTORY_ITEM_FETCH_MAX_PAGES:
            truncated = True
            break
        data = _myob_get_json(url=url, access_token=access)
        pages += 1
        items = data.get("Items")
        batch: list[MyobItemSellingUom] = []
        if isinstance(items, list):
            for obj in items:
                if not isinstance(obj, dict):
                    continue
                uid = str(obj.get("UID") or "").strip()
                if not uid:
                    continue
                obj_norm = (
                    normalize_myob_item_json_for_order_import(obj, item_uid=uid)
                    if isinstance(obj, dict)
                    else obj
                )
                uom = _uom_string_from_item_json(obj_norm) if isinstance(obj_norm, dict) else None
                bought = is_bought_from_item_json(obj_norm) if isinstance(obj_norm, dict) else None
                sold = is_sold_from_item_json(obj_norm) if isinstance(obj_norm, dict) else None
                inv = is_inventoried_from_item_json(obj_norm) if isinstance(obj_norm, dict) else None
                inc_uid = sync_income_account_from_item_json(db, obj_norm)
                batch.append(
                    MyobItemSellingUom(
                        myob_item_uid=uid,
                        selling_unit_of_measure=uom,
                        is_bought=bought,
                        is_sold=sold,
                        is_inventoried=inv,
                        myob_income_account_uid=inc_uid,
                    )
                )
        if batch:
            db.add_all(batch)
            inserted += len(batch)
            db.flush()
        nxt = data.get("NextPageLink")
        url = nxt if isinstance(nxt, str) and nxt.strip() else None

    return {
        "ok": True,
        "rows_inserted": inserted,
        "pages_fetched": pages,
        "truncated": truncated,
    }


def item_selling_uom_summary(db: Session) -> dict[str, Any]:
    """Row count and counts grouped by ``selling_unit_of_measure`` (including null bucket)."""
    total = int(db.scalar(select(func.count()).select_from(MyobItemSellingUom)) or 0)
    rows = db.execute(
        select(MyobItemSellingUom.selling_unit_of_measure, func.count())
        .group_by(MyobItemSellingUom.selling_unit_of_measure)
        .order_by(func.count().desc())
    ).all()
    by_uom: list[dict[str, Any]] = []
    for v, c in rows:
        key = v if v is not None and str(v).strip() else None
        by_uom.append({"selling_unit_of_measure": key, "count": int(c)})
    is_bought_rows = (
        db.execute(
            select(MyobItemSellingUom.is_bought, func.count())
            .group_by(MyobItemSellingUom.is_bought)
            .order_by(func.count().desc())
        )
        .all()
    )
    by_bought: list[dict[str, Any]] = []
    for b, c in is_bought_rows:
        if b is True:
            key: bool | str = True
        elif b is False:
            key = False
        else:
            key = "null"
        by_bought.append({"is_bought": key, "count": int(c)})
    return {
        "row_count": total,
        "by_selling_unit_of_measure": by_uom,
        "by_is_bought": by_bought,
    }
