from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite+pysqlite:///./production.db"
    ENV: str = "dev"
    SESSION_TTL_HOURS: int = 168
    COOKIE_NAME: str = "sid"

    # Printing artwork (PDF) — stored in S3 when S3_BUCKET is set.
    S3_BUCKET: str | None = None
    S3_REGION: str = "ap-southeast-2"
    # Optional (e.g. MinIO / LocalStack). Leave unset for real AWS.
    S3_ENDPOINT_URL: str | None = None
    S3_PRINTING_ARTWORK_PREFIX: str = "printing-artwork/"
    S3_PRINTING_ARTWORK_URL_TTL_SECONDS: int = 900
    PRINTING_ARTWORK_MAX_BYTES: int = 25 * 1024 * 1024

    # MYOB Business API (OAuth). Register the same MYOB_REDIRECT_URI in the MYOB developer portal.
    MYOB_APP_KEY: str | None = None
    MYOB_APP_SECRET: str | None = None
    # Must match the redirect URI registered with MYOB exactly (Vite proxies /api to the backend).
    # Use `.../api/myob/oauth/callback` if you registered that URL in the MYOB portal instead.
    MYOB_REDIRECT_URI: str = "http://localhost:5173/api/myob/oauth/callback"
    # Space-separated scopes. Default allows reading customers via Contact/Customer (see MYOB scope docs).
    MYOB_SCOPES: str = "sme-contacts-customer"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()


