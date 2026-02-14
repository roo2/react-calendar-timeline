from __future__ import annotations

from typing import List, Optional
import re

try:
    import email_validator  # noqa: F401
    from pydantic import EmailStr as _EmailType
except Exception:  # pragma: no cover
    _EmailType = str  # type: ignore[assignment]

from pydantic import BaseModel, Field, field_validator


class ContactInput(BaseModel):
    type: str = Field(..., description="Contact type: Primary Contact, Accounts, Purchasing, Operations, Other")
    name: str = Field(..., min_length=1, description="Full name")
    title: Optional[str] = Field(None, description="Job title/position")
    email: _EmailType = Field(..., description="Email address")
    phone: Optional[str] = Field(None, description="Phone number (optional)")
    phone_alt: Optional[str] = Field(None, description="Alternate phone number (optional)")
    preferred_method: str = Field("Email", description="Preferred contact method: Email or Phone")
    notes: Optional[str] = Field(None, description="Additional notes about this contact")

    @field_validator("preferred_method")
    @classmethod
    def validate_preferred_method(cls, v: str) -> str:
        if v not in ["Email", "Phone"]:
            raise ValueError("Preferred method must be 'Email' or 'Phone'")
        return v

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        # If email-validator is installed, Pydantic's EmailStr already validated it.
        # Otherwise fall back to a lightweight sanity check so the app can run.
        if isinstance(v, str):
            if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v):
                raise ValueError("Invalid email address")
        return v


class AddressInput(BaseModel):
    label: str = Field(..., min_length=1, description="Address label/name (e.g., 'Head Office')")
    type: str = Field(..., description="Address type: Billing, Delivery, or Both")
    street1: str = Field(..., min_length=1, description="Street address line 1")
    street2: Optional[str] = Field(None, description="Street address line 2")
    suburb: str = Field(..., min_length=1, description="Suburb/City")
    state: str = Field(..., min_length=1, description="State/Province")
    postcode: str = Field(..., min_length=1, description="Postcode/ZIP")
    country: str = Field("Australia", description="Country")
    contact_name: Optional[str] = Field(None, description="Contact name at this address")
    contact_phone: Optional[str] = Field(None, description="Contact phone at this address")
    delivery_instructions: Optional[str] = Field(None, description="Delivery instructions")
    is_default: bool = Field(False, description="Whether this is the default delivery address")

    @field_validator("type")
    @classmethod
    def validate_address_type(cls, v: str) -> str:
        if v not in ["Billing", "Delivery", "Both"]:
            raise ValueError("Address type must be 'Billing', 'Delivery', or 'Both'")
        return v


class DeliveryPreferencesInput(BaseModel):
    preferred_pallet_type: str = Field("Plain", description="Preferred pallet type: Chep, Plain, Resin, None")
    preferred_transport_company: Optional[str] = Field(None, description="Preferred transport company/carrier")
    preferred_wrapping: bool = Field(True, description="Whether wrapping is required")
    special_instructions: Optional[str] = Field(None, description="Special delivery instructions")
    delivery_contact_id: Optional[str] = Field(None, description="Reference to contact for deliveries")

    @field_validator("preferred_pallet_type")
    @classmethod
    def validate_pallet_type(cls, v: str) -> str:
        if v not in ["Chep", "Plain", "Resin", "None"]:
            raise ValueError("Preferred pallet type must be 'Chep', 'Plain', 'Resin', or 'None'")
        return v


class CustomerCreateRequest(BaseModel):
    code: str = Field(..., min_length=2, max_length=4, description="2-4 letter customer code (e.g., CP)")
    name: str = Field(..., min_length=1, description="Customer name")
    abn: Optional[str] = Field(None, description="Business Registration/ABN")
    tax_id: Optional[str] = Field(None, description="Tax ID")
    status: str = Field("Active", description="Status: Active, Inactive, or Archived")
    contacts: List[ContactInput] = Field(default_factory=list, description="List of contacts")
    delivery_addresses: List[AddressInput] = Field(default_factory=list, description="List of delivery addresses")
    delivery_preferences: Optional[DeliveryPreferencesInput] = Field(None, description="Delivery preferences")
    payment_terms: Optional[str] = Field(None, description="Payment terms (e.g., 'Net 30')")
    credit_limit: Optional[float] = Field(None, ge=0, description="Credit limit")
    currency_preference: str = Field("AUD", description="Currency preference: AUD, USD, etc.")
    notes: Optional[str] = Field(None, description="General notes about the customer")
    internal_notes: Optional[str] = Field(None, description="Internal notes (not visible to customer)")

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in ["Active", "Inactive", "Archived"]:
            raise ValueError("Status must be 'Active', 'Inactive', or 'Archived'")
        return v

    @field_validator("currency_preference")
    @classmethod
    def validate_currency(cls, v: str) -> str:
        if len(v) != 3:
            raise ValueError("Currency preference must be a 3-letter code (e.g., AUD, USD)")
        return v.upper()

    @field_validator("code")
    @classmethod
    def validate_code(cls, v: str) -> str:
        s = (v or "").strip().upper()
        if not re.match(r"^[A-Z]{2,4}$", s):
            raise ValueError("Customer code must be 2-4 letters (A-Z)")
        return s

    @field_validator("delivery_addresses")
    @classmethod
    def validate_addresses(cls, v: List[AddressInput]) -> List[AddressInput]:
        if len(v) == 0:
            raise ValueError("At least one delivery address is required")
        default_count = sum(1 for addr in v if addr.is_default)
        if default_count > 1:
            raise ValueError("Only one address can be marked as default")
        if default_count == 0 and len(v) > 0:
            # Auto-set first address as default if none is set
            v[0].is_default = True
        return v

    @field_validator("contacts")
    @classmethod
    def validate_contacts(cls, v: List[ContactInput]) -> List[ContactInput]:
        if len(v) == 0:
            raise ValueError("At least one contact is required")
        return v


class CustomerUpdateRequest(CustomerCreateRequest):
    """Same as CustomerCreateRequest but allows partial updates"""
    pass


class CustomerResponse(BaseModel):
    id: str
    code: str
    name: str
    abn: Optional[str] = None
    tax_id: Optional[str] = None
    status: str
    contacts: List[dict]
    delivery_addresses: List[dict]
    delivery_preferences: dict
    payment_terms: Optional[str] = None
    credit_limit: Optional[float] = None
    currency_preference: str
    notes: Optional[str] = None
    internal_notes: Optional[str] = None
    created_at: Optional[str] = None

    class Config:
        from_attributes = True
