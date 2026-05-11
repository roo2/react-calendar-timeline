#!/usr/bin/env bash
# Deploy printing-artwork S3 stack (CloudFormation).
set -euo pipefail

STACK_NAME=""
BUCKET_NAME=""
REGION="${AWS_REGION:-ap-southeast-2}"
PREFIX="printing-artwork/"
CORS_ORIGIN=""
TEMPLATE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/cloudformation/printing-artwork-s3.yaml"

usage() {
  cat <<'EOF'
Usage: deploy-printing-artwork-s3.sh --stack-name NAME --bucket-name BUCKET [options]

Required:
  --stack-name NAME       CloudFormation stack name
  --bucket-name BUCKET    Globally unique S3 bucket name

Optional:
  --region REGION         AWS region (default: AWS_REGION or ap-southeast-2)
  --prefix PREFIX         Object key prefix, trailing slash recommended (default: printing-artwork/)
  --cors-origin ORIGIN    e.g. https://app.example.com (omit to skip CORS)

Example:
  ./deploy-printing-artwork-s3.sh \\
    --stack-name crownpack-printing-artwork-dev \\
    --bucket-name crownpack-printing-artwork-dev-123456789012 \\
    --region ap-southeast-2 \\
    --prefix printing-artwork/ \\
    --cors-origin 'https://localhost:5173'
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack-name) STACK_NAME="${2:-}"; shift 2 ;;
    --bucket-name) BUCKET_NAME="${2:-}"; shift 2 ;;
    --region) REGION="${2:-}"; shift 2 ;;
    --prefix) PREFIX="${2:-}"; shift 2 ;;
    --cors-origin) CORS_ORIGIN="${2:-}"; shift 2 ;;
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
    "ObjectPrefix=${PREFIX}" \
    "AllowedCorsOrigin=${CORS_ORIGIN}"

echo ""
echo "Outputs:"
aws cloudformation describe-stacks \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
  --output table

echo ""
echo "Next: create an access key for the IAM user (see infrastructure/README.md)."
