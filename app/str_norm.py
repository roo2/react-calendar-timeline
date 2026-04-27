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
