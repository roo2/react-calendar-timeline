from typing import Optional

from pydantic import BaseModel


# Saved quote (customer-attached); margin recomputed on edit from stored price_per_kg + current rates
class SavedQuoteCreateRequest(BaseModel):
    customer_id: str
    payload: dict  # form state for re-hydration
    cost_per_kg: Optional[float] = None
    price_per_kg: Optional[float] = None


class SavedQuoteUpdateRequest(BaseModel):
    payload: Optional[dict] = None
    cost_per_kg: Optional[float] = None
    price_per_kg: Optional[float] = None


class SavedQuoteResponse(BaseModel):
    id: str
    customer_id: str
    customer_name: Optional[str] = None
    payload: dict
    # Return as string to preserve exact decimals over JSON (avoids float rounding on reload)
    cost_per_kg: Optional[str] = None
    price_per_kg: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
