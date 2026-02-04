SDS 12 — Integrations and Future Proofing

1. Integrations (Future)

Integrations are out of scope for the MVP and are treated as optional future extensions.
Quality evidence is recorded manually (see SDS 14).

2. Security

Network isolation for machine VLAN.

AuthN: HMAC or mTLS between gateway and app.

AuthZ: integration client scoped to permitted capabilities.

Replay protection: idempotency_key + timestamp window.

3. Reliability

Gateway buffering for offline scenarios.

At-least-once delivery; server dedup via idempotency_key.

Clock sync (NTP) on gateway/clients; server tolerates bounded skew.
6. Branding Assets (Local)

Branding assets (logo, fonts, theme.css) are locally hosted and not integrated with external CDNs; no external network dependency is required for brand application in the UI or printables.

