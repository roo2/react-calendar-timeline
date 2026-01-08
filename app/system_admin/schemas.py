from pydantic import BaseModel
from typing import List, Literal

from app.auth.schemas import CreateUserRequest


class OperatingCalendar(BaseModel):
    # Week template, site start anchor (e.g., Monday 04:30), optional 24/7
    mode: Literal["week_template", "twenty_four_seven"] = "week_template"
    start_time_hhmm: str = "04:30"
    days: List[str] = ["Mon", "Tue", "Wed", "Thu"]  # MVP: 4-day week
    hours_per_day: float = 24.0
    exceptions: List[str] = []  # dates like "2026-01-26" (public holidays)


class CreateUserBody(CreateUserRequest):
    pass


