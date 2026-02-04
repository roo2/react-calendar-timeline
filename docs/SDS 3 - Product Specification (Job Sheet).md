SDS 3 — Product Specification (Job Sheet)
1. Purpose & Design Intent

The Product Specification (Job Sheet) is the authoritative definition of what is to be manufactured.

Design intent:

Single source of truth for manufacturable intent

Immutable via versioning (no silent edits)

Human-readable on the factory floor

Machine-derivable for quoting and planning

Independent of quantity and price

If the job sheet is wrong, the factory will make the wrong thing.
Therefore: clarity beats completeness.

2. Ownership & Governance (Recap)

Owned by: Production Manager

Created by: Sales or Production Manager

Edited by: Production Manager only, via new versions

Read by: Everyone

Suggested changes by: Operators (via OperatorSuggestion)

3. Structure Overview

The Product Specification is divided into seven sections, each with clear responsibility and downstream usage.

Product Identity

Dimensions & Geometry

Materials & Formulation

Printing & Artwork

Quality Expectations

Run Requirements

Packaging & Logistics Requirements

Each section specifies:

User-entered fields

Derived fields

Validation rules

Downstream consumers (Quote / Production / QC)

4. Section 3.1 — Product Identity
Purpose

Classifies what kind of thing this is, and where it can be used.

User-entered fields

Product Type (enum)

Bag

Bag on Roll

Tube

Sheet

Centre Fold

U-Film

Finish Mode (enum)

Rolls

Cartons

Industry / Compliance Intent (multi-select)

Food contact

Non-food

Medical

Chemical / Industrial

Intended Use / Notes (free text)

Validation rules

Product Type is mandatory

Finish Mode is mandatory

Industry flags are advisory, not blocking

Downstream usage

Quote Engine: selects rate cards & waste adders

QC: determines required checks

Packaging: default assumptions

5. Section 3.2 — Dimensions & Geometry
Purpose

Defines the physical geometry of the product in canonical units.

Canonical units

Length: millimetres

Width: millimetres

Thickness: microns (µm)

User-entered fields

Base Width (mm)

Base Length (mm) (or “Continuous” for rolls)

Thickness / Gauge (µm)

Geometry Type (enum)

Flat

Gusset

Bottom Gusset

Centre Fold

Gusset Size (mm) (conditional)

Derived fields

Layflat Width (mm)

Decision Width (mm) (used for machine selection)

Area per unit (mm²)

Validation rules

Width, thickness mandatory

Length mandatory unless Finish Mode = Rolls

Gusset size required if gusset geometry selected

All values > 0

Downstream usage

Quote Engine: yield, kg/m, bags/roll

Machine selection

QC dimensional checks

6. Section 3.3 — Materials & Formulation
Purpose

Defines what the product is made from, independent of price.

6.1 Resin Blend
User-entered fields

Blend Type (enum)

LD

MD

Custom

Resin Components (list)

Resin code

Percentage (%)

Validation rules

Percentages must sum to 100%

Custom blend requires ≥1 component

Derived fields

Blend Density

Blend Material Cost / kg (via rate cards)

6.2 Colour & Opacity
User-entered fields

Colour Code

Colour Strength (%)

Opaque (boolean)

Opaque Strength (%) (conditional)

Derived fields

Colour cost per kg

Additional opacity cost per kg

6.3 Additives
User-entered fields (repeatable)

Additive type (anti-block, slip, UV, etc.)

Strength (%)

Derived fields

Additive cost per kg

Downstream usage

Quote Engine: material cost

Production: formulation reference

QC: formulation confirmation

7. Section 3.4 — Printing & Artwork
Purpose

Defines if and how the product is printed.

User-entered fields

Printing Method (enum)

None

Inline

Uteco

Number of Colours

Ink Codes

Cylinder / Plate Numbers

Print Side (front / back / both)

Artwork Files (PDFs, images)

Validation rules

Printing method required

Artwork required if printing ≠ None

Downstream usage

Quote Engine: printing cost

Production: print setup

QC: colour & artwork checks

8. Section 3.5 — Quality Expectations
Purpose

Captures risk and sensitivity, not pass/fail results.

User-entered fields

Critical Quality Flags (multi-select)

Tight gauge tolerance

Seal integrity critical

Cosmetic critical

Colour critical

Known Issues / History (free text)

Derived behavior

Determines required QC checks

Influences waste assumptions (advisory)

Downstream usage

QC module: required checks

Production UI: warnings

9. Section 3.6 — Run Requirements
Purpose

Provides execution guidance without enforcing machine control.

User-entered fields

Preferred Extruder(s) (optional)

Preferred Printer

Preferred Converter

Special Setup Notes

Treat Inside / Outside

Inline Perforation / Sealing (boolean flags)

Validation rules

None are mandatory

Advisory only

Downstream usage

Scheduling hints

Operator guidance

10. Section 3.7 — Packaging & Logistics Requirements
Purpose

Defines how the product must leave the factory.

User-entered fields

Pack Mode (Rolls / Cartons)

Core Type (7mm / 13mm / PVC / None)

Core Inclusion Policy (Include / Half / Exclude)

Bags per Carton (if cartons)

Pallet Type (Chep / Plain / Resin / None)

Wrapping Required (boolean)

Derived fields

Core cost & weight

Carton counts (when quantities known)

Downstream usage

Quote Engine

Dispatch workflow

Inventory consumption

11. Versioning Rules (Critical)

Product Specs are never edited in place

Any change creates a new ProductVersion

Existing Quotes, Orders, Jobs continue referencing old versions

Operator Suggestions are resolved by:

Accept → new version

Reject → no change

12. Data Model Summary (Product Spec)
Product
 └── ProductVersion
      ├── Identity
      ├── Dimensions
      ├── Formulation
      ├── Printing
      ├── Quality Expectations
      ├── Run Requirements
      └── Packaging Requirements

13. What This Design Fixes vs Legacy Job Sheets
Legacy Problem	New Model Solution
Specs mixed with run logs	Clean separation
Silent edits	Versioning
Overloaded paper forms	Purpose-driven sections
Operator notes overwrite history	Suggestions workflow
Re-run confusion months later	Version-linked orders

14. Derived Operation Routing Rules (MVP)
Purpose

Derive required operation order from Product Spec to guide scheduling and enforce run preconditions.

Derived Behavior

First operation must be Extrusion for all products.

Inline features (Printing Method = Inline, Perforation flags) are executed as part of the Extrusion run.

Uteco printing is a separate Printing operation and requires prior Extrusion.

Conversion (bagging) is required when Finish Mode = Cartons (loose bags).

If Printing Method = Uteco and Finish Mode = Cartons, the required order is:

Extrusion → Uteco Printing → Conversion (Bagging).

If Printing Method = None and Finish Mode = Cartons, the required order is:

Extrusion → Conversion (Bagging).

If Finish Mode = Rolls, Conversion is typically not required; Printing may be Inline or Uteco depending on Printing Method.

Validation Rules

Disallow starting a job with Uteco Printing or Conversion.

Disallow Uteco Printing unless at least one Extrusion run exists for the job.

Disallow Conversion unless:

Printing Method = None AND at least one Extrusion run exists; OR

Printing Method = Uteco AND at least one Uteco Printing run exists.

Inline printing/perforation must not create separate operations; they are attributes of the Extrusion run.

Downstream Consumers

Scheduling: advisory warnings when queues contradict required order.

Production Execution: hard precondition checks at run start.

15. QC Configuration (Per ProductVersion)
Purpose

Declare required QC checks, sampling plans, and acceptance criteria.

User-entered fields (per ProductVersion → Quality Expectations)

Sampling Plan (e.g., continuous, every N minutes, per roll, per carton)

Acceptance Criteria (thresholds, ranges, tolerances by check type)

Out-of-Control Actions (advisory: stop, alert operator)

Validation rules

Acceptance criteria required for any required QC check.

Downstream usage

Production execution enforces required QC checks and captures evidence as append-only QCCheck records.

16. QC WI Mapping (Per ProductVersion)

For each required job-level check, record reference WI code(s):

raw_material_spec_wi (default: WI-01)

dimensional_spec_wi (default: WI-01)

film_quality_leak_seal_wi (default: WI-09/10)

colour_film_ink_wi (default: WI-01/41)

venting_spec_wi (default: WI-39)

Notes

WI mappings drive the JobQCSummary final_checklist labels and references.

17. Tool Requirements (Per ProductVersion)

Purpose

Declare which movable tools are required per operation stage so scheduling can reserve them and the Gantt can display icons.

Structure (per ProductVersion)

tool_requirements: list of items

stage: extrusion | conversion

tool_type: enum (see SDS 1 Tool.type)

quantity: default 1

preferred_machine_ids (optional): list

notes (optional)

Rules

Inline printing / perforation flags map to Tool Requirements:

Printing Method = Inline → tool_type = inline_printer_1c (or 4c/silver as specified)

Inline Perforation / Sealing → tool_type = perforation_* (as applicable)

If multiple alternative tools can satisfy a need (e.g., perforation via Vicro or Orion), list multiple requirements with “one-of” semantics:

one_of: [tool_type_a, tool_type_b] (MVP: represented as separate alternatives; scheduler picks one)

Validation

tool_type must be compatible with stage and machine type.

quantity ≥ 1.

Downstream

Scheduling reserves tools for the operation window.

Gantt displays tool icons on the operation bar.