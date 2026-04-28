"""
Parse MYOB / Dolphin-style ``Receivable Invoice Detail`` TSV exports.

Layout: title rows, a header row containing ``Invoice Number`` / ``Source`` / ``Reference`` / etc.,
then repeated blocks: a **client section** row (client name only), detail lines, then ``Total ...``,
then the next client section.
"""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field
from io import StringIO
from pathlib import Path
from typing import TextIO

RECEIVABLE_INVOICE = "Receivable Invoice"


@dataclass
class DolphinLine:
    """Detail row under a client section (import when ``Source`` is Receivable Invoice)."""

    client_section: str
    invoice_number: str
    invoice_date: str
    source: str
    reference: str
    item_code: str
    description: str
    quantity: str
    unit_price_ex: str
    discount_ex: str
    gst: str
    gross: str
    invoice_total: str
    balance: str
    contact_account_number: str
    contact_group: str
    account_code: str
    account_name: str
    raw_row: list[str] = field(repr=False, default_factory=list)

    def is_receivable_invoice(self) -> bool:
        return (self.source or "").strip() == RECEIVABLE_INVOICE


_INV_RE = re.compile(r"^[\dA-Z][\w-]*$", re.I)


def _norm_cell(s: str | None) -> str:
    if s is None:
        return ""
    return str(s).replace("\ufeff", "").strip()


def _is_total_line(first: str) -> bool:
    t = _norm_cell(first).lower()
    return t.startswith("total ")


def _col_index(col: dict[str, int], *names: str) -> int:
    for n in names:
        k = n.strip().lower()
        if k in col:
            return int(col[k])
    return -1


def _is_probably_data_row(cells: list[str], col: dict[str, int]) -> bool:
    j = _col_index(col, "invoice number")
    if j < 0 or j >= len(cells):
        return False
    inv = _norm_cell(cells[j])
    if not inv or not _INV_RE.match(inv):
        return False
    return True


def _is_section_header_row(cells: list[str], col: dict[str, int]) -> bool:
    if not cells or not _norm_cell(cells[0]):
        return False
    if _is_total_line(cells[0]):
        return False
    if _is_probably_data_row(cells, col):
        return False
    inv_i = _col_index(col, "invoice number")
    src_i = _col_index(col, "source")
    if inv_i >= 0 and src_i >= 0 and inv_i < len(cells) and src_i < len(cells):
        inv = _norm_cell(cells[inv_i])
        src = _norm_cell(cells[src_i])
        if not inv and not src:
            return bool(_norm_cell(cells[0]))
    n_non_empty = sum(1 for c in cells if _norm_cell(c))
    if n_non_empty == 1:
        return _norm_cell(cells[0]) not in {
            "Receivable Invoice Detail",
            "DOLPHIN PLASTICS & PACKAGING",
        }
    return False


def _find_header_row(rows: list[list[str]]) -> tuple[int, dict[str, int]] | None:
    for i, r in enumerate(rows):
        if not r or not _norm_cell(r[0]):
            continue
        if _norm_cell(r[0]).lower() != "invoice number":
            continue
        col = {_norm_cell(c).lower(): j for j, c in enumerate(r) if _norm_cell(c)}
        if "invoice number" in col and "source" in col:
            return i, col
    return None


def _get(row: list[str], i: int) -> str:
    if i < 0 or i >= len(row):
        return ""
    return _norm_cell(row[i])


def _map_line(client_section: str, row: list[str], col: dict[str, int]) -> DolphinLine:
    return DolphinLine(
        client_section=client_section,
        invoice_number=_get(row, _col_index(col, "invoice number")),
        invoice_date=_get(row, _col_index(col, "invoice date")),
        source=_get(row, _col_index(col, "source")),
        reference=_get(row, _col_index(col, "reference")),
        item_code=_get(row, _col_index(col, "item code")),
        description=_get(row, _col_index(col, "description")),
        quantity=_get(row, _col_index(col, "quantity")),
        unit_price_ex=_get(row, _col_index(col, "unit price (ex) (aud)", "unit price (ex)")),
        discount_ex=_get(row, _col_index(col, "discount (ex) (aud)", "discount (ex)")),
        gst=_get(row, _col_index(col, "gst (aud)", "gst")),
        gross=_get(row, _col_index(col, "gross (aud)", "gross")),
        invoice_total=_get(row, _col_index(col, "invoice total (aud)", "invoice total")),
        balance=_get(row, _col_index(col, "balance (aud)", "balance")),
        contact_account_number=_get(row, _col_index(col, "contact account number")),
        contact_group=_get(row, _col_index(col, "contact group")),
        account_code=_get(row, _col_index(col, "account code")),
        account_name=_get(
            row,
            _col_index(
                col,
                "account",
            ),
        ),
        raw_row=row,
    )


def iter_dolphin_tsv_rows(
    path: str | Path | TextIO,
) -> tuple[list[str], list[DolphinLine], list[str]]:
    """
    Parse a TSV file. Returns ``(header_cells, data_lines, warnings)`` where ``data_lines`` are
    all rows (any ``Source``); call :meth:`DolphinLine.is_receivable_invoice` to filter.
    """
    if isinstance(path, str | Path):
        text = Path(path).read_text(encoding="utf-8", errors="replace")
    else:
        text = path.read()
    reader = csv.reader(StringIO(text), delimiter="\t")
    rows: list[list[str]] = [list(r) for r in reader]
    if not rows:
        return [], [], ["empty file"]

    hdr = _find_header_row(rows)
    if not hdr:
        return [], [], ["header row with 'Invoice Number' and 'Source' not found"]
    start_i, col = hdr
    header_cells = rows[start_i]

    out: list[DolphinLine] = []
    warn: list[str] = []
    current_client = "Unknown"
    for r in rows[start_i + 1 :]:
        if not r or all(not _norm_cell(c) for c in r):
            continue
        if _is_section_header_row(r, col):
            current_client = _norm_cell(r[0]) or current_client
            continue
        if not _is_probably_data_row(r, col):
            if _norm_cell(r[0]) and _is_total_line(r[0]):
                continue
            n0 = _norm_cell(r[0])
            looks_like_inv = _INV_RE.match(n0)
            if (
                n0
                and not n0[0].isdigit()
                and "receivable" not in n0.lower()
                and not looks_like_inv
            ):
                if not _is_total_line(r[0]):
                    current_client = n0
            continue
        try:
            out.append(_map_line(current_client, r, col))
        except Exception as e:  # pragma: no cover
            warn.append(f"skip row parse error: {e}")

    return header_cells, out, warn


def group_lines_by_invoice(
    lines: list[DolphinLine], *, only_receivable_invoice: bool = True
) -> dict[tuple[str, str], list[DolphinLine]]:
    """
    Group by ``(client_section, invoice_number)`` so the same MYOB invoice number is one order.
    If ``only_receivable_invoice``, keep rows that pass :meth:`DolphinLine.is_receivable_invoice`.
    """
    g: dict[tuple[str, str], list[DolphinLine]] = {}
    for ln in lines:
        if only_receivable_invoice and not ln.is_receivable_invoice():
            continue
        if not (ln.invoice_number or "").strip():
            continue
        key = (ln.client_section.strip() or "Unknown", ln.invoice_number.strip())
        g.setdefault(key, []).append(ln)
    for _k, g_lines in g.items():
        g_lines.sort(
            key=lambda r: (r.invoice_date or "", r.item_code or "", (r.description or "")[:40]),
        )
    return g
