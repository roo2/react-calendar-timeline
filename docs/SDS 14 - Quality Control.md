SDS 14 — Quality Control

1. Purpose & Scope

Ensure every product run meets defined quality criteria and produces ISO-compliant evidence. Covers manual QC, non-conformance handling, reporting, and job-level release.

2. Roles & Authority

Operator: perform/record QC checks.

Production Manager: defines acceptance criteria, reviews deviations, approves releases.

System Admin: system configuration only.

3. QC Check Taxonomy (by Operation)

Extrusion: thickness (µm), width (mm), length (mm, if applicable), film appearance, openability, treatment level (advisory).

Uteco Printing: registration, colour density/ΔE (if applicable), print defects.

Conversion (Bagging): seal integrity, dimensions (length/width), perforation quality, count per pack.

For each check type declare: unit, method, frequency, required/optional, acceptance criteria.

4. Sampling Plans

Modes: per roll, time-based (every N minutes), quantity-based (every N units/rolls), start/end-of-run checks.

Default plans by product type; overrides per ProductVersion.

5. Acceptance Criteria & Tolerances

Defined per check type with units and bounds. Tied to ProductVersion “Quality Expectations” (SDS 3).

6. Evidence Model

Manual: QCCheck {check_type, required, result, values, measured_by, timestamp, source=manual}.

7. Run Gating Rules

A run cannot Complete until all required checks for that operation are satisfied (manual).

8. Non-Conformance & Exceptions

Deviation: {run_id, check_type, observed_value, reason, disposition: rework/accept-as-is/scrap, approved_by, approved_at}.

Optionally place run/job on hold; blocks dispatch until resolved.

9. Calibration & Traceability

CalibrationRecord per instrument with effective dates and certificate reference. Decisions use calibration effective at measurement time. Retain calibration ≥ 7 years.

10. UI Requirements

Operator: live required-checklist; clear pass/fail; minimal input.

Production Manager: QC dashboard; deviations queue; per-job QC summary; ISO evidence export (PDF/CSV).

11. API & Services (Refs SDS 11)

POST /runs/{run_id}/qc_check; QCService aggregate/finalize job-level summary; annual QC report.

12. Reporting & KPIs

First-pass yield, defect rate by check type, top defects, worst-case deviations.
12.1 Weekly Quality Rollups (Authoritative)

First-pass yield (FPY) = count(jobs with JobQCSummary.status = final_pass) / count(jobs completed) within window.

Deviations count = Σ deviations where approved within window.

Optionally include per-check compliance_rate averages and worst-case deviations.

13. Audit & Retention

QC evidence retained ≥ 3 years; deviations and approvals logged; exportable audit trail per job/order.

14. Security & Governance

Strict RBAC; edits append-only; no backdating. Changes to acceptance criteria require new ProductVersion.

15. Future Extensions

SPC charts (Cp/Cpk), auto-holds on out-of-control conditions, automated labels for holds, OCR/image QC.

16. Job-Level QC Summary (Final Release)

Purpose

Aggregate per-roll/per-run QC into a single job release record, aligned to WIs and ISO evidence.

Data Model: JobQCSummary

job_qc_summary_id

job_id (FK)

totals: {rolls, kg, metres}

aggregates per check (min/max/avg, pass_count, fail_count, compliance_rate%)

thickness_um, width_mm, length_mm (if applicable)

film_appearance, openability

leak_proof_seals, colour_film, colour_ink, venting

final_checklist (required items with WI references)

raw_material_spec (WI-01): pass/fail, signed_by, signed_at, notes

width/length/um to spec (WI-01): pass/fail, signed_by, signed_at, notes

film quality & leak-proof seals (WI-09/10): pass/fail, signed_by, signed_at, notes

colour of film & colour of ink (WI-01/41): pass/fail, signed_by, signed_at, notes

venting specs (WI-39): pass/fail, signed_by, signed_at, notes

deviations: [{check_type, observed, disposition: rework/accept-as-is/scrap, approved_by, approved_at, reason}]

status: draft | final_pass | final_fail | final_pass_with_deviation

created_by, created_at

Aggregation Rules

Compliance rate = pass_count / (pass_count + fail_count).

“Worst case” deviation captured for each dimensional metric (largest absolute delta).

Length_mm aggregates N/A for continuous film.

Gating

A job cannot be dispatched unless JobQCSummary.status ∈ {final_pass, final_pass_with_deviation}. Deviations must be approved by Production Manager.

Reporting

JobQCSummary feeds annual QC report: include job_id, customer, product_version, date range, totals, compliance rates, worst-case deviations, deviations list with approvals, final status and signatures.

