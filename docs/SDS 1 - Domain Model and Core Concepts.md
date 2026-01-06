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

customer_code (human-visible, sequential)

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

Machine telemetry (OperationRun auto-updates)

Predictive scheduling (without rewriting core entities)