"""
Import multiple MYOB sale orders from one ``GET …/Sale/Order?$top&$skip`` page.

Each order is fetched and passed to :func:`import_one_myob_sale_order` (same as the single-order admin action).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.integrations.myob.order_import import import_one_myob_sale_order
from app.integrations.myob.service import MyobApiError, MyobConfigError, fetch_sale_order_detail_readonly, fetch_sale_orders_list_readonly


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

    items_raw: list[Any] = []
    if isinstance(myob, dict):
        raw_items = myob.get("Items")
        if isinstance(raw_items, list):
            items_raw = raw_items

    results: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

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
            one = import_one_myob_sale_order(db, myob_order=raw_order, item_fetch=None)
            if isinstance(one, dict):
                if bool(one.get("skipped")):
                    skipped.append(one)
                else:
                    results.append(one)
        except (MyobConfigError, MyobApiError) as e:
            errors.append({"order_uid": odu, "order_uri": ou, "error": str(e)})

    return {
        "ok": len(errors) == 0,
        "list_request_url": request_url,
        "top": top_i,
        "skip": skip_i,
        "list_item_count": len(items_raw),
        "imported": len(results),
        "skipped": len(skipped),
        "failed": len(errors),
        "results": results,
        "skipped_results": skipped,
        "errors": errors,
    }
