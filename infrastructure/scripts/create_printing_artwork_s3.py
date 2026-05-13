#!/usr/bin/env python3
"""
Create S3 bucket + IAM user + inline policy for printing artwork PDFs (boto3).

Example:
  python create_printing_artwork_s3.py \\
    --bucket-name my-unique-bucket \\
    --region ap-southeast-2 \\
    --prefix printing/ \\
    --cors-origins http://localhost:5173 \\
    --create-access-key
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid

import boto3
from botocore.exceptions import ClientError


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--bucket-name", required=True, help="Globally unique S3 bucket name")
    p.add_argument("--region", default="ap-southeast-2", help="AWS region")
    p.add_argument(
        "--prefix",
        default="printing/",
        help="Object prefix (trailing slash recommended); use same as S3_PRINTING_ARTWORK_PREFIX",
    )
    p.add_argument(
        "--user-name",
        default="",
        help="IAM user name (default: printing-artwork-<short uuid>)",
    )
    p.add_argument(
        "--cors-origins",
        default="",
        help="Comma-separated browser origins for CORS (no spaces), e.g. https://a.com,https://b.com",
    )
    p.add_argument(
        "--cors-origin",
        default="",
        help="Single origin; same as passing one value to --cors-origins (backward compatible)",
    )
    p.add_argument(
        "--create-access-key",
        action="store_true",
        help="Create one IAM access key and print credentials once (stdout)",
    )
    return p.parse_args()


def ensure_prefix(prefix: str) -> str:
    p = prefix.strip()
    if not p.endswith("/"):
        p += "/"
    return p


def main() -> int:
    args = parse_args()
    prefix = ensure_prefix(args.prefix)
    region = args.region.strip()
    bucket = args.bucket_name.strip().lower()
    user_name = (args.user_name or "").strip() or f"printing-artwork-{uuid.uuid4().hex[:10]}"

    s3 = boto3.client("s3", region_name=region)
    iam = boto3.client("iam", region_name=region)

    # --- Bucket ---
    try:
        if region == "us-east-1":
            s3.create_bucket(Bucket=bucket)
        else:
            s3.create_bucket(
                Bucket=bucket,
                CreateBucketConfiguration={"LocationConstraint": region},
            )
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code != "BucketAlreadyOwnedByYou":
            print(f"create_bucket failed: {e}", file=sys.stderr)
            return 1

    s3.put_bucket_versioning(Bucket=bucket, VersioningConfiguration={"Status": "Enabled"})
    s3.put_bucket_encryption(
        Bucket=bucket,
        ServerSideEncryptionConfiguration={
            "Rules": [
                {
                    "ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"},
                    "BucketKeyEnabled": True,
                }
            ]
        },
    )
    s3.put_public_access_block(
        Bucket=bucket,
        PublicAccessBlockConfiguration={
            "BlockPublicAcls": True,
            "IgnorePublicAcls": True,
            "BlockPublicPolicy": True,
            "RestrictPublicBuckets": True,
        },
    )

    def parse_cors_origins() -> list[str]:
        raw = (args.cors_origins or "").strip() or (args.cors_origin or "").strip()
        if not raw:
            return []
        return [o.strip() for o in raw.split(",") if o.strip()]

    cors_origins = parse_cors_origins()
    if cors_origins:
        s3.put_bucket_cors(
            Bucket=bucket,
            CORSConfiguration={
                "CORSRules": [
                    {
                        "AllowedHeaders": ["*"],
                        "AllowedMethods": ["GET", "PUT", "HEAD"],
                        "AllowedOrigins": cors_origins,
                        "ExposeHeaders": ["ETag"],
                        "MaxAgeSeconds": 3000,
                    }
                ]
            },
        )

    # --- IAM user + policy ---
    try:
        iam.create_user(UserName=user_name)
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") != "EntityAlreadyExists":
            print(f"create_user failed: {e}", file=sys.stderr)
            return 1

    policy_doc = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "ObjectReadWriteDelete",
                "Effect": "Allow",
                "Action": [
                    "s3:PutObject",
                    "s3:GetObject",
                    "s3:DeleteObject",
                    "s3:AbortMultipartUpload",
                    "s3:ListMultipartUploadParts",
                ],
                "Resource": f"arn:aws:s3:::{bucket}/{prefix}*",
            },
            {
                "Sid": "ListPrefix",
                "Effect": "Allow",
                "Action": ["s3:ListBucket"],
                "Resource": f"arn:aws:s3:::{bucket}",
                "Condition": {"StringLike": {"s3:prefix": [prefix, f"{prefix}*"]}},
            },
        ],
    }

    iam.put_user_policy(
        UserName=user_name,
        PolicyName="printing-artwork-s3",
        PolicyDocument=json.dumps(policy_doc),
    )

    print("--- Created / updated ---")
    print(f"S3_BUCKET={bucket}")
    print(f"S3_REGION={region}")
    print(f"S3_PRINTING_ARTWORK_PREFIX={prefix}")
    print(f"IAM_USER={user_name}")

    if args.create_access_key:
        resp = iam.create_access_key(UserName=user_name)
        ak = resp["AccessKey"]
        print("")
        print("# Save these once; they cannot be retrieved again:")
        print(f"AWS_ACCESS_KEY_ID={ak['AccessKeyId']}")
        print(f"AWS_SECRET_ACCESS_KEY={ak['SecretAccessKey']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
