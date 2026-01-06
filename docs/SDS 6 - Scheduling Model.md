SDS 6 — Scheduling Model
1. Purpose & Design Intent

The Scheduling Model answers one question only:

“In what order will jobs be attempted on each machine?”

Design intent:

Human-led — scheduling is a decision, not an algorithm

Constraint-respecting — one job per machine at a time

Reversible — reordering must be safe and cheap

Reality-tolerant — delays, pauses, and changes are expected

Simple first — sophistication comes later, not now

The scheduler exists to support production managers, not to replace them.

2. What Scheduling Is (and Is Not)
Scheduling is

An ordered queue per machine

A way to express priority and intent

A visual planning aid

A coordination mechanism between planning and execution

Scheduling is not

A promise of start or finish times

An optimisation engine

A capacity planner

A constraint solver


3. Core Concepts
3.1 Machine

A Machine is a physical resource that can process one job at a time.

Machine types (MVP):

Extruder (multiple)

Printer (Uteco / Inline)

Converter (Bagging machines)

Each machine has:

identity

capability metadata (used by quoting, not scheduling)

one active queue

3.2 Scheduling Queue

Each machine has a queue, which is:

a strictly ordered list of Jobs

manually reorderable

independent of other machines’ queues

A job may appear in:

extrusion queue

printing queue

conversion queue
…at different times in its lifecycle.

4. Scheduling Data Model
4.1 MachineQueueItem

Represents a job’s position in a machine’s queue.

Fields:

machine_id

job_id

position (integer, 1-based)

status:

queued

running

completed

removed

created_at

updated_at

Invariant:
For a given machine, position must be unique and contiguous.

5. Scheduling Workflow
5.1 When Jobs Enter Scheduling

A job becomes schedulable when:

Order status ≥ confirmed

Job status = planned

Production Manager actions:

assign job to machine queue

choose machine (extruder/printer/converter)

5.2 Scheduling to Execution

Scheduling does not start production.

Production begins only when:

an Operator starts an OperationRun

the job becomes running

the machine is free

At that moment:

the job’s queue item status becomes running

6. Queue Reordering Rules
Allowed actions

Move job up/down in queue

Remove job from queue

Insert job at any position

Disallowed actions

Reorder while job is running

Insert a job into a machine queue if:

machine is inactive

job is cancelled

Side effects

Reordering updates position values

No historical scheduling audit required (MVP)

7. Machine Exclusivity Constraint
Hard Rule

A machine may have at most one running job at any time.

Enforcement layers

UI:

disable “Start” if machine has active run

API:

transactionally enforce uniqueness

Database:

unique constraint on (machine_id, status = running)

8. Interaction with Job States
State transitions
Action	Job State Change
Added to queue	planned → scheduled
Operator starts run	scheduled → running
Operator pauses run	running → paused
Operator resumes	paused → running
Run finishes	running → completed

Scheduling never:

completes a job

pauses a job

resumes a job

9. Multi-Machine Reality
Parallelism rules

Multiple extruders may run simultaneously

Multiple bagging machines may run simultaneously

One job may:

complete extrusion today

wait unscheduled for printing

be scheduled for conversion later

The scheduler does not enforce cross-machine dependencies in v1.

10. Failure Modes & Safeguards
Must prevent

Running two jobs on one machine

Scheduling cancelled jobs

Deleting jobs silently

Auto-rescheduling without human action

Must allow

Jobs to sit idle

Out-of-order execution

Human judgement overrides

11. UI Expectations (MVP)
Production Manager View

List of machines

Each machine shows its queue:

job_code

customer

product

planned quantity

Controls:

add job

move up/down

remove

Operator View

“My Machine”

Current running job

Next job (read-only)

12. Future Extensions (Explicitly Deferred)

Designed so these can be added without refactoring:

Drag-and-drop reordering

Gantt-style timeline

Capacity visualisation

Automated suggestions

Dependency enforcement

Multi-site scheduling

13. Why This Model Works

Matches how factories actually schedule

Avoids false precision

Supports interruptions naturally

Is trivial to reason about and debug

Keeps humans in control

14. Routing Constraints & Enforcement (MVP)

Scheduling-Level Behavior

The scheduler remains human-led and does not auto-enforce cross-machine dependencies.

It must display advisories when a job is queued on a downstream machine before required upstream runs are completed:

Uteco queued before any Extrusion run exists.

Conversion queued before required Printing (if Uteco) or before Extrusion (if no printing).

Run Start Hard-Stops (enforced by Production Execution)

A job’s first started run must be Extrusion.

Uteco Printing may start only if the job has at least one completed Extrusion run.

Conversion (Bagging) may start only if:

Printing Method = None AND at least one completed Extrusion run exists; OR

Printing Method = Uteco AND at least one completed Uteco Printing run exists.

UI Expectations

Disable “Start” on Uteco if no Extrusion run exists for the job.

Disable “Start” on Conversion if its prerequisites (per above) are not satisfied.

Allow reordering and out-of-order queuing, but keep warnings visible until prerequisites are met.

Notes

These constraints reflect site reality: 8 extruders (with possible inline 1‑colour printing and perforation), one out‑of‑line Uteco printer (up to 6 colours front/back), and 3 bagging machines.

15. Gantt Scheduling UI (MVP+)
Purpose

Provide a visual, drag‑and‑drop timeline for planning jobs across all machines, with duration estimates per operation and clear visual emphasis for colour/printing work.

Lanes (Machine Lines)

One lane per installed machine, auto‑generated from the Machine catalog:

Extrusion: EX01 … EX08

Printing: UTECO01

Conversion: BGR01 … BGR03

Adding a new machine automatically creates a new lane.

Timeline & Operating Calendar

Default operating window: 24 hours/day, 4 days/week, starting Monday 04:30 through Friday 04:30.

Configurable to up to 24/7 operation.

Calendar exceptions (future): public holidays, maintenance windows (advisory for MVP).

Bars (Job Operations)

Each required operation appears as a separate bar in its machine lane:

Extrusion → Uteco Printing (if applicable) → Conversion/Bagging (if applicable).

A single Job can therefore appear up to 3 times on the Gantt.

Bars show: job_code, customer, product, planned quantity, estimated duration, and readiness (blocked/ready/running/completed).

Visual Emphasis & Highlighting

Jobs requiring printing (Inline or Uteco) and/or colour are visually highlighted:

Uteco printing required: distinctive colour fill + printer icon.

Inline print/perforation on extrusion: badge/icon on the extrusion bar.

Colour jobs: hue accent based on Number of Colours; non‑colour jobs remain neutral.

This aids grouping like‑for‑like jobs to reduce changeover waste.

Duration Estimates (Displayed on Bars)

Extrusion: estimated_time = estimated_kg / extruder_rate_kg_per_hour (from rate cards), adjusted by width/thickness yields.

Uteco printing: estimated_time = web_length_m / printer_speed_m_per_min + setup_allowance; colour count influences setup.

Conversion: estimated_time = units / bagger_rate_units_per_hour + setup_allowance; geometry may adjust rate.

All estimates are previews; actuals come from OperationRuns.

Drag‑and‑Drop (DnD) Behavior

Allowed:

Reorder bars within a lane to reprioritise queue positions.

Move extrusion bars between extruder lanes if machine capabilities match (width/gauge), subject to role and configuration.

Disallowed:

Dragging an extrusion bar to UTECO or bagger lanes.

Dragging a UTECO bar onto a bagger lane unless extrusion is completed.

Dragging a bagger bar onto UTECO lane.

Cross‑type moves are only permitted when they represent valid operation steps and prerequisites are satisfied.

Interactions & Constraints

DnD produces a server‑validated operation (no client‑side trust).

On drop, the server enforces Routing Constraints & Run Start Hard‑Stops (section 14) and capability checks.

Invalid drops snap back with an explanation inline.

Status Integration

Running operations render as active bars; completed operations show completed styling; queued operations show estimated start based on lane order and operating calendar.

System auto‑computes tentative start/finish projections per lane from queue order and calendar; these are advisory, not promises.

Printing & Export (Future)

Printable weekly view for production meetings.

CSV snapshot export (deferred).