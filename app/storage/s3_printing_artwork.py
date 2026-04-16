from __future__ import annotations

import boto3
from botocore.client import BaseClient

from app.config import settings


def printing_artwork_bucket_configured() -> bool:
    b = getattr(settings, "S3_BUCKET", None)
    return bool(b and str(b).strip())


def s3_client() -> BaseClient:
    kwargs: dict = {"region_name": settings.S3_REGION}
    if settings.S3_ENDPOINT_URL:
        kwargs["endpoint_url"] = settings.S3_ENDPOINT_URL
    return boto3.client("s3", **kwargs)


def normalized_prefix() -> str:
    p = (settings.S3_PRINTING_ARTWORK_PREFIX or "printing-artwork/").strip()
    if not p.endswith("/"):
        p += "/"
    return p


def object_key_job_sheet(job_sheet_id: str, file_id: str) -> str:
    return f"{normalized_prefix()}job-sheets/{job_sheet_id}/{file_id}.pdf"


def object_key_product(product_id: str, file_id: str) -> str:
    return f"{normalized_prefix()}products/{product_id}/{file_id}.pdf"


def put_pdf(*, bucket: str, key: str, body: bytes, original_filename: str) -> None:
    client = s3_client()
    disp = f'attachment; filename="{original_filename}"'
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType="application/pdf",
        ContentDisposition=disp,
    )


def presign_get_url(*, bucket: str, key: str, expires_in: int = 900) -> str:
    client = s3_client()
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires_in,
    )


def delete_object(*, bucket: str, key: str) -> None:
    client = s3_client()
    client.delete_object(Bucket=bucket, Key=key)
