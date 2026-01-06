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

A Gantt chart (yet)

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