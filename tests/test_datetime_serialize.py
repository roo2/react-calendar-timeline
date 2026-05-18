from datetime import datetime, timedelta, timezone

from app.datetime_serialize import datetime_to_api_iso

AEST = timezone(timedelta(hours=10))


def test_datetime_to_api_iso_naive_assumes_utc():
    assert datetime_to_api_iso(datetime(2025, 5, 19, 4, 30, 0)) == "2025-05-19T04:30:00Z"


def test_datetime_to_api_iso_aware_converts_to_utc():
    dt = datetime(2025, 5, 19, 14, 30, 0, tzinfo=AEST)
    assert datetime_to_api_iso(dt) == "2025-05-19T04:30:00Z"
