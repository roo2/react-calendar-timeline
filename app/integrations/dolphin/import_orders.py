"""
Import Dolphin / MYOB ``Receivable Invoice`` detail TSV into :class:`Order` / :class:`OrderItem`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db.models.domain import Customer, Order, OrderItem
from app.db.models.enums import OrderStatus
from app.integrations.dolphin.description_uom import (
    build_synthetic_item_json_for_dolphin_uom,
    parse_uom_from_dolphin_description,
)
from app.integrations.dolphin.income_accounts import upsert_dolphin_income_account
from app.integrations.dolphin.tsv_parse import (
    DolphinLine,
    group_lines_by_invoice,
    iter_dolphin_tsv_rows,
)
from app.integrations.myob.order_import_mapping import map_myob_item_to_app_quantity
from app.job_sheets import service as job_sheets_service
from app.str_norm import strip_trailing_dash_suffix

DOLPHIN_IMPORT_SOURCE = "DOLPHIN_TSV"


def _parse_invoice_date(s: str | None) -> date | None:
    if not (s or "").strip():
        return None
    raw = str(s).strip()
    from datetime import datetime as dt

    for fmt in ("%d %b %Y", "%d %B %Y", "%Y-%m-%d", "%d-%b-%Y"):
        try:
            return dt.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def _float_safe(s: str | None) -> float | None:
    try:
        t = (s or "").replace(",", "").strip()
        if not t:
            return None
        f = float(t)
        return f if f == f else None
    except (TypeError, ValueError):
        return None


def _invoice_balance_aud(lines: list[DolphinLine]) -> float | None:
    """MYOB invoice ``Balance (AUD)`` is repeated on each line; use the first parsable value."""
    for ln in lines:
        b = _float_safe(ln.balance)
        if b is not None:
            return b
    return None


def _dolphin_order_status_from_balance(balance_aud: float | None) -> OrderStatus:
    """
    Historic receivable invoices: paid (zero balance) → closed; outstanding → dispatched.

    If balance is missing from the export, prefer dispatched (invoice may still be open).
    """
    if balance_aud is None:
        return OrderStatus.DISPATCHED
    if abs(float(balance_aud)) < 0.005:
        return OrderStatus.CLOSED
    return OrderStatus.DISPATCHED


def synthetic_dolphin_order_uid(*, customer_id: str, invoice_number: str) -> str:
    key = f"crownpack:dolphin-order:{str(customer_id).strip()}:{str(invoice_number).strip()}"
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, key))


def _import_requires_job_sheet_for_dolphin(
    *,
    account_name: str | None,
    account_code: str | None,
) -> bool:
    """Heuristic: in-house manufacturing GL lines get draft job sheets; fees/freight do not."""
    n = (account_name or "").lower()
    if any(x in n for x in ("freight", "fee", "interest", "rounding", "discount")):
        return False
    if "manufactured" in n and "purchased" not in n and "imported" not in n:
        return True
    if (account_code or "").strip() in ("4030",):
        return True
    return False


def _is_outsourced_dolphin_line(*, account_name: str | None, account_code: str | None) -> bool:
    """
    Heuristic for outsourced manufacturing lines (not in-house job-sheet lines).

    These should sit between in-house job-sheet products and fee/freight/resell-style rows.
    """
    n = (account_name or "").lower()
    if any(x in n for x in ("freight", "fee", "interest", "rounding", "discount", "resell", "resale")):
        return False
    if any(x in n for x in ("outsourced", "purchased", "imported")):
        return True
    return (account_code or "").strip() in ("4040", "4050")


def _dolphin_line_sort_bucket(line: DolphinLine) -> int:
    """0=in-house job sheet, 1=outsourced, 2=freight/fees/resell/other."""
    if _import_requires_job_sheet_for_dolphin(account_name=line.account_name, account_code=line.account_code):
        return 0
    if _is_outsourced_dolphin_line(account_name=line.account_name, account_code=line.account_code):
        return 1
    return 2


def order_dolphin_lines_for_import(lines: list[DolphinLine]) -> list[DolphinLine]:
    """Stable order: job-sheet products, then outsourced, then freight/fees/resold/other."""
    indexed = list(enumerate(lines))
    indexed.sort(key=lambda t: (_dolphin_line_sort_bucket(t[1]), t[0]))
    return [ln for _i, ln in indexed]


def resolve_dolphin_customer(db: Session, line: DolphinLine) -> Customer | None:
    """
    Prefer ``Contact Account Number`` → :attr:`Customer.myob_display_id`, else match section name.
    """
    acc = (line.contact_account_number or "").strip()
    if acc:
        c = db.scalar(select(Customer).where(Customer.myob_display_id == acc))
        if c is not None:
            return c
    section = (line.client_section or "").strip()
    if not section:
        return None
    c2 = db.scalar(select(Customer).where(func.lower(Customer.name) == section.lower()))
    if c2 is not None:
        return c2
    return db.scalar(select(Customer).where(Customer.name.ilike(section)))


def _customer_po_from_lines(lines: list[DolphinLine]) -> str | None:
    for ln in lines:
        r = (ln.reference or "").strip()
        if r:
            return r[:128]
    return None


def _allocate_order_code(db: Session, *, invoice: str, myob_order_uid: str) -> str:
    base = (invoice or "").strip()[:32] or f"D-{myob_order_uid[:8]}"
    o = db.scalar(select(Order).where(Order.code == base))
    if o is None or str(o.myob_order_uid or "") == str(myob_order_uid):
        return base
    alt = f"D{base}"[:32]
    o2 = db.scalar(select(Order).where(Order.code == alt))
    if o2 is None or str(o2.myob_order_uid or "") == str(myob_order_uid):
        return alt
    return f"{base[:20]}-{str(myob_order_uid)[:4]}"[:32]


def _build_item_json(
    line: DolphinLine,
    *,
    income_account_id: str | None,
) -> dict[str, Any]:
    raw_u = parse_uom_from_dolphin_description(line.description)
    d: dict[str, Any] = {
        "_dolphin": {
            "item_code": (line.item_code or "").strip() or None,
            "client_section": (line.client_section or "").strip() or None,
            "parsed_uom": raw_u,
            "income_account_id": income_account_id,
        },
    }
    # Dolphin GL rows are not MYOB ``IncomeAccount.UID``; only display id + name for UI / mapping.
    ia: dict[str, Any] = {}
    ac = (line.account_code or "").strip()
    an = (line.account_name or "").strip()
    if ac:
        ia["DisplayID"] = ac
    if an:
        ia["Name"] = an
    if ia:
        d["IncomeAccount"] = ia
    syn = build_synthetic_item_json_for_dolphin_uom(raw_uom=raw_u, income_display_id=ac or None)
    if "IncomeAccount" in syn:
        merged = {**(d.get("IncomeAccount") or {}), **syn["IncomeAccount"]}
        d["IncomeAccount"] = merged
        rest = {k: v for k, v in syn.items() if k != "IncomeAccount"}
        d.update(rest)
    else:
        d.update(syn)
    return d


def import_dolphin_tsv(
    db: Session,
    path: str,
    *,
    dry_run: bool = False,
    created_by: str = "Dolphin TSV import",
) -> dict[str, Any]:
    """
    Parse ``dolphin-orders*.tsv``, keep ``Receivable Invoice`` rows, group by invoice, upsert income
    accounts, and create ``myob_import`` order lines.
    """
    _hdr, lines, w = iter_dolphin_tsv_rows(path)
    groups = group_lines_by_invoice(lines, only_receivable_invoice=True)
    skipped: list[dict[str, str]] = []
    out: dict[str, Any] = {
        "warnings": w,
        "tsv_path": str(path),
        "dry_run": bool(dry_run),
        "groups": len(groups),
        "orders_upserted": 0,
        "order_items": 0,
        "skipped": skipped,
        "skipped_line_sync_import_review_complete": 0,
    }

    for (_section, inv), g_lines in sorted(groups.items(), key=lambda x: (x[0][0], x[0][1])):
        if not g_lines:
            continue
        cust = resolve_dolphin_customer(db, g_lines[0])
        if cust is None:
            skipped.append(
                {
                    "client_section": str(_section),
                    "invoice": str(inv),
                    "reason": "customer_not_found",
                }
            )
            continue
        duid = synthetic_dolphin_order_uid(customer_id=str(cust.id), invoice_number=inv)
        code = _allocate_order_code(db, invoice=inv, myob_order_uid=duid)
        od0 = _parse_invoice_date(g_lines[0].invoice_date)
        cpo = _customer_po_from_lines(g_lines)
        balance_aud = _invoice_balance_aud(g_lines)
        dolphin_status = _dolphin_order_status_from_balance(balance_aud)
        if dry_run:
            out["orders_upserted"] = int(out["orders_upserted"]) + 1
            out["order_items"] = int(out["order_items"]) + len(g_lines)
            continue

        now = datetime.now(UTC)
        order = db.scalar(select(Order).where(Order.myob_order_uid == duid))
        if order is None:
            order = Order(
                id=str(uuid.uuid4()),
                code=code,
                customer_id=str(cust.id),
                status=dolphin_status,
                order_date=od0,
                customer_purchase_order_number=cpo,
                import_source=DOLPHIN_IMPORT_SOURCE,
                myob_order_uid=duid,
                myob_last_modified=None,
                myob_synced_at=now,
                product_version_id=None,
            )
            db.add(order)
            db.flush()
        else:
            order.code = code
            order.customer_id = str(cust.id)
            order.status = dolphin_status
            if od0 is not None:
                order.order_date = od0
            order.customer_purchase_order_number = cpo
            order.import_source = DOLPHIN_IMPORT_SOURCE
            order.myob_synced_at = now
            db.add(order)
            db.flush()

        review_locked = str(getattr(order, "import_review_status", None) or "").strip().lower() == "complete"
        if review_locked:
            out["skipped_line_sync_import_review_complete"] = (
                int(out["skipped_line_sync_import_review_complete"]) + 1
            )
            out["orders_upserted"] = int(out["orders_upserted"]) + 1
            continue

        db.execute(delete(OrderItem).where(OrderItem.order_id == str(order.id)))
        db.flush()

        ordered_lines = order_dolphin_lines_for_import(g_lines)
        for idx, line in enumerate(ordered_lines):
            inc_id = upsert_dolphin_income_account(
                db,
                account_code=line.account_code,
                account_name=line.account_name or None,
            )
            item_json = _build_item_json(line, income_account_id=inc_id)
            raw_u = parse_uom_from_dolphin_description(line.description)
            map_mfg = bool((raw_u or "").strip())
            qu, qy_t, sales_raw = map_myob_item_to_app_quantity(
                item_json,
                requires_job_sheet=map_mfg,
            )
            req_js = _import_requires_job_sheet_for_dolphin(
                account_name=line.account_name,
                account_code=line.account_code,
            )
            qf = _float_safe(line.quantity) or 0.0
            upf = _float_safe(line.unit_price_ex)
            totf = _float_safe(line.gross)
            if totf is None and qf and upf is not None:
                totf = round(qf * upf, 6)
            raw_desc = (line.description or "").strip()
            desc = strip_trailing_dash_suffix(raw_desc) or (line.item_code or "Line")

            oi = OrderItem(
                id=str(uuid.uuid4()),
                order_id=str(order.id),
                line_index=idx,
                line_kind="myob_import",
                myob_line_type="Transaction",
                myob_item_uid=None,
                myob_item_number=(line.item_code or None) or None,
                myob_item_name=None,
                import_line_description=desc,
                myob_row_id=idx,
                import_ship_quantity=qf,
                import_unit_price=upf,
                import_line_total=totf,
                import_quantity_unit=qu,
                import_qty_type=qy_t,
                myob_item_sales_unit_raw=sales_raw,
                myob_item_json=item_json if item_json else None,
                import_requires_job_sheet=bool(req_js),
            )
            db.add(oi)
            out["order_items"] = int(out["order_items"]) + 1
        db.flush()
        order.import_review_status = "incomplete"
        db.add(order)
        db.flush()

        for oi2 in list(
            db.scalars(
                select(OrderItem).where(
                    OrderItem.order_id == str(order.id),
                )
            )
        ):
            requires = bool(oi2.import_requires_job_sheet and oi2.line_kind == "myob_import")
            if requires and not oi2.job_sheet_id:
                up = oi2.import_unit_price
                lt = oi2.import_line_total
                js = job_sheets_service.create_myob_import_draft_job_sheet(
                    db=db,
                    customer_id=str(order.customer_id),
                    quantity_value=float(oi2.import_ship_quantity or 0.0),
                    quantity_unit=str(oi2.import_quantity_unit or "ea"),
                    qty_type=str(oi2.import_qty_type or "units"),
                    unit_rate=float(up) if up is not None else None,
                    line_total=float(lt) if lt is not None else None,
                    created_by=created_by,
                )
                oi2.job_sheet_id = str(js.id)
                db.add(oi2)
        db.flush()

        out["orders_upserted"] = int(out["orders_upserted"]) + 1

    if not dry_run:
        db.commit()
    return out
