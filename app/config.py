from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite+pysqlite:///./production.db"
    ENV: str = "dev"
    SESSION_TTL_HOURS: int = 168
    COOKIE_NAME: str = "sid"

    # Printing artwork (PDF) — stored in S3 when S3_BUCKET is set.
    S3_BUCKET: str | None = None
    S3_REGION: str = "ap-southeast-2"
    S3_PRINTING_ARTWORK_PREFIX: str = "printing/"
    S3_PRINTING_ARTWORK_URL_TTL_SECONDS: int = 900
    PRINTING_ARTWORK_MAX_BYTES: int = 25 * 1024 * 1024

    # MYOB Business API (OAuth). Register the same MYOB_REDIRECT_URI in the MYOB developer portal.
    MYOB_APP_KEY: str | None = None
    MYOB_APP_SECRET: str | None = None
    # Must match the redirect URI registered with MYOB exactly (Vite proxies /api to the backend).
    # Use `.../api/myob/oauth/callback` if you registered that URL in the MYOB portal instead.
    MYOB_REDIRECT_URI: str = "http://localhost:5173/api/myob/oauth/callback"
    # AccountRight company file GUID used in https://api.myob.com/accountright/{id}/...
    # If set, overrides any id stored in the database (OAuth / admin save).
    MYOB_COMPANY_FILE_ID: str | None = None
    # OData ``$top`` for MYOB ``Sale/Order`` and ``Sale/Invoice/Item`` list calls during import (per request).
    # Bulk import still pages until no more rows; see ``app.integrations.myob.order_import_batch``.
    MYOB_SALE_ORDER_LIST_MAX_TOP: int = 1000

    # Xero (OAuth 2.0). Register the same XERO_REDIRECT_URI in the Xero developer portal.
    XERO_CLIENT_ID: str | None = None
    XERO_CLIENT_SECRET: str | None = None
    # Must match the redirect URI registered with Xero exactly (Vite proxies /api to the backend).
    XERO_REDIRECT_URI: str = "http://localhost:5173/api/xero/oauth/callback"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()

# OAuth scopes for Xero authorize / token exchange (not read from .env — edit here to change consent).
# offline_access is required for refresh tokens. accounting.* scopes cover Quotes + Invoices + Contacts.
XERO_SCOPES = (
    "openid profile email offline_access "
    "accounting.settings accounting.contacts accounting.transactions"
)


# OAuth scopes for MYOB authorize / token exchange (not read from .env — edit here to change consent).
# sme-contacts-customer: Contact/Customer. sme-sales: /Sale/*. sme-inventory: GET Inventory/Item (line UOM mapping).
MYOB_SCOPES = "sme-contacts-customer sme-sales sme-inventory"


