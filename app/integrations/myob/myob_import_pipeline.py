"""Sequential MYOB import: customers → item cache → sale orders."""

from __future__ import annotations

from typing import Any, Callable, Literal

from sqlalchemy.orm import Session

from app.integrations.myob.customer_import import import_customers_from_myob
from app.integrations.myob.item_selling_uom_cache import rebuild_myob_item_selling_uom_cache
from app.integrations.myob.order_import_batch import import_all_myob_sale_orders, import_myob_sale_orders_list_page

PipelineStep = Literal["customers", "item_cache", "orders"]
OnPipelineStep = Callable[[PipelineStep, dict[str, Any]], None]


def _customers_for_progress(customers: dict[str, Any]) -> dict[str, Any]:
    """Strip large MYOB payload for progress callbacks / job status polling."""
    out = {k: v for k, v in customers.items() if k != "myob_json"}
    return out


def _orders_progress_snapshot(orders_result: dict[str, Any], *, orders: Literal["all", "page"]) -> dict[str, Any]:
    """Small summary for polling while the orders step runs (avoid huge ``results`` arrays in ``partial``)."""
    snap: dict[str, Any] = {
        "ok": orders_result.get("ok"),
        "imported": orders_result.get("imported"),
        "failed": orders_result.get("failed"),
        "skipped": orders_result.get("skipped"),
    }
    if orders == "all":
        snap["pages_fetched"] = orders_result.get("pages_fetched")
        snap["truncated"] = orders_result.get("truncated")
        snap["top"] = orders_result.get("top")
    else:
        snap["list_item_count"] = orders_result.get("list_item_count")
        snap["top"] = orders_result.get("top")
        snap["skip"] = orders_result.get("skip")
    return snap


def run_myob_import_pipeline(
    db: Session,
    *,
    orders: Literal["all", "page"] = "all",
    orders_top: int = 200,
    orders_skip: int = 0,
    on_step: OnPipelineStep | None = None,
) -> dict[str, Any]:
    """
    Run MYOB imports in order:

    1. **Customers** — upsert local rows from MYOB Contact/Customer (same as ``POST /customers/sync``).
    2. **Item cache** — rebuild ``myob_item_selling_uoms`` (+ income accounts from item payloads); same as
       ``POST /item-selling-uoms/rebuild``.
    3. **Orders** — either every sale order (``orders='all'``) or one OData list page (``orders='page'``).

    The item cache step is committed before order import so the cache is persisted even when no orders are listed.

    Optional ``on_step`` is invoked after each major step with ``(step_name, {"result": ...})`` where ``result`` is
    JSON-friendly (customer sync omits ``myob_json``).
    """
    customers = import_customers_from_myob(db)
    if on_step is not None:
        on_step("customers", {"result": _customers_for_progress(customers)})

    item_cache = rebuild_myob_item_selling_uom_cache(db)
    db.commit()
    if on_step is not None:
        on_step("item_cache", {"result": dict(item_cache)})

    top_i = max(1, min(int(orders_top), 1000))
    skip_i = max(0, int(orders_skip))

    if orders == "all":
        orders_result = import_all_myob_sale_orders(db, top=top_i)
    else:
        orders_result = import_myob_sale_orders_list_page(db, top=top_i, skip=skip_i)

    if on_step is not None:
        on_step("orders", {"result": _orders_progress_snapshot(orders_result, orders=orders)})

    overall_ok = bool(customers.get("ok")) and bool(item_cache.get("ok", True)) and bool(orders_result.get("ok"))

    return {
        "ok": overall_ok,
        "orders_mode": orders,
        "customers": customers,
        "item_cache": item_cache,
        "orders": orders_result,
    }
