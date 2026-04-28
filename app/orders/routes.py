from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select

from app.auth.deps import allow_roles_any, csrf_protect, current_identity, require_roles
from app.db.models.domain import (
    Customer,
    JobSheet,
    MyobIncomeAccount,
    MyobItemSellingUom,
    OrderItem,
    Product,
    ProductVersion,
    ResellProduct,
)
from app.db.session import SessionLocal
from app.exceptions import DomainError
from app.orders import service
from app.orders.schemas import (
    CreateJobRequest,
    CreateOrderItemRequest,
    CreateOrderRequest,
    CreateResellOrderLineRequest,
    JobDTO,
    LinkMyobImportLineRequest,
    OrderDetailDTO,
    OrderListItemDTO,
    OrderListResponse,
    UpdateOrderRequest,
    UpdateResellOrderLineRequest,
)
from app.products.service import compute_product_code_full
from app.str_norm import (
    customer_facing_product_code_from_import_description,
    strip_trailing_dash_suffix,
)

router = APIRouter(prefix="/api/orders", tags=["orders"])

# Default sales/income account used for new in-house manufactured job-sheet products.
DEFAULT_MANUFACTURED_INCOME_ACCOUNT_UID = "3d453a97-a7e0-4c7f-a0be-fd89ba3f6a46"


def _myob_import_line_product_code(oi: OrderItem, order_import_source: str | None) -> str:
    """List/detail label for ``myob_import`` lines: Dolphin uses the leading product code in the description."""
    src = str(order_import_source or "")
    is_dolphin = src == "DOLPHIN_TSV" or (
        isinstance(getattr(oi, "myob_item_json", None), dict) and (oi.myob_item_json or {}).get("_dolphin")
    )
    if is_dolphin:
        cf = customer_facing_product_code_from_import_description(getattr(oi, "import_line_description", None))
        if cf:
            return cf
    n = str(getattr(oi, "myob_item_number", None) or getattr(oi, "myob_item_name", None) or "").strip()
    if n:
        return n
    return "MYOB"


def _job_to_dto(j) -> JobDTO:
    return JobDTO(
        id=j.id,
        job_code=j.job_code,
        planned_qty=j.planned_qty,
        produced_qty=j.produced_qty,
        allocated_order_units=j.allocated_order_units,
        status=str(j.status),
    )


def _myob_all_job_sheets_flag(o) -> bool | None:
    if getattr(o, "import_source", None) != "MYOB":
        return None
    items = list(getattr(o, "items", None) or [])
    need = [
        i
        for i in items
        if getattr(i, "line_kind", None) == "myob_import" and bool(getattr(i, "import_requires_job_sheet", False))
    ]
    if not need:
        return True
    for i in need:
        if not getattr(i, "job_sheet_id", None):
            return False
        js = getattr(i, "job_sheet", None)
        if js is not None and bool(getattr(js, "is_import_draft", False)):
            return False
    return True


def _resell_line_counts(o) -> tuple[int, int]:
    """Return (outsourced_manufacturing resell lines, supply resell lines)."""
    out_n, sup_n = 0, 0
    for oi in getattr(o, "items", None) or []:
        if getattr(oi, "line_kind", None) != "resell":
            continue
        rp = getattr(oi, "resell_product", None)
        if rp is not None and str(getattr(rp, "catalog_kind", None) or "") == "outsourced_manufacturing":
            out_n += 1
        else:
            sup_n += 1
    return out_n, sup_n


def _myob_income_display_for_order_item(db, oi: OrderItem) -> tuple[str | None, str | None]:
    """Resolve income account display id + name for an import line (Crown Pack MYOB vs Dolphin TSV)."""
    j = getattr(oi, "myob_item_json", None)
    if isinstance(j, dict):
        d0 = j.get("_dolphin")
        if isinstance(d0, dict):
            iid = str(d0.get("income_account_id") or "").strip()
            if iid:
                acc = db.get(MyobIncomeAccount, iid)
                if acc is not None:
                    return (
                        str(acc.display_id) if acc.display_id else None,
                        str(acc.name) if acc.name else None,
                    )
        inc = j.get("IncomeAccount")
        if isinstance(inc, dict):
            iu = str(inc.get("UID") or "").strip()
            if iu:
                acc = db.get(MyobIncomeAccount, iu)
                if acc is None:
                    acc = db.scalar(
                        select(MyobIncomeAccount).where(MyobIncomeAccount.myob_account_uid == iu)
                    )
                if acc is not None:
                    return (
                        str(acc.display_id) if acc.display_id else None,
                        str(acc.name) if acc.name else None,
                    )
    uid = str(getattr(oi, "myob_item_uid", None) or "").strip()
    if uid:
        row = db.get(MyobItemSellingUom, uid)
        iu2 = str(getattr(row, "myob_income_account_uid", None) or "").strip() if row is not None else ""
        if iu2:
            acc = db.get(MyobIncomeAccount, iu2)
            if acc is not None:
                return (
                    str(acc.display_id) if acc.display_id else None,
                    str(acc.name) if acc.name else None,
                )
    return (None, None)


def _default_income_display_for_new_job_sheet(db) -> tuple[str | None, str | None]:
    """Fallback income account for in-house manufactured/new job-sheet products."""
    acc = db.get(MyobIncomeAccount, DEFAULT_MANUFACTURED_INCOME_ACCOUNT_UID)
    if acc is None:
        return (None, None)
    return (
        str(acc.display_id) if acc.display_id else None,
        str(acc.name) if acc.name else None,
    )


def _products_summary(o) -> tuple[str | None, int]:
    """Return (first product code/label, number of additional product-like lines)."""
    codes: list[str] = []
    for oi in getattr(o, "items", None) or []:
        kind = str(getattr(oi, "line_kind", None) or "manufactured")
        if kind == "manufactured":
            js = getattr(oi, "job_sheet", None)
            p = getattr(js, "product", None) if js is not None else None
            code = str(getattr(p, "code", None) or "").strip()
        elif kind == "myob_import":
            code = _myob_import_line_product_code(oi, getattr(o, "import_source", None))
        else:
            continue
        if code:
            codes.append(code)
    if not codes:
        return None, 0
    return codes[0], max(0, len(codes) - 1)


def _order_total_from_orm(o) -> float | None:
    """Sum line totals from job sheets, resell, and MYOB import lines (unified order_items)."""
    total = 0.0
    any_line = False
    for oi in getattr(o, "items", None) or []:
        kind = getattr(oi, "line_kind", None) or "manufactured"
        if kind == "resell":
            t = getattr(oi, "resell_line_total", None)
            if t is not None:
                total += float(t)
                any_line = True
            continue
        if kind == "myob_import":
            js = getattr(oi, "job_sheet", None)
            if js is not None and getattr(js, "line_total", None) is not None:
                total += float(js.line_total)
                any_line = True
            elif getattr(oi, "import_line_total", None) is not None:
                total += float(oi.import_line_total)
                any_line = True
            continue
        js = getattr(oi, "job_sheet", None)
        if js is not None and getattr(js, "line_total", None) is not None:
            total += float(js.line_total)
            any_line = True
    return total if any_line else None


def _order_to_list_dto(o) -> OrderListItemDTO:
    return OrderListItemDTO(
        id=o.id,
        code=o.code,
        customer_purchase_order_number=getattr(o, "customer_purchase_order_number", None),
        status=(getattr(o.status, "value", None) or str(o.status)),
        customer_id=o.customer_id,
        product_version_id=o.product_version_id,
        customer_name=(o.customer.name if getattr(o, "customer", None) else None),
        item_count=len(getattr(o, "items", []) or []),
        order_total=_order_total_from_orm(o),
        created_at=str(getattr(o, "created_at", None)) if getattr(o, "created_at", None) else None,
        order_date=str(getattr(o, "order_date", None)) if getattr(o, "order_date", None) else None,
        import_source=getattr(o, "import_source", None),
        myob_order_uid=getattr(o, "myob_order_uid", None),
        myob_synced_at=(
            o.myob_synced_at.isoformat() if getattr(o, "myob_synced_at", None) is not None else None
        ),
        myob_all_job_sheets_entered=_myob_all_job_sheets_flag(o),
    )


def _order_to_detail_dto(o) -> OrderDetailDTO:
    return OrderDetailDTO(
        **_order_to_list_dto(o).model_dump(),
        jobs=[_job_to_dto(j) for j in (o.jobs or [])],
        myob_source_sales_order_json=(
            dict(getattr(o, "myob_source_sales_order_json"))
            if isinstance(getattr(o, "myob_source_sales_order_json", None), dict)
            else None
        ),
        myob_source_invoices_json=(
            list(getattr(o, "myob_source_invoices_json"))
            if isinstance(getattr(o, "myob_source_invoices_json", None), list)
            else []
        ),
    )


@router.get("", response_model=OrderListResponse, dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))])
async def list_orders(
    customer_id: str | None = Query(default=None),
    brand_id: str | None = Query(default=None, description="Filter by customers.brand_id (UUID)"),
    brand_code: str | None = Query(
        default=None,
        description="Filter by brand code (e.g. CROWN_PACK, DOLPHIN); ignored if brand_id is set",
    ),
    invoice_number: str | None = Query(default=None),
    customer_po: str | None = Query(default=None),
    customer: str | None = Query(default=None),
    product: str | None = Query(default=None),
    order_total_min: float | None = Query(default=None),
    order_total_max: float | None = Query(default=None),
    status: str | None = Query(default=None),
    order_date_from: date | None = Query(default=None),
    order_date_to: date | None = Query(default=None),
    line_item_search: str | None = Query(default=None),
    search: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=200),
):
    if customer_id:
        try:
            uuid.UUID(str(customer_id))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid customer_id")
    if brand_id:
        try:
            uuid.UUID(str(brand_id))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid brand_id")
    orders, total = service.list_orders(
        customer_id=customer_id,
        brand_id=brand_id,
        brand_code=brand_code,
        invoice_number=invoice_number,
        customer_po=customer_po,
        customer=customer,
        product=product,
        order_total_min=order_total_min,
        order_total_max=order_total_max,
        status=status,
        order_date_from=order_date_from,
        order_date_to=order_date_to,
        line_item_search=line_item_search,
        search=search,
        page=page,
        page_size=page_size,
    )
    # Enrich with product code/version in a single DB round trip.
    # For multi-item orders, we use the first item as the summary.
    meta: dict[str, dict] = {}
    ids = [str(o.product_version_id) for o in orders if getattr(o, "product_version_id", None)]
    if ids:
        with SessionLocal() as db:
            rows = (
                db.query(ProductVersion, Product)
                .join(Product, Product.id == ProductVersion.product_id)
                .filter(ProductVersion.id.in_(ids))
                .all()
            )
            changed = False
            for pv, p in rows:
                computed_code = ""
                if isinstance(getattr(pv, "spec_payload", None), dict):
                    computed_code = compute_product_code_full(p, pv.spec_payload)
                if computed_code and computed_code != getattr(p, "code", None):
                    p.code = computed_code
                    db.add(p)
                    changed = True
                meta[str(pv.id)] = {"product_code": p.code, "version_number": pv.version_number}
            if changed:
                db.commit()
    out: list[OrderListItemDTO] = []
    for o in orders:
        dto = _order_to_list_dto(o)
        r_out, r_sup = _resell_line_counts(o)
        first_man_code, manu_other_n = _products_summary(o)
        dto = dto.model_copy(
            update={
                "manufactured_first_product_code": first_man_code,
                "manufactured_other_line_count": manu_other_n,
                "resell_outsourced_line_count": r_out,
                "resell_supply_line_count": r_sup,
            }
        )
        m = meta.get(str(o.product_version_id)) if getattr(o, "product_version_id", None) else None
        if m:
            dto.product_code = dto.product_code or m.get("product_code")
            dto.version_number = m.get("version_number")
        out.append(dto)
    return {"items": out, "total": total, "page": page, "page_size": page_size}


@router.post("", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def create_order(payload: CreateOrderRequest, identity=Depends(current_identity)):
    try:
        u = identity.get("user")
        created_by = (u.get("username") if isinstance(u, dict) else getattr(u, "username", None) if u else None) or "system"
        o = service.create_order(payload, created_by=created_by)
        return {"ok": True, "order_id": str(o.id)}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.patch("/{order_id}", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def update_order(order_id: str, payload: UpdateOrderRequest):
    try:
        uuid.UUID(str(order_id))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid order_id")
    try:
        o = service.update_order(order_id, payload)
        return {"ok": True, "order_id": str(o.id)}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.post("/{order_id}/items", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def add_order_item(order_id: str, payload: CreateOrderItemRequest, identity=Depends(current_identity)):
    try:
        u = identity.get("user")
        created_by = (u.get("username") if isinstance(u, dict) else getattr(u, "username", None) if u else None) or "system"
        oi = service.add_order_item(order_id, payload, created_by=created_by)
        return {"ok": True, "order_item_id": str(oi.id)}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.delete("/{order_id}/items/{order_item_id}", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def remove_order_item(order_id: str, order_item_id: str):
    try:
        service.remove_order_item(order_id, order_item_id)
        return {"ok": True}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.post("/{order_id}/resell-items", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def add_order_resell_item(order_id: str, payload: CreateResellOrderLineRequest, identity=Depends(current_identity)):
    try:
        u = identity.get("user")
        created_by = (u.get("username") if isinstance(u, dict) else getattr(u, "username", None) if u else None) or "system"
        ln = service.add_order_resell_line(order_id, payload, created_by=created_by)
        return {"ok": True, "resell_line_id": str(ln.id)}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.patch(
    "/{order_id}/resell-items/{line_id}",
    dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())],
)
async def patch_order_resell_item(order_id: str, line_id: str, payload: UpdateResellOrderLineRequest):
    try:
        service.update_order_resell_line(order_id, line_id, payload)
        return {"ok": True}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.delete(
    "/{order_id}/resell-items/{line_id}",
    dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())],
)
async def remove_order_resell_item(order_id: str, line_id: str):
    try:
        service.remove_order_resell_line(order_id, line_id)
        return {"ok": True}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.post(
    "/{order_id}/resell-items/{line_id}/convert-to-myob-job-sheet",
    dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())],
)
async def convert_resell_line_to_myob_job_sheet(order_id: str, line_id: str, identity=Depends(current_identity)):
    """
    When MYOB import classified a line as resell (``IsBought``) but it should be manufactured, convert the row to
    ``myob_import`` with ``import_requires_job_sheet`` and a new import-draft job sheet (same as re-import path).
    """
    try:
        u = identity.get("user")
        created_by = (u.get("username") if isinstance(u, dict) else getattr(u, "username", None) if u else None) or "system"
        oi = service.convert_resell_line_to_myob_import_job_sheet(order_id, line_id, created_by=created_by)
        return {"ok": True, "order_item_id": str(oi.id), "job_sheet_id": str(oi.job_sheet_id) if oi.job_sheet_id else None}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.post(
    "/{order_id}/myob-import-lines/{line_id}/link",
    dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())],
)
async def link_myob_import_line(order_id: str, line_id: str, payload: LinkMyobImportLineRequest):
    try:
        service.link_myob_import_line_job_sheet(
            order_id, line_id, str(payload.job_sheet_id)
        )
        return {"ok": True}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.get("/bootstrap", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))])
async def orders_bootstrap(customer_id: str | None = Query(default=None)):
    """
    Data needed to render the "New Order" form:
    - customers list
    - active product versions list with product code + version number
    - resell products: when ``customer_id`` is set, outsourced manufacturing rows are limited to that customer
      (supply / fees rows are always included).
    """
    with SessionLocal() as db:
        customers = (
            db.query(Customer)
            .order_by(Customer.name.asc())
            .all()
        )
        versions = (
            db.query(ProductVersion, Product, Customer)
            .join(Product, ProductVersion.id == Product.active_version_id)
            .join(Customer, Product.customer_id == Customer.id, isouter=True)
            .order_by(Product.code.asc(), ProductVersion.version_number.desc())
            .all()
        )
        changed = False
        if versions:
            for pv, p, cust in versions:
                computed_code = ""
                if isinstance(getattr(pv, "spec_payload", None), dict):
                    computed_code = compute_product_code_full(p, pv.spec_payload)
                if computed_code and computed_code != getattr(p, "code", None):
                    p.code = computed_code
                    db.add(p)
                    changed = True
            if changed:
                db.commit()
        resell_q = db.query(ResellProduct).filter(ResellProduct.active.is_(True))
        cid = (customer_id or "").strip()
        if cid:
            try:
                uuid.UUID(cid)
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid customer_id")
            resell_q = resell_q.filter(
                or_(
                    ResellProduct.catalog_kind != "outsourced_manufacturing",
                    ResellProduct.customer_id == cid,
                )
            )
        resell_products = resell_q.order_by(ResellProduct.description.asc()).all()
    return {
        "customers": [{"id": str(c.id), "name": c.name} for c in customers],
        "resell_products": [
            {
                "id": str(r.id),
                "description": str(r.description),
                "unit_price": float(r.unit_price) if r.unit_price is not None else 0.0,
                "catalog_kind": str(getattr(r, "catalog_kind", None) or "supply"),
                "customer_id": str(r.customer_id) if getattr(r, "customer_id", None) else None,
            }
            for r in resell_products
        ],
        # legacy field (kept so older clients can still render a version dropdown)
        "versions": [
            {
                "id": str(pv.id),
                "product_id": str(p.id),
                "product_code": p.code,
                "version_number": pv.version_number,
                "customer_name": (cust.name if cust else None),
            }
            for (pv, p, cust) in versions
        ],
    }


@router.get("/{order_id}", response_model=OrderDetailDTO, dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER", "OPERATOR"))])
async def show_order(order_id: str):
    o = service.get_detail(order_id)
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    dto = _order_to_detail_dto(o)
    r_out, r_sup = _resell_line_counts(o)
    dto = dto.model_copy(
        update={
            "resell_outsourced_line_count": r_out,
            "resell_supply_line_count": r_sup,
        }
    )
    # Add customer_name and product meta
    dto.customer_name = (o.customer.name if getattr(o, "customer", None) else None)
    dto.created_at = str(getattr(o, "created_at", None)) if getattr(o, "created_at", None) else None
    dto.order_date = str(getattr(o, "order_date", None)) if getattr(o, "order_date", None) else None
    with SessionLocal() as db:
        if getattr(o, "product_version_id", None):
            pv = db.get(ProductVersion, str(o.product_version_id))
            if pv:
                p = db.get(Product, str(pv.product_id))
                if p:
                    computed_code = ""
                    if isinstance(getattr(pv, "spec_payload", None), dict):
                        computed_code = compute_product_code_full(p, pv.spec_payload)
                    if computed_code and computed_code != getattr(p, "code", None):
                        p.code = computed_code
                        db.add(p)
                        try:
                            db.commit()
                        except Exception:
                            db.rollback()
                    dto.product_code = p.code
                else:
                    dto.product_code = None
                dto.version_number = pv.version_number

        def _js_meta(js):
            if js is None:
                return None, None
            return str(js.product_id) if getattr(js, "product_id", None) else None, (
                str(js.job_no) if getattr(js, "job_no", None) else None
            )

        dto.items = []
        changed_items = False
        ois = (
            db.query(OrderItem)
            .filter(OrderItem.order_id == str(o.id))
            .order_by(OrderItem.line_index.asc(), OrderItem.id.asc())
            .all()
        )
        for oi in ois:
            if oi.line_kind == "resell":
                resell_raw = (
                    (str(oi.import_line_description).strip() if getattr(oi, "import_line_description", None) else "")
                    or (str(oi.resell_description_snapshot).strip() if getattr(oi, "resell_description_snapshot", None) else "")
                )
                resell_name = strip_trailing_dash_suffix(resell_raw)
                rp_row = (
                    db.get(ResellProduct, str(oi.resell_product_id)) if getattr(oi, "resell_product_id", None) else None
                )
                rck = str(getattr(rp_row, "catalog_kind", None) or "supply") if rp_row is not None else "supply"
                inc_disp: str | None = None
                inc_name: str | None = None
                if rp_row is not None and getattr(rp_row, "myob_income_account_uid", None):
                    acc_r = db.get(MyobIncomeAccount, str(rp_row.myob_income_account_uid))
                    if acc_r is not None:
                        inc_disp = str(acc_r.display_id) if acc_r.display_id else None
                        inc_name = str(acc_r.name) if acc_r.name else None
                dto.items.append(
                    {
                        "line_kind": "resell",
                        "id": str(oi.id),
                        "resell_line_id": str(oi.id),
                        "myob_item_uid": getattr(oi, "myob_item_uid", None),
                        "myob_row_id": getattr(oi, "myob_row_id", None),
                        "resell_product_id": str(oi.resell_product_id) if oi.resell_product_id else None,
                        "resell_catalog_kind": rck,
                        "income_account_display_id": inc_disp,
                        "income_account_name": inc_name,
                        "job_sheet_id": None,
                        "job_no": None,
                        "product_id": str(oi.resell_product_id) if oi.resell_product_id else None,
                        "product_code": "Resell",
                        "product_name": resell_name,
                        "product_version_id": None,
                        "version_number": None,
                        "finish_mode": None,
                        "due_date": (str(oi.resell_due_date) if getattr(oi, "resell_due_date", None) is not None else None),
                        "quantity_value": float(oi.resell_quantity_value) if oi.resell_quantity_value is not None else 0.0,
                        "quantity_unit": str(oi.resell_quantity_unit or "ea"),
                        "rate": float(oi.resell_unit_rate) if getattr(oi, "resell_unit_rate", None) is not None else None,
                        "total_price": float(oi.resell_line_total) if getattr(oi, "resell_line_total", None) is not None else None,
                    }
                )
                continue
            if oi.line_kind == "myob_import":
                js = db.get(JobSheet, str(oi.job_sheet_id)) if oi.job_sheet_id else None
                linked_pid, jno = _js_meta(js)
                id_disp, nm_income = _myob_income_display_for_order_item(db, oi)
                dto.items.append(
                    {
                        "line_kind": "myob_import",
                        "id": str(oi.id),
                        "line_index": oi.line_index,
                        "description": oi.import_line_description,
                        "ship_quantity": float(oi.import_ship_quantity) if oi.import_ship_quantity is not None else 0.0,
                        "quantity_unit": oi.import_quantity_unit,
                        "qty_type": oi.import_qty_type,
                        "unit_price": float(oi.import_unit_price) if oi.import_unit_price is not None else None,
                        "line_total": float(oi.import_line_total) if oi.import_line_total is not None else None,
                        "myob_item_number": oi.myob_item_number,
                        "myob_item_name": oi.myob_item_name,
                        "myob_item_sales_unit_raw": oi.myob_item_sales_unit_raw,
                        "requires_job_sheet": bool(oi.import_requires_job_sheet),
                        "job_sheet_id": str(oi.job_sheet_id) if oi.job_sheet_id else None,
                        "is_import_draft": bool(getattr(js, "is_import_draft", False)) if js is not None else None,
                        "job_no": jno,
                        "linked_product_id": linked_pid,
                        "product_id": None,
                        "product_code": _myob_import_line_product_code(oi, getattr(o, "import_source", None)),
                        "product_name": oi.import_line_description,
                        "quantity_value": float(oi.import_ship_quantity) if oi.import_ship_quantity is not None else 0.0,
                        "rate": float(oi.import_unit_price) if oi.import_unit_price is not None else None,
                        "total_price": float(oi.import_line_total) if oi.import_line_total is not None else None,
                        "income_account_display_id": id_disp,
                        "income_account_name": nm_income,
                    }
                )
                continue
            if not oi.job_sheet_id:
                continue
            item_rows = (
                db.query(JobSheet, ProductVersion, Product)
                .join(ProductVersion, ProductVersion.id == JobSheet.product_version_id)
                .join(Product, Product.id == ProductVersion.product_id)
                .filter(JobSheet.id == str(oi.job_sheet_id))
                .all()
            )
            if not item_rows:
                continue
            (js, pv, p) = item_rows[0]
            computed_code = ""
            if isinstance(getattr(pv, "spec_payload", None), dict):
                computed_code = compute_product_code_full(p, pv.spec_payload)
            if computed_code and computed_code != getattr(p, "code", None):
                p.code = computed_code
                db.add(p)
                changed_items = True
            spec_payload = pv.spec_payload if isinstance(getattr(pv, "spec_payload", None), dict) else {}
            iden_raw = spec_payload.get("identity")
            iden = iden_raw if isinstance(iden_raw, dict) else {}
            item_finish_mode = iden.get("finish_mode")
            myob_line = (str(oi.import_line_description).strip() if getattr(oi, "import_line_description", None) else "") or None
            spec_desc = getattr(p, "description", None)
            display_name = myob_line or spec_desc
            id_disp, nm_income = _myob_income_display_for_order_item(db, oi)
            if not id_disp and not nm_income:
                id_disp, nm_income = _default_income_display_for_new_job_sheet(db)
            dto.items.append(
                {
                    "line_kind": "product",
                    "id": str(oi.id),
                    "job_sheet_id": str(js.id),
                    "job_no": js.job_no,
                    "is_import_draft": bool(getattr(js, "is_import_draft", False)),
                    "import_line_description": myob_line,
                    "product_id": str(p.id),
                    "product_code": p.code,
                    "product_name": display_name,
                    "product_version_id": str(pv.id),
                    "version_number": pv.version_number,
                    "finish_mode": item_finish_mode,
                    "due_date": (str(js.due_date.date()) if getattr(js, "due_date", None) is not None else None),
                    "quantity_value": float(js.quantity_value),
                    "quantity_unit": js.quantity_unit,
                    "rate": float(js.unit_rate) if getattr(js, "unit_rate", None) is not None else None,
                    "total_price": float(js.line_total) if getattr(js, "line_total", None) is not None else None,
                    "income_account_display_id": id_disp,
                    "income_account_name": nm_income,
                }
            )
        if changed_items:
            db.commit()

    dto.myob_import_lines = []
    return dto


@router.post("/{order_id}/jobs", dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())])
async def create_job(
    order_id: str,
    payload: CreateJobRequest,
):
    try:
        j = service.create_job(order_id, payload)
        return {"ok": True, "job": _job_to_dto(j)}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.post("/{order_id}/publish", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def publish_order(order_id: str):
    try:
        o = service.publish_order(order_id)
        return {"ok": True, "order_id": str(o.id), "status": (getattr(o.status, "value", None) or str(o.status))}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)

