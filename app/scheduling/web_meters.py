"""
Derive web length (meters) for scheduling from job sheet quantity + product spec.

Mirrors the frontend ``computeDerivedGeometryAndTotals`` / quote calculator enough
for Uteco print duration (meters ÷ meters_per_min).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.domain import Job, JobSheet, OrderItem
from app.db.models.rate_cards import Core, PrintingPricingTier, Resin

if TYPE_CHECKING:
    from app.db.models.domain import ProductVersion


def _clamp(n: float, lo: float, hi: float) -> float:
	return max(lo, min(hi, n))


def _mm_to_m(mm: float) -> float:
	return mm / 1000.0


def _um_to_m(um: float) -> float:
	return um / 1_000_000.0


def job_sheet_for_job(session: Session, job: Job) -> Optional[JobSheet]:
	if job.job_sheet_id:
		return session.get(JobSheet, str(job.job_sheet_id))
	if job.order_id:
		items = list(
			session.execute(
				select(OrderItem).where(OrderItem.order_id == str(job.order_id)).order_by(OrderItem.id.asc())
			).scalars().all()
		)
		idx = int(job.job_code) - 1
		if 0 <= idx < len(items):
			js_id = items[idx].job_sheet_id
			if js_id:
				return session.get(JobSheet, str(js_id))
	return None


def run_up_lane_count_from_spec(spec: dict) -> int:
	"""Sheet/Centerfold run-up lane count (0 if not applicable or ``none``). Matches quote UI slugs."""
	identity = spec.get("identity") or {}
	pt = str(identity.get("product_type") or "")
	if pt not in ("Sheet", "Centerfold"):
		return 0
	run_req = spec.get("run_requirements") or {}
	ru_slug = str(run_req.get("run_up") or "none")
	if ru_slug == "1up":
		return 1
	if ru_slug == "2up":
		return 2
	if ru_slug == "4up":
		return 4
	if ru_slug == "6up":
		return 6
	return 0


def printing_run_up_length_multiplier_from_spec(_spec: dict) -> float:
	"""Run-up widens the die and slits lanes; it does not multiply product web metres for printing/Uteco (matches frontend)."""
	return 1.0


def layflat_mm_from_spec(spec: dict) -> float:
	"""Die / extrusion layflat (includes Sheet/Centerfold run-up width). Match ``computeLayflatMm`` in the quotes UI."""
	identity = spec.get("identity") or {}
	dims = spec.get("dimensions") or {}
	pt = str(identity.get("product_type") or "")
	geom = str(dims.get("geometry") or "Flat").lower()
	try:
		w = float(dims.get("base_width_mm") or 0)
	except (TypeError, ValueError):
		w = 0.0
	try:
		g = float(dims.get("gusset_mm") or 0)
	except (TypeError, ValueError):
		g = 0.0
	ru = run_up_lane_count_from_spec(spec)
	if (pt == "Sheet" or pt == "Centerfold") and ru > 0:
		return w * (ru / 2.0)
	if pt == "Centerfold" or geom in ("centrefold", "centre_fold", "centerfold"):
		return 0.5 * w
	if pt == "U-Film":
		lw = float(dims.get("ufilm_left_width_mm") or 0)
		rw = float(dims.get("ufilm_right_width_mm") or 0)
		return w + lw + rw
	if pt == "J-Film":
		lw = float(dims.get("ufilm_left_width_mm") or 0)
		rw = float(dims.get("ufilm_right_width_mm") or 0)
		return lw + rw
	if geom == "gusset":
		return w + g
	return w


def layflat_mm_mass_from_spec(spec: dict) -> float:
	"""Layflat for polymer kg/m (per finished strip); excludes run-up width inflation. Match ``computeLayflatMmForMass`` in the frontend."""
	identity = spec.get("identity") or {}
	dims = spec.get("dimensions") or {}
	pt = str(identity.get("product_type") or "")
	geom = str(dims.get("geometry") or "Flat").lower()
	try:
		w = float(dims.get("base_width_mm") or 0)
	except (TypeError, ValueError):
		w = 0.0
	try:
		g = float(dims.get("gusset_mm") or 0)
	except (TypeError, ValueError):
		g = 0.0
	if pt == "Centerfold" or geom in ("centrefold", "centre_fold", "centerfold"):
		return 0.5 * w
	if pt == "U-Film":
		lw = float(dims.get("ufilm_left_width_mm") or 0)
		rw = float(dims.get("ufilm_right_width_mm") or 0)
		return w + lw + rw
	if pt == "J-Film":
		lw = float(dims.get("ufilm_left_width_mm") or 0)
		rw = float(dims.get("ufilm_right_width_mm") or 0)
		return lw + rw
	if geom == "gusset":
		return w + g
	return w


def thickness_um_from_spec(spec: dict) -> float:
	dims = spec.get("dimensions") or {}
	try:
		return float(dims.get("thickness_um") or 0)
	except (TypeError, ValueError):
		return 0.0


def trim_factor_from_spec(spec: dict) -> Optional[float]:
	"""Multiplier on nominal gauge (1 − trim%/100), not on web metres."""
	identity = spec.get("identity") or {}
	try:
		tp = identity.get("trim_pct")
		if tp is None:
			return None
		p = float(tp)
		if p <= 0:
			return None
		return _clamp(1.0 - p / 100.0, 0.01, 1.0)
	except (TypeError, ValueError):
		return None


def _roll_weight_billing_slug(spec: dict) -> str:
	identity = spec.get("identity") or {}
	pack = spec.get("packaging") or {}
	raw = (
		identity.get("roll_weight_billing")
		or spec.get("roll_weight_billing")
		or pack.get("core_policy")
	)
	x = str(raw or "core_off").strip().lower().replace("-", "_").replace(" ", "_")
	if x in ("core_half_off", "half_core", "half"):
		return "core_half_off"
	if x in ("core_off", "exclude_core", "exclude", "without_core", "no_core"):
		return "core_off"
	if x in ("core_included", "include_core", "include", "with_core"):
		return "core_included"
	return "core_off"


def core_kg_per_roll_for_billing(session: Session, spec: dict) -> float:
	identity = spec.get("identity") or {}
	pack = spec.get("packaging") or {}
	if str(identity.get("finish_mode") or "") != "Rolls":
		return 0.0
	if _roll_weight_billing_slug(spec) == "core_off":
		return 0.0
	core_type = pack.get("core_type")
	if core_type is None or str(core_type).strip().lower() in ("", "none"):
		return 0.0
	core = session.get(Core, str(core_type).strip())
	if core is None or float(core.kg_per_meter or 0) <= 0:
		return 0.0
	layflat_mm = layflat_mm_mass_from_spec(spec)
	if layflat_mm <= 0:
		return 0.0
	frac = 0.5 if _roll_weight_billing_slug(spec) == "core_half_off" else 1.0
	return _mm_to_m(layflat_mm) * float(core.kg_per_meter) * frac


def effective_thickness_um_from_spec(spec: dict) -> float:
	"""Nominal gauge reduced by trim % for polymer mass; metres are not scaled by trim."""
	nominal = thickness_um_from_spec(spec)
	tf = trim_factor_from_spec(spec)
	if tf is None or nominal <= 0:
		return nominal
	return nominal * tf


def blend_density_kg_m3(session: Session, spec: dict) -> float:
	formulation = spec.get("formulation") or {}
	blend_in = formulation.get("blend") if isinstance(formulation.get("blend"), list) else []
	if not blend_in:
		blend_in = [{"resin_code": "LDPE", "pct": 100}]
	rows: list[dict[str, float]] = []
	for c in blend_in:
		if not isinstance(c, dict):
			continue
		code = str(c.get("resin_code") or "").strip()
		try:
			pct = float(c.get("pct") or 0)
		except (TypeError, ValueError):
			pct = 0.0
		if not code or pct <= 0:
			continue
		r = session.get(Resin, code)
		density = float(r.density) * 1_000_000.0 if r is not None else 920.0
		rows.append({"pct": pct, "density": density})
	if not rows:
		return 920.0
	total = sum(x["pct"] for x in rows)
	if total <= 0:
		return 920.0
	if abs(total - 100.0) > 0.01:
		return float(sum(x["density"] * (x["pct"] / total) for x in rows))
	return float(sum(x["density"] * (x["pct"] / 100.0) for x in rows))


def quantity_object_from_job_sheet(spec: dict, js: JobSheet) -> dict[str, Any]:
	"""Mirror ``buildQuantityObjectForCalculator`` inputs from persisted job sheet rows."""
	identity = spec.get("identity") or {}
	finish = str(identity.get("finish_mode") or "Rolls")
	pt = str(identity.get("product_type") or "")
	dims = spec.get("dimensions") or {}
	pack = spec.get("packaging") or {}
	qty_type = str(js.qty_type or "kg")
	qv = float(js.quantity_value or 0)
	num_rolls = max(1, int(js.num_rolls or 1))
	wpr = float(js.weight_per_roll_kg or 0)
	num_units = float(js.num_product_units if js.num_product_units is not None else 0)
	if qty_type == "units" and num_units <= 0:
		num_units = qv
	try:
		base_length_mm = float(dims.get("base_length_mm") or 0)
	except (TypeError, ValueError):
		base_length_mm = 0.0
	length_units = str(dims.get("length_units") or "mm").lower()
	continuous = finish == "Rolls" and (pt == "Tube" or length_units in ("continuous",))
	try:
		units_per_roll = float(pack.get("bags_per_roll") or pack.get("units_per_roll") or 0)
	except (TypeError, ValueError):
		units_per_roll = 0.0
	out: dict[str, Any] = {}
	if qty_type == "units":
		u = int(round(num_units)) if num_units > 0 else None
		if u is not None:
			out["units"] = u
	elif qty_type == "kg":
		if finish == "Rolls" and num_rolls > 0 and wpr > 0:
			out["total_kg"] = num_rolls * wpr
			out["rolls"] = num_rolls
		elif qv > 0:
			out["total_kg"] = qv
		if finish == "Rolls" and "rolls" not in out and qv > 0 and wpr > 0:
			out["rolls"] = max(1, round(qv / wpr))
		if (
			finish == "Rolls"
			and not continuous
			and base_length_mm > 0
			and out.get("rolls")
			and units_per_roll > 0
		):
			out["total_m"] = (int(out["rolls"]) * units_per_roll * base_length_mm) / 1000.0
	elif qty_type == "total_rolls":
		rolls = int(qv) if qv > 0 else num_rolls
		if rolls > 0 and wpr > 0:
			out["total_kg"] = rolls * wpr
			out["rolls"] = rolls
		elif rolls > 0:
			out["rolls"] = rolls
		if (
			not continuous
			and base_length_mm > 0
			and units_per_roll > 0
			and rolls > 0
			and not (out.get("total_m") and float(out["total_m"]) > 0)
		):
			out["total_m"] = (rolls * units_per_roll * base_length_mm) / 1000.0
	elif qty_type == "rolls_units":
		rolls = int(qv) if qv > 0 else num_rolls
		if rolls > 0 and units_per_roll > 0:
			total_units = rolls * units_per_roll
			out["units"] = int(round(total_units))
			out["rolls"] = rolls
			if base_length_mm > 0:
				out["total_m"] = (total_units * base_length_mm) / 1000.0
	if finish == "Rolls" and num_rolls > 0 and qty_type not in ("total_rolls", "rolls_units"):
		if "rolls" not in out:
			out["rolls"] = num_rolls
	if qty_type == "units" and num_units > 0 and base_length_mm > 0:
		out["total_m"] = (num_units * base_length_mm) / 1000.0
	return out


def web_length_meters_from_spec_and_quantity(session: Session, spec: dict, qty: dict[str, Any]) -> float:
	identity = spec.get("identity") or {}
	dims = spec.get("dimensions") or {}
	finish = str(identity.get("finish_mode") or "Rolls")
	pt = str(identity.get("product_type") or "")
	layflat_mm = layflat_mm_mass_from_spec(spec)
	base_len_raw = dims.get("base_length_mm")
	continuous = finish == "Rolls" and (pt == "Tube" or base_len_raw is None)
	if continuous:
		effective_len_m = 1.0
	else:
		try:
			unit_length_mm = float(base_len_raw or 0)
		except (TypeError, ValueError):
			unit_length_mm = 0.0
		lu = str(dims.get("length_units") or "mm").lower()
		if lu == "m":
			unit_length_mm = unit_length_mm * 1000.0
		effective_len_m = _mm_to_m(unit_length_mm) if unit_length_mm > 0 else 0.0

	thickness_um = effective_thickness_um_from_spec(spec)
	nominal_thickness_um = thickness_um_from_spec(spec)
	density = blend_density_kg_m3(session, spec)
	thickness_m = _um_to_m(thickness_um)
	kg_per_m2 = density * thickness_m
	kg_per_linear_m_untrimmed = (
		density * _um_to_m(nominal_thickness_um) * _mm_to_m(layflat_mm) if layflat_mm > 0 else 0.0
	)
	area_per_unit_m2 = effective_len_m * _mm_to_m(layflat_mm) if layflat_mm > 0 and effective_len_m > 0 else 0.0
	kg_per_unit = area_per_unit_m2 * kg_per_m2
	kg_per_linear_m = kg_per_m2 * _mm_to_m(layflat_mm) if layflat_mm > 0 else 0.0

	units_in = qty.get("units")
	total_kg_req = qty.get("total_kg")
	total_m_req = qty.get("total_m")

	units_in_i = int(units_in) if units_in is not None and float(units_in) > 0 else None
	total_kg_n = float(total_kg_req) if total_kg_req is not None and float(total_kg_req) > 0 else None
	total_m_n = float(total_m_req) if total_m_req is not None and float(total_m_req) > 0 else None
	trim_factor = trim_factor_from_spec(spec)
	target_units_i = units_in_i
	if finish == "Cartons" and units_in_i is not None and trim_factor is not None and trim_factor > 0:
		target_units_i = int(round(units_in_i * (1.0 + (1.0 - trim_factor))))

	if target_units_i is not None and not continuous and effective_len_m > 0:
		derived_total_m = float(target_units_i) * effective_len_m
	elif total_m_n is not None:
		derived_total_m = total_m_n
	elif target_units_i is not None and kg_per_unit > 0 and kg_per_linear_m > 0:
		derived_total_m = float(target_units_i) * effective_len_m if effective_len_m > 0 else (kg_per_unit * target_units_i) / kg_per_linear_m
	else:
		derived_total_kg = total_kg_n if total_kg_n is not None else 0.0
		if total_m_n is not None:
			derived_total_m = total_m_n
		elif derived_total_kg > 0 and kg_per_linear_m_untrimmed > 0:
			# Legacy kg-only: untrimmed kg/m so trim does not shrink scheduled web length.
			derived_total_m = derived_total_kg / kg_per_linear_m_untrimmed
		else:
			derived_total_m = 0.0

	m = max(0.0, float(derived_total_m))
	return m * printing_run_up_length_multiplier_from_spec(spec)


def web_length_meters_for_uteco_schedule(session: Session, job: Job, product_version: Optional[ProductVersion]) -> float:
	spec = (product_version.spec_payload if product_version else {}) or {}
	if not isinstance(spec, dict):
		spec = {}
	js = job_sheet_for_job(session, job)
	if js is not None:
		qty = quantity_object_from_job_sheet(spec, js)
		m = web_length_meters_from_spec_and_quantity(session, spec, qty)
		if m > 0:
			return m
	return max(float(job.planned_qty) * 0.1, 1.0)


def pick_uteco_printing_tier(session: Session, print_width_mm: int, num_colours: int) -> Optional[PrintingPricingTier]:
	if print_width_mm <= 0 or num_colours < 1:
		return None
	rows = list(
		session.execute(
			select(PrintingPricingTier)
			.where(
				PrintingPricingTier.method == "uteco",
				PrintingPricingTier.num_colours == num_colours,
				PrintingPricingTier.max_print_width_mm >= print_width_mm,
			)
			.order_by(PrintingPricingTier.max_print_width_mm.asc())
		).scalars().all()
	)
	return rows[0] if rows else None
