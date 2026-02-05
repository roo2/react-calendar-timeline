## Enumerations (PostgreSQL types)

- operation_type: extrusion, printing_inline, printing_uteco, conversion, packaging_dispatch
- job_status: planned, scheduled, running, paused, completed, dispatched, cancelled
- order_status: draft, confirmed, dispatched, closed, cancelled
- run_status: running, paused, completed
- qc_check_result: pass, fail, na
- qc_source: manual, sensor
- inventory_category: raw_material, wip_extruded_roll, wip_printed_roll, finished_goods, packaging_material, scrap
- dispatch_status: pending, ready, dispatched
- tool_reservation_status: planned, conflicted, cancelled, fulfilled
- job_qc_summary_status: draft, final_pass, final_fail, final_pass_with_deviation
- machine_type: extruder, printer_uteco, converter_bagger
- sensor_type: temperature, pressure, speed, humidity, thickness, other
- sensor_protocol: opcua, modbus, mqtt, http, file, other

## Key Constraints and Indexes

- Unique product versions: product_versions unique (product_id, version_number)
- Unique job per order: jobs unique (order_id, job_code)
- Unique dispatch per job: dispatch_records unique (job_id)
- Telemetry idempotency: telemetry_events unique (idempotency_key)
- Machine exclusivity: partial unique index on operation_runs(machine_id) where status='running'
- ToolMount overlap prevention: GiST exclusion constraint on (tool_id, tstzrange(mounted_from, mounted_to))
- ToolReservation overlap prevention: GiST exclusion constraint on (tool_id, tstzrange(planned_from, planned_to))
- Sequences: product_code_seq, order_code_seq (string formatting handled in app)

## Append-only Protections

- run_output_entries: triggers prevent UPDATE and DELETE
- inventory_transactions: triggers prevent UPDATE and DELETE
- tool_mounts: trigger prevents DELETE (UPDATE allowed to close window)

## Seeds

- Machines:
  - EX01…EX08 (type extruder; capability.supports_inline_1c_print=true; capability.supports_inline_perforation=true)
  - UTECO01 (type printer_uteco; capability.max_colours_per_side=6; capability.duplex_supported=true)
  - BGR01…BGR03 (type converter_bagger; capability.supported_finish_modes=['Cartons'])
- Tool types (optional): inline_printer_1c, electra_punch

## Quote Engine Rate Cards (SDS-4 §6)

- Tables:
  - resins(resin_code PK, name, density NUMERIC(6,4) > 0, price_per_kg NUMERIC(12,4) ≥ 0, currency)
  - additives(additive_code PK, name, price_per_kg NUMERIC(12,4) ≥ 0, category?, notes?)
  - colours(colour_code PK, name, price_per_kg NUMERIC(12,4) ≥ 0, opacity_multiplier NUMERIC(6,3) ≥ 0 DEFAULT 0, currency)
  - cores(core_type PK, description, cost_per_meter NUMERIC(12,4) ≥ 0, kg_per_meter NUMERIC(12,4) ≥ 0, currency)
  - printing_rates(id UUID PK, method printing_method, min_meters NUMERIC(12,2) ≥ 0, cost_per_1000m NUMERIC(12,4) ≥ 0, setup_minutes INT ≥ 0, duplex_supported BOOL)
  - conversion_rates(id UUID PK, gauge and length ranges with min ≤ max, bags_per_hour > 0, setup_minutes ≥ 0)
  - waste_adders(id UUID PK, condition UNIQUE, waste_minutes ≥ 0)
- Enum: printing_method = none | inline | uteco
- Seeds: basic LD/MD resins, colours WHT/BLK, STD core, inline/uteco printing_rates, one conversion_rate, waste_adders defaults

## Analytics Views (SDS-8 §2, §3, §6)

- v_inventory_balances_by_category(inventory_category, qty): sums ledger by category
- v_wip_stage_balances(single row): columns
  - wip_extrusion_kg: Σ ledger where category='wip_extruded_roll'
  - wip_printing_kg: Σ ledger where category='wip_printed_roll'
  - fg_on_hand_units: Σ ledger where category='finished_goods' (dispatch as negative movements)

## Notes

- All timestamps are timestamptz (UTC).
- Evidence tables use ON DELETE RESTRICT; no cascades on history-bearing tables.
- ProductVersion is immutable at service layer; database allows reads and FK references.
- Job `job_code` and `run_index` are application-controlled; DB enforces uniqueness/monotonicity via constraints where applicable.


