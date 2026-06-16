from __future__ import annotations

from typing import Any, List, Optional
import re
import uuid

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


class PhoneInput(BaseModel):
    phone_type: str = Field("DEFAULT", description="Xero phone type: DEFAULT, MOBILE, DDI, or FAX")
    phone_country_code: Optional[str] = Field(None, description="Xero PhoneCountryCode")
    phone_area_code: Optional[str] = Field(None, description="Xero PhoneAreaCode")
    phone_number: str = Field(default="", description="Xero PhoneNumber")

    @field_validator("phone_type")
    @classmethod
    def validate_phone_type(cls, v: str) -> str:
        s = str(v or "").strip().upper()
        if s not in ["DEFAULT", "MOBILE", "DDI", "FAX"]:
            raise ValueError("Phone type must be 'DEFAULT', 'MOBILE', 'DDI', or 'FAX'")
        return s

    @field_validator("phone_country_code", "phone_area_code", mode="before")
    @classmethod
    def strip_optional_phone_parts(cls, v: Any) -> Any:
        if v is None:
            return None
        return str(v).strip()

    @field_validator("phone_number", mode="before")
    @classmethod
    def strip_phone_number(cls, v: Any) -> str:
        return str(v or "").strip()


class ContactInput(BaseModel):
    first_name: str = Field(default="", description="Contact person first name (Xero ContactPerson)")
    last_name: str = Field(default="", description="Contact person last name (Xero ContactPerson)")
    email_address: Optional[_EmailType] = Field(None, description="Contact person email (Xero ContactPerson)")
    include_in_emails: bool = Field(True, description="Include this person on Xero emails")

    @field_validator("email_address", mode="before")
    @classmethod
    def empty_email_to_none(cls, v: Any) -> Any:
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @field_validator("email_address")
    @classmethod
    def validate_email(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        if isinstance(v, str) and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v):
            raise ValueError("Invalid email address")
        return v

    @field_validator("first_name", "last_name", mode="before")
    @classmethod
    def strip_name_parts(cls, v: Any) -> str:
        return str(v or "").strip()


class AddressInput(BaseModel):
    address_type: str = Field(..., description="Xero address type: STREET, POBOX, or DELIVERY")
    address_line1: str = Field(default="", description="Address line 1")
    address_line2: Optional[str] = Field(None, description="Address line 2")
    address_line3: Optional[str] = Field(None, description="Address line 3")
    address_line4: Optional[str] = Field(None, description="Address line 4")
    city: str = Field(default="", description="City/suburb")
    region: str = Field(default="", description="State/region")
    postal_code: str = Field(default="", description="Postcode")
    country: str = Field(default="", description="Country")
    attention_to: Optional[str] = Field(None, description="Attention to (Xero AttentionTo)")

    @field_validator("address_type")
    @classmethod
    def validate_address_type(cls, v: str) -> str:
        s = str(v or "").strip().upper()
        if s not in ["STREET", "POBOX", "DELIVERY"]:
            raise ValueError("Address type must be 'STREET', 'POBOX', or 'DELIVERY'")
        return s


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
    contact_first_name: str = Field(default="", description="Primary contact first name (Xero Contact FirstName)")
    contact_last_name: str = Field(default="", description="Primary contact last name (Xero Contact LastName)")
    email_address: Optional[_EmailType] = Field(None, description="Primary contact email (Xero EmailAddress)")
    contact_phone: Optional[str] = Field(None, description="Primary phone display (derived from phones)")
    phones: List[PhoneInput] = Field(default_factory=list, description="Phone numbers (Xero Phones)")
    status: str = Field("Active", description="Status: Active, Inactive, or Archived")
    contacts: List[ContactInput] = Field(default_factory=list, description="List of contacts")
    delivery_addresses: List[AddressInput] = Field(default_factory=list, description="List of delivery addresses")
    delivery_preferences: Optional[DeliveryPreferencesInput] = Field(None, description="Delivery preferences")
    payment_terms: Optional[PaymentTermsInput] = Field(None, description="MYOB-style payment terms (JSON in DB)")
    notes: Optional[str] = Field(None, description="General notes about the customer")
    xero_contact_id: Optional[str] = Field(
        None,
        description="Xero Contact UUID (ContactID). Set this to link the customer for Xero quotes and invoices.",
    )

    @field_validator("xero_contact_id", mode="before")
    @classmethod
    def normalize_xero_contact_id(cls, v: Any) -> Optional[str]:
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        s = str(v).strip()
        try:
            return str(uuid.UUID(s))
        except Exception:
            raise ValueError("xero_contact_id must be a valid UUID (Xero ContactID)")

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in ["Active", "Inactive", "Archived"]:
            raise ValueError("Status must be 'Active', 'Inactive', or 'Archived'")
        return v

    @field_validator("email_address", mode="before")
    @classmethod
    def empty_customer_email_to_none(cls, v: Any) -> Any:
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @field_validator("contact_first_name", "contact_last_name", mode="before")
    @classmethod
    def strip_primary_contact_names(cls, v: Any) -> str:
        return str(v or "").strip()

    @field_validator("delivery_addresses")
    @classmethod
    def validate_addresses(cls, v: List[AddressInput]) -> List[AddressInput]:
        return v

    @field_validator("contacts")
    @classmethod
    def validate_contacts(cls, v: List[ContactInput]) -> List[ContactInput]:
        return v

    @field_validator("phones")
    @classmethod
    def validate_phones(cls, v: List[PhoneInput]) -> List[PhoneInput]:
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
    contact_first_name: Optional[str] = None
    contact_last_name: Optional[str] = None
    email_address: Optional[str] = None
    contact_phone: Optional[str] = None
    phones: List[dict] = Field(default_factory=list)
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
    xero_contact_id: Optional[str] = None
    xero_last_modified: Optional[str] = None
    xero_synced_at: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)
