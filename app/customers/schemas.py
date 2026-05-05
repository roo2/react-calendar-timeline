from __future__ import annotations

from typing import Any, List, Optional
import re

try:
    import email_validator  # noqa: F401
    from pydantic import EmailStr as _EmailType
except Exception:  # pragma: no cover
    _EmailType = str  # type: ignore[assignment]

from pydantic import BaseModel, ConfigDict, Field, field_validator

_MYOB_PAYMENT_IS_DUE = frozenset(
    {
        "CashOnDelivery",
        "PrePaid",
        "InAGivenNumberOfDays",
        "OnADayOfTheMonth",
        "NumberOfDaysAfterEOM",
        "DayOfMonthAfterEOM",
    }
)


class PaymentTermsInput(BaseModel):
    """
    MYOB AccountRight SellingDetails.Terms subset (API uses snake_case).
    Payment due type plus balance due only (no discount date).
    """

    payment_is_due: str = Field(..., description="MYOB PaymentIsDue")
    balance_due_date: Optional[int] = Field(None, description="MYOB BalanceDueDate (day or days, per MYOB rules)")

    @field_validator("payment_is_due")
    @classmethod
    def validate_payment_is_due(cls, v: str) -> str:
        s = (v or "").strip()
        if s not in _MYOB_PAYMENT_IS_DUE:
            raise ValueError("Invalid payment_is_due")
        return s

    @field_validator("balance_due_date")
    @classmethod
    def validate_balance_due_date(cls, v: Optional[int]) -> Optional[int]:
        if v is None:
            return None
        if int(v) < 0 or int(v) > 366:
            raise ValueError("Balance due date must be between 0 and 366")
        return int(v)


class ContactInput(BaseModel):
    type: str = Field(..., description="Contact type: Primary Contact, Accounts, Purchasing, Operations, Other")
    name: str = Field(..., min_length=1, description="Full name")
    title: Optional[str] = Field(None, description="Job title/position")
    email: Optional[_EmailType] = Field(None, description="Email address (optional)")
    phone: Optional[str] = Field(None, description="Phone number (optional)")
    phone_alt: Optional[str] = Field(None, description="Alternate phone number (optional)")
    notes: Optional[str] = Field(None, description="Additional notes about this contact")

    @field_validator("email", mode="before")
    @classmethod
    def empty_email_to_none(cls, v: Any) -> Any:
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        if isinstance(v, str) and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v):
            raise ValueError("Invalid email address")
        return v


class AddressInput(BaseModel):
    label: str = Field(default="", description="Address label/name (optional)")
    type: str = Field(..., description="Address type: Billing, Delivery, or Both")
    street1: str = Field(default="", description="Street address line 1 (optional)")
    street2: Optional[str] = Field(None, description="Street address line 2")
    suburb: str = Field(default="", description="Suburb/City (optional)")
    state: str = Field(default="", description="State/Province (optional)")
    postcode: str = Field(default="", description="Postcode/ZIP (optional)")
    country: str = Field(default="", description="Country (optional)")
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
    special_instructions: Optional[str] = Field(None, description="Special delivery instructions")
    delivery_contact_id: Optional[str] = Field(None, description="Reference to contact for deliveries")

    @field_validator("preferred_pallet_type")
    @classmethod
    def validate_pallet_type(cls, v: str) -> str:
        if v not in ["Chep", "Plain", "Resin", "None"]:
            raise ValueError("Preferred pallet type must be 'Chep', 'Plain', 'Resin', or 'None'")
        return v


class PricingTierBrief(BaseModel):
    """Subset of customer_pricing_tiers for API responses."""

    id: str
    name: str
    discount_percent: float


class CustomerCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, description="Customer name")
    pricing_tier_id: Optional[str] = Field(None, description="Optional quote pricing tier (customer_pricing_tiers.id)")
    brand_id: Optional[str] = Field(None, description="Optional brand (brands.id)")
    priority_rank: Optional[int] = Field(None, description="Optional sales priority (lower = higher priority)")
    abn: Optional[str] = Field(None, description="Business Registration/ABN")
    contact_phone: Optional[str] = Field(None, description="Main contact phone number (optional)")
    status: str = Field("Active", description="Status: Active, Inactive, or Archived")
    contacts: List[ContactInput] = Field(default_factory=list, description="List of contacts")
    delivery_addresses: List[AddressInput] = Field(default_factory=list, description="List of delivery addresses")
    delivery_preferences: Optional[DeliveryPreferencesInput] = Field(None, description="Delivery preferences")
    payment_terms: Optional[PaymentTermsInput] = Field(None, description="MYOB-style payment terms (JSON in DB)")
    notes: Optional[str] = Field(None, description="General notes about the customer")

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in ["Active", "Inactive", "Archived"]:
            raise ValueError("Status must be 'Active', 'Inactive', or 'Archived'")
        return v

    @field_validator("delivery_addresses")
    @classmethod
    def validate_addresses(cls, v: List[AddressInput]) -> List[AddressInput]:
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
        return v


class CustomerUpdateRequest(CustomerCreateRequest):
    """Same as CustomerCreateRequest but allows partial updates"""
    pass


class CustomerResponse(BaseModel):
    id: str
    name: str
    pricing_tier_id: Optional[str] = None
    pricing_tier: Optional[PricingTierBrief] = None
    brand_id: Optional[str] = None
    brand_code: Optional[str] = None
    brand_name: Optional[str] = None
    priority_rank: Optional[int] = None
    abn: Optional[str] = None
    contact_phone: Optional[str] = None
    status: str
    contacts: List[dict]
    delivery_addresses: List[dict]
    delivery_preferences: dict
    payment_terms: Optional[dict] = None
    notes: Optional[str] = None
    created_at: Optional[str] = None
    myob_customer_uid: Optional[str] = None
    myob_display_id: Optional[str] = None
    myob_last_modified: Optional[str] = None
    myob_synced_at: Optional[str] = None
    myob_notes: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)
