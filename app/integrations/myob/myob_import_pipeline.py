"""Sequential MYOB import: customers → item cache → sale orders."""

from __future__ import annotations

from typing import Any, Literal

from sqlalchemy.orm import Session

from app.integrations.myob.customer_import import import_customers_from_myob
from app.integrations.myob.item_selling_uom_cache import rebuild_myob_item_selling_uom_cache
from app.integrations.myob.order_import_batch import import_all_myob_sale_orders, import_myob_sale_orders_list_page


def run_myob_import_pipeline(
    db: Session,
    *,
    orders: Literal["all", "page"] = "all",
    orders_top: int = 200,
    orders_skip: int = 0,
) -> dict[str, Any]:
    """
    Run MYOB imports in order:

    1. **Customers** — upsert local rows from MYOB Contact/Customer (same as ``POST /customers/sync``).
    2. **Item cache** — rebuild ``myob_item_selling_uoms`` (+ income accounts from item payloads); same as
       ``POST /item-selling-uoms/rebuild``.
    3. **Orders** — either every sale order (``orders='all'``) or one OData list page (``orders='page'``).

    The item cache step is committed before order import so the cache is persisted even when no orders are listed.
    """
    customers = import_customers_from_myob(db)

    item_cache = rebuild_myob_item_selling_uom_cache(db)
    db.commit()

    top_i = max(1, min(int(orders_top), 1000))
    skip_i = max(0, int(orders_skip))

    if orders == "all":
        orders_result = import_all_myob_sale_orders(db, top=top_i)
    else:
        orders_result = import_myob_sale_orders_list_page(db, top=top_i, skip=skip_i)

    overall_ok = bool(customers.get("ok")) and bool(item_cache.get("ok", True)) and bool(orders_result.get("ok"))

    return {
        "ok": overall_ok,
        "orders_mode": orders,
        "customers": customers,
        "item_cache": item_cache,
        "orders": orders_result,
    }
