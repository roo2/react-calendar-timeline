"""Product code generation (underscore segments + additive short codes)."""

from app.products.product_code_additive import (
    product_code_additive_segment,
    normalize_additive_code_for_product_code,
)
from app.products.product_type_finish_shortcode import product_type_finish_shortcode_from_spec
from app.products.service import compute_product_code_base


def _minimal_spec(*, additives=None):
    return {
        "identity": {"product_type": "Bag", "finish_mode": "Rolls"},
        "dimensions": {
            "base_width_mm": 200,
            "base_length_mm": 600,
            "thickness_um": 50,
            "geometry": "None",
        },
        "formulation": {
            "colour_components": [{"colour_code": "BLACK", "pct": 100}],
            "additives": additives or [],
        },
        "printing": {"method": "None"},
    }


def test_product_type_finish_shortcode():
    assert product_type_finish_shortcode_from_spec(_minimal_spec()) == "PBR"
    spec = _minimal_spec()
    spec["identity"]["finish_mode"] = "Cartons"
    assert product_type_finish_shortcode_from_spec(spec) == "PBC"


def test_segment_separator_is_underscore():
    code = compute_product_code_base(_minimal_spec())
    assert "-" not in code
    assert code.startswith("PBR_")
    assert "_600_50_" in code
    assert code.endswith("BLA")  # BLACK → first 3 chars


def test_legacy_additive_codes_map_to_short():
    assert normalize_additive_code_for_product_code("ANTI_BLOCK") == "AB"
    assert normalize_additive_code_for_product_code("anti_static") == "AS"


def test_up_to_two_additives_dot_separated():
    spec = _minimal_spec(
        additives=[
            {"additive_code": "ANTI_BLOCK", "pct": 1},
            {"additive_code": "UV", "pct": 0.5},
        ],
    )
    assert product_code_additive_segment(spec["formulation"]) == "AB.UV"
    code = compute_product_code_base(spec)
    assert "_AB.UV_" in code or code.endswith("_AB.UV")


def test_manual_customer_code_unchanged():
    spec = _minimal_spec()
    spec["identity"]["customer_code"] = "CUSTOM-123"
    assert compute_product_code_base(spec) == "CUSTOM-123"
