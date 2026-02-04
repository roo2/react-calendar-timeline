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

There are two operational roles and one system capability role.

Operational roles

Sales

Production

Capability role

Administrator

A single user account may hold multiple roles (e.g. Production + Administrator).

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

3.2 Production
Primary responsibility

Own production execution and production truth.

Allowed to:

View Jobs and Product Specs (read-only)

Start / pause / resume / complete Operation Runs

Record production outputs

Perform and record QC checks

Add execution notes

Submit Production Suggestions

Create new Product Versions (as the mechanism for spec changes)

Schedule Jobs on Machines and manage production priorities

Approve Quotes

Override final price, margin, and waste assumptions

Receive inventory

Adjust inventory (manual adjustments allowed)

Dispatch and close Jobs and Orders

Explicitly not allowed to:

Manage users or credentials (unless also Administrator)

Change system-level security settings

Rationale:
This role carries the commercial and production risk and therefore controls truth.

3.3 Administrator (Capability Role)
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

Modify production data without holding Production role

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

Change production data without Production role
Approve quotes or override pricing

Rationale:
Branding changes are system configuration and must be controlled by Administrator.

4. Permission Matrix (Authoritative)
Action	Sales	Production	Administrator
Create customer	✅	✅	✅
Create product (job sheet)	✅	✅	✅
Edit product spec	❌	✅	✅
Create product version	❌	✅	✅
Submit production suggestion	❌	✅	✅
Approve quote	❌	✅	❌
Override price/margin/waste	❌	✅	❌
Create quote	✅	✅	❌
Create order	✅	✅	❌
Create job	❌	✅	❌
Schedule job	❌	✅	❌
Start/stop production	❌	✅	❌
Record QC	❌	✅	❌
Adjust inventory	❌	✅	❌
Manage users	❌	❌	✅
System settings	❌	❌	✅
Manage branding (BrandTheme)	❌	❌	✅
Upload logo/font assets	❌	❌	✅

This table is normative.
UI and API must enforce it.

5. Approval & Override Governance
5.1 Quote Approval
Rules

All quotes must pass through:
draft → pending approval → approved

Only Production can approve.

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

Only Production

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

6.2 Production Suggestions

Production users submit suggestions

Production decides:

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

Production users editing specs without creating a new version

Sales approving quotes

Silent modification of approved quotes

Overwriting historical specs

Running two jobs on one machine

Deleting inventory history

Editing past execution records

If any of these occur, it is a system bug, not user error.