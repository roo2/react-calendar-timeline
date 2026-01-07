SDS 8 — Inventory & Scrap Accounting

1. Ledger Transaction Types (append-only)

receipt_raw_material (+ raw_material)

consume_raw_to_extrusion (− raw_material)

produce_extruded_roll (+ wip_extruded_roll)

consume_extruded_to_printing (− wip_extruded_roll)

produce_printed_roll (+ wip_printed_roll)

consume_printed_to_conversion (− wip_printed_roll)

produce_finished_goods (+ finished_goods)

scrap_{extrusion|printing|conversion} (+ scrap)

manual_adjust_{category} (+/−; signed)

2. Stage WIP Derivations (authoritative)

WIP_extrusion_kg = balance(wip_extruded_roll)

WIP_printing_kg = balance(wip_printed_roll)

FG_on_hand_units = balance(finished_goods)

Balances computed per category at a point-in-time from the ledger.

3. Inventory Turns & Flow

Weekly inventory_turns ≈ dispatched_kg_week / avg_inventory_kg_week

avg_inventory_kg_week = average of daily (raw_material_kg + WIP_extrusion_kg + WIP_printing_kg + FG_kg_equiv)

FG_kg_equiv: convert finished units → kg via product yield

Lead times:

job_flow_time = dispatched_at − first_run_started_at

stage_durations: {extrusion: first_ex_start→last_ex_end, printing: first_pr_start→last_pr_end, conversion: first_cv_start→last_cv_end}

4. Weekly Scrap

Report: {stage, kg_or_units, % of stage outputs}, by reason where provided.

5. Performance Windows

“Week” uses site operating calendar (SDS 11 SystemAdminService.operating_calendar).

6. Unit Conversions & Yield Source (Authoritative)

Yield per product_version

Yield_kg_per_unit = Area_per_unit_m2 × Gauge_um × Density_kg_per_m3 × 1e-3

Inputs:

Area_per_unit_m2 from SDS 3 (Dimensions & Geometry; derived)

Gauge_um from SDS 3

Density_kg_per_m3 from blend density in SDS 3 (Materials & Formulation)

For rolls: compute kg from metres × decision_width_m × gauge × density.

FG_kg_equiv

FG_kg_equiv = Σ(finished_units × Yield_kg_per_unit) for carton outputs; add finished rolls kg directly.

Notes

All conversions are deterministic and versioned against the ProductVersion in force at production time.
