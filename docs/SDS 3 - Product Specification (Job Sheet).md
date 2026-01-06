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