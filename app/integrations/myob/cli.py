"""Refresh MYOB tokens from cron / Heroku Scheduler."""

from __future__ import annotations

import sys

from app.db.session import SessionLocal
from app.integrations.myob.service import (
    MyobConfigError,
    MyobOAuthError,
    myob_configured,
    refresh_tokens,
)


def main() -> int:
    if not myob_configured():
        print("[MYOB] MYOB_APP_KEY / MYOB_APP_SECRET not set; skipping.", file=sys.stderr)
        return 0
    with SessionLocal() as db:
        try:
            did = refresh_tokens(db, log_access_token=True)
        except MyobOAuthError as e:
            print(f"[MYOB] Refresh failed: {e}", file=sys.stderr)
            return 1
        except MyobConfigError as e:
            print(f"[MYOB] {e}", file=sys.stderr)
            return 1
    if not did:
        print("[MYOB] No refresh token stored; connect MYOB in Admin first.", file=sys.stderr)
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
