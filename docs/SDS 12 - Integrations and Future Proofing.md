SDS 12 — Integrations and Future Proofing

1. Telemetry Architecture (MVP+)

Device Registry: Sensors registered and assigned to Machines.

Ingestion Adapters:

HTTP Gateway (MVP)

MQTT (topic: site/{machine_code}/{sensor_code})

OPC UA / Modbus TCP (via gateway)

Normalization: Convert inbound payloads to TelemetryEvent with unified schema and units.

Evaluation: Apply ProductVersion Acceptance Criteria to produce QCReadings.

Events: Emit TelemetryIngested, QCReadingCreated (for observability, not required by core flow).

2. Security

Network isolation for machine VLAN.

AuthN: HMAC or mTLS between gateway and app.

AuthZ: sensor_id scoped to machine.

Replay protection: idempotency_key + timestamp window.

3. Reliability

Gateway buffering for offline scenarios.

At-least-once delivery; server dedup via idempotency_key.

Clock sync (NTP) on sensors/gateway; server tolerates bounded skew.

4. Calibration & Units

Maintain CalibrationRecord history per sensor; effective dating.

Store raw values and scaled values; decisions use calibration effective at recorded_at.

5. Performance Targets

Sustained ingest: ≥ 10 events/sec across site (burst ≥ 50/sec) without impacting UI.

Evaluation latency: < 200 ms per event under normal load.
6. Branding Assets (Local)

Branding assets (logo, fonts, theme.css) are locally hosted and not integrated with external CDNs; no external network dependency is required for brand application in the UI or printables.

