SDS 1 — Domain Model & Core Concepts
1. Purpose of the Domain Model

The domain model exists to represent how the factory actually operates, not how documents are currently filled out.

Key principles:

Job-sheet-centric:
The product specification (job sheet) is the source of truth.

Execution is separate from specification:
What should be made ≠ what was made.

Commercial intent is separate from manufacturing reality:
Quotes and orders do not directly control machines.

Everything meaningful is versioned or evented:
We never overwrite history.

2. Canonical Vocabulary (Hard Rules)

These terms are enforced throughout the system.
No synonyms. No ambiguity.

Term	Meaning
Customer	A legal/commercial entity buying product
Product	A manufacturable product definition owned by a customer
Product Version	An immutable snapshot of a product specification
Quote	A priced commercial offer based on a product version
Order	A customer commitment to purchase
Job	A single production run of an order
Operation	A manufacturing stage (extrusion, printing, conversion, packaging)
Run	A concrete execution of an operation
Inventory Transaction	A ledger entry representing stock movement

If a concept cannot be cleanly mapped to one of the above, it probably does not belong in v1.

3. Entity Overview Diagram (Textual ERD)
Customer
 ├── Product
 │    └── ProductVersion (immutable)
 │          └── Quote
 │
 └── Order
      └── Job (1..n)
            └── OperationRun (1..n)
                  └── QCCheck (0..n)

InventoryItem
 └── InventoryTransaction (ledger)

Machine
 └── OperationRun

4. Core Entities (Detailed)
4.1 Customer
Why this entity exists

Represents the commercial counterparty.
It anchors numbering, ownership, and future CRM/accounting integration.

Owns

Identity and numbering

Contact and delivery context

Long-lived commercial relationship

Does not own

Pricing rules

Product specs

Orders directly (those reference the customer)

Fields (conceptual)

customer_id (internal)

name

contacts (structured)

delivery addresses

notes

Invariants

A customer must exist before a product, quote, or order can exist.

Customer deletion is disallowed once referenced.

4.2 Product (Job Sheet Master)
Why this entity exists

Represents what is manufactured, independent of when or how often it is produced.

This is the digital replacement of the F15 job sheet, but modernised.

Owns

Identity of a manufacturable item

Relationship to a customer

The concept of versioning

Does not own

Quantities

Pricing

Execution data

Scheduling

Fields

product_id

product_code (unique, human-visible)

customer_id

active_version_id

lifecycle status (active / archived)

Invariants

A product belongs to exactly one customer

A product may have many versions

Only one version is “current”

4.3 ProductVersion (Immutable Job Sheet)
Why this entity exists

Separates specification truth from operational change.

Any time a job sheet changes in a meaningful way, a new version is created.

This is critical for:

traceability

re-runs months later

operator trust

Owns

All manufacturable specifications

Everything that feeds quoting and production

Does not own

Order quantities

Pricing decisions

Machine assignments

Execution outcomes

Fields (logical groups)

version number

created_by

created_at

spec payload:

product type

dimensions

formulation

printing/artwork

quality expectations

run requirements

packaging requirements

Invariants

Product versions are immutable

Operators cannot edit

Production Managers create new versions via controlled changes

Quotes and orders always reference a specific version

4.4 OperatorSuggestion
Why this entity exists

Captures shop-floor intelligence without corrupting specifications.

This is how continuous improvement happens without chaos.

Owns

A proposed improvement or correction

Attribution to an operator

Resolution state

Does not own

Spec changes directly

Fields

suggestion_id

product_id or product_version_id

suggestion text

category (optional)

status (open / accepted / rejected)

resolved_by

resolved_at

Invariants

Accepting a suggestion creates a new ProductVersion

Suggestions never mutate existing versions

4.5 Quote
Why this entity exists

Represents commercial intent with financial assumptions.

Quotes are derived, approved, and optionally overridden.

Owns

Pricing snapshot

Currency context

Approval and override history

Does not own

Product definitions

Production execution

Scheduling

Fields

quote_id

quote_code

customer_id

product_version_id

currency

fx rate snapshot

cost breakdown (derived)

final price

status

approval metadata

Invariants

Quotes reference exactly one product version

Approved quotes cannot be silently modified

Overrides are logged, not hidden

4.6 Order
Why this entity exists

Represents commercial commitment.

An order answers: what, for whom, by when, in what currency.

Owns

Due dates

Commercial quantities

Relationship to customer and product version

Does not own

Production execution

Machine assignments

Operational metrics

Fields

order_id

order_code

customer_id

product_version_id

quote_id (optional)

order type flags (repeat / recurring / backorder)

status

currency snapshot

Invariants

Orders reference locked product versions

Orders may produce multiple jobs over time

Orders never mutate specs

4.7 Job (Production Instance)
Why this entity exists

This is the bridge between planning and reality.

A job represents one attempt to manufacture part or all of an order.

Owns

Production intent for a specific run

Status across time

Aggregated output metrics

Does not own

Product definition

Commercial pricing

Fields

job_id

job_code (order-scoped sequence)

order_id

run index

planned quantities

produced quantities (aggregates)

status

Invariants

Jobs belong to exactly one order

Orders may have multiple jobs

Jobs may be paused, resumed, or span days

4.8 OperationRun
Why this entity exists

Captures actual execution of a manufacturing step.

This replaces:

run logs

operator notes tables

informal machine memory

Owns

Start/stop times

Machine used

Output quantities

Notes

Does not own

Product specs

Scheduling queues

Pricing

Fields

operation_run_id

job_id

operation type

machine_id

started_at / ended_at

outputs (kg, meters, rolls, cartons)

notes

Invariants

A job may have multiple runs

One run = one machine at a time

Machine exclusivity is enforced here

4.9 QCCheck
Why this entity exists

Represents quality evidence, not a checklist checkbox.

Owns

Pass/fail decisions

Measurements

Attribution

Fields

qc_check_id

operation_run_id

check type

required flag

result

numeric values (optional)

measured_by

timestamp

4.10 Machine
Why this entity exists

Defines capability constraints, not scheduling logic.

Owns

Machine identity

Capability metadata

Fields

machine_id

machine code

type (extruder / printer / converter)

capability ranges

active flag

4.11 InventoryItem & InventoryTransaction
Why ledger-based inventory exists

To support:

negative stock

auditability

weekly scrap calculation

future traceability

InventoryItem owns

category

unit of measure

InventoryTransaction owns

quantity movement

timestamp

linkage (job or receipt)

Invariants

Inventory state is derived, never stored

All stock changes are append-only

4.12 Site Machine Catalog (MVP)
Purpose

Declare installed machinery and capabilities so scheduling and execution can validate reality.

Machine Types (recap)

Extruder (may have inline 1‑colour printing and/or perforation)

Printer — Uteco (out‑of‑line, up to 6 colours, duplex)

Converter — Bagging machines

Canonical Capability Fields

machine_id

machine_code

type: extruder | printer_uteco | converter_bagger

capabilities (type-specific):

extruder:

supports_inline_1c_print: boolean

supports_inline_perforation: boolean

width_range_mm: [min, max]

gauge_range_um: [min, max]

printer_uteco:

max_colours_per_side: 6

duplex_supported: true

max_web_width_mm

converter_bagger:

supported_finish_modes: [Cartons]

min_max_width_mm: [min, max]

active: boolean

notes

Installed Machines (to be confirmed)

Extruders (8 units): EX01 … EX08

For each EX0x: set supports_inline_1c_print, supports_inline_perforation, width_range_mm, gauge_range_um, notes.

Uteco Printer (1 unit):

machine_code: UTECO01

max_colours_per_side: 6

duplex_supported: true

max_web_width_mm: [TBC]

notes: out‑of‑line flexo; requires prior extrusion.

Bagging Machines (3 units): BGR01 … BGR03

For each BGR0x: set supported_finish_modes = [Cartons], min_max_width_mm, notes.

Invariants

Machine type is immutable after creation (changes require a new machine record).

Capabilities reflect physical reality; scheduling/production must not assign runs violating capability ranges.

4.13 Automated QC Evidence (Not Included)

The system records QC evidence manually. No automated device data capture entities are defined.

(Existing) QCCheck:

source = manual

4.14 Tooling & Shared Equipment (MVP+)
Purpose

Model movable equipment (“tools”) that can be mounted to multiple machines over time, but used by only one job at a time.

New Entities

Tool

tool_id

tool_code (human-visible)

type (enum): inline_printer_1c | inline_printer_4c | inline_printer_silver | perforation_seal_vicro | perforation_seal_orion | perforation_only_orion | winder | electra_punch | v_folder | conversion_punch

stages_supported (array enum): extrusion | conversion

compatible_machine_types (array): [extruder], [converter], or both

icon_ref (static asset name)

active (boolean)

notes

ToolMount (current placement)

tool_id

machine_id (nullable)

mounted_at (timestamp)

unmounted_at (nullable)

notes

ToolReservation (append-only)

reservation_id

tool_id

operation_run_id (nullable until run starts)

job_id

machine_id (intended mount)

stage (extrusion | conversion)

reserved_from (planned)

reserved_to (planned)

status: planned | active | released | cancelled

created_by, created_at

Invariants

A Tool may be active in at most one reservation with status ∈ {planned, active} overlapping in time.

A Tool cannot be used by two OperationRuns concurrently.

ToolMount updates are append-only; the latest open mount represents current placement.

ToolReservation becomes active when the OperationRun starts; planned reservations can be cancelled/moved by the PM.

Installed Tools (site catalog)

Extrusion only:

inline_printer_1c: 2 units

inline_printer_4c: 1 unit

inline_printer_silver: 1 unit

perforation_seal_vicro: 1 unit

perforation_seal_orion: 1 unit

perforation_only_orion: 1 unit

winder: 4 units

Extrusion & Conversion:

electra_punch: 1 unit

Conversion only:

v_folder: 1 unit

conversion_punch: 1 unit

4.14.1 Tool Icon Registry

Each Tool.type has an icon asset name (SVG/PNG). UI renders the icon on Gantt bars.

Icons are stored under static assets and referenced by Tool.icon_ref.

4.15 BrandTheme (Site‑Level Settings)
Purpose

Define site‑wide branding (logo, colors, typography, shape tokens) independently of functional modules to enable future rebranding without code changes.

Owns

Logo assets (SVG/PNG)
Color tokens (semantic)
Typography (font families/weights and uploaded font files)
UI shape tokens (radius), density (optional)

Fields

theme_id
name
is_active (boolean)
palette:
  primary
  primary_contrast
  secondary
  accent
  success
  warning
  danger
  surface
  surface_alt
  text_primary
  text_secondary
  border
typography:
  heading_font_family
  body_font_family
  monospace_font_family
  heading_weight
  body_weight
  font_files: [ { family, weight, style, url, format } ]
shape:
  radius_sm
  radius_md
  radius_lg
assets:
  logo_svg_url
  logo_png_url
effective_from (optional)
updated_by
updated_at

Invariants

Exactly one active theme at any time.
SVG uploads are sanitized; fonts limited to WOFF2/WOFF; MIME type and size validated.
Theme changes are versioned; previous versions remain available for rollback.

5. Cross-Cutting Invariants (Must Never Be Broken)

Specs are immutable

Execution never edits specification

Quotes and orders reference versions

Jobs represent reality, not intent

Inventory is ledger-based

Overrides are logged, not hidden

Operators cannot silently change truth

6. What This Domain Model Enables

Because of this structure, the system can later support:

HubSpot CRM sync (Customer + Quote)

Xero accounting sync (Order + Dispatch)

Barcode tracking (Job/Run/Inventory)

Predictive scheduling (without rewriting core entities)
7. Derived Operational Metrics (Authoritative)

Purpose

Define canonical, derived metrics for inventory, work‑in‑progress (WIP), and fulfilment that power the Operational Dashboard and weekly KPIs. These metrics are computed from immutable sources (InventoryTransaction, OperationRun outputs, DispatchRecord) and never edited in place.

7.1 Inventory Categories (Normative)

Categories used by the ledger and derivations:

raw_material

wip_extruded_roll

wip_printed_roll

finished_goods

packaging_material

scrap

7.2 OutputEntry (Append‑Only, per OperationRun)

Fields

run_id

timestamp

quantity

uom

good_or_scrap (enum)

note (optional)

UOM rules

Extrusion: kg, metres

Printing: kg, metres

Conversion: units (bags), cartons

Conversion outputs are flagged as finished_goods when Finish Mode = Cartons; otherwise finished rolls.

7.3 Stage WIP Buckets (Derived)

WIP_extrusion_kg = Σ Extrusion OutputEntry.good(kg) − Σ Printing input(kg) − Σ Extrusion scrap(kg)

WIP_printing_kg = Σ Printing OutputEntry.good(kg) − Σ Conversion input(kg) − Σ Printing scrap(kg)

FG_on_hand_units = Σ Conversion OutputEntry.good(units finished_goods=true) − Σ Dispatched_units − Σ Conversion scrap(units)

Notes

Inputs are inferred from the consuming stage’s InventoryTransactions.

Balances are point‑in‑time, derived from the ledger.

7.4 Job Fulfilment Delta (Per Job)

allocated_order_units (Job‑level allocation from the parent Order)

produced_finished_units (from Conversion OutputEntry.good where finished_goods=true; or rolls/metres when Finish Mode = Rolls)

fulfilment_delta = produced_finished_units − allocated_order_units

7.5 Invariants

All metrics are derived; no stored totals.

Inventory state remains ledger‑based and append‑only.