# Infrastructure — S3 for printing / artwork PDFs

This folder provisions a **private** S3 bucket, an **IAM user** with least-privilege access to a single object prefix, and optional **CORS** for browser uploads (presigned `PUT`).

It matches the app’s env vars documented in `env.example`:

- `S3_BUCKET`
- `S3_REGION`
- `S3_PRINTING_ARTWORK_PREFIX` (default `printing-artwork/`)

## Option A — CloudFormation (recommended)

**Prereqs:** AWS CLI v2, credentials with permission to create S3 buckets, IAM users, and policies.

1. Pick a **globally unique** bucket name (S3 is global).

2. Deploy the stack (from repo root):

```bash
chmod +x infrastructure/scripts/deploy-printing-artwork-s3.sh
./infrastructure/scripts/deploy-printing-artwork-s3.sh \
  --stack-name crownpack-printing-artwork-dev \
  --bucket-name YOUR_UNIQUE_BUCKET_NAME \
  --region ap-southeast-2 \
  --prefix printing-artwork/ \
  --cors-origin 'https://app.example.com'
```

3. Create an access key for the IAM user (credentials shown **once**):

```bash
aws iam create-access-key --user-name "$(aws cloudformation describe-stacks \
  --stack-name crownpack-printing-artwork-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`IamUserName`].OutputValue' \
  --output text)"
```

4. Set backend env (see `env.example`):

```bash
S3_BUCKET=YOUR_UNIQUE_BUCKET_NAME
S3_REGION=ap-southeast-2
S3_PRINTING_ARTWORK_PREFIX=printing-artwork/
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

**Update stack** (e.g. change CORS): re-run `deploy-printing-artwork-s3.sh` with the same stack name; CloudFormation will update in place.

**Teardown:**

```bash
aws cloudformation delete-stack --stack-name crownpack-printing-artwork-dev --region ap-southeast-2
```

Empty the bucket first if CloudFormation deletion fails due to non-empty bucket.

## Option B — Python + boto3

Use when you prefer a script over a stack, or need custom logic.

```bash
cd infrastructure/scripts
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-infra.txt
python create_printing_artwork_s3.py \
  --bucket-name YOUR_UNIQUE_BUCKET_NAME \
  --region ap-southeast-2 \
  --prefix printing-artwork/ \
  --cors-origin 'https://app.example.com' \
  --create-access-key
```

The script prints `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` once when `--create-access-key` is used.

## Security notes

- The bucket stays **private**; the app should use **presigned URLs** for upload/download.
- Prefer **IAM roles** (EC2/ECS/Lambda) over long-lived keys in production; this template uses an IAM **user** for simplicity on small deployments.
- Rotate or delete access keys if compromised; restrict `AllowedCorsOrigin` to your real frontend origin(s).
