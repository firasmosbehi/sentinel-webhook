# Privacy And Data Handling

## What Sentinel Stores

Depending on configuration and runtime behavior, Sentinel may store:
- Baseline snapshots in an Apify Key-Value Store (`state_store_name`).
  - `text`: normalized snapshot text (or stable JSON when in `fields[]` / JSON mode)
  - `html` (optional): extracted HTML fragment (text mode only)
  - metadata: hashes, timestamps, headers
- Run events in the default dataset (always).
- Optional history events in `history_dataset_name`.
- Failed webhook deliveries in `dead_letter_dataset_name` (dead-letter queue).

## Redaction Defaults

By default:
- `redact_logs: true`

This redacts sensitive-looking query parameters (e.g. `token`, `key`, `secret`) and common token patterns from error messages stored in datasets/logs.

If you need exact values in logs/datasets:
- Set `redact_logs: false`

## Webhook Secrets

- `webhook_secret` is never sent to the webhook receiver.
- It is used only to compute an HMAC signature header.

