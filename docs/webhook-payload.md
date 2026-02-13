# Webhook Payload Reference

The webhook payload is a JSON object with `schema_version: 1`.

Event types:
- `BASELINE_STORED`: First successful snapshot stored (no diff).
- `CHANGE_DETECTED`: A change compared to the previous baseline.
- `NO_CHANGE`: Optional heartbeat event (when `notify_on_no_change=true`).
- `FETCH_FAILED`: Optional error event (when `notify_on_fetch_failure=true`).

Key fields:
- `event_id`: Deterministic ID for the event (used for idempotency).
- `url`: The monitored URL.
- `timestamp`: ISO 8601 timestamp.
- `summary`: Human-readable summary (when available).
- `artifacts`: Optional artifact references (debug snapshots / screenshots).
- `changes`: Present for change events. May include:
  - `changes.text`: Old/new snapshot text (may be truncated).
    - `changes.text.patch`: Optional unified diff patch (when `include_unified_diff=true`).
  - `changes.fields`: Field-level changes when `fields[]` extraction is used.
  - `changes.json`: Deep diffs when the response is `application/json`.
- `previous` / `current`: Baseline hash + fetchedAt metadata.
- `error`: Present for `FETCH_FAILED` (safe error shape).

JSON Schema:
- `schemas/webhook-payload.schema.json`

Idempotency headers sent with every webhook:
- `x-sentinel-event-id`: same as `event_id`
- `idempotency-key`: same as `event_id`

Optional signing headers (when `webhook_secret` is set):
- `x-sentinel-timestamp`
- `x-sentinel-signature`
