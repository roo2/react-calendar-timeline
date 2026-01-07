SDS 5 — Order & Job Lifecycle (MVP)

1. Job Allocation vs. Order Quantity

Orders define ordered_units (bags for cartons; rolls/metres for rolls).

Each Job optionally carries allocated_order_units (how much of the order this job intends to fulfil).

2. Produced vs. Allocated

Job aggregates:

produced_finished_units (Σ Conversion OutputEntry.good where finished_goods=true)

dispatched_units (from DispatchRecord)

fulfilment_delta = dispatched_units − allocated_order_units

3. Weekly Off-Target Logic

off_target = abs(fulfilment_delta) > tolerance_units

Default tolerance: 0 units (configurable system setting or % of allocated_order_units)

Report fields per job-week: {job_id, order_id, allocated_units, dispatched_units, delta_units, over_or_under}

4. Lifecycle End

Job completeness requires Dispatch (see SDS 9).

Fulfilment delta freezes at dispatch.

