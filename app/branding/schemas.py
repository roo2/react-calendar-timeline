from pydantic import BaseModel


class BrandTheme(BaseModel):
    name: str
    palette: dict[str, str] = {}
    typography: dict[str, str] = {}
    assets: dict[str, str] = {}


