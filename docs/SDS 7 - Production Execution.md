SDS 7 — Production Execution

1. Purpose

Define how runs are executed and how QC evidence (manual and sensor-derived) gates completion.

2. QC Evidence Sources

Manual: operator records QCCheck via UI.

Sensor: Telemetry-derived QCReading auto-attaches to the active OperationRun.

3. Run Gating (Required QC)

A run cannot complete unless all required QC checks are satisfied by either manual QCCheck or qualifying QCReading.

UI shows “Required QC” with live status (manual/sensor).

4. Real-time Validation

On telemetry ingest:

Map sensor → machine → active OperationRun (if any).

Evaluate against ProductVersion Acceptance Criteria.

Create QCReading (source=sensor) and, when criteria met, mark corresponding required check as satisfied.

5. Operator UX

Live widget with sensor status (stale/healthy), last reading time, and pass/fail state per check.

If sensor stale or out-of-calibration → show warning; manual QC remains available.

6. Failure Modes (must handle)

No active run on machine → buffer or discard with reason (configurable).

Duplicate events (retry) → dedup via idempotency_key.

Clock skew → tolerate ±2 minutes; otherwise mark reading “time_invalid”.

7. Data Model Notes

QCCheck.source ∈ {manual, sensor}; reading_ref links to QCReading when sensor-satisfied.

OperationRun retains immutability; all evidence is append-only.

8. OutputEntry Semantics (KPI-ready)

For each OperationRun, OutputEntry must carry {quantity, uom, good_or_scrap}.

Conversion runs must record finished_units (bags) and optional cartons; Extrusion/Printing must record kg and/or metres.

Service must post matching InventoryTransaction:

Extrusion good → wip_extruded_roll (+)

Printing good → wip_printed_roll (+), consumes wip_extruded_roll (−)

Conversion good → finished_goods (+), consumes wip_printed_roll (−) or wip_extruded_roll (−) if no printing

scrap at any stage → scrap (+)

9. Tool Readiness (Run Start Gate)

On start_run:

Verify all required ToolReservations exist for this operation window.

Verify ToolMount for each required tool matches the target machine.

If not satisfied → InvariantViolation("Required tool not available/mounted").
