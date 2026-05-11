from __future__ import annotations

from enum import Enum
import uuid
from typing import Optional, Tuple, List, Dict, Any

from sqlalchemy import select, func, or_
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import IntegrityError

from app.db.session import SessionLocal
from app.db.models.domain import Product, ProductVersion, OperatorSuggestion, Customer
from app.exceptions import DomainError
from app.products.schemas import (
    CreateProductRequest,
    CreateProductVersionRequest,
    OperatorSuggestionRequest,
    ProductType,
    SpecPayload,
    PrintMethod,
    FinishMode,
    UpdateProductRequest,
)


def compute_product_description(spec_payload: Any, *, max_len: Optional[int] = None) -> Optional[str]:
    """
    Compute the canonical product description from a ProductVersion spec_payload.

    Format (mostly uppercase, units in lowercase) e.g.
    "LDPE LF TUBE RED PRINTED 2 COLOURS X 1 SIDE. W55mm X 80µm X L300mm."
    """
    if not isinstance(spec_payload, dict):
        return None

    identity = spec_payload.get("identity") if isinstance(spec_payload.get("identity"), dict) else {}
    dims = spec_payload.get("dimensions") if isinstance(spec_payload.get("dimensions"), dict) else {}
    formulation = spec_payload.get("formulation") if isinstance(spec_payload.get("formulation"), dict) else {}
    printing = spec_payload.get("printing") if isinstance(spec_payload.get("printing"), dict) else {}

    def _up(v: Any) -> str:
        if v is None:
            return ""
        # Enums sometimes leak through as "ProductType.BAG" (enum name), but we need the enum *value*.
        if isinstance(v, Enum):
            v = v.value
        if isinstance(v, str) and "." in v:
            # If the enum name leaked as plain text, keep just the last segment.
            v = v.split(".")[-1]
        s = str(v).strip()
        return s.upper()

    def _int_str(v: Any, *, default: str = "-") -> str:
        try:
            if v is None or (isinstance(v, str) and not v.strip()):
                return default
            n = float(v)
            if not (n == n and n not in (float("inf"), float("-inf"))):  # NaN/inf guard
                return default
            return str(int(round(n)))
        except Exception:
            return default

    def _int(v: Any) -> Optional[int]:
        try:
            if v is None or (isinstance(v, str) and not v.strip()):
                return None
            n = float(v)
            if not (n == n and n not in (float("inf"), float("-inf"))):
                return None
            return int(round(n))
        except Exception:
            return None

    def _derive_num_colours(p: dict) -> int:
        # Prefer explicit num_colours; fall back to counting linked Ink+Plate (or ink_codes)
        # so the description updates immediately when the user adds pairs.
        explicit = _int(p.get("num_colours"))
        if explicit is not None and explicit > 0:
            return explicit
        inks: set[str] = set()
        for key in ("front_ink_plate", "back_ink_plate"):
            rows = p.get(key)
            if isinstance(rows, list):
                for r in rows:
                    if not isinstance(r, dict):
                        continue
                    code = str(r.get("ink_code") or "").strip()
                    if code:
                        inks.add(code.upper())
        codes = p.get("ink_codes")
        if isinstance(codes, list):
            for c in codes:
                code = str(c or "").strip()
                if code:
                    inks.add(code.upper())
        return len(inks)

    # Resin blend (blend_type like "LD" becomes "LDPE"; otherwise try resin_code).
    blend_type = _up(formulation.get("blend_type"))
    resin = ""
    if blend_type and blend_type != "CUSTOM":
        resin = blend_type
    else:
        blend = formulation.get("blend")
        if isinstance(blend, list) and len(blend) == 1 and isinstance(blend[0], dict):
            resin = _up(blend[0].get("resin_code"))
    if resin in {"LD", "LLD", "HD", "MD"}:
        resin = f"{resin}PE"
    elif resin and not resin.endswith("PE") and resin in {"LDPE", "LLDPE", "HDPE", "MDPE"}:
        # already complete; keep
        pass
    elif resin and not resin.endswith("PE") and resin.endswith("P"):  # defensive
        pass

    product_type = _up(identity.get("product_type"))

    # Colour: from colour_components; skip WHITE when other colours exist (opacity / filler masterbatch).
    colour = ""
    comps = formulation.get("colour_components")
    if isinstance(comps, list):
        codes: list[str] = []
        for row in comps:
            if not isinstance(row, dict):
                continue
            cc = str(row.get("colour_code") or "").strip()
            if cc:
                codes.append(_up(cc))
        if codes:
            has_white = "WHITE" in codes
            has_other = any(c != "WHITE" for c in codes)
            if has_white and has_other:
                colour = next((c for c in codes if c != "WHITE"), "")
            else:
                colour = codes[0]
    if not colour:
        legacy = formulation.get("colour") if isinstance(formulation.get("colour"), dict) else {}
        colour = _up(legacy.get("colour_code"))

    method = _up(printing.get("method"))
    printed = bool(method) and method != _up(PrintMethod.NONE.value)
    printed_seg = ""
    if printed:
        num_colours_i = _derive_num_colours(printing)
        num_colours = str(num_colours_i)
        side = (printing.get("side") or "").strip().lower()
        num_sides = "2" if side == "both" else "1"
        colour_word = "COLOUR" if num_colours == "1" else "COLOURS"
        side_word = "SIDE" if num_sides == "1" else "SIDES"
        printed_seg = f"PRINTED {num_colours} {colour_word} X {num_sides} {side_word}"

    geometry = _up(dims.get("geometry"))
    gusset_mm_i = _int(dims.get("gusset_mm")) or 0
    has_gusset = geometry == "GUSSET" or gusset_mm_i > 0
    gusset_prefix = "G" if has_gusset else "LF"
    can_show_gusset_prefix = product_type in {"BAG", "TUBE"}
    is_sheet = product_type == "SHEET" or geometry == "SHEET"
    lf_or_g = "SWS" if is_sheet else (gusset_prefix if can_show_gusset_prefix else "")

    width = _int_str(dims.get("base_width_mm"))
    width_seg = f"({width}mm + {gusset_mm_i}mm)" if has_gusset and gusset_mm_i > 0 else f"{width}mm"

    gauge = _int_str(dims.get("thickness_um"))
    base_len_mm = dims.get("base_length_mm")
    include_len = base_len_mm is not None
    length_seg = f"{_int_str(base_len_mm)}mm" if include_len else ""

    name_parts = [p for p in [resin, lf_or_g, product_type, colour] if p]
    name = " ".join(name_parts).strip() or "UNKNOWN PRODUCT"

    # Gauge should be the last of the dimensions.
    dims_seg = f"W{width_seg}"
    if include_len:
        dims_seg += f" X L{length_seg}"
    dims_seg += f" X {gauge}µm"
    # Sentences: "<NAME>." "PRINTED ..." "<DIMS>."
    parts: list[str] = [f"{name}."]
    if printed_seg:
        parts.append(f"{printed_seg}.")
    parts.append(f"{dims_seg}.")
    desc = " ".join(parts)
    if max_len is not None and len(desc) > max_len:
        desc = desc[: max_len].rstrip()
    return desc


def _up(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, Enum):
        v = v.value
    if isinstance(v, str) and "." in v:
        v = v.split(".")[-1]
    return str(v).strip().upper()


def _int_or_null(v: Any) -> int | None:
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    try:
        n = float(v)
        if not (n == n and n not in (float("inf"), float("-inf"))):
            return None
        return int(round(n))
    except Exception:
        return None


def _int_str(v: Any, *, fallback: str) -> str:
    if v is None or (isinstance(v, str) and not v.strip()):
        return fallback
    try:
        n = float(v)
        if not (n == n and n not in (float("inf"), float("-inf"))):
            return fallback
        return str(int(round(n)))
    except Exception:
        return fallback


def _derive_num_colours(printing: dict) -> int:
    explicit = _int_or_null(printing.get("num_colours"))
    if explicit is not None and explicit > 0:
        return explicit

    inks: set[str] = set()
    for key in ("front_ink_plate", "back_ink_plate"):
        rows = printing.get(key)
        if not isinstance(rows, list):
            continue
        for r in rows:
            if not isinstance(r, dict):
                continue
            code = str(r.get("ink_code") or "").strip()
            if code:
                inks.add(code.upper())

    codes = printing.get("ink_codes")
    if isinstance(codes, list):
        for c in codes:
            code = str(c or "").strip()
            if code:
                inks.add(code.upper())

    return len(inks)


def _total_print_inks(printing: dict) -> int:
    # xP suffix uses the total count of ink_code rows across BOTH sides.
    def _count(rows: Any) -> int:
        if not isinstance(rows, list):
            return 0
        n = 0
        for r in rows:
            if not isinstance(r, dict):
                continue
            if str(r.get("ink_code") or "").strip():
                n += 1
        return n

    front_n = _count(printing.get("front_ink_plate"))
    back_n = _count(printing.get("back_ink_plate"))
    total = front_n + back_n
    if total > 0:
        return total

    explicit = _int_or_null(printing.get("num_colours"))
    if explicit is not None and explicit > 0:
        return explicit

    return _derive_num_colours(printing)


PRODUCT_TYPE_PREFIX: dict[str, str] = {
    "BAG": "PB",
    "TUBE": "PT",
    "SLEEVE": "SV",
    "SHEET": "ST",
    "CENTERFOLD": "CF",
    "U-FILM": "UF",
    "UFILM": "UF",
}


def compute_product_code_base(spec_payload: Any) -> str:
    """
    Compute product code from spec only (no customer prefix).

    If ``identity.customer_code`` is set, it is returned as the product code (customer-visible override).

    Matches the frontend algorithm:
    - single dashes between segments (missing segments are omitted)
    - xP suffix where P = number of ink_code rows across both sides
    """
    if not isinstance(spec_payload, dict):
        return ""

    identity = spec_payload.get("identity") if isinstance(spec_payload.get("identity"), dict) else {}
    manual = str(identity.get("customer_code") or "").strip()
    if manual:
        return manual

    dims = spec_payload.get("dimensions") if isinstance(spec_payload.get("dimensions"), dict) else {}
    formulation = spec_payload.get("formulation") if isinstance(spec_payload.get("formulation"), dict) else {}
    printing = spec_payload.get("printing") if isinstance(spec_payload.get("printing"), dict) else {}

    product_type = _up(identity.get("product_type"))
    type_prefix = PRODUCT_TYPE_PREFIX.get(product_type, "XX")

    finish_mode = _up(identity.get("finish_mode"))
    finish_char = "C" if finish_mode == "CARTONS" else "R"

    geometry = _up(dims.get("geometry"))
    base_width = _int_or_null(dims.get("base_width_mm"))
    gusset_mm = _int_or_null(dims.get("gusset_mm")) or 0
    has_gusset = geometry == "GUSSET" or gusset_mm > 0
    is_centerfold = product_type == "CENTERFOLD" or geometry == "CENTREFOLD"
    is_ufilm = product_type in {"U-FILM", "UFILM"} or geometry == "UFILM"
    is_sheet = product_type == "SHEET" or geometry == "SHEET"

    width_seg = _int_str(dims.get("base_width_mm"), fallback="")
    if width_seg:
        if has_gusset and gusset_mm > 0:
            width_seg = f"({_int_str(dims.get('base_width_mm'), fallback='-')}+{gusset_mm})"
        elif is_centerfold and base_width is not None:
            layflat = int(round(base_width / 2))
            width_seg = f"{layflat}({base_width})"
        elif is_sheet and base_width is not None:
            run_req = spec_payload.get("run_requirements") if isinstance(spec_payload.get("run_requirements"), dict) else {}
            ru_slug = str(run_req.get("run_up") or "none").strip().lower()
            ru = 1 if ru_slug == "1up" else 2 if ru_slug == "2up" else 4 if ru_slug == "4up" else 6 if ru_slug == "6up" else 2
            layflat = int(round(base_width * (ru / 2))) if ru > 0 else base_width
            width_seg = f"{layflat}({base_width})"
        elif is_ufilm:
            l = _int_or_null(dims.get("ufilm_left_width_mm")) or 0
            r = _int_or_null(dims.get("ufilm_right_width_mm")) or 0
            w = base_width or 0
            width_seg = f"{l}/{w}/{r}"

    length_mm = _int_str(dims.get("base_length_mm"), fallback="")
    gauge_um = _int_str(dims.get("thickness_um"), fallback="")

    colour_code = ""
    comps = formulation.get("colour_components")
    if isinstance(comps, list):
        for row in comps:
            if isinstance(row, dict):
                cc = str(row.get("colour_code") or "").strip()
                if cc:
                    colour_code = _up(cc)[:3]
                    break
    if not colour_code:
        legacy_colour = formulation.get("colour") if isinstance(formulation.get("colour"), dict) else {}
        cc = legacy_colour.get("colour_code")
        if cc:
            colour_code = _up(cc)[:3]
    # If no colour code is available, omit the segment entirely.
    # Using a placeholder (e.g. '---') causes extra dashes in the final code.
    if not colour_code:
        colour_code = ""

    print_seg = ""
    method = _up(printing.get("method"))
    if method and method != "NONE":
        n = _total_print_inks(printing)
        if n > 0:
            print_seg = f"{n}P"

    parts: list[str] = [f"{type_prefix}{finish_char}"]
    if width_seg:
        parts.append(width_seg)
    if length_mm:
        parts.append(length_mm)
    if gauge_um:
        parts.append(gauge_um)
    if colour_code:
        parts.append(colour_code)
    if print_seg:
        parts.append(print_seg)

    return "-".join(parts)


def compute_product_code_full(product: Product, spec_payload: Any) -> str:
    """
    Product code shown/stored from spec (no customer prefix).
    Manual ``identity.customer_code`` wins when present; else generated from dimensions/printing.
    `product` is kept for call-site compatibility; code is derived only from spec_payload.
    """
    _ = product  # unused; signature preserved for callers
    return compute_product_code_base(spec_payload)


def _try_update_product_code(db: Session, product: Product, new_code: str) -> None:
    if not new_code:
        return
    if getattr(product, "code", None) == new_code:
        return
    product.code = new_code


def product_code_exists(code: str, *, customer_id: str) -> bool:
    """True if any product for this customer already uses this code (case-insensitive). Informational only."""
    code_in = (code or "").strip()
    if not code_in:
        return False
    try:
        cid = str(uuid.UUID(customer_id))
    except Exception:
        return False
    with SessionLocal() as db:
        return product_code_taken_in_session(db, code_in, customer_id=cid)


def product_code_taken_in_session(
    db: Session,
    code: str,
    *,
    customer_id: str,
    exclude_product_id: Optional[str] = None,
) -> bool:
    code_in = (code or "").strip()
    if not code_in:
        return True
    stmt = select(func.count()).select_from(Product).where(
        func.lower(Product.code) == code_in.lower(),
        Product.customer_id == str(customer_id),
    )
    if exclude_product_id:
        stmt = stmt.where(Product.id != str(exclude_product_id))
    n = db.scalar(stmt) or 0
    return int(n) > 0


def create_product_v1_in_session(
    db: Session, *, customer_id: str, spec: SpecPayload, created_by: str
) -> tuple[Product, ProductVersion]:
    """
    Create a customer product + v1 in the current transaction (no commit).

    Used when completing a MYOB import draft: the first saved spec should attach to a *new* product,
    not a new version of the global MYOB placeholder product.
    """
    _ensure_customer_exists(db, customer_id)
    cid = str(uuid.UUID(customer_id))
    spec_dict = spec.model_dump() if hasattr(spec, "model_dump") else spec.dict()
    base = (compute_product_code_base(spec_dict) or "").strip()[:32]
    code = base if base else f"IMP-{str(uuid.uuid4())[:8].upper()}"[:32]

    product = Product(
        code=code,
        description=compute_product_description(spec_dict, max_len=255),
        customer_id=cid,
    )
    db.add(product)
    db.flush()
    version = ProductVersion(
        product_id=product.id,
        version_number=1,
        created_by=created_by or "system",
        spec_payload=spec_dict,
    )
    db.add(version)
    db.flush()
    new_code = compute_product_code_full(product, spec_dict)
    if new_code and new_code != product.code and len(new_code) <= 32:
        _try_update_product_code(db, product, new_code)
    product.active_version_id = version.id
    db.add(product)
    db.flush()
    return product, version


def _ensure_customer_exists(db: Session, customer_id: str) -> None:
    # IDs are stored as String(36) in the DB. We still validate UUID format,
    # but comparisons/PK lookups must use the string value.
    try:
        cid = str(uuid.UUID(customer_id))
    except Exception as e:
        raise DomainError("Invalid customer_id") from e
    exists = db.scalar(select(func.count()).select_from(Customer).where(Customer.id == cid)) or 0
    if exists == 0:
        raise DomainError("Customer not found")


def _next_version_number(db: Session, product_id: str) -> int:
    current = db.scalar(
        select(func.max(ProductVersion.version_number)).where(ProductVersion.product_id == product_id)
    )
    return int(current or 0) + 1


def create_product_with_version(payload: CreateProductRequest, created_by: str) -> Tuple[Product, ProductVersion]:
    with SessionLocal() as db:
        _ensure_customer_exists(db, payload.customer_id)
        cid = str(uuid.UUID(payload.customer_id))
        code_in = (payload.code or "").strip()
        spec_dict = payload.spec.dict()
        product = Product(
            code=code_in,
            description=compute_product_description(spec_dict, max_len=255),
            customer_id=cid,
        )
        db.add(product)
        db.flush()  # get product.id
        version = ProductVersion(
            product_id=product.id,
            version_number=1,
            created_by=created_by or "system",
            spec_payload=spec_dict,
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
        pid = str(uuid.UUID(product_id))
        stmt = (
            select(Product)
            .options(joinedload(Product.versions))
            .options(joinedload(Product.active_version))
            .options(joinedload(Product.customer))
            .where(Product.id == pid)
        )
        product = db.scalar(stmt)
        if not product:
            return None
        if product.active_version and isinstance(product.active_version.spec_payload, dict):
            new_code = compute_product_code_full(product, product.active_version.spec_payload)
            if new_code and new_code != product.code:
                _try_update_product_code(db, product, new_code)
                db.commit()
        return product


def get_version(version_id: str) -> Optional[ProductVersion]:
    with SessionLocal() as db:
        vid = str(uuid.UUID(version_id))
        stmt = select(ProductVersion).where(ProductVersion.id == vid)
        return db.scalar(stmt)


def create_new_version(product_id: str, payload: CreateProductVersionRequest, created_by: str) -> ProductVersion:
    with SessionLocal() as db:
        pid = str(uuid.UUID(product_id))
        # ensure product exists
        product = db.get(Product, pid)
        if not product:
            raise DomainError("Product not found")
        spec_dict = payload.spec.dict()
        vnum = _next_version_number(db, pid)
        version = ProductVersion(
            product_id=pid,
            version_number=vnum,
            created_by=created_by or "system",
            spec_payload=spec_dict,
        )
        db.add(version)
        db.flush()
        product.active_version_id = version.id
        product.description = compute_product_description(spec_dict, max_len=255)
        if isinstance(spec_dict, dict):
            new_code = compute_product_code_full(product, spec_dict)
            if new_code and new_code != product.code:
                _try_update_product_code(db, product, new_code)
        db.add(product)
        db.commit()
        db.refresh(version)
        return version


def _norm_product_extruder(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    t = str(v).strip()
    if not t:
        return None
    return t[:64]


def _norm_product_die_size(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    t = str(v).strip()
    return t if t else None


def update_product(product_id: str, payload: UpdateProductRequest) -> Product:
    with SessionLocal() as db:
        pid = str(uuid.UUID(product_id))
        product = db.get(Product, pid)
        if not product:
            raise DomainError("Product not found")
        upd = payload.model_dump(exclude_unset=True)
        if "production_extruder_code" in upd:
            product.production_extruder_code = _norm_product_extruder(payload.production_extruder_code)
        if "die_size" in upd:
            product.die_size = _norm_product_die_size(payload.die_size)
        # Description is computed from the active ProductVersion.
        desc = None
        if product.active_version_id:
            active = db.get(ProductVersion, product.active_version_id)
            if active and isinstance(active.spec_payload, dict):
                desc = compute_product_description(active.spec_payload, max_len=255)
        product.description = desc
        db.add(product)
        db.commit()
        db.refresh(product)
        return product


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
            # Keep product description/code aligned with the new active version spec.
            if isinstance(new_ver.spec_payload, dict):
                product.description = compute_product_description(new_ver.spec_payload, max_len=255)
                new_code = compute_product_code_full(product, new_ver.spec_payload)
                if new_code and new_code != product.code:
                    _try_update_product_code(db, product, new_code)
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


def search_products(query: Optional[str], *, customer_id: Optional[str] = None) -> List[Product]:
    with SessionLocal() as db:
        stmt = (
            select(Product)
            .options(joinedload(Product.customer))
            .options(joinedload(Product.active_version))
        )
        if customer_id:
            stmt = stmt.where(Product.customer_id == str(customer_id))
        if query:
            like = f"%{query}%"
            stmt = stmt.where(or_(Product.code.ilike(like)))
        stmt = stmt.order_by(Product.created_at.desc())
        products = list(db.scalars(stmt).all())

        changed = False
        for p in products:
            if p.active_version and isinstance(p.active_version.spec_payload, dict):
                new_code = compute_product_code_full(p, p.active_version.spec_payload)
                if new_code and new_code != p.code:
                    # Best-effort update; collisions are ignored.
                    original = p.code
                    p.code = new_code
                    try:
                        db.flush()
                        changed = True
                    except IntegrityError:
                        db.rollback()
                        p.code = original
                        # continue with other products (after rollback)
        if changed:
            db.commit()

        ids = [str(p.id) for p in products]
        if ids:
            cnt_rows = db.execute(
                select(ProductVersion.product_id, func.count())
                .where(ProductVersion.product_id.in_(ids))
                .group_by(ProductVersion.product_id)
            ).all()
            cnt_map = {str(r[0]): int(r[1]) for r in cnt_rows}
            for p in products:
                setattr(p, "_version_count", cnt_map.get(str(p.id), 0))
        else:
            for p in products:
                setattr(p, "_version_count", 0)

        return products


def list_suggestions(product_id: Optional[str] = None, status: Optional[str] = "open") -> List[OperatorSuggestion]:
    with SessionLocal() as db:
        stmt = select(OperatorSuggestion)
        if product_id:
            stmt = stmt.where(OperatorSuggestion.product_id == uuid.UUID(product_id))
        if status:
            stmt = stmt.where(OperatorSuggestion.status == status)
        stmt = stmt.order_by(OperatorSuggestion.created_at.desc())
        return list(db.scalars(stmt).all())


def _derived_inline_seal(spec: SpecPayload) -> bool:
    """Bag on rolls: inline bottom seal is implied (not a persisted toggle)."""
    return spec.identity.product_type == ProductType.BAG and spec.identity.finish_mode == FinishMode.ROLLS


def derive_operation_routing(spec: SpecPayload) -> Dict[str, Any]:
    operations: List[Dict[str, str]] = []
    warnings: List[str] = []
    operations.append(
        {"operation_type": "EXTRUSION", "description": "Extrusion (required first operation)"}
    )
    if spec.run_requirements.inline_perforation:
        operations[-1]["description"] += " with inline perforation"
    if _derived_inline_seal(spec):
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



