SDS 4 — Quote Engine
1. Purpose & Design Intent

The Quote Engine converts a Product Specification (Job Sheet version) plus order intent into a priced commercial offer.

Design intent:

Deterministic — same inputs always produce the same result

Explainable — every dollar can be traced to a rule or rate card

Config-driven — prices live in tables, not code

Governed — overrides are explicit and logged

Snapshot-based — quotes never change retroactively

The quote engine is not a negotiation tool.
It is a calculator with guardrails.

2. Scope
In scope

Material cost calculation

Yield & quantity derivation

Machine selection for costing

Waste estimation

Printing & conversion costing

Packaging & core costing

Margin & final price

Multi-currency snapshotting

Override governance

Out of scope (explicit)

Dynamic pricing optimisation

Automatic FX fetching (manual snapshot only in v1)

Demand-based pricing

Customer-specific discount logic (can be layered later)

3. Quote Lifecycle
States
draft → pending_approval → approved → sent → won | lost

Rules

Quotes are created in draft

Only Production Manager may approve

Only approved quotes can be converted to Orders

Approved quotes are immutable except via explicit overrides

4. Inputs (Authoritative)
4.1 Core Inputs
Required

product_version_id

customer_id

currency (AUD | USD)

Order intent:

target quantity (one of):

total kg

total meters

number of rolls

number of bags/cartons

trim selection (%)

Optional

manual FX rate (if currency ≠ AUD)

requested margin (defaults from system config)

4.2 Derived Inputs (from Product Version)

Geometry & dimensions

Formulation (resin blend, additives, colour)

Printing method & colours

Packaging requirements

Quality flags

Run requirements

5. Canonical Internal Units

All calculations normalize to:

Mass: kg

Length: meters

Area: m²

Time: minutes

Cost: currency unit of quote

No calculations are done in mixed units.

6. Rate Cards & Configuration Tables

All prices and thresholds live in database tables, editable by Production Managers.

6.1 Resin Catalog

resin_code

price_per_kg

density (kg/m³)

currency

6.2 Additive Catalog

additive_code

price_per_kg

currency

6.3 Colour Catalog

colour_code

price_per_kg

opaque_multiplier

currency

6.4 Core Catalog

core_type

cost_per_meter

kg_per_meter

currency

6.5 Machine Capability Table

machine_id

min_width / max_width

min_gauge / max_gauge

throughput_kg_per_hr

6.6 Printing Rate Cards

method (inline / uteco)

min_meters

setup_cost

cost_per_1000m

currency

6.7 Conversion Rate Card

min_gauge / max_gauge

min_length / max_length

bags_per_minute

roll_change_penalty_minutes

6.8 Waste Adders

condition (e.g. custom blend, inline print, gusset)

waste_minutes

7. Calculation Pipeline (Normative)

The quote engine must execute exactly in this order.

Step 1 — Normalize Quantities

From order intent + product geometry derive:

meters per unit

kg per meter

total meters

total kg

rolls count

meters per roll

kg per roll

This logic mirrors the spreadsheet but uses canonical units.

Step 2 — Material Cost per kg
Resin blend
blend_cost_per_kg =
  Σ (component_pct × resin_price_per_kg)

Colour cost
colour_cost_per_kg =
  colour_price × (strength_pct / 100)
  + (opaque ? opaque_multiplier × colour_price : 0)

Additives
additive_cost_per_kg =
  Σ (additive_pct × additive_price_per_kg)

Total material cost
material_cost_per_kg =
  resin + colour + additives

Step 3 — Core Cost

Based on:

core type

inclusion policy (include / half / exclude)

width or length basis

Produces:

core_cost_total

core_weight_total

Step 4 — Machine Selection (Costing Only)

Select the first capable machine that satisfies:

decision width ∈ machine range

gauge ∈ machine range

From that machine:

throughput_kg_per_hr

meters_per_hr (derived)

This selection affects costing, not scheduling.

Step 5 — Waste Estimation

Compute waste minutes:

waste_minutes =
  base_setup
  + Σ applicable waste adders


Convert to kg:

waste_kg =
  (waste_minutes / 60) × machine_throughput_kg_per_hr

Step 6 — Printing Cost

If printing enabled:

printing_cost =
  max(
    setup_cost + (total_meters / 1000 × rate_per_1000m),
    minimum_charge
  )

Step 7 — Conversion Cost

Determine bags/minute from rate card:

conversion_minutes =
  total_bags / bags_per_minute
  + roll_changes × roll_change_penalty


Then convert to cost via configured labour rate (or flat rate).

Step 8 — Packaging Cost

Includes:

cartons

pallets

wrap

consumables

Derived from:

pack mode

quantities

packaging requirements

Step 9 — Total Cost Build-Up
total_cost =
  material_cost
  + waste_cost
  + printing_cost
  + conversion_cost
  + packaging_cost
  + overheads

Step 10 — Margin & Price
price =
  total_cost / (1 - margin)


Margin defaults from system config but may be overridden by Production Manager.

8. Multi-Currency Handling

Quotes are priced in a single currency

All rate cards store a currency

If currencies differ:

require manual FX rate entry

store fx_rate_used

All derived values store:

base currency amount

quoted currency amount

No retroactive FX updates.

9. Overrides (Governed Escape Hatch)
Allowed override fields

Final price

Margin

Waste assumptions

Rules

Only Production Managers

Override creates immutable QuoteOverrideAudit record:

field

old value

new value

user

timestamp

Overrides do not recalculate underlying costs.

10. Outputs (Authoritative)
Stored on Quote

Cost breakdown

Quantities (kg, meters, rolls, bags)

Selected machine (for costing)

Waste estimates

Margin

Final price

Currency + FX snapshot

Approval & override metadata

These outputs are snapshotted and never recomputed unless a new quote is created.

11. Validation & Failure Modes
Hard failures

Resin percentages ≠ 100%

Missing rate card entries

No capable machine found

Missing artwork for printed products

Soft warnings

High waste %

Thin gauge near machine limits

Unusual bag/roll ratios

Warnings do not block quoting.

12. Testing Strategy (Critical)
Spreadsheet parity tests

Import known spreadsheet rows as fixtures

Assert:

kg totals

material cost

waste kg

final price (± rounding tolerance)

Determinism test

Same inputs → same outputs every run

13. What This Design Guarantees

Quotes can be trusted by production

Operators are never surprised by specs

Managers can intervene without breaking traceability

Future pricing logic can evolve without rewriting history