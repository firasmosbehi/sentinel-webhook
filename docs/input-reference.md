# Input Reference

Sentinel uses `INPUT_SCHEMA.json` for the Apify UI and validates inputs at runtime.

## Modes

- `mode` (string, default: `monitor`)
  - `monitor`: Fetch targets, diff vs previous baseline, send webhook on change.
  - `replay_dead_letter`: Replay failed webhook deliveries stored in `dead_letter_dataset_name`.

## Target Selection

You can run Sentinel in single-target or multi-target mode.

- `target_url` (string): Primary URL to monitor.
- `targets` (array, optional): Multi-target mode. Each target object:
  - `target_url` (string, required)
  - `selector` (string, optional): Override extraction selector for this target.
  - `fields` (array, optional): Override `fields[]` for this target.
  - `ignore_json_paths` (array, optional): Override `ignore_json_paths[]` for this target.

When `targets[]` is provided:
- Sentinel processes every entry in `targets[]`.
- For each target, `selector` / `fields` / `ignore_json_paths` default to the top-level values when not overridden.

## Rendering

- `rendering_mode` (string, default: `static`)
  - `static`: Uses `fetch()` + HTML normalization.
  - `playwright`: Uses Playwright (Chromium) to render JS pages.
- `wait_until` (string, default: `domcontentloaded`): Playwright `waitUntil` (`domcontentloaded` | `load` | `networkidle`).
- `wait_for_selector` (string, optional): Selector to wait for in Playwright mode. If omitted, Sentinel uses `selector` (when set).
- `wait_for_selector_timeout_secs` (int, default: `10`): Timeout for `wait_for_selector`.

## Webhook Delivery

- `webhook_url` (string, required): URL to POST payloads to.
- `webhook_headers` (object, default: `{}`): Extra headers for webhook requests.
- `webhook_secret` (string, optional): If set, signs requests. See `docs/signature-verification.md`.

Webhook retries:
- `webhook_timeout_secs` (int, default: `timeout_secs`)
- `webhook_max_retries` (int, default: `max_retries`)
- `webhook_retry_backoff_ms` (int, default: `retry_backoff_ms`)
- `webhook_retry_on_statuses` (int[], default: `[429]`)
- `webhook_retry_on_5xx` (bool, default: `true`)
- `webhook_max_retry_time_secs` (number, optional): Cap total retry time (including backoff).

Payload size:
- `max_payload_bytes` (int, default: `250000`): Truncates large old/new texts.

## Baseline Behavior

- `baseline_mode` (string, default: `store_only`)
  - `store_only`: Store the first snapshot only.
  - `notify`: Also POST a `BASELINE_STORED` webhook on the first run.
- `reset_baseline` (bool, default: `false`): Ignore stored baseline and store a new one on this run.

## Diffing

- `selector` (string, optional): CSS selector to scope extraction (default for all targets).
- `fields` (array, default: `[]`): Structured extraction. Each entry:
  - `{ "name": "price", "selector": ".price", "type": "text" }`
  - `{ "name": "sku", "selector": "[data-sku]", "type": "attribute", "attribute": "data-sku" }`
- `ignore_json_paths` (string[], default: `[]`): JSON Pointer paths to ignore for `application/json` responses (e.g. `/meta/timestamp`).
- `min_change_ratio` (number, default: `0`): Suppress small changes (0..1).

## Noise Reduction

- `ignore_selectors` (string[], default: `[]`): Remove these selectors before extraction.
- `ignore_attributes` (string[], default: `[]`): Strip these attributes before extraction.
- `ignore_regex_presets` (string[], default: `[]`): Built-ins (`timestamps` | `uuids` | `tokens`).
- `ignore_regexes` (string[], default: `[]`): Custom regex patterns (plain or `/pattern/flags`).

Empty snapshots:
- `min_text_length` (int, default: `0`)
- `on_empty_snapshot` (string, default: `error`)
  - `error`: Fail the run for this target (baseline not updated).
  - `ignore`: Emit `EMPTY_SNAPSHOT_IGNORED` and keep baseline intact.
  - `treat_as_change`: Continue (will likely trigger a change).

## Fetching

Retries and timeouts:
- `fetch_timeout_secs` (int, default: `timeout_secs`)
- `fetch_connect_timeout_secs` (int, default: `min(10, fetch_timeout_secs)`)
- `fetch_max_retries` (int, default: `max_retries`)
- `fetch_retry_backoff_ms` (int, default: `retry_backoff_ms`)

Limits:
- `max_redirects` (int, default: `5`)
- `max_content_bytes` (int, default: `2000000`)

Politeness (useful with `targets[]`):
- `politeness_delay_ms` (int, default: `0`)
- `politeness_jitter_ms` (int, default: `0`)

Proxy:
- `proxy_configuration` (object, optional):
  - `use_apify_proxy` (bool)
  - `apify_proxy_groups` (string[])
  - `apify_proxy_country` (string)
  - `proxy_urls` (string[])

## Security Controls

Domain policies:
- `target_domain_allowlist` / `target_domain_denylist`
- `webhook_domain_allowlist` / `webhook_domain_denylist`

Logging:
- `redact_logs` (bool, default: `true`)
- `debug` (bool, default: `false`)

## Storage

- `state_store_name` (string, default: `sentinel-state`): KV store for baseline snapshots.
- `history_dataset_name` (string, default: `sentinel-history`)
- `history_mode` (string, default: `changes_only`)
- `dead_letter_dataset_name` (string, default: `sentinel-dead-letter`)

## Dead-Letter Replay

When `mode=replay_dead_letter`:
- `replay_limit` (int, default: `100`)
- `replay_use_stored_webhook_url` (bool, default: `true`)
- `replay_dry_run` (bool, default: `false`)

## Legacy Inputs (Backwards Compatibility)

These are still accepted and used as defaults for the split settings:
- `timeout_secs` (int, default: `30`)
- `max_retries` (int, default: `3`)
- `retry_backoff_ms` (int, default: `1000`)

