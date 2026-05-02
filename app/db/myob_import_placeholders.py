"""Fixed UUIDs for internal MYOB import draft job sheets (migration + app code)."""

# Internal "system" customer that owns the placeholder product used only for draft import rows.
MYOB_DRAFT_INTERNAL_CUSTOMER_ID = "a0000001-0000-4000-8000-000000000001"

# Product + version used for JobSheet rows until staff pick the real product/spec.
MYOB_DRAFT_PLACEHOLDER_PRODUCT_ID = "a0000001-0000-4000-8000-000000000002"
MYOB_DRAFT_PLACEHOLDER_VERSION_ID = "a0000001-0000-4000-8000-000000000003"

# Reserved placeholder code on the internal draft customer (display-only codes may repeat across real customers).
MYOB_DRAFT_PRODUCT_CODE = "__MYOB_IMPORT__"

# Minimal spec for the placeholder product version; real production uses a new version.
MYOB_DRAFT_SPEC_PAYLOAD: dict = {
    "identity": {"product_type": "other", "finish_mode": "Rolls"},
    "import_placeholder": True,
}
