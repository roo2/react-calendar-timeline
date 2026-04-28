"""
Import multiple MYOB sale orders from one ``GET …/Sale/Order?$top&$skip`` page.

Before importing orders, the batch loads **all** ``Sale/Invoice/Item`` rows (paginated) so each order can be
reconciled with its invoice on ``(Number, CustomerPurchaseOrderNumber)`` (status + line ``ShipQuantity``).

Each order is fetched and passed to :func:`import_one_myob_sale_order` (same as the single-order admin action).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.integrations.myob.order_import import import_one_myob_sale_order
from app.integrations.myob.service import (
    MYOB_SALE_ORDER_IMPORT_MAX_PAGES,
    MYOB_SALE_ORDER_LIST_MAX_TOP,
    MyobApiError,
    MyobConfigError,
    fetch_all_sale_invoice_items_readonly,
    fetch_myob_url_readonly,
    fetch_sale_order_detail_readonly,
    fetch_sale_orders_list_readonly,
)


def _import_myob_sale_orders_from_list_items(
    db: Session,
    items_raw: list[Any],
    *,
    invoices: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], set[str]]:
    """Import each list row that has ``URI`` or ``UID``; return ``(results, skipped, errors)``."""
    results: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    matched_invoice_uids: set[str] = set()

    for row in items_raw:
        if not isinstance(row, dict):
            continue
        order_uri = row.get("URI") or row.get("Uri")
        order_uid = row.get("UID") or row.get("Uid")
        ou = str(order_uri).strip() if order_uri else None
        odu = str(order_uid).strip() if order_uid else None
        if ou == "":
            ou = None
        if odu == "":
            odu = None

        if not ou and not odu:
            errors.append(
                {
                    "order_uid": odu,
                    "order_uri": ou,
                    "error": "List row has no URI or UID.",
                }
            )
            continue

        try:
            detail = fetch_sale_order_detail_readonly(db, order_uri=ou, order_uid=odu)
        except (MyobConfigError, MyobApiError) as e:
            errors.append({"order_uid": odu, "order_uri": ou, "error": str(e)})
            continue

        raw_order = detail.get("myob")
        if not isinstance(raw_order, dict):
            errors.append(
                {
                    "order_uid": odu,
                    "order_uri": ou,
                    "error": "Invalid MYOB order response (expected JSON object).",
                }
            )
            continue

        try:
            one = import_one_myob_sale_order(
                db, myob_order=raw_order, item_fetch=None, invoices=invoices
            )
            if isinstance(one, dict):
                miu = str(one.get("matched_invoice_uid") or "").strip()
                if miu:
                    matched_invoice_uids.add(miu)
                if bool(one.get("skipped")):
                    skipped.append(one)
                else:
                    results.append(one)
        except (MyobConfigError, MyobApiError) as e:
            errors.append({"order_uid": odu, "order_uri": ou, "error": str(e)})

    return results, skipped, errors, matched_invoice_uids


def import_myob_sale_orders_list_page(
    db: Session,
    *,
    top: int = 50,
    skip: int = 0,
) -> dict[str, Any]:
    """
    List one page of sale orders from MYOB, then import each row that has a ``URI`` or ``UID``.

    Failures on individual orders are collected; successful imports are committed by
    :func:`import_one_myob_sale_order` (per order).
    """
    list_meta = fetch_sale_orders_list_readonly(db, top=top, skip=skip)
    myob = list_meta.get("myob")
    request_url = str(list_meta.get("request_url") or "")
    top_i = int(list_meta.get("top") or top)
    skip_i = int(list_meta.get("skip") or skip)

    invoices = fetch_all_sale_invoice_items_readonly(db)

    items_raw: list[Any] = []
    if isinstance(myob, dict):
        raw_items = myob.get("Items")
        if isinstance(raw_items, list):
            items_raw = raw_items

    results, skipped, errors, _matched = _import_myob_sale_orders_from_list_items(db, items_raw, invoices=invoices)

    return {
        "ok": len(errors) == 0,
        "list_request_url": request_url,
        "top": top_i,
        "skip": skip_i,
        "list_item_count": len(items_raw),
        "sale_invoices_indexed": len(invoices),
        "imported": len(results),
        "skipped": len(skipped),
        "failed": len(errors),
        "results": results,
        "skipped_results": skipped,
        "errors": errors,
    }


def import_all_myob_sale_orders(db: Session, *, top: int = 200) -> dict[str, Any]:
    """
    Page through ``GET …/Sale/Order`` until no more rows (``NextPageLink`` or ``$skip`` when MYOB omits next),
    importing each order the same way as :func:`import_myob_sale_orders_list_page`.

    Stops after :data:`MYOB_SALE_ORDER_IMPORT_MAX_PAGES` list requests; then ``truncated`` is true.
    """
    top_i = max(1, min(int(top), MYOB_SALE_ORDER_LIST_MAX_TOP))
    skip = 0
    list_url: str | None = None

    all_results: list[dict[str, Any]] = []
    all_skipped: list[dict[str, Any]] = []
    all_errors: list[dict[str, Any]] = []
    pages = 0
    first_request_url: str | None = None
    last_request_url: str | None = None

    invoices = fetch_all_sale_invoice_items_readonly(db)
    matched_invoice_uids: set[str] = set()

    while pages < MYOB_SALE_ORDER_IMPORT_MAX_PAGES:
        page_from_next_link = bool(list_url)
        if list_url:
            page_meta = fetch_myob_url_readonly(db, url=list_url)
            raw = page_meta.get("myob")
            current_req = str(page_meta.get("request_url") or "")
        else:
            page_meta = fetch_sale_orders_list_readonly(db, top=top_i, skip=skip)
            raw = page_meta.get("myob")
            current_req = str(page_meta.get("request_url") or "")

        if first_request_url is None:
            first_request_url = current_req
        last_request_url = current_req

        items_raw: list[Any] = []
        if isinstance(raw, dict):
            batch = raw.get("Items")
            if isinstance(batch, list):
                items_raw = batch

        if not items_raw:
            break

        chunk_r, chunk_s, chunk_e, chunk_matched = _import_myob_sale_orders_from_list_items(db, items_raw, invoices=invoices)
        all_results.extend(chunk_r)
        all_skipped.extend(chunk_s)
        all_errors.extend(chunk_e)
        matched_invoice_uids.update(chunk_matched)

        pages += 1

        next_link: str | None = None
        if isinstance(raw, dict):
            npl = raw.get("NextPageLink")
            if isinstance(npl, str) and npl.strip():
                next_link = npl.strip()

        if next_link:
            list_url = next_link
            continue

        list_url = None
        # A page loaded via ``NextPageLink`` is not part of the ``$skip`` sequence; do not advance ``$skip``.
        if page_from_next_link:
            break
        if len(items_raw) < top_i:
            break
        skip += len(items_raw)

    for inv in invoices:
        if not isinstance(inv, dict):
            continue
        inv_uid = str(inv.get("UID") or "").strip()
        if inv_uid and inv_uid in matched_invoice_uids:
            continue
        try:
            one = import_one_myob_sale_order(
                db,
                myob_order=inv,
                item_fetch=None,
                invoices=invoices,
                source_document="invoice",
            )
            if bool(one.get("skipped")):
                all_skipped.append(one)
            else:
                all_results.append(one)
        except (MyobConfigError, MyobApiError) as e:
            all_errors.append(
                {
                    "invoice_uid": inv_uid or None,
                    "invoice_number": str(inv.get("Number") or "") or None,
                    "error": str(e),
                }
            )

    return {
        "ok": len(all_errors) == 0,
        "pages_fetched": pages,
        "truncated": pages >= MYOB_SALE_ORDER_IMPORT_MAX_PAGES,
        "top": top_i,
        "first_list_request_url": first_request_url,
        "last_list_request_url": last_request_url,
        "sale_invoices_indexed": len(invoices),
        "imported": len(all_results),
        "skipped": len(all_skipped),
        "failed": len(all_errors),
        "results": all_results,
        "skipped_results": all_skipped,
        "errors": all_errors,
    }
