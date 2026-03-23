"""SQLAlchemy column types that tolerate legacy enum storage (member names vs values)."""

from __future__ import annotations

from sqlalchemy import String, TypeDecorator

from app.db.models.enums import OrderStatus


class OrderStatusColumn(TypeDecorator):
	"""
	Persists OrderStatus.value (e.g. draft). On read, accepts either DB value or legacy Python member name (e.g. DRAFT).
	"""

	impl = String(32)
	cache_ok = True

	def process_bind_param(self, value, dialect):
		if value is None:
			return None
		if isinstance(value, OrderStatus):
			return value.value
		if isinstance(value, str):
			try:
				return OrderStatus(value.lower()).value
			except ValueError:
				if value.upper() in OrderStatus.__members__:
					return OrderStatus[value.upper()].value
		raise TypeError(f"Not an OrderStatus: {value!r}")

	def process_result_value(self, value, dialect):
		if value is None:
			return None
		s = str(value).strip()
		try:
			return OrderStatus(s.lower())
		except ValueError:
			pass
		key = s.upper()
		if key in OrderStatus.__members__:
			return OrderStatus[key]
		raise ValueError(f"Invalid order status in database: {value!r}")
