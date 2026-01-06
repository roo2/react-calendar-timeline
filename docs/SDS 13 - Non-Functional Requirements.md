SDS 13 — Non-Functional Requirements
1. Purpose & Design Intent

Non-functional requirements define:

How the system behaves under load

How safe it is to operate

How resilient it is to human error and power loss

How maintainable it is over time

Design intent:

Prefer boring, predictable technology

Optimise for factory uptime

Assume intermittent connectivity

Assume non-technical users

Assume one site, one server

A system that crashes less is more valuable than one that has more features.

2. Deployment Environment
2.1 Target Environment (MVP)

Single on-prem server (Linux recommended)

Local network access (LAN / Wi-Fi)

Optional VPN for remote access

No public internet dependency required for core operation

2.2 Supported Clients

Modern mobile browsers (Android / iOS)

Desktop browsers (Chrome, Edge)

No native apps required

3. Availability & Reliability
3.1 Uptime Targets

Production hours availability: ≥ 99%

Graceful degradation preferred over hard failure

3.2 Failure Modes to Handle Gracefully

Browser refresh mid-operation

Operator phone battery dies

Temporary network dropout

Server restart

3.3 Required Behaviours

Append-only writes protect partial data

Idempotent POSTs where possible

No “half-saved” runs

4. Performance Requirements
4.1 Latency
Action	Target
Page load	< 500 ms
HTMX action	< 200 ms
Quote calculation	< 1 s
Run start/stop	Instantaneous feel
Gantt drag-and-drop	validate + update lane in < 200 ms
Gantt initial render	< 1 s for one-week view with 12 lanes
4.2 Concurrency

Expected concurrent users: 5–20

Peak events:

multiple operators recording outputs

manager reordering schedule

System must handle this without locking UI.

5. Data Integrity & Consistency
5.1 Transactionality

All state-changing operations wrapped in DB transactions

Failure → full rollback

5.2 Idempotency

For critical actions:

start run

complete run

confirm dispatch

System must:

detect duplicates

prevent double execution

6. Security Requirements
6.1 Authentication

Username + password

Passwords:

salted

hashed (bcrypt or argon2)

Session timeout configurable

6.2 Authorization

Strict role-based access control

Server-side enforcement (never trust UI)

6.3 Network Security

HTTPS strongly recommended (even internally)

Reverse proxy (nginx / caddy)

Firewall restricts DB access to app only

7. Auditability & Logging
7.1 Required Logs

Authentication events (login/logout)

Quote approvals and overrides

Inventory adjustments

Dispatch confirmations

System errors

7.2 Explicitly Not Required

Per-field audit trails

Read access logs

User behaviour analytics

7.3 Log Retention

Logs retained for minimum 12 months

Rotated automatically

8. Backup & Recovery
8.1 Backup Strategy (MVP)

Nightly database backups

Stored:

locally

optional off-server copy (USB / NAS)

8.2 Restore Requirements

Full system restore < 1 hour

Restore must include:

database

uploaded files (artwork)

config files

8.3 Test Restores

Manual restore test at least quarterly

9. Data Longevity
9.1 Retention Rules

Product specs: indefinite

Quotes & orders: ≥ 7 years (commercial)

Inventory ledger: ≥ 7 years

Production runs & QC: ≥ 3 years

Deletion:

Soft delete only

Hard delete not exposed in UI

10. Maintainability
10.1 Codebase

Modular monolith

Clear module boundaries (see SDS 11)

No circular dependencies

10.2 Configuration

Environment-based config (dotenv)

No hard-coded secrets

Rate cards editable in UI, not code

Operating calendar configurable (week template, site start anchor time, optional 24/7 mode)

10.3 Testability

Unit tests for:

quote engine

scheduling invariants

Smoke tests for:

run lifecycle

inventory adjustments

11. Observability (Minimal but Sufficient)
11.1 Health Checks

/health endpoint

DB connectivity

disk space (optional)

11.2 Metrics (Optional MVP)

active users

active runs

queue lengths

gantt bars rendered

gantt dnd operations/min

Advanced monitoring deferred.

12. Accessibility & Usability
12.1 Accessibility

High contrast colour scheme

Large fonts

Avoid colour-only status indicators

12.2 Usability

No long forms for operators

Progressive disclosure for managers

Defaults everywhere possible

13. Localization & Units

Language: English only (MVP)

Units:

Metric only

No unit switching

14. Compliance & Risk
14.1 Regulatory

No personal sensitive data stored beyond users

No financial payment processing

No regulatory certifications required (MVP)

14.2 Risk Mitigation
Risk	Mitigation
Operator misuse	Role-based UI + server enforcement
Bad data	Append-only + immutability
Hardware failure	Backups
Knowledge loss	System replaces tribal knowledge
15. Explicit Non-Goals (Reaffirmed)

Not a CRM

Not an ERP

Not a scheduling optimiser

Not a warehouse management system

Not cloud-first

16. Why These NFRs Work

Align with real factory constraints

Keep system stable and predictable

Avoid premature complexity

Allow growth without refactoring