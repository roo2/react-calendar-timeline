from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite+pysqlite:///./production.db"
    ENV: str = "dev"
    SESSION_TTL_HOURS: int = 8
    COOKIE_NAME: str = "sid"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()


