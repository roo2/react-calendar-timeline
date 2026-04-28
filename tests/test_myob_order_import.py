"""MYOB order import: upsert from Sale/Order JSON + mocked Inventory/Item fetches (in-memory DB)."""

from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

import app.db.models.domain  # noqa: F401 — register metadata
from app.db.models import Base
from app.db.models.domain import (
    Customer,
    Job,
    JobSheet,
    MyobIncomeAccount,
    MyobItemSellingUom,
    Order,
    OrderItem,
    Product,
    ProductVersion,
)
from app.config import settings
from app.job_sheets.service import finalize_import_draft_job_sheet_after_spec_save
from app.db.myob_import_placeholders import (
    MYOB_DRAFT_INTERNAL_CUSTOMER_ID,
    MYOB_DRAFT_PLACEHOLDER_PRODUCT_ID,
    MYOB_DRAFT_PLACEHOLDER_VERSION_ID,
    MYOB_DRAFT_SPEC_PAYLOAD,
)
from app.integrations.myob import service as myob_service
from app.integrations.myob.order_import import import_one_myob_sale_order
from app.integrations.myob.item_import_fixups import QUOTE_ROLL_PLACEHOLDER_ITEM_UID
from app.integrations.myob.order_import_mapping import (
    OUTSOURCED_MANUFACTURING_INCOME_ACCOUNT_UID,
    map_myob_item_to_app_quantity,
    myob_resell_catalog_kind,
)

# 4-0007 Income - Resale - Imported items (not inc cores) (CP & AP) — also outsourced manufacturing resell.
INCOME_RESELL_IMPORTED_ITEMS_UID = "fd93417d-f1e2-4c09-8697-b177a04176f4"


def _seed_myob_draft_placeholders(db) -> None:
    if db.get(Customer, MYOB_DRAFT_INTERNAL_CUSTOMER_ID):
        return
    db.add(
        Customer(
            id=MYOB_DRAFT_INTERNAL_CUSTOMER_ID,
            name="Internal (MYOB import placeholder)",
            status="Active",
            contacts={},
            delivery_addresses={},
            delivery_preferences={},
        )
    )
    p = Product(
        id=MYOB_DRAFT_PLACEHOLDER_PRODUCT_ID,
        code="__MYOB_IMPORT__",
        description="Placeholder for MYOB import draft job sheets",
        customer_id=MYOB_DRAFT_INTERNAL_CUSTOMER_ID,
    )
    db.add(p)
    pv = ProductVersion(
        id=MYOB_DRAFT_PLACEHOLDER_VERSION_ID,
        product_id=MYOB_DRAFT_PLACEHOLDER_PRODUCT_ID,
        version_number=1,
        created_by="test",
        spec_payload=dict(MYOB_DRAFT_SPEC_PAYLOAD),
    )
    db.add(pv)
    p.active_version_id = MYOB_DRAFT_PLACEHOLDER_VERSION_ID
    db.add(p)
    db.commit()


# Subset of a real AccountRight `Sale/Order/Item` GET.
SAMPLE_MYOB_ORDER = {
    "UID": "9cefe34d-f7bf-49b5-8005-eea396187c80",
    "Number": "EP60840",
    "Date": "2026-01-20T00:00:00",
    "LastModified": "2026-01-20T00:48:40.333",
    "CustomerPurchaseOrderNumber": "PO-2646-01",
    "Customer": {
        "UID": "4e675b59-3b4b-46d6-bbe0-88dc2cdf94a9",
        "Name": "SANOFI-AVENTIS HEALTHCARE PTY LTD - Code 2646",
    },
    "Lines": [
        {
            "RowID": 2327,
            "Type": "Transaction",
            "Description": "ANTI -STATIC",
            "ShipQuantity": 120.0,
            "UnitPrice": 64.3,
            "Total": 7716.0,
            "Item": {
                "UID": "951c35aa-9f4c-4acd-aae1-802d6d11be36",
                "Number": "S25035",
                "Name": "SANOFI",
                "URI": "https://api.myob.com/accountright/x/Inventory/Item/951c35aa-9f4c-4acd-aae1-802d6d11be36",
            },
        },
        {
            "RowID": 2326,
            "Type": "Transaction",
            "Description": "PLAIN PALLET CHARGE",
            "ShipQuantity": 2.0,
            "UnitPrice": 35.0,
            "Total": 70.0,
            "Item": {
                "UID": "4d3e1150-452d-47fc-a1ef-4561fba93cc3",
                "Number": "PLAIN PALLET",
                "Name": "PLAIN PALLET",
                "URI": "https://api.myob.com/accountright/x/Inventory/Item/4d3e1150-452d-47fc-a1ef-4561fba93cc3",
            },
        },
    ],
}


def _item_fetch(sanofi_uid: str, pallet_uid: str):
    def fetch(uri: str | None, uid: str | None) -> dict:
        u = (uid or "").lower()
        if u == sanofi_uid.lower():
            # Typical API shape: coded UOM on SellingUnitOfMeasure (display may be absent).
            return {
                "SellingDetails": {"SellingUnitOfMeasure": "ROLL"},
                "IsBought": False,
            }
        if u == pallet_uid.lower():
            return {"SellingDetails": {"ItemSalesUnit": "Each"}, "IsBought": False}
        return {}

    return fetch


def test_import_one_order_creates_rows_and_pallet_does_not_require_job_sheet():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    Sess = sessionmaker(bind=engine)
    db = Sess()
    _seed_myob_draft_placeholders(db)

    cust = Customer(
        id=str(uuid.uuid4()),
        name="SANOFI (test)",
        myob_customer_uid="4e675b59-3b4b-46d6-bbe0-88dc2cdf94a9",
    )
    db.add(cust)
    db.commit()
    db.refresh(cust)

    f = _item_fetch("951c35aa-9f4c-4acd-aae1-802d6d11be36", "4d3e1150-452d-47fc-a1ef-4561fba93cc3")
    res = import_one_myob_sale_order(
        db,
        myob_order=dict(SAMPLE_MYOB_ORDER),
        item_fetch=f,
    )
    assert res["ok"] is True
    assert res["myob_all_job_sheets_entered"] is False
    order = db.get(Order, res["order_id"])
    assert order is not None
    assert order.code == "EP60840"
    assert order.myob_order_uid == SAMPLE_MYOB_ORDER["UID"]
    assert order.customer_purchase_order_number == "PO-2646-01"
    assert order.import_source == "MYOB"
    assert order.customer_id == cust.id

    lines = list(
        db.query(OrderItem)
        .filter(OrderItem.order_id == str(order.id), OrderItem.line_kind == "myob_import")
        .order_by(OrderItem.line_index)
    )
    assert len(lines) == 2
    film = next(x for x in lines if (x.myob_item_number or "") == "S25035")
    pallet = next(x for x in lines if (x.myob_item_number or "") == "PLAIN PALLET")
    assert film.import_requires_job_sheet is True
    assert film.import_quantity_unit == "rolls"
    assert film.import_qty_type == "total_rolls"
    assert film.myob_item_sales_unit_raw == "ROLL"
    assert film.job_sheet_id is not None
    assert pallet.import_requires_job_sheet is False
    assert pallet.import_quantity_unit == "ea"
    assert pallet.import_qty_type == "units"
    # Re-import: stable UID
    res2 = import_one_myob_sale_order(db, myob_order=dict(SAMPLE_MYOB_ORDER), item_fetch=f)
    assert res2["order_id"] == res["order_id"]


def test_import_skips_credit_note_like_negative_price_order():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    Sess = sessionmaker(bind=engine)
    db = Sess()
    _seed_myob_draft_placeholders(db)
    cust = Customer(
        id=str(uuid.uuid4()),
        name="SANOFI (test)",
        myob_customer_uid="4e675b59-3b4b-46d6-bbe0-88dc2cdf94a9",
    )
    db.add(cust)
    db.commit()

    bad = dict(SAMPLE_MYOB_ORDER)
    bad["UID"] = str(uuid.uuid4())
    bad["Number"] = "CR-1"
    bad["Lines"] = [
        {
            "RowID": 1,
            "Type": "Transaction",
            "Description": "Credit line",
            "ShipQuantity": 1.0,
            "UnitPrice": -10.0,
            "Total": -10.0,
            "Item": {"UID": "x", "Number": "X", "Name": "X"},
        }
    ]
    out = import_one_myob_sale_order(db, myob_order=bad, item_fetch=lambda *_: {})
    assert out["ok"] is True
    assert out["skipped"] is True
    assert out["skip_reason"] == "credit_note_like_order"
    row = db.scalar(select(Order).where(Order.myob_order_uid == bad["UID"]))
    assert row is None


def _item_fetch_resell_pallet(film_uid: str, pallet_uid: str):
    def fetch(uri: str | None, uid: str | None) -> dict:
        u = (uid or "").lower()
        if u == film_uid.lower():
            return {
                "SellingDetails": {"SellingUnitOfMeasure": "ROLL"},
                "IsBought": False,
            }
        if u == pallet_uid.lower():
            return {
                "SellingDetails": {"ItemSalesUnit": "Each"},
                "IsBought": True,
                "IncomeAccount": {
                    "UID": "3d453a97-a7e0-4c7f-a0be-fd89ba3f6a46",
                    "Name": "Income - Sales - Manufactured (CP & AP)",
                    "DisplayID": "4-0002",
                },
            }
        return {}

    return fetch


def test_import_pallet_bought_goes_to_resell_catalog():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    Sess = sessionmaker(bind=engine)
    db = Sess()
    _seed_myob_draft_placeholders(db)

    cust = Customer(
        id=str(uuid.uuid4()),
        name="SANOFI (test)",
        myob_customer_uid="4e675b59-3b4b-46d6-bbe0-88dc2cdf94a9",
    )
    db.add(cust)
    db.commit()
    db.refresh(cust)

    f = _item_fetch_resell_pallet(
        "951c35aa-9f4c-4acd-aae1-802d6d11be36",
        "4d3e1150-452d-47fc-a1ef-4561fba93cc3",
    )
    res = import_one_myob_sale_order(
        db,
        myob_order=dict(SAMPLE_MYOB_ORDER),
        item_fetch=f,
    )
    assert res["ok"] is True
    manu = list(
        db.query(OrderItem).filter(
            OrderItem.order_id == str(res["order_id"]),
            OrderItem.line_kind == "myob_import",
        )
    )
    resell = list(
        db.query(OrderItem).filter(
            OrderItem.order_id == str(res["order_id"]),
            OrderItem.line_kind == "resell",
        )
    )
    assert len(manu) == 1
    assert manu[0].import_requires_job_sheet is True
    assert len(resell) == 1
    assert resell[0].resell_product_id is not None
    assert resell[0].job_sheet_id is None
    from app.db.models.domain import ResellProduct

    rp = db.get(ResellProduct, str(resell[0].resell_product_id))
    assert rp is not None
    assert str(rp.myob_item_uid).lower() == "4d3e1150-452d-47fc-a1ef-4561fba93cc3"
    assert str(rp.myob_income_account_uid).lower() == "3d453a97-a7e0-4c7f-a0be-fd89ba3f6a46"
    assert getattr(rp, "catalog_kind", None) == "supply"
    assert getattr(rp, "customer_id", None) is None
    acc = db.get(MyobIncomeAccount, "3d453a97-a7e0-4c7f-a0be-fd89ba3f6a46")
    assert acc is not None
    assert acc.display_id == "4-0002"
    assert "Manufactured" in (acc.name or "")


def test_finalize_import_draft_clears_draft_converts_line_and_creates_job():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    Sess = sessionmaker(bind=engine)
    db = Sess()
    _seed_myob_draft_placeholders(db)

    cust = Customer(
        id=str(uuid.uuid4()),
        name="SANOFI (test)",
        myob_customer_uid="4e675b59-3b4b-46d6-bbe0-88dc2cdf94a9",
    )
    db.add(cust)
    db.commit()
    db.refresh(cust)

    f = _item_fetch("951c35aa-9f4c-4acd-aae1-802d6d11be36", "4d3e1150-452d-47fc-a1ef-4561fba93cc3")
    res = import_one_myob_sale_order(
        db,
        myob_order=dict(SAMPLE_MYOB_ORDER),
        item_fetch=f,
    )
    assert res["ok"] is True
    order = db.get(Order, res["order_id"])
    assert order is not None
    film = db.scalar(
        select(OrderItem).where(
            OrderItem.order_id == str(order.id),
            OrderItem.line_kind == "myob_import",
            OrderItem.myob_item_number == "S25035",
        )
    )
    assert film is not None and film.job_sheet_id is not None

    js = db.get(JobSheet, str(film.job_sheet_id))
    assert js is not None
    assert js.is_import_draft is True
    assert not list(db.query(Job).filter(Job.order_id == str(order.id)).all())

    finalize_import_draft_job_sheet_after_spec_save(db, str(js.id))
    db.commit()

    db.refresh(js)
    assert js.is_import_draft is False
    db.refresh(film)
    assert film.line_kind == "manufactured"
    jobs = list(db.query(Job).filter(Job.order_id == str(order.id)).all())
    assert len(jobs) == 1
    assert str(getattr(jobs[0].status, "value", jobs[0].status)).lower() == "planned"


def test_import_uses_item_uom_cache_without_inventory_get():
    """Default item_fetch reads ``myob_item_selling_uoms`` and must not call MYOB Inventory/Item GET when cached."""
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    Sess = sessionmaker(bind=engine)
    db = Sess()
    _seed_myob_draft_placeholders(db)

    cust = Customer(
        id=str(uuid.uuid4()),
        name="SANOFI (test)",
        myob_customer_uid="4e675b59-3b4b-46d6-bbe0-88dc2cdf94a9",
    )
    db.add(cust)
    db.add(
        MyobItemSellingUom(
            myob_item_uid="951c35aa-9f4c-4acd-aae1-802d6d11be36",
            selling_unit_of_measure="ROLL",
        )
    )
    db.add(
        MyobItemSellingUom(
            myob_item_uid="4d3e1150-452d-47fc-a1ef-4561fba93cc3",
            selling_unit_of_measure="EA",
        )
    )
    db.commit()
    db.refresh(cust)

    with patch("app.integrations.myob.order_import.fetch_inventory_item_readonly") as mock_get:
        mock_get.side_effect = AssertionError("unexpected Inventory/Item GET when UOM cache is populated")

        res = import_one_myob_sale_order(
            db,
            myob_order=dict(SAMPLE_MYOB_ORDER),
            item_fetch=None,
        )

    assert res["ok"] is True
    mock_get.assert_not_called()
    film = db.scalar(
        select(OrderItem).where(OrderItem.myob_item_number == "S25035", OrderItem.line_kind == "myob_import")
    )
    assert film is not None
    assert film.import_quantity_unit == "rolls"


def test_myob_resell_catalog_kind_classifies_outsourced_manufacturing():
    sample = {
        "IsBought": True,
        "IsSold": True,
        "IsInventoried": False,
        "IncomeAccount": {"UID": OUTSOURCED_MANUFACTURING_INCOME_ACCOUNT_UID},
    }
    assert myob_resell_catalog_kind(sample) == "outsourced_manufacturing"
    assert (
        myob_resell_catalog_kind(
            {**sample, "IncomeAccount": {"UID": INCOME_RESELL_IMPORTED_ITEMS_UID}}
        )
        == "outsourced_manufacturing"
    )
    assert myob_resell_catalog_kind({**sample, "IsInventoried": True}) == "supply"
    assert myob_resell_catalog_kind({**sample, "IsSold": False}) == "supply"
    assert myob_resell_catalog_kind({**sample, "IsBought": False}) == "supply"
    assert myob_resell_catalog_kind({**sample, "IncomeAccount": {"UID": str(uuid.uuid4())}}) == "supply"
    # DisplayID match (stable GL code when MYOB income account UID differs from hard-coded set).
    assert (
        myob_resell_catalog_kind(
            {
                "IsBought": True,
                "IsSold": True,
                "IsInventoried": False,
                "IncomeAccount": {"UID": str(uuid.uuid4()), "DisplayID": "4-1112"},
            }
        )
        == "outsourced_manufacturing"
    )


OUTSOURCED_MYOB_ORDER = {
    "UID": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    "Number": "OS-TEST-1",
    "Date": "2026-01-20T00:00:00",
    "LastModified": "2026-01-20T00:48:40.333",
    "Customer": {
        "UID": "4e675b59-3b4b-46d6-bbe0-88dc2cdf94a9",
        "Name": "SANOFI-AVENTIS HEALTHCARE PTY LTD - Code 2646",
    },
    "Lines": [
        {
            "RowID": 5001,
            "Type": "Transaction",
            "Description": "AWP - Machine Roll - 25um",
            "ShipQuantity": 10.0,
            "UnitPrice": 68.0,
            "Total": 680.0,
            "Item": {
                "UID": "9ecbcb44-8a8d-4913-9621-c70bf253e900",
                "Number": "MACHINE ROLLS 25UM",
                "Name": "AWP - Machine Roll - 25um",
                "URI": "https://api.myob.com/accountright/x/Inventory/Item/9ecbcb44-8a8d-4913-9621-c70bf253e900",
            },
        },
    ],
}


def _item_fetch_outsourced_roll():
    uid = "9ecbcb44-8a8d-4913-9621-c70bf253e900"

    def fetch(uri: str | None, item_uid: str | None) -> dict:
        u = (item_uid or "").lower()
        if u == uid.lower():
            return {
                "UID": uid,
                "IsBought": True,
                "IsSold": True,
                "IsInventoried": False,
                "IncomeAccount": {"UID": OUTSOURCED_MANUFACTURING_INCOME_ACCOUNT_UID},
                "SellingDetails": {"SellingUnitOfMeasure": "ROLL", "IsTaxInclusive": False},
            }
        return {}

    return fetch


def test_import_outsourced_bought_roll_4_0007_income_sets_outsourced_catalog_kind():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    Sess = sessionmaker(bind=engine)
    db = Sess()
    _seed_myob_draft_placeholders(db)

    cust = Customer(
        id=str(uuid.uuid4()),
        name="SANOFI (test)",
        myob_customer_uid="4e675b59-3b4b-46d6-bbe0-88dc2cdf94a9",
    )
    db.add(cust)
    db.commit()
    db.refresh(cust)

    uid = "9ecbcb44-8a8d-4913-9621-c70bf253e900"

    def fetch(uri: str | None, item_uid: str | None) -> dict:
        u = (item_uid or "").lower()
        if u == uid.lower():
            return {
                "UID": uid,
                "IsBought": True,
                "IsSold": True,
                "IsInventoried": False,
                "IncomeAccount": {"UID": INCOME_RESELL_IMPORTED_ITEMS_UID},
                "SellingDetails": {"SellingUnitOfMeasure": "ROLL", "IsTaxInclusive": False},
            }
        return {}

    res = import_one_myob_sale_order(
        db,
        myob_order=dict(OUTSOURCED_MYOB_ORDER),
        item_fetch=fetch,
    )
    assert res["ok"] is True
    resell = list(
        db.query(OrderItem).filter(
            OrderItem.order_id == str(res["order_id"]),
            OrderItem.line_kind == "resell",
        )
    )
    assert len(resell) == 1
    from app.db.models.domain import ResellProduct

    rp = db.get(ResellProduct, str(resell[0].resell_product_id))
    assert rp is not None
    assert getattr(rp, "catalog_kind", None) == "outsourced_manufacturing"
    from app.db.models.domain import Order

    order_row = db.get(Order, str(res["order_id"]))
    assert order_row is not None
    assert str(rp.customer_id) == str(order_row.customer_id)


def test_import_quote_roll_placeholder_not_resell_when_myob_isbought_true():
    """MYOB marks '- ROLLS' / Used for Quotes as bought; we override to manufactured import."""
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    Sess = sessionmaker(bind=engine)
    db = Sess()
    _seed_myob_draft_placeholders(db)

    cust = Customer(
        id=str(uuid.uuid4()),
        name="SANOFI (test)",
        myob_customer_uid="4e675b59-3b4b-46d6-bbe0-88dc2cdf94a9",
    )
    db.add(cust)
    db.commit()
    db.refresh(cust)

    order = {
        "UID": str(uuid.uuid4()),
        "Number": "ROLLS-OV-1",
        "Date": "2026-01-20T00:00:00",
        "LastModified": "2026-01-20T00:48:40.333",
        "Customer": {
            "UID": "4e675b59-3b4b-46d6-bbe0-88dc2cdf94a9",
            "Name": "SANOFI-AVENTIS HEALTHCARE PTY LTD - Code 2646",
        },
        "Lines": [
            {
                "RowID": 7001,
                "Type": "Transaction",
                "Description": "Quote line",
                "ShipQuantity": 5.0,
                "UnitPrice": 10.0,
                "Total": 50.0,
                "Item": {
                    "UID": QUOTE_ROLL_PLACEHOLDER_ITEM_UID,
                    "Number": "- ROLLS",
                    "Name": "Used for Quotes",
                    "URI": f"https://api.myob.com/accountright/x/Inventory/Item/{QUOTE_ROLL_PLACEHOLDER_ITEM_UID}",
                },
            },
        ],
    }

    def fetch(uri: str | None, item_uid: str | None) -> dict:
        u = (item_uid or "").lower()
        if u == QUOTE_ROLL_PLACEHOLDER_ITEM_UID.lower():
            return {
                "UID": QUOTE_ROLL_PLACEHOLDER_ITEM_UID,
                "IsBought": True,
                "IsSold": True,
                "IsInventoried": True,
                "SellingDetails": {"SellingUnitOfMeasure": "ROLL"},
            }
        return {}

    res = import_one_myob_sale_order(db, myob_order=order, item_fetch=fetch)
    assert res["ok"] is True
    manu = list(
        db.query(OrderItem).filter(
            OrderItem.order_id == str(res["order_id"]),
            OrderItem.line_kind == "myob_import",
        )
    )
    resell = list(
        db.query(OrderItem).filter(
            OrderItem.order_id == str(res["order_id"]),
            OrderItem.line_kind == "resell",
        )
    )
    assert len(manu) == 1
    assert manu[0].import_requires_job_sheet is True
    assert manu[0].import_quantity_unit == "rolls"
    assert len(resell) == 0


def test_import_outsourced_bought_roll_sets_resell_uom_and_catalog_kind():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    Sess = sessionmaker(bind=engine)
    db = Sess()
    _seed_myob_draft_placeholders(db)

    cust = Customer(
        id=str(uuid.uuid4()),
        name="SANOFI (test)",
        myob_customer_uid="4e675b59-3b4b-46d6-bbe0-88dc2cdf94a9",
    )
    db.add(cust)
    db.commit()
    db.refresh(cust)

    res = import_one_myob_sale_order(
        db,
        myob_order=dict(OUTSOURCED_MYOB_ORDER),
        item_fetch=_item_fetch_outsourced_roll(),
    )
    assert res["ok"] is True
    resell = list(
        db.query(OrderItem).filter(
            OrderItem.order_id == str(res["order_id"]),
            OrderItem.line_kind == "resell",
        )
    )
    assert len(resell) == 1
    line = resell[0]
    assert str(line.resell_quantity_unit or "") == "rolls"
    assert str(line.import_quantity_unit or "") == "rolls"
    assert str(line.import_qty_type or "") == "total_rolls"
    from app.db.models.domain import ResellProduct

    rp = db.get(ResellProduct, str(line.resell_product_id))
    assert rp is not None
    assert getattr(rp, "catalog_kind", None) == "outsourced_manufacturing"
    from app.db.models.domain import Order

    order_row = db.get(Order, str(res["order_id"]))
    assert order_row is not None
    assert str(rp.customer_id) == str(order_row.customer_id)


def test_map_myob_item_uses_selling_unit_of_measure():
    qu, qt, raw = map_myob_item_to_app_quantity({"SellingDetails": {"SellingUnitOfMeasure": "ROLL"}})
    assert qu == "rolls"
    assert qt == "total_rolls"
    assert raw == "ROLL"

    qu2, qt2, raw2 = map_myob_item_to_app_quantity({"SellingDetails": {"SellingUnitOfMeasure": "KG"}})
    assert qu2 == "kg" and qt2 == "kg" and raw2 == "KG"

    qu3, qt3, raw3 = map_myob_item_to_app_quantity({"SellingDetails": {"SellingUnitOfMeasure": "CTN"}})
    assert qu3 == "cartons" and qt3 == "units" and raw3 == "CTN"

    qu4, qt4, raw4 = map_myob_item_to_app_quantity({"SellingDetails": {"SellingUnitOfMeasure": "1000"}})
    assert qu4 == "1000" and qt4 == "units" and raw4 == "1000"

    qu5, qt5, raw5 = map_myob_item_to_app_quantity({"SellingDetails": {}})
    assert qu5 == "ea" and qt5 == "units"

    qu6, qt6, raw6 = map_myob_item_to_app_quantity(
        {"SellingDetails": {"SellingUnitOfMeasure": "ROLL"}},
        requires_job_sheet=False,
    )
    assert qu6 == "ea" and qt6 == "units" and raw6 == "ROLL"

    qu7, qt7, raw7 = map_myob_item_to_app_quantity({"SellingDetails": {"SellingUnitOfMeasure": "100"}})
    assert qu7 == "ea" and qt7 == "units" and raw7 == "100"


def test_myob_accountright_api_host_ok_accepts_regional_api_hosts():
    assert myob_service._myob_accountright_api_host_ok("api.myob.com")
    assert myob_service._myob_accountright_api_host_ok("arl2.api.myob.com")
    assert not myob_service._myob_accountright_api_host_ok("example.com")
    assert not myob_service._myob_accountright_api_host_ok("api.evil.com")


def test_upsert_uom_quote_roll_placeholder_persists_is_bought_false():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    Sess = sessionmaker(bind=engine)
    db = Sess()
    from app.integrations.myob.item_selling_uom_cache import upsert_uom_from_item_json

    upsert_uom_from_item_json(
        db,
        item_uid=QUOTE_ROLL_PLACEHOLDER_ITEM_UID,
        item_json={
            "UID": QUOTE_ROLL_PLACEHOLDER_ITEM_UID,
            "IsBought": True,
            "SellingDetails": {"SellingUnitOfMeasure": "ROLL"},
        },
    )
    db.commit()
    u = db.get(MyobItemSellingUom, QUOTE_ROLL_PLACEHOLDER_ITEM_UID)
    assert u is not None
    assert u.is_bought is False


def test_upsert_uom_from_item_json_sets_income_account_fk():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    Sess = sessionmaker(bind=engine)
    db = Sess()
    from app.integrations.myob.item_selling_uom_cache import upsert_uom_from_item_json

    iuid = str(uuid.uuid4())
    acid = str(uuid.uuid4())
    upsert_uom_from_item_json(
        db,
        item_uid=iuid,
        item_json={
            "SellingDetails": {"SellingUnitOfMeasure": "EA"},
            "IncomeAccount": {"UID": acid, "Name": "Sales", "DisplayID": "1-100"},
        },
    )
    db.commit()
    u = db.get(MyobItemSellingUom, iuid)
    assert u is not None
    assert str(u.myob_income_account_uid).lower() == acid.lower()
    ia = db.get(MyobIncomeAccount, acid)
    assert ia is not None
    assert ia.display_id == "1-100"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
