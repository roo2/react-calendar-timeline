from __future__ import annotations

import textwrap
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

import app.db.models.domain  # noqa: F401 — register metadata
from app.db.models import Base
from app.db.models.domain import Customer, Order, OrderItem
from app.db.models.enums import OrderStatus
from app.integrations.dolphin.import_orders import (
    DOLPHIN_IMPORT_SOURCE,
    _dolphin_order_status_from_balance,
    _invoice_balance_aud,
    import_dolphin_tsv,
    synthetic_dolphin_order_uid,
)

from app.integrations.dolphin.description_uom import (
    build_synthetic_item_json_for_dolphin_uom,
    parse_uom_from_dolphin_description,
)
from app.integrations.dolphin.tsv_parse import (
    RECEIVABLE_INVOICE,
    DolphinLine,
    group_lines_by_invoice,
    iter_dolphin_tsv_rows,
)
from app.integrations.dolphin.import_orders import order_dolphin_lines_for_import
from app.integrations.myob.order_import_mapping import map_myob_item_to_app_quantity
from app.str_norm import customer_facing_product_code_from_import_description

ROOT = Path(__file__).resolve().parents[1]


def test_iter_dolphin_short_tsv():
    p = ROOT / "scripts" / "dolphin-orders-short.tsv"
    if not p.is_file():
        pytest.skip("dolphin-orders-short.tsv not in tree")
    hdr, lines, w = iter_dolphin_tsv_rows(p)
    assert "Invoice Number" in (hdr[0] or "")
    assert not w
    inv = [x for x in lines if x.is_receivable_invoice()]
    assert len(inv) >= 1
    g = group_lines_by_invoice(lines, only_receivable_invoice=True)
    k950345 = next(((a, b), v) for (a, b), v in g.items() if b == "950345")
    assert len(k950345[1]) == 3


def test_parse_uom_from_description():
    s = "STRETCH … (UOM = CTN)  - note"
    assert parse_uom_from_dolphin_description(s) == "CTN"
    assert parse_uom_from_dolphin_description("no uom here") is None


def test_customer_facing_code_from_description():
    s = "PB1000800100 - L/D NATURAL POLY BAG 1000MM X 800MM X 100UM $/1000 (UOM = THOU)   - (Customer Part # .)"
    assert customer_facing_product_code_from_import_description(s) == "PB1000800100"
    assert customer_facing_product_code_from_import_description("no separator") is None


def test_uom_maps_like_myob():
    j = build_synthetic_item_json_for_dolphin_uom(raw_uom="CTN", income_display_id="4040")
    qu, qt, raw = map_myob_item_to_app_quantity(j, requires_job_sheet=True)
    assert qu == "cartons"
    assert raw in (None, "CTN")

    j_thou = build_synthetic_item_json_for_dolphin_uom(raw_uom="THOU", income_display_id="4040")
    qu2, qt2, raw2 = map_myob_item_to_app_quantity(j_thou, requires_job_sheet=True)
    assert qu2 == "1000"
    assert qt2 == "units"
    assert raw2 in (None, "THOU")


def test_only_receivable_invoice_in_group():
    """Non-invoice source rows are excluded from grouped import keys."""
    from app.integrations.dolphin.tsv_parse import DolphinLine

    a = [
        DolphinLine(
            "C",
            "1",
            "1 Jan 2020",
            RECEIVABLE_INVOICE,
            "",
            "",
            "D",
            "1",
            "0",
            "0",
            "0",
            "0",
            "0",
            "0",
            "x",
            "",
            "4000",
            "Sales",
        )
    ]
    b = a + [
        DolphinLine(
            "C",
            "1",
            "1 Jan 2020",
            "Receivable Overpayment",
            "",
            "",
            "D",
            "0",
            "0",
            "0",
            "0",
            "0",
            "0",
            "0",
            "x",
            "",
            "4000",
            "Sales",
        )
    ]
    g1 = group_lines_by_invoice(a, only_receivable_invoice=True)
    g2 = group_lines_by_invoice(b, only_receivable_invoice=True)
    assert len(g1[("C", "1")]) == 1
    assert len(g2[("C", "1")]) == 1


def test_dolphin_balance_maps_to_closed_or_dispatched():
    assert _dolphin_order_status_from_balance(0.0).value == "closed"
    assert _dolphin_order_status_from_balance(0.001).value == "closed"
    assert _dolphin_order_status_from_balance(50.0).value == "dispatched"
    assert _dolphin_order_status_from_balance(None).value == "dispatched"

    paid = DolphinLine(
        "S",
        "1",
        "1 Jan 2020",
        RECEIVABLE_INVOICE,
        "",
        "",
        "X",
        "1",
        "0",
        "0",
        "0",
        "1",
        "1",
        "0.00",
        "",
        "",
        "4030",
        "Sales",
    )
    assert _invoice_balance_aud([paid]) == 0.0

    owing = DolphinLine(
        "S",
        "2",
        "1 Jan 2020",
        RECEIVABLE_INVOICE,
        "",
        "",
        "X",
        "1",
        "0",
        "0",
        "0",
        "1",
        "1",
        "12.50",
        "",
        "",
        "4030",
        "Sales",
    )
    assert _invoice_balance_aud([owing]) == 12.5


def test_dolphin_line_ordering_job_sheet_then_outsourced_then_fees():
    def mk(desc: str, code: str, account_name: str) -> DolphinLine:
        return DolphinLine(
            client_section="C",
            invoice_number="INV-1",
            invoice_date="1 Jan 2020",
            source=RECEIVABLE_INVOICE,
            reference="",
            item_code=code,
            description=desc,
            quantity="1",
            unit_price_ex="1",
            discount_ex="0",
            gst="0",
            gross="1",
            invoice_total="1",
            balance="0",
            contact_account_number="",
            contact_group="",
            account_code="",
            account_name=account_name,
        )

    fee = mk("Freight line", "FEE", "Freight Charges")
    outsourced = mk("Outsourced product", "OUT", "Income - Sales - Purchased")
    inhouse = mk("Manufactured product", "MFG", "Income - Sales - Manufactured (CP & AP)")

    ordered = order_dolphin_lines_for_import([fee, outsourced, inhouse])
    assert [x.item_code for x in ordered] == ["MFG", "OUT", "FEE"]


def test_dolphin_import_skips_line_sync_when_import_review_complete(tmp_path: Path):
    """Re-import must not delete/rebuild order lines when staff marked import review complete."""
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    Sess = sessionmaker(bind=engine)
    db = Sess()

    cust_id = str(uuid.uuid4())
    db.add(Customer(id=cust_id, name="LockTest", myob_display_id="7612"))
    db.commit()

    inv = "ZZ90001"
    duid = synthetic_dolphin_order_uid(customer_id=cust_id, invoice_number=inv)
    oid = str(uuid.uuid4())
    oi_id = str(uuid.uuid4())
    db.add(
        Order(
            id=oid,
            code=inv,
            customer_id=cust_id,
            status=OrderStatus.DRAFT,
            import_source=DOLPHIN_IMPORT_SOURCE,
            myob_order_uid=duid,
            import_review_status="complete",
        )
    )
    db.add(
        OrderItem(
            id=oi_id,
            order_id=oid,
            line_index=0,
            line_kind="myob_import",
            import_line_description="KEEP ME",
            myob_row_id=0,
            import_requires_job_sheet=False,
        )
    )
    db.commit()

    tsv = textwrap.dedent(
        """
        Receivable Invoice Detail

        Invoice Number\tInvoice Date\tSource\tReference\tItem Code\tDescription\tQuantity\tUnit Price (ex) (AUD)\tDiscount (ex) (AUD)\tGST (AUD)\tGross (AUD)\tInvoice Total (AUD)\tBalance (AUD)\tContact Account Number\tContact Group\tAccount Code\tAccount

        SecA
        ZZ90001\t1 Jan 2026\tReceivable Invoice\t\tX\tDifferent desc\t99\t1\t0\t0\t99\t99\t0\t7612\t\t4030\tIncome - Sales - Manufactured (CP & AP)
        """
    ).lstrip()
    path = tmp_path / "lock.tsv"
    path.write_text(tsv, encoding="utf-8")

    out = import_dolphin_tsv(db, str(path), dry_run=False)
    assert int(out.get("skipped_line_sync_import_review_complete", 0)) >= 1
    row = db.scalar(select(OrderItem).where(OrderItem.order_id == oid))
    assert row is not None
    assert str(row.id) == oi_id
    assert row.import_line_description == "KEEP ME"
