from decimal import Decimal
from app.quotes.quote_engine.models import SpecDTO, ResinComponent
from app.quotes.quote_engine.calculator import compute_dimensions


def _spec(geometry: str, width: int, length: int | None = 500, gusset: int | None = None, roll: bool = False) -> SpecDTO:
    return SpecDTO(
        product_type="Bag",
        geometry=geometry,  # type: ignore
        base_width_mm=Decimal(width),
        base_length_mm=Decimal(length) if length is not None else None,
        continuous_roll=roll,
        gusset_mm=Decimal(gusset) if gusset is not None else None,
        thickness_um=Decimal(25),
        print_method="none",
        blend=[ResinComponent(code="LD", pct=Decimal(100), density=Decimal("920"))],
    )


def test_dimensions_flat():
    dims = compute_dimensions(_spec("flat", 300, 500))
    assert dims.layflat_mm == Decimal(300)


def test_dimensions_gusset():
    dims = compute_dimensions(_spec("gusset", 200, 400, gusset=50))
    assert dims.layflat_mm == Decimal(200 + 50)


def test_dimensions_bottom_gusset():
    dims = compute_dimensions(_spec("bottom_gusset", 250, 600))
    assert dims.layflat_mm == Decimal(250)


def test_dimensions_centre_fold():
    dims = compute_dimensions(_spec("centre_fold", 150, 700))
    assert dims.layflat_mm == Decimal(150) / Decimal(2)


def test_dimensions_roll_uses_1m_length():
    dims = compute_dimensions(_spec("flat", 300, None, roll=True))
    # area per unit uses 1m when continuous roll
    assert dims.area_per_unit_m2 > 0


