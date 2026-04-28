"""Small string normalizers shared across modules."""

from __future__ import annotations

# Hyphen / minus / dash characters MYOB and editors often leave as a trailing separator.
_TRAILING_DASH_CHARS = frozenset("-–—−")


def strip_trailing_dash_suffix(value: str | None) -> str:
    """
    Drop trailing hyphen-like characters and surrounding spaces.

    MYOB line text often ends with a lone separator, e.g. ``FREIGHT CHARGED -``.
    """
    if value is None:
        return ""
    t = str(value).rstrip()
    while t and t[-1] in _TRAILING_DASH_CHARS:
        t = t[:-1].rstrip()
    return t


def customer_facing_product_code_from_import_description(text: str | None) -> str | None:
    """
    For MYOB / Dolphin long-form line descriptions, return the leading "customer-facing" code segment
    before the first `` - `` (e.g. ``PB1000800100 - L/D NATURAL POLY BAG ...`` → ``PB1000800100``).
    """
    s = (text or "").strip()
    if not s or " - " not in s:
        return None
    head = s.split(" - ", 1)[0].strip()
    return head or None
