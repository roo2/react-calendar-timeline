#!/usr/bin/env bash
# Deploy two S3 stacks for Crown Pack: local (Vite) + staging (Heroku).
# When you move the app to https://production.crownpack.net.au, re-run the staging
# deploy with STAGING_CORS_ORIGINS including both Heroku and production (see README).
#
# Usage (from repo root):
#   ./infrastructure/scripts/deploy-crownpack-printing-s3-envs.sh
#
# Default bucket names are short and memorable; they must be globally unique in S3.
# If create-bucket fails (name taken), override before running, e.g.:
#   export BUCKET_LOCAL=crownpack-print-local-me
#   export BUCKET_STAGING=crownpack-production-yourcompany
#
# Optional overrides:
#   AWS_REGION (default ap-southeast-2)
#   STACK_LOCAL (default crownpack-printing-artwork-local)
#   STACK_STAGING (default crownpack-printing-artwork-staging)
#   BUCKET_LOCAL (default crownpack-print-local — separate from production)
#   BUCKET_STAGING (default crownpack-production — Heroku / production app; objects under printing/)
#   STAGING_CORS_ORIGINS (default Heroku staging URL only)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="${SCRIPT_DIR}/deploy-printing-artwork-s3.sh"

if [[ ! -x "$DEPLOY" && -f "$DEPLOY" ]]; then
  chmod +x "$DEPLOY"
fi

REGION="${AWS_REGION:-ap-southeast-2}"

STACK_LOCAL="${STACK_LOCAL:-crownpack-printing-artwork-local}"
STACK_STAGING="${STACK_STAGING:-crownpack-printing-artwork-staging}"
BUCKET_LOCAL="${BUCKET_LOCAL:-crownpack-print-local}"
BUCKET_STAGING="${BUCKET_STAGING:-crownpack-production}"

# Staging: Heroku today; add https://production.crownpack.net.au when that host serves the app.
STAGING_CORS_ORIGINS="${STAGING_CORS_ORIGINS:-https://crownpack-production-38f4b529d3b6.herokuapp.com}"

echo "=== Local (Vite dev server) ==="
"$DEPLOY" \
  --stack-name "$STACK_LOCAL" \
  --bucket-name "$BUCKET_LOCAL" \
  --region "$REGION" \
  --prefix printing/ \
  --cors-origins 'http://localhost:5173'

echo ""
echo "=== Staging (Heroku; extend CORS when production domain is live — see infrastructure/README.md) ==="
"$DEPLOY" \
  --stack-name "$STACK_STAGING" \
  --bucket-name "$BUCKET_STAGING" \
  --region "$REGION" \
  --prefix printing/ \
  --cors-origins "$STAGING_CORS_ORIGINS"

echo ""
echo "Done. Set Heroku/local backend env from stack outputs:"
echo "  aws cloudformation describe-stacks --region $REGION --stack-name $STACK_LOCAL --query 'Stacks[0].Outputs'"
echo "  aws cloudformation describe-stacks --region $REGION --stack-name $STACK_STAGING --query 'Stacks[0].Outputs'"
