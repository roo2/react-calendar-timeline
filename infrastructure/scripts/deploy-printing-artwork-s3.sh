#!/usr/bin/env bash
# Deploy printing-artwork S3 stack (CloudFormation).
set -euo pipefail

STACK_NAME=""
BUCKET_NAME=""
REGION="${AWS_REGION:-ap-southeast-2}"
PREFIX="printing/"
CORS_ORIGINS=""
TEMPLATE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/cloudformation/printing-artwork-s3.yaml"

usage() {
  cat <<'EOF'
Usage: deploy-printing-artwork-s3.sh --stack-name NAME --bucket-name BUCKET [options]

Required:
  --stack-name NAME       CloudFormation stack name
  --bucket-name BUCKET    Globally unique S3 bucket name

Optional:
  --region REGION         AWS region (default: AWS_REGION or ap-southeast-2)
  --prefix PREFIX         Object key prefix, trailing slash recommended (default: printing/)
  --cors-origins LIST     Comma-separated origins, no spaces (omit to skip CORS)
  --cors-origin ORIGIN    Same as a single-value --cors-origins (backward compatible)

Example:
  ./deploy-printing-artwork-s3.sh \\
    --stack-name crownpack-printing-artwork-dev \\
    --bucket-name crownpack-printing-artwork-dev-123456789012 \\
    --region ap-southeast-2 \\
    --prefix printing/ \\
    --cors-origins 'http://localhost:5173'
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack-name) STACK_NAME="${2:-}"; shift 2 ;;
    --bucket-name) BUCKET_NAME="${2:-}"; shift 2 ;;
    --region) REGION="${2:-}"; shift 2 ;;
    --prefix) PREFIX="${2:-}"; shift 2 ;;
    --cors-origins) CORS_ORIGINS="${2:-}"; shift 2 ;;
    --cors-origin) CORS_ORIGINS="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "$STACK_NAME" || -z "$BUCKET_NAME" ]]; then
  echo "Error: --stack-name and --bucket-name are required." >&2
  usage
  exit 1
fi

if [[ ! -f "$TEMPLATE" ]]; then
  echo "Error: template not found at $TEMPLATE" >&2
  exit 1
fi

echo "Deploying stack ${STACK_NAME} in ${REGION}..."
aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --template-file "$TEMPLATE" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    "BucketName=${BUCKET_NAME}" \
    "ObjectPrefix=${PREFIX}"

# CORS is not set in CloudFormation (conditional CorsConfiguration fails AWS::EarlyValidation::PropertyValidation).
# Apply browser CORS via S3 API after the bucket exists.
apply_bucket_cors_from_csv() {
  local bucket="$1"
  local region="$2"
  local origins_csv="$3"
  local tmp
  tmp="$(mktemp)"
  if ! CORS_ORIGINS_CSV="$origins_csv" python3 - "$tmp" <<'PY'
import json
import os
import sys

out_path = sys.argv[1]
raw = os.environ.get("CORS_ORIGINS_CSV", "").strip()
origins = [o.strip() for o in raw.split(",") if o.strip()]
if not origins:
    sys.stderr.write("CORS: no origins after split; refusing.\n")
    sys.exit(1)
cfg = {
    "CORSRules": [
        {
            "AllowedHeaders": ["*"],
            "AllowedMethods": ["GET", "PUT", "HEAD"],
            "AllowedOrigins": origins,
            "ExposeHeaders": ["ETag"],
            "MaxAgeSeconds": 3000,
        }
    ],
}
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(cfg, f)
PY
  then
    rm -f "$tmp"
    echo "Error: failed to build CORS JSON (need python3)." >&2
    exit 1
  fi
  aws s3api put-bucket-cors --bucket "$bucket" --region "$region" --cors-configuration "file://$tmp"
  rm -f "$tmp"
}

if [[ -n "$CORS_ORIGINS" ]]; then
  echo ""
  echo "Applying S3 CORS for browser uploads (origins: ${CORS_ORIGINS})..."
  apply_bucket_cors_from_csv "$BUCKET_NAME" "$REGION" "$CORS_ORIGINS"
else
  echo ""
  echo "No --cors-origins: clearing bucket CORS (if any)..."
  aws s3api delete-bucket-cors --bucket "$BUCKET_NAME" --region "$REGION" 2>/dev/null || true
fi

echo ""
echo "Outputs:"
aws cloudformation describe-stacks \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
  --output table

echo ""
echo "Next: create an access key for the IAM user (see infrastructure/README.md)."
