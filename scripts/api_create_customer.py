from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
import uuid
from dataclasses import dataclass
from http.cookiejar import CookieJar
from typing import Any, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import HTTPCookieProcessor, Request, build_opener


@dataclass
class ApiClient:
    base_url: str

    def __post_init__(self) -> None:
        if not self.base_url.endswith("/"):
            self.base_url += "/"
        self.cookies = CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.cookies))

    def request_json(
        self,
        method: str,
        path: str,
        *,
        body: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        url = urljoin(self.base_url, path.lstrip("/"))
        data = None
        req_headers = {"accept": "application/json"}
        if headers:
            req_headers.update(headers)
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            req_headers.setdefault("content-type", "application/json")
        req = Request(url=url, data=data, method=method.upper(), headers=req_headers)
        try:
            with self.opener.open(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8")
                if not raw:
                    return {}
                return json.loads(raw)
        except HTTPError as e:
            raw = ""
            try:
                raw = e.read().decode("utf-8")
            except Exception:
                pass
            raise RuntimeError(f"HTTP {e.code} {e.reason} for {method} {url}: {raw}") from e
        except URLError as e:
            raise RuntimeError(f"Network error for {method} {url}: {e}") from e


def _default_customer_payload(name: str) -> Dict[str, Any]:
    # Matches app/customers/schemas.py requirements:
    # - at least one contact
    # - at least one delivery address (one default)
    return {
        "name": name,
        "abn": None,
        "tax_id": None,
        "status": "Active",
        "contacts": [
            {
                "type": "Primary Contact",
                "name": "Test Admin",
                "title": "Admin",
                "email": "admin@example.com",
                "phone": "+61 400 000 000",
                "phone_alt": None,
                "preferred_method": "Email",
                "notes": "Seeded via API script",
            }
        ],
        "delivery_addresses": [
            {
                "label": "Head Office",
                "type": "Both",
                "street1": "1 Test Street",
                "street2": None,
                "suburb": "Sydney",
                "state": "NSW",
                "postcode": "2000",
                "country": "Australia",
                "contact_name": "Dispatch",
                "contact_phone": "+61 400 000 000",
                "delivery_instructions": "Leave at reception",
                "is_default": True,
            }
        ],
        "delivery_preferences": {
            "preferred_pallet_type": "Plain",
            "preferred_transport_company": None,
            "preferred_wrapping": True,
            "special_instructions": None,
            "delivery_contact_id": None,
        },
        "payment_terms": "Net 30",
        "credit_limit": 25000,
        "currency_preference": "AUD",
        "notes": "Seeded customer",
        "internal_notes": "Internal seeded note",
    }


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="Create a customer via the API (login + CSRF + POST /api/customers).")
    p.add_argument(
        "--base-url",
        default=os.getenv("API_BASE_URL", "http://localhost:8000"),
        help="API base URL (default: http://localhost:8000 or API_BASE_URL)",
    )
    p.add_argument("--username", default=os.getenv("API_USERNAME"), help="Login username (or API_USERNAME)")
    p.add_argument("--password", default=os.getenv("API_PASSWORD"), help="Login password (or API_PASSWORD)")
    p.add_argument(
        "--customer-name",
        default=None,
        help="Customer name (default: generated).",
    )
    p.add_argument(
        "--payload-json",
        default=None,
        help="Raw JSON payload to send instead of the default payload.",
    )

    args = p.parse_args(argv)

    username = args.username
    if not username:
        raise SystemExit("ERROR: --username (or API_USERNAME) is required")

    password = args.password
    if not password:
        password = getpass.getpass("Password: ")
    if not password:
        raise SystemExit("ERROR: empty password not allowed")

    client = ApiClient(args.base_url)

    # Login (sets cookie)
    login = client.request_json(
        "POST",
        "/api/auth/login",
        body={"username": username, "password": password},
    )
    if not login.get("ok"):
        raise SystemExit(f"ERROR: login failed: {login}")

    csrf = ((login.get("identity") or {}).get("csrf")) if isinstance(login.get("identity"), dict) else None
    if not csrf:
        csrf_resp = client.request_json("GET", "/api/auth/csrf")
        csrf = csrf_resp.get("csrf_token")
    if not csrf:
        raise SystemExit("ERROR: could not obtain CSRF token after login")

    name = args.customer_name or f"Test Customer {uuid.uuid4().hex[:8]}"
    if args.payload_json:
        payload = json.loads(args.payload_json)
    else:
        payload = _default_customer_payload(name)

    resp = client.request_json(
        "POST",
        "/api/customers",
        body=payload,
        headers={"x-csrf-token": str(csrf)},
    )
    print(json.dumps(resp, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

