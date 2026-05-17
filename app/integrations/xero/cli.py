"""Refresh Xero tokens from cron / Heroku Scheduler."""

from __future__ import annotations

import sys

from app.db.session import SessionLocal
from app.integrations.xero.service import (
    XeroConfigError,
    XeroOAuthError,
    refresh_tokens,
    xero_configured,
)


def main() -> int:
    if not xero_configured():
        print("[XERO] XERO_CLIENT_ID / XERO_CLIENT_SECRET not set; skipping.", file=sys.stderr)
        return 0
    with SessionLocal() as db:
        try:
            did = refresh_tokens(db, log_access_token=True)
        except XeroOAuthError as e:
            print(f"[XERO] Refresh failed: {e}", file=sys.stderr)
            return 1
        except XeroConfigError as e:
            print(f"[XERO] {e}", file=sys.stderr)
            return 1
    if not did:
        print("[XERO] No refresh token stored; connect Xero in Admin first.", file=sys.stderr)
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
