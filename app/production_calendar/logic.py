"""
Production operating hours: wall-clock segments per local day + exceptions.
Used to advance job finish times across nights/weekends/holidays (Gantt advisory).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

try:
	from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
except ImportError:  # pragma: no cover
	ZoneInfo = None  # type: ignore
	ZoneInfoNotFoundError = Exception  # type: ignore


UTC = timezone.utc

# Factory location — all production hours and Gantt advisory times use this IANA zone.
FACTORY_TIMEZONE = "Australia/Brisbane"

WEEKDAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

DEFAULT_WEEK_JSON: Dict[str, Dict[str, Any]] = {
	"monday": {"enabled": True, "start": "00:00", "end": "24:00"},
	"tuesday": {"enabled": True, "start": "00:00", "end": "24:00"},
	"wednesday": {"enabled": True, "start": "00:00", "end": "24:00"},
	"thursday": {"enabled": True, "start": "00:00", "end": "24:00"},
	"friday": {"enabled": True, "start": "00:00", "end": "16:30"},
	"saturday": {"enabled": False, "start": "00:00", "end": "24:00"},
	"sunday": {"enabled": False, "start": "00:00", "end": "24:00"},
}


@dataclass
class CalendarExceptionData:
	closed: bool
	open_time: Optional[str] = None
	close_time: Optional[str] = None


@dataclass
class OperatingContext:
	tz: Any  # ZoneInfo
	week: Dict[str, Any]
	exceptions_by_date: Dict[date, CalendarExceptionData]
	gantt_preview_weeks: int


def _zone(tz_name: str):
	if ZoneInfo is None:
		return timezone.utc
	try:
		return ZoneInfo(tz_name)
	except ZoneInfoNotFoundError:
		return ZoneInfo("UTC") if ZoneInfo else timezone.utc


def parse_hm(s: str) -> Tuple[int, int]:
	parts = (s or "00:00").strip().split(":")
	h = int(parts[0])
	m = int(parts[1]) if len(parts) > 1 else 0
	return h, m


def _combine_local(d: date, h: int, m: int, tz) -> datetime:
	return datetime(d.year, d.month, d.day, h, m, 0, 0, tzinfo=tz)


def segments_for_day(d: date, ctx: OperatingContext) -> List[Tuple[datetime, datetime]]:
	"""Ordered non-overlapping [start, end) segments in factory local time."""
	tz = ctx.tz
	exc = ctx.exceptions_by_date.get(d)
	if exc and exc.closed:
		return []

	wd = d.weekday()
	key = WEEKDAY_KEYS[wd]
	day_cfg = ctx.week.get(key) or {}
	if not day_cfg.get("enabled", False):
		return []

	st = str(day_cfg.get("start", "00:00"))
	en = str(day_cfg.get("end", "24:00"))
	h1, m1 = parse_hm(st)
	start_dt = _combine_local(d, h1, m1, tz)

	if en.strip() in ("24:00", "24:00:00"):
		end_dt = _combine_local(d, 0, 0, tz) + timedelta(days=1)
	else:
		h2, m2 = parse_hm(en)
		if h2 >= 24:
			end_dt = _combine_local(d, 0, 0, tz) + timedelta(days=1)
		else:
			end_dt = _combine_local(d, h2, m2, tz)

	if exc:
		if exc.open_time:
			oh, om = parse_hm(exc.open_time)
			open_dt = _combine_local(d, oh, om, tz)
			start_dt = max(start_dt, open_dt)
		if exc.close_time:
			ch, cm = parse_hm(exc.close_time)
			close_dt = _combine_local(d, ch, cm, tz)
			end_dt = min(end_dt, close_dt)

	if start_dt >= end_dt:
		return []
	return [(start_dt, end_dt)]


def segment_containing(t: datetime, ctx: OperatingContext) -> Optional[Tuple[datetime, datetime]]:
	t = t.astimezone(ctx.tz)
	for a, b in segments_for_day(t.date(), ctx):
		if a <= t < b:
			return (a, b)
	return None


def snap_to_operating_instant(t: datetime, ctx: OperatingContext) -> datetime:
	"""If t is inside an operating segment, return t; else next segment start."""
	t = t.astimezone(ctx.tz)
	if segment_containing(t, ctx):
		return t
	return next_open_at_or_after(t, ctx)


def next_open_at_or_after(t: datetime, ctx: OperatingContext) -> datetime:
	t = t.astimezone(ctx.tz)
	d = t.date()
	for _ in range(800):
		segs = segments_for_day(d, ctx)
		for a, b in segs:
			if b <= t:
				continue
			candidate = a if t < a else t
			if candidate < b:
				return candidate
		d = d + timedelta(days=1)
		t = datetime.combine(d, time(0, 0), tzinfo=ctx.tz)
	raise ValueError("No operating hours found in the next 800 days — check Admin → Production hours.")


def operating_hours_between(start: datetime, end: datetime, ctx: OperatingContext) -> float:
	"""
	Operating-time hours from `start` toward `end` (non-negative).
	Uses monotonicity of add_operating_hours in the searched interval.
	"""
	if end <= start:
		return 0.0
	start_l = start.astimezone(ctx.tz)
	end_l = end.astimezone(ctx.tz)
	# Upper bound: wall-clock span is an upper bound on operating hours
	hi = max(24.0 * 400.0, (end_l - start_l).total_seconds() / 3600.0 * 2.0)
	lo = 0.0
	for _ in range(90):
		mid = (lo + hi) / 2.0
		t = add_operating_hours(start_l, mid, ctx)
		if t <= end_l:
			lo = mid
		else:
			hi = mid
	return lo


def add_operating_hours(start: datetime, duration_hours: float, ctx: OperatingContext) -> datetime:
	"""
	Advance `start` by `duration_hours` of *operating* time (inside weekly hours, respecting exceptions).
	`start` should be timezone-aware (UTC or local).
	"""
	if duration_hours <= 0:
		return start.astimezone(ctx.tz)
	t = snap_to_operating_instant(start, ctx)
	remaining = duration_hours * 3600.0
	epsilon = 1e-4
	guard = 0
	while remaining > epsilon:
		guard += 1
		if guard > 500000:
			raise ValueError("Operating hours calculation exceeded iteration limit")
		cov = segment_containing(t, ctx)
		if cov is None:
			t = next_open_at_or_after(t, ctx)
			continue
		_a, b = cov
		slack = (b - t).total_seconds()
		if slack <= 0:
			t = next_open_at_or_after(b, ctx)
			continue
		use = min(remaining, slack)
		remaining -= use
		t = t + timedelta(seconds=use)
		if remaining > epsilon:
			if t >= b or segment_containing(t, ctx) is None:
				t = next_open_at_or_after(t, ctx)
	return t


def compute_gantt_window_bounds(
	ctx: OperatingContext,
	now_utc: Optional[datetime] = None,
	max_finish_local: Optional[datetime] = None,
) -> Tuple[datetime, datetime]:
	"""
	Returns (window_start_utc, window_end_utc) for Gantt axis.
	Window start = next operating instant from now (in factory TZ).
	Window end = max(now + preview_weeks wall, max_finish + 1 day), in UTC.
	"""
	if now_utc is None:
		now_utc = datetime.now(tz=UTC)
	now_local = now_utc.astimezone(ctx.tz)
	start_local = snap_to_operating_instant(now_local, ctx)
	end_wall_local = start_local + timedelta(weeks=ctx.gantt_preview_weeks)
	if max_finish_local is not None:
		mx = max(max_finish_local.astimezone(ctx.tz), start_local)
		end_local = max(end_wall_local, mx + timedelta(days=1))
	else:
		end_local = end_wall_local
	return (start_local.astimezone(UTC), end_local.astimezone(UTC))


def operating_context_from_settings(
	timezone_name: str,
	week_json: Optional[Dict[str, Any]],
	gantt_preview_weeks: int,
	exceptions: List[Tuple[date, CalendarExceptionData]],
) -> OperatingContext:
	tz = _zone(timezone_name or "UTC")
	week = week_json if isinstance(week_json, dict) and week_json else DEFAULT_WEEK_JSON
	ex_map: Dict[date, CalendarExceptionData] = {d: e for d, e in exceptions}
	wks = max(1, min(52, int(gantt_preview_weeks or 4)))
	return OperatingContext(tz=tz, week=week, exceptions_by_date=ex_map, gantt_preview_weeks=wks)


def calendar_dict_for_gantt(window_start_utc: datetime, window_end_utc: datetime, timezone_name: str) -> dict:
	return {
		"start": window_start_utc,
		"end": window_end_utc,
		"timezone": timezone_name,
		"days": None,
		"hours_per_day": None,
	}
