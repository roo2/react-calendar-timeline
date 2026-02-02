from __future__ import annotations

import uuid
from typing import Optional, Tuple, List, Dict, Any

from sqlalchemy import select, func, or_
from sqlalchemy.orm import Session, joinedload

from app.db.session import SessionLocal
from app.db.models.domain import Product, ProductVersion, OperatorSuggestion, Customer
from app.exceptions import DomainError
from app.products.schemas import (
    CreateProductRequest,
    CreateProductVersionRequest,
    OperatorSuggestionRequest,
    SpecPayload,
    PrintMethod,
    FinishMode,
)


def _ensure_customer_exists(db: Session, customer_id: str) -> None:
    try:
        cid = uuid.UUID(customer_id)
    except Exception as e:
        raise DomainError("Invalid customer_id") from e
    exists = db.scalar(select(func.count()).select_from(Customer).where(Customer.id == cid)) or 0
    if exists == 0:
        raise DomainError("Customer not found")


def _next_version_number(db: Session, product_id: uuid.UUID) -> int:
    current = db.scalar(
        select(func.max(ProductVersion.version_number)).where(ProductVersion.product_id == product_id)
    )
    return int(current or 0) + 1


def create_product_with_version(payload: CreateProductRequest, created_by: str) -> Tuple[Product, ProductVersion]:
    with SessionLocal() as db:
        _ensure_customer_exists(db, payload.customer_id)
        # Ensure unique product code
        existing = db.scalar(select(func.count()).select_from(Product).where(Product.code == payload.code)) or 0
        if existing > 0:
            raise DomainError("Product code already exists")
        product = Product(code=payload.code, customer_id=uuid.UUID(payload.customer_id))
        db.add(product)
        db.flush()  # get product.id
        version = ProductVersion(
            product_id=product.id,
            version_number=1,
            created_by=created_by or "system",
            spec_payload=payload.spec.dict(),
        )
        db.add(version)
        db.flush()
        product.active_version_id = version.id
        db.add(product)
        db.commit()
        db.refresh(product)
        db.refresh(version)
        return product, version


def get_with_versions(product_id: str) -> Optional[Product]:
    with SessionLocal() as db:
        pid = uuid.UUID(product_id)
        stmt = (
            select(Product)
            .options(joinedload(Product.versions))
            .options(joinedload(Product.customer))
            .where(Product.id == pid)
        )
        return db.scalar(stmt)


def get_version(version_id: str) -> Optional[ProductVersion]:
    with SessionLocal() as db:
        vid = uuid.UUID(version_id)
        stmt = select(ProductVersion).where(ProductVersion.id == vid)
        return db.scalar(stmt)


def create_new_version(product_id: str, payload: CreateProductVersionRequest, created_by: str) -> ProductVersion:
    with SessionLocal() as db:
        pid = uuid.UUID(product_id)
        # ensure product exists
        product = db.get(Product, pid)
        if not product:
            raise DomainError("Product not found")
        vnum = _next_version_number(db, pid)
        version = ProductVersion(
            product_id=pid,
            version_number=vnum,
            created_by=created_by or "system",
            spec_payload=payload.spec.dict(),
        )
        db.add(version)
        db.flush()
        product.active_version_id = version.id
        db.add(product)
        db.commit()
        db.refresh(version)
        return version


def create_suggestion(req: OperatorSuggestionRequest, created_by: str) -> OperatorSuggestion:
    with SessionLocal() as db:
        product_id = uuid.UUID(req.product_id) if req.product_id else None
        version_id = uuid.UUID(req.version_id) if req.version_id else None
        # optional existence checks
        if product_id and not db.get(Product, product_id):
            raise DomainError("Product not found")
        if version_id and not db.get(ProductVersion, version_id):
            raise DomainError("Product version not found")
        sug = OperatorSuggestion(
            product_id=product_id,
            product_version_id=version_id,
            text=req.suggestion_text,
            category=req.category,
            status="open",
            created_by=created_by or "operator",
        )
        db.add(sug)
        db.commit()
        db.refresh(sug)
        return sug


def resolve_suggestion(suggestion_id: str, decision: str, resolver: str) -> OperatorSuggestion:
    if decision not in ("accept", "reject"):
        raise DomainError("Invalid decision")
    with SessionLocal() as db:
        sid = uuid.UUID(suggestion_id)
        sug = db.get(OperatorSuggestion, sid)
        if not sug:
            raise DomainError("Suggestion not found")
        # Accept → create new ProductVersion by cloning active (if available)
        if decision == "accept":
            if not sug.product_id:
                raise DomainError("Suggestion is not linked to a product")
            product = db.get(Product, sug.product_id)
            if not product or not product.active_version_id:
                raise DomainError("Product active version not found")
            active = db.get(ProductVersion, product.active_version_id)
            if not active:
                raise DomainError("Active version not found")
            cloned_spec = dict(active.spec_payload)
            meta = cloned_spec.get("meta") or {}
            meta["accepted_suggestion_id"] = str(sug.id)
            meta["accepted_text"] = sug.text
            cloned_spec["meta"] = meta
            vnum = _next_version_number(db, product.id)
            new_ver = ProductVersion(
                product_id=product.id,
                version_number=vnum,
                created_by=resolver or "prod_manager",
                spec_payload=cloned_spec,
            )
            db.add(new_ver)
            db.flush()
            product.active_version_id = new_ver.id
            db.add(product)
            sug.status = "accepted"
        else:
            sug.status = "rejected"
        sug.resolved_by = resolver or "prod_manager"
        sug.resolved_at = func.now()
        db.add(sug)
        db.commit()
        db.refresh(sug)
        return sug


def search_products(query: Optional[str]) -> List[Product]:
    with SessionLocal() as db:
        stmt = select(Product).options(joinedload(Product.customer))
        if query:
            like = f"%{query}%"
            stmt = stmt.where(or_(Product.code.ilike(like)))
        stmt = stmt.order_by(Product.created_at.desc())
        return list(db.scalars(stmt).all())


def list_suggestions(product_id: Optional[str] = None, status: Optional[str] = "open") -> List[OperatorSuggestion]:
    with SessionLocal() as db:
        stmt = select(OperatorSuggestion)
        if product_id:
            stmt = stmt.where(OperatorSuggestion.product_id == uuid.UUID(product_id))
        if status:
            stmt = stmt.where(OperatorSuggestion.status == status)
        stmt = stmt.order_by(OperatorSuggestion.created_at.desc())
        return list(db.scalars(stmt).all())


def derive_operation_routing(spec: SpecPayload) -> Dict[str, Any]:
    operations: List[Dict[str, str]] = []
    warnings: List[str] = []
    operations.append(
        {"operation_type": "EXTRUSION", "description": "Extrusion (required first operation)"}
    )
    if spec.run_requirements.inline_perforation:
        operations[-1]["description"] += " with inline perforation"
    if spec.run_requirements.inline_seal:
        operations[-1]["description"] += " with inline sealing"
    if spec.printing.method == PrintMethod.INLINE:
        operations[-1]["description"] += f" with inline printing ({spec.printing.num_colours or 0} colours)"
    if spec.printing.method == PrintMethod.UTECO:
        operations.append(
            {
                "operation_type": "PRINTING_UTECO",
                "description": f"Uteco Printing ({spec.printing.num_colours or 0} colours) - requires completed Extrusion",
            }
        )
    if spec.identity.finish_mode == FinishMode.CARTONS:
        if spec.printing.method == PrintMethod.UTECO:
            operations.append(
                {"operation_type": "CONVERSION", "description": "Conversion (Bagging) - requires completed Uteco Printing"}
            )
        else:
            operations.append(
                {"operation_type": "CONVERSION", "description": "Conversion (Bagging) - requires completed Extrusion"}
            )
    return {"operations": operations, "warnings": warnings}


def extract_tool_requirements(spec: SpecPayload) -> List[Dict[str, Any]]:
    tools: List[Dict[str, Any]] = []
    if spec.printing.method == PrintMethod.INLINE:
        if (spec.printing.num_colours or 0) == 1:
            tools.append({"stage": "extrusion", "tool_type": "inline_printer_1c", "quantity": 1})
        # Placeholder for other mappings
    if spec.run_requirements.inline_perforation:
        tools.append({"stage": "extrusion", "tool_type": "perforation_vicro", "quantity": 1})
    if spec.tool_requirements:
        for t in spec.tool_requirements:
            tools.append(
                {
                    "stage": t.stage,
                    "tool_type": t.tool_type,
                    "quantity": t.quantity,
                    "preferred_machine_ids": t.preferred_machine_ids,
                    "notes": t.notes,
                }
            )
    return tools



