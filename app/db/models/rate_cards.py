from __future__ import annotations

from sqlalchemy import Boolean, CheckConstraint, Enum as SAEnum, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
import uuid

from app.db.models import Base
from app.db.models.enums import PrintingMethod


class Resin(Base):
    __tablename__ = "resins"

    resin_code: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    density: Mapped[float] = mapped_column(Numeric(12, 6))
    price_per_kg: Mapped[float] = mapped_column(Numeric(12, 4))

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
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (CheckConstraint("price_per_kg >= 0", name="ck_additives_price_nonneg"),)


class Colour(Base):
    __tablename__ = "colours"

    colour_code: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    price_per_kg: Mapped[float] = mapped_column(Numeric(12, 4))

    __table_args__ = (
        CheckConstraint("price_per_kg >= 0", name="ck_colours_price_nonneg"),
    )


class Core(Base):
    __tablename__ = "cores"

    core_type: Mapped[str] = mapped_column(String(32), primary_key=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    cost_per_meter: Mapped[float] = mapped_column(Numeric(12, 4))
    kg_per_meter: Mapped[float] = mapped_column(Numeric(12, 4))

    __table_args__ = (
        CheckConstraint("cost_per_meter >= 0", name="ck_cores_cost_nonneg"),
        CheckConstraint("kg_per_meter >= 0", name="ck_cores_kg_nonneg"),
    )


class Ink(Base):
    __tablename__ = "inks"

    ink_code: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    printer_type: Mapped[str] = mapped_column(String(16), default="inline")


class Plate(Base):
    __tablename__ = "plates"

    customer_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("customers.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    plate_code: Mapped[str] = mapped_column(String(32), primary_key=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cylinder: Mapped[str | None] = mapped_column(String(64), nullable=True)


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


class PrintingPricingTier(Base):
    __tablename__ = "printing_pricing_tiers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    method: Mapped[str] = mapped_column(String(16))
    max_print_width_mm: Mapped[int] = mapped_column(Integer)
    num_colours: Mapped[int] = mapped_column(Integer)
    min_meters: Mapped[int] = mapped_column(Integer)
    min_charge: Mapped[float | None] = mapped_column(Numeric(12, 4), nullable=True)
    setup_fee: Mapped[float | None] = mapped_column(Numeric(12, 4), nullable=True)
    cost_per_1000m: Mapped[float] = mapped_column(Numeric(12, 4))

    __table_args__ = (
        UniqueConstraint("method", "max_print_width_mm", "num_colours", name="uq_printing_pricing_tier"),
        CheckConstraint("method IN ('inline','uteco')", name="ck_print_tier_method"),
        CheckConstraint("max_print_width_mm > 0", name="ck_print_tier_max_width_pos"),
        CheckConstraint("num_colours >= 1", name="ck_print_tier_num_colours_ge1"),
        CheckConstraint("min_meters >= 0", name="ck_print_tier_min_m_ge0"),
        CheckConstraint("min_charge IS NULL OR min_charge >= 0", name="ck_print_tier_min_charge_nonneg"),
        CheckConstraint("setup_fee IS NULL OR setup_fee >= 0", name="ck_print_tier_setup_fee_nonneg"),
        CheckConstraint("cost_per_1000m >= 0", name="ck_print_tier_cost_nonneg"),
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


class ConversionSpeed(Base):
    __tablename__ = "conversion_speeds"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    min_gauge_um: Mapped[int] = mapped_column(Integer)
    max_gauge_um: Mapped[int] = mapped_column(Integer)
    min_length_mm: Mapped[int] = mapped_column(Integer)
    max_length_mm: Mapped[int] = mapped_column(Integer)
    bags_per_minute: Mapped[float] = mapped_column(Numeric(12, 4))

    __table_args__ = (
        UniqueConstraint(
            "min_gauge_um",
            "max_gauge_um",
            "min_length_mm",
            "max_length_mm",
            name="uq_conversion_speed_range",
        ),
        CheckConstraint("min_gauge_um >= 0", name="ck_conv_speed_min_gauge_ge0"),
        CheckConstraint("max_gauge_um >= min_gauge_um", name="ck_conv_speed_gauge_range"),
        CheckConstraint("min_length_mm >= 0", name="ck_conv_speed_min_len_ge0"),
        CheckConstraint("max_length_mm >= min_length_mm", name="ck_conv_speed_len_range"),
        CheckConstraint("bags_per_minute > 0", name="ck_conv_speed_bpm_pos"),
    )


class ConversionFactor(Base):
    __tablename__ = "conversion_factors"

    slug: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    value: Mapped[float] = mapped_column(Numeric(12, 4))

    __table_args__ = (
        CheckConstraint("length(slug) > 0", name="ck_conversion_factors_slug_nonempty"),
    )


class WasteAdder(Base):
    __tablename__ = "waste_adders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    condition: Mapped[str] = mapped_column(Text)
    waste_minutes: Mapped[int] = mapped_column(Integer)

    __table_args__ = (
        CheckConstraint("waste_minutes >= 0", name="ck_waste_minutes_nonneg"),
    )


class Extruder(Base):
    __tablename__ = "extruders"

    extruder_code: Mapped[str] = mapped_column(String(16), primary_key=True)
    model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    film_width_min_mm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    film_width_max_mm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    decision_width_mm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    average_kg_hr: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ave_width: Mapped[float | None] = mapped_column(Numeric(12, 3), nullable=True)
    cost_per_hr: Mapped[float | None] = mapped_column(Numeric(12, 4), nullable=True)

    __table_args__ = (
        CheckConstraint("cost_per_hr IS NULL OR cost_per_hr >= 0", name="ck_extruders_cost_per_hr_nonneg"),
    )


class ExtrusionWasteFactor(Base):
    __tablename__ = "extrusion_waste_factors"

    factor: Mapped[str] = mapped_column(Text, primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True)
    minutes: Mapped[int] = mapped_column(Integer)

    __table_args__ = (
        CheckConstraint("length(slug) > 0", name="ck_extrusion_waste_factors_slug_nonempty"),
        CheckConstraint("minutes >= 0", name="ck_extrusion_waste_factors_minutes_nonneg"),
    )

