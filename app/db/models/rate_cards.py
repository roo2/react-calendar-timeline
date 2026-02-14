from __future__ import annotations

from sqlalchemy import Boolean, CheckConstraint, Enum as SAEnum, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
import uuid

from app.db.models import Base
from app.db.models.enums import PrintingMethod


class Resin(Base):
    __tablename__ = "resins"

    resin_code: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    density: Mapped[float] = mapped_column(Numeric(6, 4))
    price_per_kg: Mapped[float] = mapped_column(Numeric(12, 4))
    currency: Mapped[str] = mapped_column(String(3))

    __table_args__ = (
        CheckConstraint("density > 0", name="ck_resins_density_positive"),
        CheckConstraint("price_per_kg >= 0", name="ck_resins_price_nonneg"),
    )


class ResinBlend(Base):
    __tablename__ = "resin_blends"

    blend_code: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))

    components: Mapped[list["ResinBlendComponent"]] = relationship(
        "ResinBlendComponent",
        back_populates="blend",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class ResinBlendComponent(Base):
    __tablename__ = "resin_blend_components"

    blend_code: Mapped[str] = mapped_column(
        String(32),
        ForeignKey("resin_blends.blend_code", ondelete="CASCADE"),
        primary_key=True,
    )
    resin_code: Mapped[str] = mapped_column(String(32), primary_key=True)
    pct: Mapped[float] = mapped_column(Numeric(6, 2))

    blend: Mapped["ResinBlend"] = relationship("ResinBlend", back_populates="components")

    __table_args__ = (
        CheckConstraint("pct >= 0", name="ck_resin_blend_components_pct_nonneg"),
        CheckConstraint("pct <= 100", name="ck_resin_blend_components_pct_le_100"),
    )


class Additive(Base):
    __tablename__ = "additives"

    additive_code: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    price_per_kg: Mapped[float] = mapped_column(Numeric(12, 4))
    category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (CheckConstraint("price_per_kg >= 0", name="ck_additives_price_nonneg"),)


class Colour(Base):
    __tablename__ = "colours"

    colour_code: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    price_per_kg: Mapped[float] = mapped_column(Numeric(12, 4))
    opacity_multiplier: Mapped[float] = mapped_column(Numeric(6, 3), default=0)
    currency: Mapped[str] = mapped_column(String(3))

    __table_args__ = (
        CheckConstraint("price_per_kg >= 0", name="ck_colours_price_nonneg"),
        CheckConstraint("opacity_multiplier >= 0", name="ck_colours_opacity_nonneg"),
    )


class Core(Base):
    __tablename__ = "cores"

    core_type: Mapped[str] = mapped_column(String(32), primary_key=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    cost_per_meter: Mapped[float] = mapped_column(Numeric(12, 4))
    kg_per_meter: Mapped[float] = mapped_column(Numeric(12, 4))
    currency: Mapped[str] = mapped_column(String(3))

    __table_args__ = (
        CheckConstraint("cost_per_meter >= 0", name="ck_cores_cost_nonneg"),
        CheckConstraint("kg_per_meter >= 0", name="ck_cores_kg_nonneg"),
    )


class Ink(Base):
    __tablename__ = "inks"

    ink_code: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))


class Plate(Base):
    __tablename__ = "plates"

    customer_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("customers.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    plate_code: Mapped[str] = mapped_column(String(32), primary_key=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)


class PrintingRate(Base):
    __tablename__ = "printing_rates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    method: Mapped[PrintingMethod] = mapped_column(SAEnum(PrintingMethod, name="printing_method"))
    min_meters: Mapped[float] = mapped_column(Numeric(12, 2))
    cost_per_1000m: Mapped[float] = mapped_column(Numeric(12, 4))
    setup_minutes: Mapped[int] = mapped_column(Integer)
    duplex_supported: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (
        CheckConstraint("min_meters >= 0", name="ck_printing_rates_min_m_ge0"),
        CheckConstraint("cost_per_1000m >= 0", name="ck_printing_rates_cost_nonneg"),
        CheckConstraint("setup_minutes >= 0", name="ck_printing_rates_setup_nonneg"),
    )


class ConversionRate(Base):
    __tablename__ = "conversion_rates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    min_gauge_um: Mapped[int] = mapped_column(Integer)
    max_gauge_um: Mapped[int] = mapped_column(Integer)
    min_length_mm: Mapped[int] = mapped_column(Integer)
    max_length_mm: Mapped[int] = mapped_column(Integer)
    bags_per_hour: Mapped[int] = mapped_column(Integer)
    setup_minutes: Mapped[int] = mapped_column(Integer)

    __table_args__ = (
        CheckConstraint("min_gauge_um >= 0", name="ck_conv_min_gauge_ge0"),
        CheckConstraint("max_gauge_um >= min_gauge_um", name="ck_conv_gauge_range"),
        CheckConstraint("min_length_mm >= 0", name="ck_conv_min_len_ge0"),
        CheckConstraint("max_length_mm >= min_length_mm", name="ck_conv_len_range"),
        CheckConstraint("bags_per_hour > 0", name="ck_conv_bph_pos"),
        CheckConstraint("setup_minutes >= 0", name="ck_conv_setup_nonneg"),
    )


class WasteAdder(Base):
    __tablename__ = "waste_adders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    condition: Mapped[str] = mapped_column(Text)
    waste_minutes: Mapped[int] = mapped_column(Integer)

    __table_args__ = (
        CheckConstraint("waste_minutes >= 0", name="ck_waste_minutes_nonneg"),
    )


