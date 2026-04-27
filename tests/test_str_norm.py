from app.str_norm import strip_trailing_dash_suffix


def test_strip_trailing_dash_suffix_freight_example():
    assert strip_trailing_dash_suffix("FREIGHT CHARGED -") == "FREIGHT CHARGED"
    assert strip_trailing_dash_suffix("FREIGHT CHARGED –") == "FREIGHT CHARGED"
    assert strip_trailing_dash_suffix("FREIGHT CHARGED —  ") == "FREIGHT CHARGED"


def test_strip_trailing_dash_suffix_preserves_internal_hyphens():
    assert strip_trailing_dash_suffix("Part-123") == "Part-123"
    assert strip_trailing_dash_suffix("A - B") == "A - B"


def test_strip_trailing_dash_suffix_none_and_empty():
    assert strip_trailing_dash_suffix(None) == ""
    assert strip_trailing_dash_suffix("") == ""
    assert strip_trailing_dash_suffix("   ") == ""
