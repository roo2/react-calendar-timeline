SDS 11 — API & Internal Interfaces
1. Purpose & Design Intent

This section defines:

HTTP route structure (the “API” behind pages/HTMX)

Request/response contracts (forms, HTMX partials)

Service layer interfaces (domain logic boundaries)

Validation & error handling rules

Transaction boundaries and invariants enforcement

Design intent:

Prefer simple, REST-like routes

Prefer server-rendered pages

Use HTMX endpoints for partial updates

Keep business logic in services, not route handlers

Enforce invariants at:

service layer

database constraints

2. System Architecture (Module Boundaries)
2.1 Recommended Python package layout
app/
  main.py
  config.py
  db/
    session.py
    migrations/
    models/               # SQLAlchemy models
  auth/
    routes.py
    service.py
    schemas.py            # Pydantic
  customers/
    routes.py
    service.py
    schemas.py
  products/
    routes.py
    service.py
    schemas.py
  quotes/
    routes.py
    service.py
    quote_engine/         # pure calculation
      models.py
      calculator.py
      selectors.py
      validators.py
      tests/
  orders/
    routes.py
    service.py
    schemas.py
  scheduling/
    routes.py
    service.py
    schemas.py
  production/
    routes.py
    service.py
    schemas.py
  inventory/
    routes.py
    service.py
    schemas.py
  dispatch/
    routes.py
    service.py
    schemas.py
  admin_ratecards/
    routes.py
    service.py
    schemas.py
  system_admin/
    routes.py
    service.py
    schemas.py
  branding/
    routes.py
    service.py
    schemas.py
  integrations/           # stubs for future
    crm/
    accounting/
    printing/
    data_capture/
  templates/
  static/

2.2 Internal “Service Layer” principle

Route handlers:

authenticate + authorize

parse input schema

call service methods

render template or return HTMX partial

Services:

enforce invariants

manage transactions

call quote engine (pure)

write DB records

Quote engine:

pure deterministic functions

no DB writes, no side effects

3. Authentication & Authorization
3.1 Session auth (MVP)

Cookie-based sessions

Server stores session in DB or signed cookie (implementation choice)

CSRF protection for forms

3.2 Role-based guards

Use a decorator or dependency like:

require_roles(*roles)

require_capability("system_admin")

UI hides links; API enforces access.

4. HTTP Route Map (Authoritative)

Routes are grouped by module. Each route notes:

permission requirement

response type: HTML page vs HTMX partial

primary service call

4.1 Auth

GET /login

Public

HTML page

POST /login

Public

Form submit

Calls AuthService.login()

POST /logout

Authenticated

Calls AuthService.logout()

4.2 Customers

GET /customers

Sales, Production Manager

HTML list (search query supported)

CustomerService.list(query)

GET /customers/new

Sales, Production Manager

HTML form

POST /customers

Sales, Production Manager (CSRF)

Create customer

CustomerService.create(payload)

GET /customers/{customer_id}

Sales, Production Manager, (optional read for Operator)

HTML detail

CustomerService.get(customer_id)

GET /customers/{customer_id}/edit

Sales, Production Manager

HTML form

POST /customers/{customer_id}

Sales, Production Manager (CSRF)

Update

CustomerService.update(customer_id, payload)

4.3 Products / Job Sheets

GET /products

Sales, Production Manager

HTML list/search

ProductService.list(query)

GET /products/new

Sales, Production Manager

HTML wizard start

POST /products

Sales, Production Manager

Creates Product + initial ProductVersion

ProductService.create_product_with_version(payload)

GET /products/{product_id}

All roles (read-only for Operator)

HTML detail (active version)

ProductService.get_with_versions(product_id)

GET /products/{product_id}/versions/{version_id}

All roles (read-only)

HTML snapshot view

ProductService.get_version(version_id)

GET /products/{product_id}/versions/new

Production Manager

HTML form prefilled from active version

POST /products/{product_id}/versions

Production Manager

Creates new ProductVersion

ProductService.create_new_version(product_id, payload)

POST /products/{product_id}/suggestions

Operator, Production Manager

Creates OperatorSuggestion

ProductService.create_suggestion(product_id, payload)

GET /suggestions

Production Manager

HTML list

ProductService.list_suggestions(filters)

POST /suggestions/{suggestion_id}/resolve

Production Manager

Accept/reject; accept creates new ProductVersion

ProductService.resolve_suggestion(suggestion_id, decision)

4.4 Quotes

GET /quotes

Sales, Production Manager

List/search

QuoteService.list(query)

GET /quotes/new

Sales, Production Manager

HTML form:

choose product_version

enter quantity intent

choose currency

No calculations yet

POST /quotes/calculate (HTMX)

Sales, Production Manager

Returns HTML partial breakdown (no DB write)

QuoteService.calculate_preview(inputs) → calls quote engine

POST /quotes

Sales, Production Manager

Save draft quote (snapshots outputs)

QuoteService.create_quote(inputs) (transaction)

POST /quotes/{quote_id}/submit_for_approval

Sales

Sets state pending_approval

QuoteService.submit_for_approval(quote_id)

POST /quotes/{quote_id}/approve

Production Manager

Sets state approved

QuoteService.approve(quote_id)

POST /quotes/{quote_id}/override

Production Manager

Override fields with audit log

QuoteService.override(quote_id, override_payload)

POST /quotes/{quote_id}/mark_won

Sales, Production Manager

QuoteService.mark_won(quote_id)

POST /quotes/{quote_id}/mark_lost

Sales, Production Manager

QuoteService.mark_lost(quote_id)

4.5 Orders & Jobs

GET /orders

Sales, Production Manager

List/search

OrderService.list(query)

GET /orders/new

Sales, Production Manager

Create order form:

from quote OR from product_version

POST /orders

Sales, Production Manager

Create order (locks product_version)

OrderService.create(payload)

GET /orders/{order_id}

Sales, Production Manager (Operator optional read)

Detail: shows jobs

OrderService.get_detail(order_id)

POST /orders/{order_id}/jobs

Production Manager

Create job (increments run_index, job_code)

OrderService.create_job(order_id, payload)

GET /jobs/{job_id}

All roles (operator sees operational view)

JobService.get_detail(job_id)

4.6 Scheduling

GET /schedule

Production Manager

HTML machines grid + queues

SchedulingService.get_overview()

GET /schedule/gantt

Production Manager

HTML page: Gantt lanes (machines) + timeline

SchedulingService.get_gantt_overview(operating_calendar)

POST /schedule/queue/add

Production Manager

Adds job to machine queue

SchedulingService.add_job(machine_id, job_id, position?)

POST /schedule/queue/reorder (HTMX)

Production Manager

up/down or move to position

Returns updated queue partial

SchedulingService.reorder(machine_id, job_id, new_position)

POST /schedule/queue/remove

Production Manager

Removes job from queue

SchedulingService.remove(machine_id, job_id)

POST /schedule/gantt/move (HTMX)

Production Manager

Drag-and-drop move/resize:

within-lane reorder or cross-lane move (validated)

Returns updated lane/row partial

SchedulingService.move_bar(job_id, operation_type, target_machine_id, target_position, proposed_start?)

GET /schedule/gantt/estimate (HTMX)

Production Manager

Returns estimated durations for a job’s operations

SchedulingService.estimate_job_operations(job_id)

4.7 Production Execution

GET /production

Production Manager

Overview: machines + active runs

ProductionService.get_overview()

GET /my-machine

Operator

Shows assigned machine view

ProductionService.get_my_machine(user_id)

POST /runs/start

Operator, Production Manager

Preconditions enforced (machine free, job queued)

ProductionService.start_run(job_id, machine_id, operation_type)

POST /runs/{run_id}/pause

Operator, Production Manager

ProductionService.pause_run(run_id)

POST /runs/{run_id}/resume

Operator, Production Manager

ProductionService.resume_run(run_id)

POST /runs/{run_id}/record_output (HTMX)

Operator, Production Manager

Adds OutputEntry (append-only)

Returns updated totals partial

ProductionService.record_output(run_id, payload)

POST /runs/{run_id}/qc_check (HTMX)

Operator, Production Manager

Adds QCCheck entry

Returns updated checklist partial

ProductionService.record_qc(run_id, payload)

POST /runs/{run_id}/note (HTMX)

Operator, Production Manager

Adds Note entry

ProductionService.add_note(run_id, payload)

POST /runs/{run_id}/complete

Operator, Production Manager

Enforce required QC checks present

ProductionService.complete_run(run_id)

4.8 Inventory

GET /inventory

Production Manager

Dashboard: current stock + negatives

InventoryService.get_dashboard()

GET /inventory/transactions

Production Manager

Ledger list

InventoryService.list_transactions(filters)

GET /inventory/receive

Production Manager

Receive form

POST /inventory/receive

Production Manager

Create receipt transaction

InventoryService.receive(payload)

GET /inventory/adjust

Production Manager

Adjust form

POST /inventory/adjust

Production Manager

Create adjustment transaction (signed)

InventoryService.adjust(payload)

GET /inventory/scrap

Production Manager

Weekly report

InventoryService.get_weekly_scrap(week_range)

4.9 Dispatch & Close-out

GET /dispatch

Production Manager

List jobs ready or pending

DispatchService.list_ready()

GET /dispatch/{job_id}

Production Manager

Dispatch detail form

DispatchService.get(job_id)

POST /dispatch/{job_id}/mark_ready

Production Manager

Creates/updates dispatch record to ready

DispatchService.mark_ready(job_id, payload)

POST /dispatch/{job_id}/confirm

Production Manager

Marks dispatched (irreversible)

DispatchService.confirm_dispatch(job_id, payload)

4.10 Admin — Rate Cards (Production Manager)

GET /admin/rate-cards

Production Manager

Dashboard

GET/POST /admin/rate-cards/{table}

Production Manager

CRUD for each catalog table

RateCardService.*

4.11 System Admin

GET /sys/users

System Admin

Users list

POST /sys/users

System Admin

Create user

SystemAdminService.create_user(payload)

POST /sys/users/{user_id}/disable

System Admin

Disable user

SystemAdminService.disable_user(user_id)

POST /sys/users/{user_id}/reset_password

System Admin

Reset password

SystemAdminService.reset_password(user_id)

GET/POST /sys/settings

System Admin

Manage system settings

SystemAdminService.update_settings(payload)

GET/POST /sys/backups

System Admin

Export/backup operations

SystemAdminService.*

4.13 Quality Control — Job Summary

GET /jobs/{job_id}/qc-summary

Production Manager, Operator (read)

Returns aggregates and current final_checklist state

POST /jobs/{job_id}/qc-summary/aggregate

Production Manager

Computes aggregates from QCChecks and saves draft summary

POST /jobs/{job_id}/qc-summary/finalize

Production Manager

Body: final_checklist items with pass/fail, notes, signatures

Sets status: final_pass | final_pass_with_deviation | final_fail

4.14 QC Reporting

GET /reports/qc/annual?year=YYYY

Production Manager

Returns CSV/PDF: per job aggregates, compliance rates, worst-case deviations, deviations+approvals, final status, signatures
4.15 Tools (Registry & Availability)

GET /tools

Production Manager, System Admin

List tools with type, icon, stage compatibility, current mount

POST /tools

System Admin

Create tool (icon upload handled in multipart)

GET /tools/availability?from=...&to=...&tool_type=...

Production Manager

Returns planned/active reservations and free capacity

POST /tools/{tool_id}/mount

Production Manager

Body: machine_id

Records ToolMount (closes prior mount if any)

4.16 Scheduling — Tool Reservations

POST /schedule/tool/reserve

Production Manager

Creates planned ToolReservation(s) for a job operation window

POST /schedule/tool/release

Production Manager

Cancels planned reservation(s)

(Amend) POST /schedule/gantt/move (HTMX)

Validates machine + tool availability, rebooks ToolReservations atomically with position change

4.17 Dashboard & KPIs

GET /dashboard

Production Manager; HTML page

DashboardService.get_overview(window)

GET /dashboard/partial/{card} (HTMX)

Returns HTML fragment per card

DashboardService.get_card(card, window)

GET /reports/kpi/weekly?start=YYYY-Www&weeks=N

Production Manager; CSV/JSON

KPIs: throughput, utilization, flow percentiles, inventory turns, FPY, deviations, fulfilment accuracy

4.18 Branding
GET /admin/branding

System Admin

HTML page: current theme with live preview

POST /admin/branding

System Admin

Save tokens/typography/shape; version and activate theme

POST /admin/branding/upload-logo

System Admin

Upload logo (SVG/PNG); sanitize and store; return URL

POST /admin/branding/upload-font

System Admin

Upload font (WOFF/WOFF2) with family/weight/style metadata; return URL

GET /static/theme.css?v={hash}

Public

Serve generated CSS for active theme (cache‑busted)
5. Request/Response Contracts (Pydantic Schemas)
Principles

All POST bodies validated via Pydantic

Server-rendered forms map 1:1 to schemas

HTMX endpoints return HTML fragments, not JSON (MVP)

Example schema categories

CreateCustomerRequest

CreateProductRequest (wizard)

CreateProductVersionRequest

QuoteCalculateRequest → QuotePreviewResult

CreateQuoteRequest (includes snapshot outputs)

CreateOrderRequest

CreateJobRequest

AddToQueueRequest

RecordOutputRequest

RecordQCRequest

ReceiveInventoryRequest

AdjustInventoryRequest

DispatchConfirmRequest

CreateToolRequest

ToolMountRequest

ToolReserveRequest {job_id, stage, tool_type or tool_id, machine_id, from, to}

ToolAvailabilityQuery
Additional schemas (for dashboard/KPI)

DashboardWindow {start_date, end_date}

InventorySnapshot {raw_kg, wip_extrusion_kg, wip_printing_kg, fg_units}

ThroughputWeekly {kg_extruded, m_printed, units_converted, jobs_completed}

UtilizationWeekly {machine_id, runtime_hours, utilization_pct}

FlowWeekly {p50_days, p95_days}

InventoryTurnsWeekly {turns}

QualityWeekly {fpy_pct, deviations_count}

FulfilmentAccuracyWeekly {jobs_off_target, total_under_units, total_over_units, rows:[{job_id, order_id, allocated, dispatched, delta}]}

6. Internal Service Interfaces (Normative)

Services are called by routes. They enforce invariants.

6.1 AuthService

login(username, password) -> session

logout(session)

6.2 CustomerService

create(payload) -> Customer

update(customer_id, payload)

list(query) -> list[Customer]

6.3 ProductService

create_product_with_version(payload) -> Product

create_new_version(product_id, payload) -> ProductVersion

get_with_versions(product_id)

create_suggestion(product_id, payload)

resolve_suggestion(suggestion_id, decision)

6.4 QuoteService

calculate_preview(inputs) -> QuoteResult (no writes)

create_quote(inputs) -> Quote (snapshots)

submit_for_approval(quote_id)

approve(quote_id)

override(quote_id, override_payload)

6.5 OrderService

create(payload) -> Order

create_job(order_id, payload) -> Job

get_detail(order_id)

6.6 SchedulingService

add_job(machine_id, job_id, position=None)

reorder(machine_id, job_id, new_position)

remove(machine_id, job_id)

get_overview()

get_gantt_overview(operating_calendar)

move_bar(job_id, operation_type, target_machine_id, target_position, proposed_start=None)

estimate_job_operations(job_id) -> dict[operation_type, EstimatedDuration]

validate_move(job_id, operation_type, target_machine_id) -> None | raises InvariantViolation

6.7 ProductionService

start_run(job_id, machine_id, operation_type) -> OperationRun

pause_run(run_id)

resume_run(run_id)

record_output(run_id, payload) (append-only output entry)

record_qc(run_id, payload) (append-only qc entry)

add_note(run_id, payload) (append-only)

complete_run(run_id) (enforce required QC)

6.8 InventoryService

receive(payload) (creates ledger entry)

adjust(payload) (creates ledger entry)

list_transactions(filters)

get_dashboard()

get_weekly_scrap(range)

6.9 DispatchService

list_ready()

mark_ready(job_id, payload)

confirm_dispatch(job_id, payload)

6.10 RateCardService

CRUD per catalog table

validate referential integrity (e.g. resin codes referenced in blends)

6.11 SystemAdminService

user CRUD

settings

backups

operating_calendar CRUD (week template, start anchor, exceptions) (optional MVP in settings)

6.13 QCService

aggregate_job_qc(job_id) -> JobQCSummary

finalize_job_qc(job_id, checklist, deviations?) -> JobQCSummary

get_job_qc(job_id) -> JobQCSummary
6.14 DashboardService

get_overview(window)

get_card(card, window)

6.15 KPIService

get_weekly_throughput(window)

get_weekly_utilization(window)

get_weekly_flow(window)

get_weekly_inventory_turns(window)

get_weekly_quality(window)

get_weekly_fulfilment_accuracy(window)

6.16 ToolService

list_tools()

create_tool(payload) -> Tool

set_mount(tool_id, machine_id)

get_availability(tool_type, from, to)

reserve(tool_spec, job_id, machine_id, window) -> ToolReservation

release(reservation_id)

6.17 BrandingService

get_active_theme() -> BrandTheme

update_theme(payload) -> BrandTheme  // version a new record, activate it

upload_logo(file) -> url             // sanitize SVG/PNG, validate MIME/size

upload_font(file, meta) -> url       // allow WOFF2/WOFF, store and return URL

render_theme_css(theme) -> str       // render variables; write versioned theme.css

7. Invariants Enforcement (Where and How)
Key invariants to enforce transactionally

Machine exclusivity: one running run per machine

Product version immutability

Quote approval only by Production Manager

Quote overrides only by Production Manager

Dispatch irreversibility

Inventory transactions append-only

Exactly one active BrandTheme

Enforcement layers

Service layer: raises domain exceptions

DB constraints:

unique partial index for running run per machine

FK constraints

statuses enumerated

8. Error Handling Strategy
Domain exceptions

Define consistent exceptions:

PermissionDenied

ValidationError

InvariantViolation

NotFound

Conflict (e.g. machine busy)

UX responses

For HTMX:

return partial with inline error message

For full page:

render error page with “Back” link

Never show stack traces to users

9. Concurrency & Transactions
Transaction boundaries

All “state-changing” service methods are wrapped in DB transactions, including:

start_run (machine exclusivity check)

approve quote

create job (increment job_code)

reorder queue

Strategy for sequential codes

Use DB sequences or locked rows for:

product_code

order_code

job run_index per order

This prevents duplicates under concurrency.

10. Why This API/Interface Design Works

Keeps UI implementation simple (pages + partials)

Keeps domain logic testable and separate

Enforces factory constraints safely

Supports future integrations without rewriting routes