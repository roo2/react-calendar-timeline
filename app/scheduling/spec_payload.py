"""Spec payload helpers shared by scheduling and machine validation (no heavy imports)."""

from __future__ import annotations

from typing import Any, Optional


def _compute_gauge_um_from_spec(spec: Any) -> Optional[float]:
	"""Resolve film thickness (µm) from a product spec / job spec dict."""
	if not isinstance(spec, dict):
		return None
	materials = spec.get("materials") or {}
	if isinstance(materials, dict) and materials.get("gauge_um") is not None:
		try:
			return float(materials.get("gauge_um"))
		except Exception:
			return None
	if spec.get("gauge_um") is not None:
		try:
			return float(spec.get("gauge_um"))
		except Exception:
			return None
	return None
