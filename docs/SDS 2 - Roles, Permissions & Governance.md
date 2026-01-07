SDS 2 — Roles, Permissions & Governance
1. Design Philosophy

The system enforces operational safety through constraint, not trust.

Key principles:

Authority follows responsibility

People who carry production risk control production truth.

Separation of intent and execution

Sales can propose; production approves.

Immutability over audit complexity

Prevent bad changes instead of logging everything.

Minimal logging, maximal protection

Only log events that change truth or money.

This is a factory system, not a collaboration app.

2. Role Model Overview

There are three operational roles and one system capability role.

Operational roles

Sales

Operator

Production Manager

Capability role

System Admin

A single user account may hold multiple roles (e.g. Production Manager + System Admin).

3. Role Definitions (Intent & Scope)
3.1 Sales
Primary responsibility

Convert customer demand into commercial intent.

Allowed to:

Create and edit Customers

Create Products (Job Sheets) initially

Create Quotes

Submit Quotes for approval

Create Orders (from approved quotes or directly)

View production and job status (read-only)

Explicitly not allowed to:

Approve quotes

Override pricing, margin, or waste

Edit job sheets after approval

Edit rate cards

Schedule machines

Start or modify production runs

Modify inventory

Rationale:
Sales owns opportunity, not risk.

3.2 Operator
Primary responsibility

Execute production safely and correctly.

Provide feedback from the factory floor.

Allowed to:

View assigned Jobs and Product Specs (read-only)

Start / pause / resume / complete Operation Runs

Record production outputs

Perform and record QC checks

Submit Operator Suggestions

Add execution notes

Explicitly not allowed to:

Edit Product Specs

Edit Product Versions

Override pricing or waste

Create or edit Quotes or Orders

Schedule jobs

Modify inventory levels

Approve anything

Rationale:
Operators are closest to reality but must not change truth silently.

3.3 Production Manager (Operational Admin)

This role is not an IT admin.
It is a business authority role.

Primary responsibility

Own manufacturing correctness and profitability.

Allowed to:

Approve Quotes

Override final price, margin, and waste assumptions

Create new Product Versions

Accept or reject Operator Suggestions

Schedule Jobs on Machines

Manage production priorities

Receive inventory

Adjust inventory (manual adjustments allowed)

Dispatch and close Jobs and Orders

Explicitly not allowed to:

Manage users or credentials (unless also System Admin)

Change system-level security settings

Rationale:
This role carries the commercial and production risk and therefore controls truth.

3.4 System Admin (Capability Role)
Primary responsibility

Maintain the system, not the factory.

Allowed to:

Create, disable, and reset users

Assign and revoke roles

Configure system-wide settings

Manage backups and exports

Configure future integrations (HubSpot, Xero, printers)

View all data (read-only unless also holding another role)

Explicitly not allowed to:

Implicitly approve quotes or override pricing

Modify production data without holding Production Manager role

Rationale:
Separation of system power from business authority prevents accidental damage.

3.5 Branding Management (Capability)
Primary responsibility

Manage site‑wide branding and theme configuration.

Allowed to:

Create/update BrandTheme
Upload logo assets (SVG/PNG) and font files (WOFF/WOFF2)
Activate a theme (exactly one active at a time)

Explicitly not allowed to:

Change production data without Production Manager role
Approve quotes or override pricing

Rationale:
Branding changes are system configuration and must be controlled by System Admin.

4. Permission Matrix (Authoritative)
Action	Sales	Operator	Prod Manager	System Admin
Create customer	✅	❌	✅	✅
Create product (job sheet)	✅	❌	✅	✅
Edit product spec	❌	❌	✅	✅
Create product version	❌	❌	✅	✅
Submit operator suggestion	❌	✅	✅	✅
Approve quote	❌	❌	✅	❌
Override price/margin/waste	❌	❌	✅	❌
Create quote	✅	❌	✅	❌
Create order	✅	❌	✅	❌
Create job	❌	❌	✅	❌
Schedule job	❌	❌	✅	❌
Start/stop production	❌	✅	✅	❌
Record QC	❌	✅	✅	❌
Adjust inventory	❌	❌	✅	❌
Manage users	❌	❌	❌	✅
System settings	❌	❌	❌	✅
Manage branding (BrandTheme)	❌	❌	❌	✅
Upload logo/font assets	❌	❌	❌	✅

This table is normative.
UI and API must enforce it.

5. Approval & Override Governance
5.1 Quote Approval
Rules

All quotes must pass through:
draft → pending approval → approved

Only Production Managers can approve.

Approval locks:

pricing assumptions

cost breakdown

currency snapshot

Consequences

Approved quotes can be converted to Orders.

Sales cannot self-approve.

5.2 Pricing Overrides
Allowed overrides

Final total price

Margin

Waste assumptions

Governance

Only Production Managers

Overrides must:

record previous value

record new value

record user and timestamp

Non-requirements

No mandatory reason text

No approval chain

Design intent:
Allow fast real-world decision-making without eroding trust.

6. Product Specification Governance
6.1 Editing Rules

Product Specs are edited only by creating new versions

Old versions remain readable forever

Orders and Jobs always reference a specific version

6.2 Operator Suggestions

Operators submit suggestions

Production Managers decide:

Accept → new Product Version

Reject → suggestion closed

No direct edits. Ever.

7. Production Governance
7.1 Job Execution

Jobs may:

be paused

resume later

span multiple days

Jobs are not “failed” by default—exceptions are explicit.

7.2 Machine Exclusivity

One active Operation Run per machine at any time.

Enforced at:

API level

UI level

8. Inventory Governance
8.1 Allowed Behavior

Negative stock is allowed

Manual adjustments are allowed

Receipts and consumption are logged as ledger entries

8.2 Required Logging

Who adjusted

When

Quantity

Item

8.3 Not Required

Reason text

Approval workflow

9. Logging & Audit Rules (Minimal but Critical)
Must be logged

Quote approvals

Quote overrides

Inventory adjustments

Job start/stop/completion

Dispatch confirmation

Not required

Field-by-field audit trails

Read access logs

UI navigation logs

Principle:
Log events that change truth, money, or stock.

10. Governance Failure Modes (What the System Must Prevent)

The system must hard-stop the following:

Operators editing specs

Sales approving quotes

Silent modification of approved quotes

Overwriting historical specs

Running two jobs on one machine

Deleting inventory history

Editing past execution records

If any of these occur, it is a system bug, not user error.