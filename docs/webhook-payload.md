# Webhook Payload Reference

The webhook payload is a JSON object with `schema_version: 1`.

Event types:
- `BASELINE_STORED`: First successful snapshot stored (no diff).
- `CHANGE_DETECTED`: A change compared to the previous baseline.

Key fields:
- `event_id`: Deterministic ID for the event (used for idempotency).
- `url`: The monitored URL.
- `timestamp`: ISO 8601 timestamp.
- `changes`: Present for `CHANGE_DETECTED`. May include:
  - `changes.text`: Old/new snapshot text (may be truncated).
  - `changes.fields`: Field-level changes when `fields[]` extraction is used.
  - `changes.json`: Deep diffs when the response is `application/json`.
- `previous` / `current`: Baseline hash + fetchedAt metadata.

JSON Schema:
- `schemas/webhook-payload.schema.json`

Idempotency headers sent with every webhook:
- `x-sentinel-event-id`: same as `event_id`
- `idempotency-key`: same as `event_id`

Optional signing headers (when `webhook_secret` is set):
- `x-sentinel-timestamp`
- `x-sentinel-signature`

