from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite+pysqlite:///./production.db"
    ENV: str = "dev"
    SESSION_TTL_HOURS: int = 168
    COOKIE_NAME: str = "sid"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()


