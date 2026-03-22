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

Printer (Uteco)

Converter (Bagging machines)

There are also Inline Printers and Hole punches but for the purpose of scheduling, these do not need to be modelled.

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

at different times in its lifecycle.

3.3 Rolls (Execution Reality)

Jobs are produced as multiple rolls (often dozens). Operations are executed per roll (or per batch of rolls), and downstream work may begin as soon as the first roll is available.

Example:

Roll 1 is extruded and moved to printing while Roll 2 is being extruded.

Scheduling remains job-level (priority/order), while execution records multiple OperationRuns per job across time.

4. Scheduling Data Model

4.1 MachineQueueItem

Represents a job’s position in a machine’s queue.

Fields:

machine_id
job_id
position (integer, 1-based)
status:(queued|running|completed|removed)
created_at
updated_at

Invariant:
For a given machine, position must be unique and contiguous.

5. Scheduling Workflow
5.1 When Jobs Enter Scheduling

A job becomes schedulable when:

Order status ≥ confirmed

Job status = planned

Production actions:

Assign job to machine queue

Choose machine (extruder/printer/converter)

5.2 Scheduling to Execution

Scheduling does not start production.

Production begins only when:

Production starts an OperationRun

the job becomes running

the machine is free

At that moment:

the job’s queue item status becomes running

6. Queue Reordering Rules
Allowed actions

Move job up/down in queue

Remove job from queue

Insert job at any position

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
Production starts run	scheduled → running
Production pauses run	running → paused
Production resumes	paused → running
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

In practice, a job may be in-progress on multiple machines at once because rolls can flow forward before the entire job is finished upstream (pipelined execution).

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

Production View

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

Production (On-Machine) View

“My Machine”

Current running job

Next job (read-only)

12. Future Extensions

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

Uteco Printing may start only if the job has at least one completed Extrusion run (i.e., at least one roll is available).

Conversion (Bagging) may start only if:

Printing Method = None AND at least one completed Extrusion run exists; OR

Printing Method = Uteco AND at least one completed Uteco Printing run exists.

UI Expectations

Disable “Start” on Uteco if no Extrusion run exists for the job.

Disable “Start” on Conversion if its prerequisites (per above) are not satisfied.

Allow reordering and out-of-order queuing, but keep warnings visible until prerequisites are met.

Notes

These constraints reflect site reality: 8 extruders (with possible inline 1‑colour printing and perforation), one out‑of‑line Uteco printer (up to 6 colours front/back), and 3 bagging machines.

15. Gantt Scheduling UI
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

A single Job can therefore appear multiple times on the Gantt (one bar per required operation).

Note on rolls and overlap:

Because jobs are executed as multiple rolls, downstream operations may start before upstream operations fully complete. The Gantt may therefore show overlapping bars for the same job across lanes; this represents pipelined execution (rolls flowing forward), not a violation of machine exclusivity.

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

Dragging an extrusion bar to UTECO or bagger lanes. Or dragging bars to a different machine type in general.

Interactions & Constraints

DnD produces a server‑validated operation (no client‑side trust).

On drop, the server enforces Routing Constraints & Run Start Hard‑Stops (section 14) and capability checks.

Invalid drops snap back with an explanation inline.

Status Integration

Running operations render as active bars; completed operations show completed styling; queued operations show estimated start based on lane order and operating calendar.

System auto‑computes tentative start/finish projections per lane from queue order and calendar; these are advisory, not promises.

Printing & Export (Future)

Printable weekly view for production meetings.

15.1 Tooling Constraints & Visualisation

Visuals

Each operation bar shows badges for required tools and a thin coloured bar below the machine's lane indicating that the tool is required for the duration of that job.

When tools are unused, they will be represented in "tool box" lanes (one lane for extrusion tools, one land for conversion tools)

Hover shows tool name and availability.

Planning & Reservation

When a job operation is placed on a lane, the system attempts to create planned ToolReservation(s) for the same time window.

If not enough tools of a type are available, the bar shows a conflict badge and the drop is allowed but marked “conflict” until resolved.

Run Start Hard-Stop

OperationRun start is blocked unless all required tools:

are reserved (status planned) for the bar’s time window,

are mounted on the target machine (ToolMount present),

Drag-and-Drop Validation

Within-lane reorder: update planned ToolReservations; keep icons updated.

Cross-lane move: only allowed if:

machine capabilities are met, and

required tool reservations can be reallocated to the new time/machine.

Invalid drops snap back with explanation (e.g., “No inline_printer_1c available 10:00–12:00”).

Changeovers (Advisory MVP)

Moving a Tool between machines incurs setup time; initially tracked as advisory metadata (display “tool move” indicator).

Future: explicit ToolMove operations with durations that constrain schedule.

Failure Modes to Prevent

Two bars overlapping that require the same unique tool (e.g., electra_punch) without sufficient units.

Starting a run when ToolReservation is missing or mounted on the wrong machine.
15.2 Tooling Entities (Schema, MVP+)

Purpose

Provide minimal entities to represent limited-count tools, their availability by time, and their mounting on machines so scheduling and run start validation can enforce constraints.

Entities

ToolType

tool_type_id

code (e.g., inline_printer_1c, electra_punch)

name

icon_ref (optional)

unique_per_machine (boolean)  // if true, at most one can be mounted on a machine at a time

Tool

tool_id

tool_type_id (FK)

serial_code

active (boolean)

notes

ToolMount (append-only history)

tool_mount_id

tool_id (FK)

machine_id (FK)

mounted_from

mounted_to (nullable when currently mounted)

ToolReservation (planning, not history of mount)

tool_reservation_id

tool_type_id (FK)  // reserve by type

optional tool_id (FK)  // may be assigned later

machine_id (FK)

planned_from

planned_to

status (planned | conflicted | cancelled | fulfilled)

Links to Schedule

ToolReservations are created/updated when bars are added/moved in the Gantt (advisory if conflicts).

Run start requires: for each required tool_type of the operation, a non-conflicted reservation matching the run window AND a ToolMount on the target machine.

15.3 Tooling Invariants & Validation (Authoritative)

Reservation window overlaps for the same tool_id are disallowed.

For each (tool_type_id, machine_id, time window), the number of planned reservations must not exceed the count of active tools of that type unless marked conflicted.

A ToolMount cannot overlap for the same tool_id on different machines.

OperationRun.start hard-stop: required tool_types must have (reservation.status in {planned} AND active ToolMount on machine).

UI may allow conflicted reservations (advisory), but server blocks run start until resolved.
16. Dashboard Signals (Advisory)

Purpose

Expose near‑real‑time, read‑only signals to the Operational Dashboard without automating scheduling decisions.

Per machine lane (UI)

running_job

next_job

last_24h outputs (kg/units)

current WIP bucket for its stage (derived; see SDS 1, SDS 8)

Notes

No scheduling decisions are automated from dashboard signals.

Signals are computed from OperationRuns and InventoryTransactions.