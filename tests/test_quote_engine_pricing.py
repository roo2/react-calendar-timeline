from decimal import Decimal
from app.quotes.quote_engine.models import (
    SpecDTO,
    ResinComponent,
    RateBook,
    PrintingRate,
    ConversionRate,
    QuantityRequest,
)
from app.quotes.quote_engine.calculator import compute_dimensions, preview_quote


def make_spec():
    return SpecDTO(
        product_type="Bag",
        geometry="flat",  # type: ignore
        base_width_mm=Decimal(300),
        base_length_mm=Decimal(500),
        continuous_roll=False,
        thickness_um=Decimal(25),
        print_method="uteco",
        num_colours=3,
        finish_mode="Cartons",
        blend=[ResinComponent(code="LD", pct=Decimal(100), density=Decimal("920"))],
        colour_code="RED",
        colour_strength_pct=Decimal("2.5"),
        additives={"SLIP": Decimal("1.0")},
    )


def make_ratebook():
    return RateBook(
        resins_price_per_kg={"LD": Decimal("1.50")},
        additives_price_per_kg={"SLIP": Decimal("3.00")},
        colours_price_per_kg={"RED": Decimal("10.00")},
        printing_rates={
            "uteco": PrintingRate(method="uteco", cost_per_1000m=Decimal("5.00"), setup_cost=Decimal("50.00"), minimum_charge=Decimal("60.00")),
            "inline": PrintingRate(method="inline", cost_per_1000m=Decimal("2.50")),
        },
        conversion_rate=ConversionRate(bags_per_minute=Decimal("200"), setup_minutes=Decimal("10")),
        waste_adders=[],
        extrusion_throughput_kg_per_hr=Decimal("100"),
    )


def test_kg_per_unit_and_material_costs():
    spec = make_spec()
    dims = compute_dimensions(spec)
    assert dims.kg_per_unit > 0


def test_preview_quote_simple_totals():
    spec = make_spec()
    ratebook = make_ratebook()
    req = QuantityRequest(units=1000)
    result = preview_quote(spec=spec, ratebook=ratebook, req=req, margin=Decimal("0.20"))
    assert result.total_cost > 0
    assert result.final_price > result.total_cost  # margin applied
    assert result.unit_price is not None


