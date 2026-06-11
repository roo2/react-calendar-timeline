"""Unit tests for MYOB → Production customer field mapping (no DB)."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

from app.customers.schemas import CustomerCreateRequest
from app.integrations.myob.customer_mapping import (
    abn_from_myob,
    build_contacts_from_myob,
    build_delivery_addresses_from_myob,
    company_name_from_myob,
    individual_trading_as_company_lastname,
    myob_raw_indicates_dolphin_brand,
    myob_notes_from_raw,
    parse_myob_last_modified,
    payment_terms_dict_from_myob,
    primary_contact_person_name_from_myob,
    status_from_myob,
)

# Representative MYOB AccountRight customer (subset of real API fields).
SAMPLE_MYOB_CUSTOMER = {
    "UID": "8b57e8a8-bdf5-4667-b9a8-18ae49d48ab1",
    "CompanyName": "A &amp; B POWDERCOATERS",
    "IsIndividual": False,
    "DisplayID": "*None",
    "IsActive": True,
    "Addresses": [
        {
            "Location": 1,
            "Street": "P O BOX 238\r\nBUDDINA  QLD  4575",
            "City": "",
            "State": "",
            "PostCode": "",
            "Country": "",
            "Phone1": "5438 2100",
            "Phone2": "",
            "Phone3": "",
            "Fax": "5483 9971",
            "Email": "",
            "Website": "",
            "ContactName": "JASON",
            "Salutation": "",
        },
        {
            "Location": 2,
            "Street": "11 BENT STREET\r\nGYMPIE  QLD  4570",
            "City": "",
            "State": "",
            "PostCode": "",
            "Country": "",
            "Phone1": "",
            "Phone2": "",
            "Phone3": "",
            "Fax": "",
            "Email": "",
            "Website": "",
            "ContactName": "",
            "Salutation": "",
        },
    ],
    "Notes": "NEW CUSTOMER 2/8/04\nQUOTE 1000(2000)50um X 200Mt.",
    "SellingDetails": {
        "ABN": "66 088 534 077",
        "Credit": {"OnHold": False},
        "Terms": {
            "PaymentIsDue": "DayOfMonthAfterEOM",
            "DiscountDate": 1,
            "BalanceDueDate": 31,
            "DiscountForEarlyPayment": 0,
            "MonthlyChargeForLatePayment": 0,
            "VolumeDiscount": 0,
        },
    },
    "LastModified": "2025-08-06T01:43:00.163",
}


def test_company_name_decodes_html_entities():
    assert company_name_from_myob(SAMPLE_MYOB_CUSTOMER) == "A & B POWDERCOATERS"


def test_company_name_falls_back_to_primary_contact_when_company_blank():
    raw = {
        "CompanyName": "",
        "IsIndividual": False,
        "Addresses": [
            {"Location": 1, "Street": "1 MAIN ST", "ContactName": "PETER BEAN"},
        ],
    }
    assert company_name_from_myob(raw) == "PETER BEAN"
    contacts = build_contacts_from_myob(raw, myob_uid="uid", company_display_name="PETER BEAN")
    assert contacts["items"][0]["name"] == "PETER BEAN"


def test_company_name_prefers_company_over_contact_when_both_present():
    raw = {
        "CompanyName": "A & L WINDOWS",
        "IsIndividual": False,
        "Addresses": [{"Location": 1, "Street": "4 PROGRESS ST", "ContactName": "PETER BEAN"}],
    }
    assert company_name_from_myob(raw) == "A & L WINDOWS"


def test_individual_d_prefix_lastname_yields_company_tail():
    raw = {
        "IsIndividual": True,
        "LastName": "D - DANIEL ST FISH MARKET",
        "FirstName": "JANINE",
        "CompanyName": "",
    }
    assert individual_trading_as_company_lastname(raw) == "DANIEL ST FISH MARKET"
    assert company_name_from_myob(raw) == "DANIEL ST FISH MARKET"


def test_individual_d_prefix_case_insensitive():
    raw = {"IsIndividual": True, "LastName": "d - ACME PTY LTD", "FirstName": "Bob", "CompanyName": "IGNORED"}
    assert company_name_from_myob(raw) == "ACME PTY LTD"


def test_non_individual_d_prefix_in_lastname_ignored_for_company():
    raw = {
        "IsIndividual": False,
        "LastName": "D - SHOULD NOT WIN",
        "CompanyName": "Real Co",
    }
    assert individual_trading_as_company_lastname(raw) is None
    assert company_name_from_myob(raw) == "Real Co"


def test_company_name_strips_d_prefix_from_company_name_when_not_individual():
    raw = {"IsIndividual": False, "CompanyName": "D - AUSSY FISH", "LastName": ""}
    assert company_name_from_myob(raw) == "AUSSY FISH"


def test_company_name_strips_d_prefix_case_insensitive_on_company_name():
    raw = {"IsIndividual": False, "CompanyName": "d - ACME RETAIL"}
    assert company_name_from_myob(raw) == "ACME RETAIL"


def test_myob_raw_indicates_dolphin_individual_d_prefix_lastname():
    assert myob_raw_indicates_dolphin_brand(
        {"IsIndividual": True, "LastName": "D - DANIEL ST FISH MARKET", "FirstName": "JANINE", "CompanyName": ""}
    )
    assert not myob_raw_indicates_dolphin_brand(
        {"IsIndividual": True, "LastName": "SMITH", "FirstName": "JANINE", "CompanyName": "Co Ltd"}
    )


def test_myob_raw_indicates_dolphin_company_d_prefix_on_company_name():
    assert myob_raw_indicates_dolphin_brand(
        {"IsIndividual": False, "CompanyName": "D - AUSSY FISH", "LastName": ""}
    )
    assert not myob_raw_indicates_dolphin_brand({"IsIndividual": False, "CompanyName": "ACME", "LastName": ""})


def test_myob_raw_indicates_dolphin_company_d_prefix_only_still_dolphin():
    assert myob_raw_indicates_dolphin_brand({"IsIndividual": False, "CompanyName": "D - "})

def test_individual_d_prefix_without_tail_falls_back_to_company_name():
    raw = {"IsIndividual": True, "LastName": "D - ", "FirstName": "X", "CompanyName": "Fallback Ltd"}
    assert individual_trading_as_company_lastname(raw) is None
    assert company_name_from_myob(raw) == "Fallback Ltd"


def test_build_contacts_individual_d_prefix_uses_first_name_not_address_contact():
    raw = {
        "UID": "00000000-0000-4000-8000-000000000001",
        "IsIndividual": True,
        "FirstName": "JANINE",
        "LastName": "D - DANIEL ST FISH MARKET",
        "CompanyName": "",
        "Addresses": [
            {
                "Location": 1,
                "Street": "1 Main St",
                "ContactName": "SITE CONTACT",
                "Phone1": "0400 000 000",
                "Email": "",
            }
        ],
    }
    company = company_name_from_myob(raw)
    assert company == "DANIEL ST FISH MARKET"
    out = build_contacts_from_myob(raw, myob_uid=raw["UID"], company_display_name=company)
    assert out["items"][0]["name"] == "JANINE"
    assert out["items"][0]["phone"] == "0400 000 000"


def test_primary_contact_name_from_address_contact_name():
    assert primary_contact_person_name_from_myob(SAMPLE_MYOB_CUSTOMER) == "JASON"


def test_status_active():
    assert status_from_myob(SAMPLE_MYOB_CUSTOMER) == "Active"


def test_abn_normalized():
    assert abn_from_myob(SAMPLE_MYOB_CUSTOMER) == "66 088 534 077"


def test_last_modified_parsed_utc():
    dt = parse_myob_last_modified(SAMPLE_MYOB_CUSTOMER["LastModified"])
    assert dt is not None
    assert dt.tzinfo is not None
    assert dt == datetime(2025, 8, 6, 1, 43, 0, 163000, tzinfo=UTC)


def test_myob_notes_preserved():
    notes = myob_notes_from_raw(SAMPLE_MYOB_CUSTOMER)
    assert notes is not None
    assert "NEW CUSTOMER" in notes
    assert "\n" in notes


def test_myob_notes_decode_literal_slash_n():
    """MYOB sometimes stores newlines as the two-character sequence \\n instead of real line breaks."""
    raw = {"Notes": "LINE1\\n\\nLINE2"}
    assert myob_notes_from_raw(raw) == "LINE1\n\nLINE2"


def test_payment_terms_day_of_month_after_eom():
    assert payment_terms_dict_from_myob(SAMPLE_MYOB_CUSTOMER) == {
        "payment_is_due": "DayOfMonthAfterEOM",
        "balance_due_date": 31,
    }


def test_payment_terms_day_of_month_after_eom_balance_only_even_if_myob_has_discount_date():
    raw = {
        "SellingDetails": {
            "Terms": {
                "PaymentIsDue": "DayOfMonthAfterEOM",
                "DiscountDate": 5,
                "BalanceDueDate": 15,
            }
        }
    }
    assert payment_terms_dict_from_myob(raw) == {"payment_is_due": "DayOfMonthAfterEOM", "balance_due_date": 15}


def test_payment_terms_variants():
    assert payment_terms_dict_from_myob(
        {"SellingDetails": {"Terms": {"PaymentIsDue": "CashOnDelivery", "BalanceDueDate": 0}}}
    ) == {"payment_is_due": "CashOnDelivery", "balance_due_date": 0}
    assert payment_terms_dict_from_myob(
        {"SellingDetails": {"Terms": {"PaymentIsDue": "PrePaid"}}}
    ) == {"payment_is_due": "PrePaid"}
    assert payment_terms_dict_from_myob(
        {
            "SellingDetails": {
                "Terms": {"PaymentIsDue": "InAGivenNumberOfDays", "BalanceDueDate": 14}
            }
        }
    ) == {"payment_is_due": "InAGivenNumberOfDays", "balance_due_date": 14}
    assert payment_terms_dict_from_myob(
        {
            "SellingDetails": {
                "Terms": {"PaymentIsDue": "OnADayOfTheMonth", "BalanceDueDate": 15}
            }
        }
    ) == {"payment_is_due": "OnADayOfTheMonth", "balance_due_date": 15}
    assert payment_terms_dict_from_myob(
        {
            "SellingDetails": {
                "Terms": {"PaymentIsDue": "NumberOfDaysAfterEOM", "BalanceDueDate": 30}
            }
        }
    ) == {"payment_is_due": "NumberOfDaysAfterEOM", "balance_due_date": 30}
    assert payment_terms_dict_from_myob({"SellingDetails": {}}) is None
    assert payment_terms_dict_from_myob({"SellingDetails": {"Terms": {}}}) is None


def test_payment_terms_passes_customer_schema():
    pt = payment_terms_dict_from_myob(SAMPLE_MYOB_CUSTOMER)
    assert pt is not None
    m = CustomerCreateRequest(
        name="Test Co",
        payment_terms=pt,
        contacts=[],
        delivery_addresses=[],
    )
    assert m.payment_terms is not None
    assert m.payment_terms.model_dump(exclude_none=True) == pt


def test_build_contacts_primary_name_is_person_not_company():
    company = company_name_from_myob(SAMPLE_MYOB_CUSTOMER)
    out = build_contacts_from_myob(
        SAMPLE_MYOB_CUSTOMER,
        myob_uid=SAMPLE_MYOB_CUSTOMER["UID"],
        company_display_name=company,
    )
    assert out == {"items": [{"type": "Primary Contact", "name": "JASON", "phone": "5438 2100"}]}
    assert "email" not in out["items"][0]


def test_build_delivery_addresses_two_rows_with_street_only():
    out = build_delivery_addresses_from_myob(SAMPLE_MYOB_CUSTOMER)
    items = out["items"]
    assert len(items) == 2
    assert items[0]["type"] == "Billing"
    assert items[0]["is_default"] is False
    assert "label" not in items[0]
    assert items[0]["street1"] == "P O BOX 238"
    assert "BUDDINA" in (items[0].get("street2") or "")
    assert items[0]["contact_name"] == "JASON"
    assert items[0]["contact_phone"] == "5438 2100"
    assert items[1]["type"] == "Delivery"
    assert items[1]["is_default"] is True
    assert "label" not in items[1]
    assert items[1]["street1"] == "11 BENT STREET"


def test_build_delivery_addresses_single_street_location_one_is_both():
    raw = {
        "Addresses": [
            {
                "Location": 1,
                "Street": "11 BENT STREET\r\nGYMPIE  QLD  4570",
                "City": "",
                "State": "",
                "PostCode": "",
                "Country": "",
            }
        ]
    }
    items = build_delivery_addresses_from_myob(raw)["items"]
    assert len(items) == 1
    assert items[0]["type"] == "Both"
    assert items[0]["is_default"] is True
    assert "label" not in items[0]


def test_build_delivery_addresses_single_po_box_is_billing_not_default():
    raw = {
        "Addresses": [
            {
                "Location": 1,
                "Street": "P O BOX 238\r\nBUDDINA  QLD  4575",
            }
        ]
    }
    items = build_delivery_addresses_from_myob(raw)["items"]
    assert len(items) == 1
    assert items[0]["type"] == "Billing"
    assert items[0]["is_default"] is False


def test_build_delivery_addresses_skips_email_only_slots():
    raw = {
        "Addresses": [
            {"Location": 1, "Street": "", "Email": "sales@example.com"},
            {
                "Location": 2,
                "Street": "11 BENT STREET\r\nGYMPIE  QLD  4570",
                "ContactName": "JASON",
                "Phone1": "5438 2100",
            },
            {"Location": 3, "Street": "", "Email": "accounts@example.com", "Phone1": "0400 000 000"},
        ]
    }
    items = build_delivery_addresses_from_myob(raw)["items"]
    assert len(items) == 1
    assert items[0]["type"] == "Both"
    assert items[0]["is_default"] is True
    assert items[0]["street1"] == "11 BENT STREET"
    assert items[0]["contact_name"] == "JASON"
    assert items[0]["contact_phone"] == "5438 2100"


def test_build_delivery_addresses_skips_phone_only_slots():
    raw = {
        "Addresses": [
            {"Location": 1, "Phone1": "07 1234 5678"},
            {"Location": 2, "Street": "22 MAIN ST", "City": "Brisbane", "State": "QLD", "PostCode": "4000"},
        ]
    }
    items = build_delivery_addresses_from_myob(raw)["items"]
    assert len(items) == 1
    assert items[0]["type"] == "Both"
    assert items[0]["street1"] == "22 MAIN ST"
    assert items[0]["suburb"] == "Brisbane"


def _empty_myob_slots() -> list[dict]:
    return [
        {"Location": i, "Street": "", "City": "", "State": "", "PostCode": "", "Country": "", "Email": ""}
        for i in range(3, 6)
    ]


def test_real_myob_a_and_b_powdercoaters_address_pattern():
    """Production MYOB sample: PO box billing + street delivery; slots 3–5 empty."""
    raw = {
        "CompanyName": "A &amp; B POWDERCOATERS",
        "IsIndividual": False,
        "Addresses": SAMPLE_MYOB_CUSTOMER["Addresses"] + _empty_myob_slots(),
    }
    items = build_delivery_addresses_from_myob(raw)["items"]
    assert len(items) == 2
    assert items[0]["type"] == "Billing"
    assert items[0]["street1"] == "P O BOX 238"
    assert items[1]["type"] == "Delivery"
    assert items[1]["is_default"] is True
    assert items[1]["street1"] == "11 BENT STREET"


def test_real_myob_amm_qld_skips_email_only_extra_slots():
    """AMM-style: structured PO box, two delivery streets, email-only slots 4–5 skipped."""
    raw = {
        "CompanyName": "AMM QLD PTY LTD",
        "IsIndividual": False,
        "Addresses": [
            {
                "Location": 1,
                "Street": "PO BOX 298",
                "City": "YANDINA",
                "State": "QLD",
                "PostCode": "4561",
            },
            {
                "Location": 2,
                "Street": "HARVEST STREET",
                "City": "YANDINA",
                "State": "QLD",
                "PostCode": "4561",
                "Email": "tania@jptenterprises.com.au",
            },
            {
                "Location": 3,
                "Street": "MAPAL CHAIR\r\n22 MACHINERY DRIVE\r\nYANDINA  QLD  4561",
                "Email": "sales@ammapal.com.au",
            },
            {"Location": 4, "Street": "", "Email": "alisa@ammfurniture.com.au"},
            {"Location": 5, "Street": "", "Email": "vicky@ammfurniture.com.au"},
        ],
    }
    items = build_delivery_addresses_from_myob(raw)["items"]
    assert len(items) == 3
    assert [i["type"] for i in items] == ["Billing", "Delivery", "Delivery"]
    assert items[0]["suburb"] == "YANDINA"
    assert items[0]["postcode"] == "4561"
    assert items[1]["is_default"] is True
    assert items[2]["street1"] == "MAPAL CHAIR"


def test_real_myob_abl_distribution_duplicate_street_billing_delivery():
    """ABL-style: same street on locations 1–2; email-only slots 3–5 skipped."""
    raw = {
        "CompanyName": "ABL DISTRIBUTION T/A - SIGNET PTY LTD",
        "IsIndividual": False,
        "Addresses": [
            {
                "Location": 1,
                "Street": "11 HARRINGTON STREET\r\nARUNDEL  QLD  4214\r\n* NO DEL AFTER 1PM *",
                "ContactName": "MICHELLE-ORDERS",
            },
            {
                "Location": 2,
                "Street": "11 HARRINGTON STREET\r\nARUNDEL  QLD  4214\r\n* NO DEL AFTER 1PM *",
                "Email": "michelle@abldistribution.com.au",
            },
            {"Location": 3, "Street": "", "Email": "kimberly@abldistribution.com.au"},
            {"Location": 4, "Street": "", "Email": "rachelle@abldistribution.com.au"},
            {
                "Location": 5,
                "Street": "",
                "Email": "ross@crownpack.net.au",
                "ContactName": "IAN BONIFACE 0414279088",
            },
        ],
    }
    items = build_delivery_addresses_from_myob(raw)["items"]
    assert len(items) == 2
    assert items[0]["type"] == "Billing"
    assert items[0]["contact_name"] == "MICHELLE-ORDERS"
    assert items[1]["type"] == "Delivery"
    assert items[1]["is_default"] is True
    assert primary_contact_person_name_from_myob(raw) == "MICHELLE-ORDERS"


def test_upsert_customer_from_myob_replaces_delivery_addresses_on_update():
    from app.integrations.myob.customer_import import upsert_customer_from_myob

    db = MagicMock()
    existing = MagicMock()
    existing.delivery_addresses = {
        "items": [{"label": "MYOB address 1", "type": "Both", "is_default": True, "street1": "OLD"}]
    }
    db.scalar.return_value = existing

    raw = dict(SAMPLE_MYOB_CUSTOMER)
    assert upsert_customer_from_myob(db, raw) == "updated"
    updated = existing.delivery_addresses["items"]
    assert updated[0]["type"] == "Billing"
    assert updated[1]["type"] == "Delivery"
    assert updated[1]["is_default"] is True
    db.commit.assert_called()


def test_brand_id_for_myob_upsert_prefers_dolphin_when_d_prefix():
    from app.integrations.myob.customer_import import brand_id_for_myob_upsert

    db = MagicMock()
    raw = {"IsIndividual": True, "LastName": "D - SHOP", "FirstName": "A", "CompanyName": ""}
    with (
        patch("app.integrations.myob.customer_import.dolphin_brand_id", return_value="id-d"),
        patch("app.integrations.myob.customer_import.crown_pack_brand_id", return_value="id-c"),
    ):
        assert brand_id_for_myob_upsert(db, raw) == "id-d"


def test_brand_id_for_myob_upsert_uses_crown_pack_when_not_d_prefix():
    from app.integrations.myob.customer_import import brand_id_for_myob_upsert

    db = MagicMock()
    raw = {"IsIndividual": False, "CompanyName": "ACME"}
    with (
        patch("app.integrations.myob.customer_import.dolphin_brand_id", return_value="id-d"),
        patch("app.integrations.myob.customer_import.crown_pack_brand_id", return_value="id-c"),
    ):
        assert brand_id_for_myob_upsert(db, raw) == "id-c"


def test_brand_id_for_myob_upsert_dolphin_row_missing_falls_back_crown():
    from app.integrations.myob.customer_import import brand_id_for_myob_upsert

    db = MagicMock()
    raw = {"IsIndividual": False, "CompanyName": "D - FISH CO"}
    with (
        patch("app.integrations.myob.customer_import.dolphin_brand_id", return_value=None),
        patch("app.integrations.myob.customer_import.crown_pack_brand_id", return_value="id-c"),
    ):
        assert brand_id_for_myob_upsert(db, raw) == "id-c"
