from decimal import Decimal
from fastapi.testclient import TestClient
from app.main import app
from app.quotes.routes import get_product_service, get_ratecard_service
from app.auth.deps import current_identity


class _ProductStub:
    def get_version(self, product_version_id: int):
        assert product_version_id == 1
        return {
            "spec": {
                "product_type": "Bag",
                "geometry": "flat",
                "base_width_mm": 300,
                "base_length_mm": 500,
                "thickness_um": 25,
                "print_method": "none",
                "num_colours": 0,
                "finish_mode": "Cartons",
                "blend": [{"code": "LD", "pct": 100, "density": 920}],
            }
        }


class _RatecardStub:
    def get_ratebook(self):
        return {
            "resins_price_per_kg": {"LD": "1.50"},
            "printing_rates": {"none": {"cost_per_1000m": "0"}},
            "conversion_rate": {"bags_per_minute": "200", "setup_minutes": "0"},
            "waste_adders": [],
            "extrusion_throughput_kg_per_hr": "100",
        }


def test_quotes_calculate_htmx_partial():
    app.dependency_overrides[get_product_service] = lambda: _ProductStub()
    app.dependency_overrides[get_ratecard_service] = lambda: _RatecardStub()
    # Satisfy role and CSRF dependencies
    app.dependency_overrides[current_identity] = lambda request=None: {"user": "tester", "roles": ["SALES"], "csrf": "t"}
    client = TestClient(app)
    payload = {
        "product_version_id": 1,
        "quantity": {"units": 1000},
        "requested_margin": "0.2",
    }
    resp = client.post("/api/quotes/calculate", json=payload, headers={"x-csrf-token": "t"})
    assert resp.status_code == 200
    data = resp.json()
    assert "currency" not in data
    assert "cost_breakdown" in data
    assert "final_price" in data


