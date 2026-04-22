"""Human-readable summaries for MYOB-style customer payment_terms JSON."""

from __future__ import annotations

from typing import Any


def _coerce_int(v: Any) -> int | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        if v != v:  # NaN
            return None
        return int(v)
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        try:
            return int(s)
        except ValueError:
            return None
    return None


def _ordinal(n: int) -> str:
    if 11 <= (n % 100) <= 13:
        suf = "th"
    else:
        suf = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suf}"


def describe_payment_terms(terms: dict[str, Any] | None) -> str | None:
    """
    End-user phrasing aligned with MYOB AccountRight credit terms
    (see MYOB help: Credit terms — customer selling details).
    """
    if not terms or not isinstance(terms, dict):
        return None
    pid = terms.get("payment_is_due")
    if not isinstance(pid, str) or not pid.strip():
        return None
    pid = pid.strip()
    bal = _coerce_int(terms.get("balance_due_date"))

    if pid == "CashOnDelivery":
        return "COD (cash on delivery)"
    if pid == "PrePaid":
        return "Prepaid"
    if pid == "InAGivenNumberOfDays":
        if bal is not None and bal > 0:
            return f"Payment due within {bal} days of invoice."
        return "In a given number of days (set balance due days)."
    if pid == "OnADayOfTheMonth":
        if bal is not None and 1 <= bal <= 31:
            return f"Payment due on the {_ordinal(bal)} of the month."
        return "On a day of the month."
    if pid == "NumberOfDaysAfterEOM":
        if bal is not None and bal > 0:
            return f"{bal} days after end of month."
        return "# of days after EOM (end of month) — set how many days after month-end."
    if pid == "DayOfMonthAfterEOM":
        if bal == 31:
            return "Balance due on the last day of the month after end of month."
        if bal is not None and 1 <= bal <= 31:
            return f"Balance due on the {_ordinal(bal)} after end of month."
        return "Day of month after EOM — set the balance due day (1–31; 31 = last day of month)."
    return None
