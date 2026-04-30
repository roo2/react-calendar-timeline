"""
One-way import of a MYOB ``Sale/Order`` (GET JSON) into local ``Order`` + ``OrderItem`` rows.

Re-import updates header fields and per-line data while preserving links to ``JobSheet`` rows.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, date, datetime
from typing import Any, Callable, Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models.domain import Customer, JobSheet, Order, OrderItem, ResellProduct
from app.db.models.enums import OrderStatus
from app.integrations.myob.income_account_sync import sync_income_account_from_item_json
from app.integrations.myob.item_selling_uom_cache import (
    get_cached_item_json_for_mapping,
    is_bought_from_item_json,
    upsert_uom_from_item_json,
)
from app.integrations.myob.item_import_fixups import normalize_myob_item_json_for_order_import
from app.integrations.myob.order_import_mapping import map_myob_item_to_app_quantity, myob_resell_catalog_kind
from app.integrations.myob.service import MyobConfigError, fetch_inventory_item_readonly
from app.job_sheets import service as job_sheets_service
from app.str_norm import strip_trailing_dash_suffix


def _dec_str(v: Any) -> str:
    if v is None:
        return ""
    return str(v).replace("\r\n", "\n")


def _parse_date_only(v: Any) -> date | None:
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    if "T" in s:
        s = s.split("T", 1)[0]
    try:
        y, m, d = s.split("-", 2)
        return date(int(y), int(m), int(d))
    except (ValueError, TypeError):
        return None


def _float_or_none(v: Any) -> float | None:
    try:
        if v is None:
            return None
        f = float(v)
        return f if f == f else None
    except (TypeError, ValueError):
        return None


_QTY_EPS = 1e-6


def _myob_transaction_ship_qty_by_item_uid(doc: dict[str, Any]) -> dict[str, float]:
    """Sum ``ShipQuantity`` per ``Item.UID`` on transaction lines (MYOB sale order or item invoice)."""
    lines = doc.get("Lines")
    if not isinstance(lines, list):
        return {}
    out: dict[str, float] = {}
    for line in lines:
        if not isinstance(line, dict):
            continue
        if str(line.get("Type") or "Transaction") not in ("", "Transaction"):
            continue
        it = line.get("Item")
        if not isinstance(it, dict) or not it.get("UID"):
            continue
        uid = str(it.get("UID")).strip()
        if not uid:
            continue
        q = line.get("ShipQuantity")
        try:
            qf = float(q) if q is not None else 0.0
        except (TypeError, ValueError):
            qf = 0.0
        out[uid] = out.get(uid, 0.0) + qf
    return out


def myob_invoice_partial_fulfillment_vs_order(
    myob_order: dict[str, Any],
    invoice: dict[str, Any] | None,
) -> bool:
    """
    True when any order line (by ``Item.UID``) has total invoice ``ShipQuantity`` below the order line total.

    When ``invoice`` is missing, returns False (callers use a separate rule for missing documents).
    """
    if not isinstance(invoice, dict):
        return False
    o_map = _myob_transaction_ship_qty_by_item_uid(myob_order)
    i_map = _myob_transaction_ship_qty_by_item_uid(invoice)
    for uid, oqty in o_map.items():
        if oqty <= _QTY_EPS:
            continue
        iq = i_map.get(uid, 0.0)
        if iq + _QTY_EPS < oqty:
            return True
    return False


def derive_order_status_for_myob_import(
    myob_order: dict[str, Any],
    invoice: dict[str, Any] | None,
) -> OrderStatus:
    """
    Map MYOB sale order ``Status`` (+ optional item invoice) to app :class:`OrderStatus`.

    - ``Open`` (or absent) → ``confirmed`` (order not yet converted to invoice in MYOB).
    - ``ConvertedToInvoice`` + invoice → invoice ``Status`` is authoritative for ``closed``; otherwise
      ``partially_fulfilled`` / ``dispatched`` from line ``ShipQuantity`` reconciliation.
    - ``ConvertedToInvoice`` without a resolvable invoice document → ``dispatched`` (conversion happened; document
      not loaded).
    """
    st = str(myob_order.get("Status") or "").strip().lower()
    if st in ("", "open"):
        return OrderStatus.CONFIRMED
    if st == "convertedtoinvoice":
        if not isinstance(invoice, dict):
            return OrderStatus.DISPATCHED
        inv_st = str(invoice.get("Status") or "").strip().lower()
        if inv_st == "closed":
            return OrderStatus.CLOSED
        if myob_invoice_partial_fulfillment_vs_order(myob_order, invoice):
            return OrderStatus.PARTIALLY_FULFILLED
        return OrderStatus.DISPATCHED
    return OrderStatus.CONFIRMED


def derive_order_status_for_invoice_only(invoice: dict[str, Any]) -> OrderStatus:
    """Map an invoice-only document (no matching sale order) into app order status."""
    inv_st = str(invoice.get("Status") or "").strip().lower()
    if inv_st == "closed":
        return OrderStatus.CLOSED
    return OrderStatus.DISPATCHED


def derive_order_status_for_sale_order_only(myob_order: dict[str, Any]) -> OrderStatus:
    """
    Map sale-order status without consulting invoices.

    With the open-orders pipeline, we only import ``Open`` sale orders from the order list and import invoices
    separately. This keeps order/invoice records independent.
    """
    st = str(myob_order.get("Status") or "").strip().lower()
    if st in ("", "open"):
        return OrderStatus.CONFIRMED
    if st == "convertedtoinvoice":
        return OrderStatus.DISPATCHED
    return OrderStatus.CONFIRMED


def _invoice_match_key(doc: dict[str, Any]) -> tuple[str, str]:
    number = str(doc.get("Number") or "").strip()
    cpo = str(doc.get("CustomerPurchaseOrderNumber") or "").strip()
    return number, cpo


def find_matching_invoice_for_order(
    myob_order: dict[str, Any],
    invoices: list[dict[str, Any]] | None,
) -> dict[str, Any] | None:
    """Match invoice by (Number, CustomerPurchaseOrderNumber)."""
    if not invoices:
        return None
    key = _invoice_match_key(myob_order)
    if not key[0]:
        return None
    for inv in invoices:
        if not isinstance(inv, dict):
            continue
        if _invoice_match_key(inv) == key:
            return inv
    return None


def find_associated_invoices_for_order(
    myob_order: dict[str, Any],
    invoices: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """All invoices that match the order by (Number, CustomerPurchaseOrderNumber)."""
    if not invoices:
        return []
    key = _invoice_match_key(myob_order)
    if not key[0]:
        return []
    out: list[dict[str, Any]] = []
    for inv in invoices:
        if not isinstance(inv, dict):
            continue
        if _invoice_match_key(inv) == key:
            out.append(inv)
    return out


def _is_credit_note_like_order(myob_order: dict[str, Any]) -> bool:
    """
    Skip MYOB credit-note-like sales orders.

    Current rule: if order total is negative or any transaction line has a negative
    unit price / line total, treat it as a credit note and do not import.
    """
    overall_total = _float_or_none(myob_order.get("TotalAmount"))
    if overall_total is not None and overall_total < 0:
        return True
    lines = myob_order.get("Lines")
    if not isinstance(lines, list):
        return False
    for line in lines:
        if not isinstance(line, dict):
            continue
        lt = str(line.get("Type") or "Transaction")
        if lt and lt != "Transaction":
            continue
        up = _float_or_none(line.get("UnitPrice"))
        if up is not None and up < 0:
            return True
        tot = _float_or_none(line.get("Total"))
        if tot is not None and tot < 0:
            return True
    return False


# Pallets, cores, skids, etc.: sold as add-ons / resupply; no in-house production job sheet on import.
_RESUPPLY_ITEM_RE = re.compile(
    r"\b(PALLET|SKID|CORES?|DOLLY|SHIPPING\s+PALLET)\b",
    re.IGNORECASE,
)


def _myob_item_looks_like_resell_supply(*, myob_item: dict | None) -> bool:
    if not myob_item:
        return False
    name = str(myob_item.get("Name") or "")
    num = str(myob_item.get("Number") or "")
    return bool(_RESUPPLY_ITEM_RE.search(f"{name} {num}"))


def _requires_job_sheet_for_line(*, myob_item: dict | None, line: dict) -> bool:
    if not myob_item or not myob_item.get("UID"):
        return False
    name = str(myob_item.get("Name") or "").strip().upper()
    num = str(myob_item.get("Number") or "").strip().upper()
    desc = str(line.get("Description") or "")
    if _myob_item_looks_like_resell_supply(myob_item=myob_item):
        return False
    if num == "PLAIN PALLET" or name == "PLAIN PALLET":
        return False
    if "PALLET" in name and "CHARGE" in (desc or "").upper():
        return False
    return True


def _next_line_index(db: Session, order_id: str) -> int:
    m = db.scalar(select(func.max(OrderItem.line_index)).where(OrderItem.order_id == str(order_id)))
    return int(m if m is not None else -1) + 1


def _delete_draft_import_job_sheet_if_any(db: Session, oi: OrderItem) -> None:
    """Clear order line link, then remove draft placeholder job sheet (RESTRICT FK)."""
    jid = getattr(oi, "job_sheet_id", None)
    if not jid:
        return
    oi.job_sheet_id = None
    db.add(oi)
    db.flush()
    js = db.get(JobSheet, str(jid))
    if js is None:
        return
    if not bool(getattr(js, "is_import_draft", False)):
        return
    db.delete(js)
    db.flush()


def _get_or_create_resell_product_for_myob(
    db: Session,
    *,
    myob_item_uid: str,
    description: str,
    unit_price: float | None,
    item_json: dict[str, Any] | None = None,
    catalog_kind: str = "supply",
    customer_id: str | None = None,
) -> ResellProduct:
    """
    Upsert MYOB-backed resell catalog rows.

    Supply rows are keyed by ``myob_item_uid`` + ``catalog_kind=supply``. Outsourced manufacturing rows are
    keyed by ``(myob_item_uid, customer_id)`` so the same MYOB item can exist per customer.
    """
    uid = str(myob_item_uid or "").strip()
    if not uid:
        raise MyobConfigError("MYOB item missing UID for resell line")
    desc = strip_trailing_dash_suffix((description or "").strip()) or f"MYOB item {uid[:8]}"
    rate: float
    if unit_price is not None and float(unit_price) == float(unit_price):
        rate = float(unit_price)
    else:
        rate = 0.0
    inc_uid: str | None = None
    if isinstance(item_json, dict):
        inc_uid = sync_income_account_from_item_json(db, item_json)
    ck = str(catalog_kind or "supply").strip() or "supply"
    if ck not in ("supply", "outsourced_manufacturing"):
        ck = "supply"
    cust = str(customer_id or "").strip() or None
    if ck == "outsourced_manufacturing":
        if not cust:
            raise MyobConfigError("Outsourced MYOB resell products require an order customer")
        rp = db.scalar(
            select(ResellProduct).where(
                ResellProduct.myob_item_uid == uid,
                ResellProduct.catalog_kind == "outsourced_manufacturing",
                ResellProduct.customer_id == cust,
            )
        )
    else:
        rp = db.scalar(
            select(ResellProduct).where(
                ResellProduct.myob_item_uid == uid,
                ResellProduct.catalog_kind == "supply",
            )
        )
        if rp is None:
            rp = db.scalar(
                select(ResellProduct).where(
                    ResellProduct.myob_item_uid == uid,
                    ResellProduct.customer_id.is_(None),
                    ResellProduct.catalog_kind != "outsourced_manufacturing",
                )
            )
    if rp is not None:
        rp.description = desc[:2000] if desc else rp.description
        if rate > 0:
            rp.unit_price = rate
        if not getattr(rp, "active", True):
            rp.active = True
        rp.catalog_kind = ck
        if ck == "outsourced_manufacturing":
            rp.customer_id = cust
        else:
            rp.customer_id = None
        if isinstance(item_json, dict):
            rp.myob_income_account_uid = inc_uid
        db.add(rp)
        db.flush()
        return rp
    rid = str(uuid.uuid4())
    rp2 = ResellProduct(
        id=rid,
        description=desc[:2000] if desc else f"MYOB {uid[:8]}",
        unit_price=rate if rate > 0 else 0.0,
        active=True,
        catalog_kind=ck,
        customer_id=cust if ck == "outsourced_manufacturing" else None,
        myob_item_uid=uid,
        myob_income_account_uid=inc_uid,
    )
    db.add(rp2)
    db.flush()
    return rp2


def import_one_myob_sale_order(
    db: Session,
    *,
    myob_order: dict[str, Any],
    item_fetch: Callable[[str | None, str | None], dict[str, Any]] | None = None,
    invoices: list[dict[str, Any]] | None = None,
    source_document: Literal["order", "invoice"] = "order",
) -> dict[str, Any]:
    if not isinstance(myob_order, dict):
        raise MyobConfigError("myob_order must be an object.")

    myob_uid = myob_order.get("UID")
    if not isinstance(myob_uid, str) or not myob_uid.strip():
        raise MyobConfigError("MYOB order missing UID")
    myob_uid = myob_uid.strip()
    if _is_credit_note_like_order(myob_order):
        return {
            "ok": True,
            "skipped": True,
            "skip_reason": "credit_note_like_order",
            "myob_order_uid": myob_uid,
            "lines_synced": 0,
            "myob_all_job_sheets_entered": True,
        }

    number_s = str(myob_order.get("Number") or "").strip()
    code = number_s or f"MYOB-{myob_uid[:8].upper()}"
    if len(code) > 32:
        code = code[:32]

    last_mod = myob_order.get("LastModified")
    myob_last_modified: str | None
    if last_mod is not None and str(last_mod).strip():
        myob_last_modified = str(last_mod).strip()[:64]
    else:
        myob_last_modified = None
    order_date = _parse_date_only(myob_order.get("Date"))
    cpo_raw = myob_order.get("CustomerPurchaseOrderNumber")
    customer_po_number = str(cpo_raw).strip()[:128] if cpo_raw is not None and str(cpo_raw).strip() else None

    cust_u = myob_order.get("Customer")
    if not isinstance(cust_u, dict) or not cust_u.get("UID"):
        raise MyobConfigError("MYOB order missing Customer.UID (sync customers from MYOB first).")
    c_uid = str(cust_u.get("UID")).strip()
    customer = db.scalar(select(Customer).where(Customer.myob_customer_uid == c_uid))
    if not customer:
        raise MyobConfigError(
            f"Customer with MYOB UID {c_uid!r} is not in this app. Run MYOB customer import (sync) first."
        )

    invoice_for_status: dict[str, Any] | None = None
    associated_invoices: list[dict[str, Any]] = []
    if source_document == "order":
        # Sale orders are imported independently from invoices now.
        invoice_for_status = None
        associated_invoices = []
    elif source_document == "invoice":
        invoice_for_status = myob_order
        associated_invoices = [myob_order]

    derived_status = (
        derive_order_status_for_invoice_only(myob_order)
        if source_document == "invoice"
        else derive_order_status_for_sale_order_only(myob_order)
    )

    if item_fetch is None:

        def _ifetch(item_uri: str | None, item_uid: str | None) -> dict[str, Any]:
            uid = str(item_uid or "").strip()
            if uid:
                cached = get_cached_item_json_for_mapping(db, item_uid=uid)
                if cached is not None:
                    return cached
            r = fetch_inventory_item_readonly(db, item_uri=item_uri, item_uid=item_uid)
            m = r.get("myob")
            out = m if isinstance(m, dict) else {}
            if uid and isinstance(out, dict):
                upsert_uom_from_item_json(db, item_uid=uid, item_json=out)
            return out

        fetch_item: Callable[[str | None, str | None], dict[str, Any]] = _ifetch
    else:
        fetch_item = item_fetch

    now = datetime.now(UTC)
    order = db.scalar(select(Order).where(Order.myob_order_uid == myob_uid))

    if order is None:
        conflict = db.scalar(select(Order).where(Order.code == code))
        if conflict is not None and getattr(conflict, "myob_order_uid", None) != myob_uid:
            suffix = myob_uid.replace("-", "")[:6].upper()
            code = f"{(number_s or 'MYOB')[:24]}-{suffix}"[:32]
        order = Order(
            id=str(uuid.uuid4()),
            code=code,
            customer_id=str(customer.id),
            import_source="MYOB",
            myob_order_uid=myob_uid,
            myob_last_modified=myob_last_modified,
            myob_synced_at=now,
            myob_source_sales_order_json=dict(myob_order) if source_document == "order" else None,
            myob_source_invoices_json=list(associated_invoices) if associated_invoices else [],
            product_version_id=None,
            status=derived_status,
            order_date=order_date,
            customer_purchase_order_number=customer_po_number,
            import_review_status="incomplete",
        )
        db.add(order)
        db.flush()
    else:
        order.customer_id = str(customer.id)
        order.myob_last_modified = myob_last_modified
        order.myob_synced_at = now
        order.import_source = "MYOB"
        if order_date is not None:
            order.order_date = order_date
        order.customer_purchase_order_number = customer_po_number
        order.myob_source_sales_order_json = dict(myob_order) if source_document == "order" else None
        order.myob_source_invoices_json = list(associated_invoices) if associated_invoices else []
        if number_s and len(number_s) <= 32 and order.code != number_s:
            other = db.scalar(
                select(Order).where(Order.code == number_s).where(Order.id != str(order.id))
            )
            if other is None:
                order.code = number_s
        db.add(order)
        db.flush()

    lines_source = myob_order
    lines = lines_source.get("Lines") if isinstance(lines_source, dict) else None
    if not isinstance(lines, list):
        lines = []

    existing_by_row: dict[int, OrderItem] = {}
    for oi0 in db.scalars(
        select(OrderItem)
        .where(
            OrderItem.order_id == str(order.id),
            OrderItem.myob_row_id.isnot(None),
        )
        .order_by(OrderItem.line_index)
    ):
        r = oi0.myob_row_id
        if r is not None:
            try:
                existing_by_row[int(r)] = oi0
            except (TypeError, ValueError):
                pass

    seen_row_ids: set[int] = set()
    n_lines = 0
    for idx, line in enumerate(lines):
        if not isinstance(line, dict):
            continue
        lt = str(line.get("Type") or "Transaction")
        if lt and lt != "Transaction":
            continue
        n_lines += 1
        it_d = line.get("Item")
        it_d = it_d if isinstance(it_d, dict) else None
        if it_d and it_d.get("UID"):
            u = str(it_d.get("UID")).strip()
            u_uri = it_d.get("URI")
            uri = str(u_uri).strip() if isinstance(u_uri, str) and u_uri.strip() else None
            item_json = fetch_item(uri, u)
        else:
            item_json = {}

        if not isinstance(item_json, dict):
            item_json = {}
        uid_line = str(it_d.get("UID")).strip() if it_d and it_d.get("UID") else None
        item_json = normalize_myob_item_json_for_order_import(item_json, item_uid=uid_line)

        qty = line.get("ShipQuantity")
        try:
            qf = float(qty) if qty is not None else 0.0
        except (TypeError, ValueError):
            qf = 0.0
        up = line.get("UnitPrice")
        try:
            up_f = float(up) if up is not None else None
        except (TypeError, ValueError):
            up_f = None
        tot = line.get("Total")
        try:
            tot_f = float(tot) if tot is not None else None
        except (TypeError, ValueError):
            tot_f = None

        desc = _dec_str(line.get("Description")) or _dec_str(
            (it_d.get("Name") or it_d.get("Number") if it_d else None) or "Line"
        )
        desc = strip_trailing_dash_suffix(desc)
        r_id = line.get("RowID")
        r_int: int | None
        try:
            r_int = int(r_id) if r_id is not None else None
        except (TypeError, ValueError):
            r_int = None
        if r_int is not None:
            seen_row_ids.add(r_int)

        bought_flag = is_bought_from_item_json(item_json)
        is_resell = bool(bought_flag is True)
        if is_resell:
            resell_catalog_kind = myob_resell_catalog_kind(item_json)
            req_js = False
        else:
            resell_catalog_kind = "supply"
            req_js = _requires_job_sheet_for_line(myob_item=it_d, line=line) if it_d else False

        map_qty_like_manufacturing = (not is_resell and bool(req_js)) or (
            is_resell and resell_catalog_kind == "outsourced_manufacturing"
        )
        if it_d and item_json is not None:
            qu, qy_t, sales_raw = map_myob_item_to_app_quantity(
                item_json, requires_job_sheet=bool(map_qty_like_manufacturing)
            )
        else:
            qu, qy_t, sales_raw = "ea", "units", None

        oi: OrderItem | None = None
        if r_int is not None:
            oi = existing_by_row.get(int(r_int))
        if oi is None and r_int is not None:
            oi = db.scalar(
                select(OrderItem).where(
                    OrderItem.order_id == str(order.id), OrderItem.myob_row_id == r_int
                )
            )

        if oi is not None and oi.line_kind == "manufactured" and oi.myob_row_id is not None:
            oi.line_index = idx
            oi.myob_line_type = "Transaction"
            oi.myob_item_uid = str(it_d.get("UID")).strip() if it_d and it_d.get("UID") else None
            oi.myob_item_number = str(it_d.get("Number") or None) if it_d else None
            oi.myob_item_name = str(it_d.get("Name") or None) if it_d else None
            oi.import_line_description = desc
            oi.import_ship_quantity = qf
            oi.import_unit_price = up_f
            oi.import_line_total = tot_f
            oi.import_quantity_unit = qu
            oi.import_qty_type = qy_t
            oi.myob_item_sales_unit_raw = sales_raw
            oi.myob_item_json = item_json if item_json else None
            oi.import_requires_job_sheet = bool(
                (not is_resell) and req_js
            )
            db.add(oi)
            db.flush()
            continue

        if is_resell:
            if not it_d or not it_d.get("UID"):
                raise MyobConfigError("MYOB resell line needs an Item.UID on the order line")
            uid_r = str(it_d.get("UID")).strip()
            rp = _get_or_create_resell_product_for_myob(
                db,
                myob_item_uid=uid_r,
                description=desc,
                unit_price=up_f,
                item_json=item_json,
                catalog_kind=str(resell_catalog_kind),
                customer_id=str(order.customer_id)
                if str(resell_catalog_kind) == "outsourced_manufacturing"
                else None,
            )
            if oi is not None and oi.line_kind == "myob_import":
                _delete_draft_import_job_sheet_if_any(db, oi)
            if oi is not None:
                oi.line_index = idx
                oi.line_kind = "resell"
                oi.job_sheet_id = None
                oi.resell_product_id = str(rp.id)
                oi.resell_description_snapshot = str(rp.description)
                oi.resell_quantity_value = qf
                oi.resell_quantity_unit = str(qu or "ea")
                oi.resell_unit_rate = up_f
                oi.resell_line_total = tot_f
                oi.resell_due_date = None
                oi.myob_line_type = "Transaction"
                oi.myob_item_uid = uid_r
                oi.myob_item_number = str(it_d.get("Number") or None) if it_d else None
                oi.myob_item_name = str(it_d.get("Name") or None) if it_d else None
                oi.myob_row_id = r_int
                oi.import_line_description = desc
                oi.import_ship_quantity = qf
                oi.import_unit_price = up_f
                oi.import_line_total = tot_f
                oi.import_quantity_unit = qu
                oi.import_qty_type = qy_t
                oi.myob_item_sales_unit_raw = sales_raw
                oi.myob_item_json = item_json
                oi.import_requires_job_sheet = False
                db.add(oi)
            else:
                oi = OrderItem(
                    id=str(uuid.uuid4()),
                    order_id=str(order.id),
                    line_index=idx,
                    line_kind="resell",
                    resell_product_id=str(rp.id),
                    resell_description_snapshot=str(rp.description),
                    resell_quantity_value=qf,
                    resell_quantity_unit=str(qu or "ea"),
                    resell_unit_rate=up_f,
                    resell_line_total=tot_f,
                    resell_due_date=None,
                    myob_line_type="Transaction",
                    myob_item_uid=uid_r,
                    myob_item_number=str(it_d.get("Number") or None) if it_d else None,
                    myob_item_name=str(it_d.get("Name") or None) if it_d else None,
                    myob_row_id=r_int,
                    import_line_description=desc,
                    import_ship_quantity=qf,
                    import_unit_price=up_f,
                    import_line_total=tot_f,
                    import_quantity_unit=qu,
                    import_qty_type=qy_t,
                    myob_item_sales_unit_raw=sales_raw,
                    myob_item_json=item_json,
                    import_requires_job_sheet=False,
                )
                db.add(oi)
            db.flush()
            continue

        if oi is not None and oi.line_kind == "resell" and not is_resell:
            oi.line_kind = "myob_import"
            oi.resell_product_id = None
            oi.resell_description_snapshot = None
            oi.resell_quantity_value = None
            oi.resell_quantity_unit = None
            oi.resell_unit_rate = None
            oi.resell_line_total = None
            oi.resell_due_date = None

        if oi is not None:
            oi.line_index = idx
            oi.myob_line_type = "Transaction"
            oi.myob_item_uid = str(it_d.get("UID")).strip() if it_d and it_d.get("UID") else None
            oi.myob_item_number = str(it_d.get("Number") or None) if it_d else None
            oi.myob_item_name = str(it_d.get("Name") or None) if it_d else None
            oi.import_line_description = desc
            oi.import_ship_quantity = qf
            oi.import_unit_price = up_f
            oi.import_line_total = tot_f
            oi.import_quantity_unit = qu
            oi.import_qty_type = qy_t
            oi.myob_item_sales_unit_raw = sales_raw
            oi.myob_item_json = item_json if item_json else None
            oi.import_requires_job_sheet = bool(req_js)
            oi.line_kind = "myob_import"
        else:
            oi = OrderItem(
                id=str(uuid.uuid4()),
                order_id=str(order.id),
                line_index=idx,
                line_kind="myob_import",
                myob_line_type="Transaction",
                myob_item_uid=str(it_d.get("UID")).strip() if it_d and it_d.get("UID") else None,
                myob_item_number=str(it_d.get("Number") or None) if it_d else None,
                myob_item_name=str(it_d.get("Name") or None) if it_d else None,
                import_line_description=desc,
                myob_row_id=r_int,
                import_ship_quantity=qf,
                import_unit_price=up_f,
                import_line_total=tot_f,
                import_quantity_unit=qu,
                import_qty_type=qy_t,
                myob_item_sales_unit_raw=sales_raw,
                myob_item_json=item_json if item_json else None,
                import_requires_job_sheet=bool(req_js),
            )
            db.add(oi)
        db.flush()

        requires = bool(oi and oi.import_requires_job_sheet and oi.line_kind == "myob_import")
        if requires and oi and not oi.job_sheet_id:
            js = job_sheets_service.create_myob_import_draft_job_sheet(
                db=db,
                customer_id=str(order.customer_id),
                quantity_value=float(oi.import_ship_quantity or 0.0),
                quantity_unit=str(oi.import_quantity_unit or "kg"),
                qty_type=str(oi.import_qty_type or "kg"),
                unit_rate=float(oi.import_unit_price) if oi.import_unit_price is not None else None,
                line_total=float(oi.import_line_total) if oi.import_line_total is not None else None,
                created_by="MYOB import",
            )
            oi.job_sheet_id = str(js.id)
            db.add(oi)
            db.flush()
        elif oi is not None and not requires and oi.job_sheet_id is not None and oi.line_kind == "myob_import":
            old = db.get(JobSheet, str(oi.job_sheet_id))
            oi.job_sheet_id = None
            db.add(oi)
            db.flush()
            if old is not None and bool(getattr(old, "is_import_draft", False)):
                db.delete(old)
                db.flush()

    if seen_row_ids:
        for oi2 in list(
            db.scalars(
                select(OrderItem).where(
                    OrderItem.order_id == str(order.id),
                    OrderItem.line_kind.in_(("myob_import", "resell")),
                )
            )
        ):
            if oi2.myob_row_id is None:
                continue
            try:
                r = int(oi2.myob_row_id)
            except (TypeError, ValueError):
                continue
            if r in seen_row_ids:
                continue
            if oi2.line_kind == "resell":
                db.delete(oi2)
                db.flush()
                continue
            if oi2.job_sheet_id is not None:
                oi2.import_line_description = f"[removed in MYOB] {oi2.import_line_description or ''}"
                oi2.import_ship_quantity = 0.0
                oi2.import_line_total = 0.0
                db.add(oi2)
            else:
                db.delete(oi2)
        db.flush()

    order.status = derived_status
    db.add(order)
    db.commit()
    db.refresh(order)

    ois = list(
        db.scalars(
            select(OrderItem).where(
                OrderItem.order_id == str(order.id),
                OrderItem.line_kind == "myob_import",
                OrderItem.import_requires_job_sheet == True,  # noqa: E712
            )
        )
    )
    if not ois:
        all_js = True
    else:
        all_js = True
        for m in ois:
            if not m.job_sheet_id:
                all_js = False
                break
            js0 = db.get(JobSheet, str(m.job_sheet_id))
            if js0 is not None and bool(getattr(js0, "is_import_draft", False)):
                all_js = False
                break

    part = (
        myob_invoice_partial_fulfillment_vs_order(myob_order, invoice_for_status)
        if isinstance(invoice_for_status, dict)
        else None
    )
    return {
        "ok": True,
        "order_id": str(order.id),
        "myob_order_uid": myob_uid,
        "myob_all_job_sheets_entered": all_js,
        "lines_synced": n_lines,
        "line_items_source": "order" if source_document == "order" else "invoice",
        "source_document": source_document,
        "app_order_status": derived_status.value,
        "myob_sale_order_status": str(myob_order.get("Status") or ""),
        "myob_invoice_status": str(invoice_for_status.get("Status") or "") if isinstance(invoice_for_status, dict) else None,
        "fulfillment_partial": part,
        "matched_invoice_uid": None,
    }
