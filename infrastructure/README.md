# Infrastructure — S3 for printing / artwork PDFs

This folder provisions a **private** S3 bucket, an **IAM user** with least-privilege access to a single object prefix, and optional **CORS** for browser uploads (presigned `PUT`).

It matches the app’s env vars documented in `env.example`:

- `S3_BUCKET`
- `S3_REGION`
- `S3_PRINTING_ARTWORK_PREFIX` (default `printing/` — keys like `printing/job-sheets/...`)

CORS accepts **one or more** comma-separated origins (no spaces), e.g. `https://a.example.com,https://b.example.com`.

When you use `deploy-printing-artwork-s3.sh`, CORS is applied with **`aws s3api put-bucket-cors` after** CloudFormation succeeds (the template does not set `CorsConfiguration`, because conditional CORS on `AWS::S3::Bucket` fails **AWS::EarlyValidation::PropertyValidation**). **Python 3** is required for that step.

---

## Crown Pack: localhost + staging (Heroku)

Use **two buckets** (two stacks): one for local Vite (`http://localhost:5173/`) and one shared **production** bucket for the app on [Heroku](https://crownpack-production-38f4b529d3b6.herokuapp.com/) (bucket name **`crownpack-production`**, with all printing PDFs under the **`printing/`** prefix).

1. From the **repo root**, deploy both stacks:

   ```bash
   chmod +x infrastructure/scripts/deploy-crownpack-printing-s3-envs.sh
   ./infrastructure/scripts/deploy-crownpack-printing-s3-envs.sh
   ```

   S3 bucket names are **globally unique**. If `crownpack-print-local` or **`crownpack-production`** is already taken in AWS, set your own before running:

   ```bash
   export BUCKET_LOCAL=crownpack-print-local-me
   export BUCKET_STAGING=crownpack-production-yourcompany
   ./infrastructure/scripts/deploy-crownpack-printing-s3-envs.sh
   ```

   This creates:

   | Stack | Default bucket name | Object prefix | CORS origins |
   |-------|---------------------|---------------|--------------|
   | `crownpack-printing-artwork-local` | `crownpack-print-local` | `printing/` | `http://localhost:5173` |
   | `crownpack-printing-artwork-staging` | **`crownpack-production`** | **`printing/`** | `https://crownpack-production-38f4b529d3b6.herokuapp.com` |

2. Create **separate** IAM access keys for each environment’s backend (local `.env` vs Heroku config vars), using the `IamUserName` output from each stack (see below).

3. Point each backend at its bucket and prefix:

   **Local** (`.env`):

   ```bash
   S3_BUCKET=crownpack-print-local
   S3_REGION=ap-southeast-2
   S3_PRINTING_ARTWORK_PREFIX=printing/
   AWS_ACCESS_KEY_ID=...   # key for local stack’s IAM user
   AWS_SECRET_ACCESS_KEY=...
   ```

   **Staging / Heroku** (config vars): use the **`crownpack-production`** stack’s IAM user keys and:

   ```bash
   S3_BUCKET=crownpack-production
   S3_REGION=ap-southeast-2
   S3_PRINTING_ARTWORK_PREFIX=printing/
   ```

### When you move the app to `https://production.crownpack.net.au`

S3 CORS must list every browser origin that will call presigned URLs. After the production hostname is live (or in addition to Heroku during a cutover), **update the staging stack** with both origins:

```bash
export STAGING_CORS_ORIGINS='https://crownpack-production-38f4b529d3b6.herokuapp.com,https://production.crownpack.net.au'

./infrastructure/scripts/deploy-crownpack-printing-s3-envs.sh
```

If you only want to change CORS (not redeploy local), run `deploy-printing-artwork-s3.sh` once for the staging stack/bucket with the new `--cors-origins` value.

If you retire Heroku, set `STAGING_CORS_ORIGINS` to production only and redeploy.

Optional overrides: `STACK_LOCAL`, `STACK_STAGING`, `BUCKET_LOCAL`, `BUCKET_STAGING`, `AWS_REGION` — see comments in `infrastructure/scripts/deploy-crownpack-printing-s3-envs.sh`.

---

## Option A — CloudFormation (single stack)

**Prereqs:** AWS CLI v2, credentials with permission to create S3 buckets, IAM users, and policies.

1. Pick a **globally unique** bucket name (S3 is global).

2. Deploy the stack (from repo root):

```bash
chmod +x infrastructure/scripts/deploy-printing-artwork-s3.sh
./infrastructure/scripts/deploy-printing-artwork-s3.sh \
  --stack-name crownpack-printing-artwork-dev \
  --bucket-name YOUR_UNIQUE_BUCKET_NAME \
  --region ap-southeast-2 \
  --prefix printing/ \
  --cors-origins 'https://app.example.com,https://other.example.com'
```

3. Create an access key for the IAM user (credentials shown **once**):

```bash
aws iam create-access-key --user-name "$(aws cloudformation describe-stacks \
  --stack-name crownpack-printing-artwork-dev \
  --region ap-southeast-2 \
  --query 'Stacks[0].Outputs[?OutputKey==`IamUserName`].OutputValue' \
  --output text)"
```

4. Set backend env (see `env.example`):

```bash
S3_BUCKET=YOUR_UNIQUE_BUCKET_NAME
S3_REGION=ap-southeast-2
S3_PRINTING_ARTWORK_PREFIX=printing/
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

**Update stack** (e.g. change CORS): re-run `deploy-printing-artwork-s3.sh` with the same stack name; CloudFormation will update in place.

**Teardown:**

```bash
aws cloudformation delete-stack --stack-name crownpack-printing-artwork-dev --region ap-southeast-2
```

Empty the bucket first if CloudFormation deletion fails due to non-empty bucket.

---

## Option B — Python + boto3

Use when you prefer a script over a stack, or need custom logic.

```bash
cd infrastructure/scripts
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-infra.txt
python create_printing_artwork_s3.py \
  --bucket-name YOUR_UNIQUE_BUCKET_NAME \
  --region ap-southeast-2 \
  --prefix printing/ \
  --cors-origins 'https://app.example.com,https://other.example.com' \
  --create-access-key
```

The script prints `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` once when `--create-access-key` is used.

---

## Security notes

- The bucket stays **private**; the app should use **presigned URLs** for upload/download.
- Prefer **IAM roles** (EC2/ECS/Lambda) over long-lived keys in production; this template uses an IAM **user** for simplicity on small deployments.
- Rotate or delete access keys if compromised; restrict CORS to real frontend origin(s) only.
