from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any

from app.config import settings
from app.exceptions import DomainError
from app.job_sheets import service as job_sheets_service
from app.products import service as products_service
from app.storage.s3_printing_artwork import (
    delete_object,
    object_key_job_sheet,
    object_key_product,
    presign_get_url,
    printing_artwork_bucket_configured,
    put_pdf,
)

PDF_MAGIC = b"%PDF"


def require_storage() -> str:
    if not printing_artwork_bucket_configured():
        raise DomainError("Printing artwork storage is not configured (set S3_BUCKET).")
    b = (settings.S3_BUCKET or "").strip()
    return b


def _max_bytes() -> int:
    default = 25 * 1024 * 1024
    try:
        raw = getattr(settings, "PRINTING_ARTWORK_MAX_BYTES", default)
        return int(raw or default)
    except Exception:
        return default


def _presign_ttl_seconds() -> int:
    return int(getattr(settings, "S3_PRINTING_ARTWORK_URL_TTL_SECONDS", 900) or 900)


def assert_pdf_bytes(data: bytes) -> None:
    if not data:
        raise DomainError("Empty file")
    if len(data) > _max_bytes():
        raise DomainError(f"PDF is too large (max {_max_bytes() // (1024 * 1024)} MB)")
    if not data.startswith(PDF_MAGIC):
        raise DomainError("Only PDF uploads are allowed")


def sanitize_filename(name: str) -> str:
    base = Path(name or "").name
    base = re.sub(r"[^A-Za-z0-9._() -]+", "", base).strip()
    return (base or "artwork.pdf")[:200]


def _printing_dict(spec: Any) -> dict:
    if not isinstance(spec, dict):
        return {}
    p = spec.get("printing")
    return p if isinstance(p, dict) else {}


def _artwork_files(printing: dict) -> list[dict]:
    raw = printing.get("artwork_files")
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    for it in raw:
        if isinstance(it, dict) and it.get("id"):
            out.append(it)
    return out


def _find_artwork_file(spec: dict, file_id: str) -> dict | None:
    printing = _printing_dict(spec)
    for it in _artwork_files(printing):
        if str(it.get("id")) == str(file_id):
            return it
    return None


def upload_job_sheet_printing_pdf(*, job_sheet_id: str, filename: str, data: bytes) -> dict:
    bucket = require_storage()
    assert_pdf_bytes(data)
    js = job_sheets_service.get_job_sheet(job_sheet_id)
    if not js:
        raise DomainError("Job sheet not found")
    try:
        jid = str(uuid.UUID(str(job_sheet_id)))
    except Exception as e:
        raise DomainError("Invalid job_sheet_id") from e
    fid = str(uuid.uuid4())
    key = object_key_job_sheet(str(jid), fid)
    meta = {"id": fid, "filename": sanitize_filename(filename), "byte_size": len(data)}
    put_pdf(bucket=bucket, key=key, body=data, original_filename=meta["filename"])
    try:
        job_sheets_service.append_printing_artwork_file_to_job_sheet_version(
            str(jid),
            file_id=fid,
            filename=meta["filename"],
            byte_size=meta["byte_size"],
        )
    except DomainError:
        try:
            delete_object(bucket=bucket, key=key)
        except Exception:
            pass
        raise
    return meta


def presign_job_sheet_printing_pdf(*, job_sheet_id: str, file_id: str) -> str:
    bucket = require_storage()
    js = job_sheets_service.get_job_sheet(job_sheet_id)
    if not js:
        raise DomainError("Job sheet not found")
    v = getattr(js, "version", None)
    spec = getattr(v, "spec_payload", None) if v else None
    if not isinstance(spec, dict):
        raise DomainError("Job sheet has no spec")
    row = _find_artwork_file(spec, file_id)
    if not row:
        raise DomainError("Artwork file not found on this job sheet")
    try:
        jid = str(uuid.UUID(str(job_sheet_id)))
        fid = str(uuid.UUID(str(file_id)))
    except Exception as e:
        raise DomainError("Invalid id") from e
    key = object_key_job_sheet(jid, str(fid))
    return presign_get_url(bucket=bucket, key=key, expires_in=_presign_ttl_seconds())


def delete_job_sheet_printing_pdf(*, job_sheet_id: str, file_id: str) -> None:
    bucket = require_storage()
    js = job_sheets_service.get_job_sheet(job_sheet_id)
    if not js:
        raise DomainError("Job sheet not found")
    v = getattr(js, "version", None)
    spec = getattr(v, "spec_payload", None) if v else None
    if not isinstance(spec, dict):
        raise DomainError("Job sheet has no spec")
    row = _find_artwork_file(spec, file_id)
    if not row:
        raise DomainError("Artwork file not found on this job sheet")
    try:
        jid = str(uuid.UUID(str(job_sheet_id)))
        fid = str(uuid.UUID(str(file_id)))
    except Exception as e:
        raise DomainError("Invalid id") from e
    key = object_key_job_sheet(jid, str(fid))
    job_sheets_service.remove_printing_artwork_file_from_job_sheet_version(job_sheet_id, file_id=str(fid))
    delete_object(bucket=bucket, key=key)


def upload_product_printing_pdf(
    *,
    product_id: str,
    version_id: str,
    filename: str,
    data: bytes,
) -> dict:
    bucket = require_storage()
    assert_pdf_bytes(data)
    v = products_service.get_version(version_id)
    if not v:
        raise DomainError("Product version not found")
    if str(getattr(v, "product_id", "")) != str(product_id):
        raise DomainError("Version does not belong to this product")
    try:
        pid = str(uuid.UUID(str(product_id)))
        str(uuid.UUID(str(version_id)))
    except Exception as e:
        raise DomainError("Invalid id") from e
    fid = str(uuid.uuid4())
    # Store per product (not per version) so copied specs keep valid keys.
    key = object_key_product(pid, fid)
    meta = {"id": fid, "filename": sanitize_filename(filename), "byte_size": len(data)}
    put_pdf(bucket=bucket, key=key, body=data, original_filename=meta["filename"])
    try:
        products_service.append_printing_artwork_file_to_product_version(
            product_id=str(pid),
            version_id=str(version_id),
            file_id=fid,
            filename=meta["filename"],
            byte_size=meta["byte_size"],
        )
    except DomainError:
        try:
            delete_object(bucket=bucket, key=key)
        except Exception:
            pass
        raise
    return meta


def presign_product_printing_pdf(*, product_id: str, version_id: str, file_id: str) -> str:
    bucket = require_storage()
    v = products_service.get_version(version_id)
    if not v:
        raise DomainError("Product version not found")
    if str(getattr(v, "product_id", "")) != str(product_id):
        raise DomainError("Version does not belong to this product")
    spec = getattr(v, "spec_payload", None)
    if not isinstance(spec, dict):
        raise DomainError("Version has no spec")
    row = _find_artwork_file(spec, file_id)
    if not row:
        raise DomainError("Artwork file not found on this product version")
    try:
        pid = str(uuid.UUID(str(product_id)))
        fid = str(uuid.UUID(str(file_id)))
    except Exception as e:
        raise DomainError("Invalid id") from e
    key = object_key_product(pid, str(fid))
    return presign_get_url(bucket=bucket, key=key, expires_in=_presign_ttl_seconds())


def delete_product_printing_pdf(*, product_id: str, version_id: str, file_id: str) -> None:
    bucket = require_storage()
    v = products_service.get_version(version_id)
    if not v:
        raise DomainError("Product version not found")
    if str(getattr(v, "product_id", "")) != str(product_id):
        raise DomainError("Version does not belong to this product")
    spec = getattr(v, "spec_payload", None)
    if not isinstance(spec, dict):
        raise DomainError("Version has no spec")
    row = _find_artwork_file(spec, file_id)
    if not row:
        raise DomainError("Artwork file not found on this product version")
    try:
        pid = str(uuid.UUID(str(product_id)))
        fid = str(uuid.UUID(str(file_id)))
    except Exception as e:
        raise DomainError("Invalid id") from e
    key = object_key_product(pid, str(fid))
    products_service.remove_printing_artwork_file_from_product_version(
        product_id=str(pid), version_id=str(version_id), file_id=str(fid)
    )
    delete_object(bucket=bucket, key=key)
