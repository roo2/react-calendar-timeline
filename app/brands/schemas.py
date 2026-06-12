from __future__ import annotations

import re
import uuid
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


class BrandDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    code: str
    name: str
    xero_branding_theme_id: Optional[str] = None


class BrandUpdate(BaseModel):
    xero_branding_theme_id: Optional[str] = None

    @field_validator("xero_branding_theme_id", mode="before")
    @classmethod
    def empty_to_none(cls, v: object) -> object:
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @field_validator("xero_branding_theme_id")
    @classmethod
    def validate_uuid(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        s = str(v).strip()
        if not _UUID_RE.match(s):
            raise ValueError("xero_branding_theme_id must be a UUID")
        return s.lower()


def dto_from_orm(row: object) -> BrandDTO:
    return BrandDTO.model_validate(row)
