SDS 9 — Dispatch & Close-out
1. Purpose & Design Intent

Dispatch & Close-out answers one final set of questions:

Is the product packed correctly?

Has it physically left the factory?

Is this job/order operationally complete?

Design intent:

Dispatch is an explicit human action

Completion is irreversible

Packaging is verified, not assumed

Accounting integration is triggered, not embedded

Paper is optional, truth is digital

Dispatch is where operational responsibility ends.

2. Conceptual Model

Dispatch is modeled as a final operational stage, not as shipping automation.

Job
 └── Packaging / Dispatch OperationRun
      └── DispatchRecord


Dispatch closes jobs, and jobs close orders.

3. Dispatch Preconditions

A job may be dispatched only if:

All required production OperationRuns are completed
(extrusion, printing, conversion as applicable)

Required QC checks are complete

Produced quantities are recorded

Packaging requirements are known (from Product Spec)

Job-level QC summary exists and is finalised

JobQCSummary.status ∈ {final_pass, final_pass_with_deviation}; if final_pass_with_deviation, all deviations must show approver and timestamp

The system must prevent dispatch if these are not met.

4. DispatchRecord Entity
4.1 Why this entity exists

Separates:

packaging verification

physical dispatch

administrative closure

Without overloading the Job itself.

4.2 DispatchRecord Fields

dispatch_record_id

job_id

order_id

dispatch_status

pending

ready

dispatched

packaging confirmation fields:

cartons_count

pallets_count

pallet_type

wrapped (boolean)

dispatch metadata:

dispatch_date

dispatched_by_user_id

carrier (free text)

delivery_ref (free text)

notes (optional)

5. Dispatch Workflow (MVP)
Step 1 — Mark Ready for Dispatch

Performed by Production Manager.

Actions:

Review job outputs

Review packaging requirements

Confirm:

quantities

carton/pallet configuration

System:

creates DispatchRecord with status ready

job status remains completed

Step 2 — Physical Packing

Operational activity:

palletising

wrapping

labeling (manual for now)

System:

does not enforce sequencing

only captures confirmation

Step 3 — Confirm Dispatch

Performed by Production Manager (or delegated role if enabled later).

Actions:

Enter:

dispatch date

carrier (optional)

delivery reference (optional)

Confirm dispatch

System effects:

DispatchRecord status → dispatched

Job status → dispatched

Order dispatch evaluation triggered

This action is irreversible.

6. Job Completion Semantics
6.1 Job Lifecycle End

A Job is considered operationally complete when:

DispatchRecord is dispatched

After this point:

No production runs may be added

No quantities may be edited

Job becomes read-only

6.2 Timing Fields (derived on confirm)

On Confirm Dispatch, persist timing fields for KPI calculations:

job.first_run_started_at

job.last_run_completed_at

dispatch_record.dispatched_at

Derived (read-only):

job_flow_time_minutes = dispatched_at − first_run_started_at

run_to_dispatch_minutes = dispatched_at − last_run_completed_at

These fields feed flow/turns KPIs (see SDS 8).

7. Order Close-out Logic
7.1 When an Order Can Close

An Order may be closed when:

All Jobs under the Order are in status dispatched

Or remaining jobs are explicitly cancelled

7.2 Order Closure States
ready_for_dispatch
  ↓
dispatched
  ↓
closed


dispatched: goods have left factory

closed: administrative finalisation

Closing an order:

does not affect accounting directly

signals downstream systems (future)

8. Relationship to Inventory
8.1 Inventory Effects

Dispatch does not:

move inventory

post financial transactions

Inventory effects already occurred during:

production output recording

packaging material usage (if tracked)

Dispatch is a confirmation event, not a stock event.

9. Label Printing (Future-Ready)
9.1 MVP Behavior

No direct printer integration

Optional printable dispatch summary:

customer

order

job

quantities

9.2 Future Extension (Designed In)

DispatchRecord includes sufficient data to support:

pallet labels

carton labels

barcode generation

printer routing

 No schema changes required later.
9.3 Branding Usage

PDFs/printables and on-screen dispatch views use the active BrandTheme for logo, colors, and fonts.
If assets are unavailable, fall back to default theme; record the theme hash used for generated documents (traceability).

10. Accounting & CRM Integration Hooks (Future)

Dispatch triggers events, not integrations.

On dispatch:

emit JobDispatched domain event

emit OrderDispatched if last job

Future adapters may:

create invoices (Xero)

update deal stage (HubSpot)

notify logistics systems

MVP stores only:

dispatch timestamp

user

11. UI Requirements (MVP)
Production Manager — Dispatch Screen

For each Job:

Job summary

Product name

Quantities produced

Packaging requirements

Input fields:

cartons

pallets

wrapped?

carrier

reference

Buttons:

Mark Ready

Confirm Dispatch

Read-only Views

Operators: view dispatch status

Sales: view order dispatch status

12. Failure Modes the System Must Prevent

Dispatching a job with incomplete production

Editing quantities after dispatch

Dispatching the same job twice

Closing an order with undispatched jobs

Silent deletion of dispatch records

13. Why This Model Works

Matches how factories actually finish work

Avoids pretending to be logistics software

Preserves a clean operational boundary

Enables future automation cleanly

Creates a trustworthy “end of life” for jobs