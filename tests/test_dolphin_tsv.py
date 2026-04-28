from __future__ import annotations

from pathlib import Path

import pytest

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
