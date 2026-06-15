"""Unit tests for customer list filtering helpers."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from app.customers.service import _apply_customer_list_sort
from app.db.models.domain import Customer


def _sql(stmt) -> str:
    return str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True})).lower()


def test_apply_customer_list_sort_defaults_to_priority_and_name():
    stmt = select(Customer)
    out = _apply_customer_list_sort(stmt, sort_by=None, sort_dir=None)
    compiled = _sql(out)
    assert "priority_rank" in compiled
    assert "name" in compiled


def test_apply_customer_list_sort_brand_joins_brand_table():
    stmt = select(Customer)
    out = _apply_customer_list_sort(stmt, sort_by="brand", sort_dir="asc")
    compiled = _sql(out)
    assert "brands" in compiled


def test_apply_customer_list_sort_contact_uses_first_name():
    stmt = select(Customer)
    out = _apply_customer_list_sort(stmt, sort_by="contact", sort_dir="desc")
    compiled = _sql(out)
    assert "contact_first_name" in compiled
