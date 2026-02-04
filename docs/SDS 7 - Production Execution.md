SDS 7 — Production Execution

1. Purpose

Define how runs are executed and how end-of-job QC evidence is captured.

2. QC Evidence Capture (Non Food-Grade)

For non food-grade jobs, QC is recorded once at the end of the job as a simple checklist plus a small set of measurements and a notes field.

Recorded fields (minimum)

- correct_raw_material: pass/fail
- dimensions_to_spec: width_mm, length_mm, thickness_um (values and/or pass/fail), plus film_quality: pass/fail
- colour_film_and_ink: pass/fail
- venting_to_spec: pass/fail
- leakproof_seals: pass/fail
- packaging: pass/fail
- variations_concessions_notes: free text

When recorded

- QC is recorded at job completion/close-out.
- Runs may complete without QC being entered; dispatch/close-out requires the end-of-job QC record to be present.

3. Production UX

End-of-job QC form with the fields above and minimal friction. Default is “pass” unchecked until explicitly set (no implicit approvals).

4. Failure Modes (must handle)

No active run on machine → buffer or discard with reason (configurable).

Duplicate events (retry) → dedup via idempotency_key.

Clock skew → tolerate ±2 minutes; otherwise mark reading “time_invalid”.

5. Data Model Notes

JobQCSummary (or equivalent job-level QC record) is append-only once finalized (no silent edits).

OperationRun retains immutability; all evidence is append-only.

6. OutputEntry Semantics (KPI-ready)

For each OperationRun, OutputEntry must carry {quantity, uom, good_or_scrap}.

Conversion runs must record finished_units (bags) and optional cartons; Extrusion/Printing must record kg and/or metres.

Service must post matching InventoryTransaction:

Extrusion good → wip_extruded_roll (+)

Printing good → wip_printed_roll (+), consumes wip_extruded_roll (−)

Conversion good → finished_goods (+), consumes wip_printed_roll (−) or wip_extruded_roll (−) if no printing

scrap at any stage → scrap (+)

7. Tool Readiness (Run Start Gate)

On start_run:

Verify all required ToolReservations exist for this operation window.

Verify ToolMount for each required tool matches the target machine.

If not satisfied → InvariantViolation("Required tool not available/mounted").
