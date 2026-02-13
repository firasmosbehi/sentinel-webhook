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
- `playwright_block_resources` (bool, default: `false`): Abort loading images/media/fonts (faster + cheaper).

Screenshot mode (Playwright only):
- `screenshot_on_change` (bool, default: `false`): Capture screenshots when a change is detected.
- `screenshot_scope` (string, default: `full_page`): `full_page` | `selector`.
- `screenshot_selector` (string, optional): Selector used when `screenshot_scope=selector` (defaults to `selector`).

## Fetching

Request customization:
- `fetch_headers` (object, default: `{}`): Extra request headers sent to the target.
- `target_method` (string, default: `GET`): HTTP method (static mode supports GET/POST/etc; Playwright currently supports GET only).
- `target_body` (string, optional): Request body (static mode only; not allowed for GET/HEAD).
- `target_cookies` (array, default: `[]`): Cookies to send.

Robots and block detection:
- `robots_txt_mode` (string, default: `ignore`): `ignore` | `respect`.
- `block_page_regexes` (string[], default: `[]`): If matched in extracted text/HTML, treat as fetch failure (prevents poisoning baseline).

Webhook retries:
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

Scheduling:
- `schedule_jitter_ms` (int, default: `0`): Sleep a random 0..N ms at the start of the run (helps avoid thundering herd).

Concurrency:
- `max_concurrency` (int, default: `1`): Concurrency for `targets[]` processing.

Proxy:
- `proxy_configuration` (object, optional):
  - `use_apify_proxy` (bool)
  - `apify_proxy_groups` (string[])
  - `apify_proxy_country` (string)
  - `proxy_urls` (string[])

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
- `include_unified_diff` (bool, default: `false`): Include a unified text patch when `changes.text` is present.
- `unified_diff_context_lines` (int, default: `3`): Context lines.
- `unified_diff_max_chars` (int, default: `20000`): Max patch size (truncated when larger).

## Noise Reduction

- `ignore_selectors` (string[], default: `[]`): Remove these selectors before extraction.
- `ignore_attributes` (string[], default: `[]`): Strip these attributes before extraction.
- `ignore_regex_presets` (string[], default: `[]`): Built-ins (`timestamps` | `uuids` | `tokens`).
- `ignore_regexes` (string[], default: `[]`): Custom regex patterns (plain or `/pattern/flags`).
- `selector_aggregation_mode` (string, default: `all`): When `selector` matches multiple nodes: `first` | `all`.
- `whitespace_mode` (string, default: `collapse`): `collapse` | `preserve_lines`.
- `unicode_normalization` (string, default: `none`): `none` | `NFKC`.

Empty snapshots:
- `min_text_length` (int, default: `0`)
- `on_empty_snapshot` (string, default: `error`)
  - `error`: Fail the run for this target (baseline not updated).
  - `ignore`: Emit `EMPTY_SNAPSHOT_IGNORED` and keep baseline intact.
  - `treat_as_change`: Continue (will likely trigger a change).

## Webhook Delivery

- `webhook_url` (string): Primary URL to POST payloads to (backwards compatible).
- `webhook_urls` (string[], optional): Fan-out webhook delivery.
- `webhook_delivery_mode` (string, default: `all`)
  - `all`: Fail the delivery if any endpoint fails.
  - `any`: Succeed if at least one endpoint succeeds.
- `webhook_method` (string, default: `POST`)
- `webhook_content_type` (string, default: `application/json; charset=utf-8`)
- `webhook_headers` (object, default: `{}`): Extra headers for webhook requests.
- `webhook_secret` (string, optional): If set, signs requests. See `docs/signature-verification.md`.

Notifications:
- `notify_on_no_change` (bool, default: `false`): Optional heartbeat webhook (`event=NO_CHANGE`).
- `notify_on_fetch_failure` (bool, default: `false`): Optional error webhook (`event=FETCH_FAILED`).
- `fetch_failure_debounce_secs` (int, default: `3600`): Debounce repeated fetch-failure notifications.

Circuit breaker (webhook delivery):
- `webhook_circuit_breaker_enabled` (bool, default: `false`)
- `webhook_circuit_failure_threshold` (int, default: `5`)
- `webhook_circuit_cooldown_secs` (int, default: `3600`)

Webhook retries:
- `webhook_timeout_secs` (int, default: `timeout_secs`)
- `webhook_max_retries` (int, default: `max_retries`)
- `webhook_retry_backoff_ms` (int, default: `retry_backoff_ms`)
- `webhook_retry_on_statuses` (int[], default: `[429]`)
- `webhook_retry_on_5xx` (bool, default: `true`)
- `webhook_max_retry_time_secs` (number, optional): Cap total retry time (including backoff).

Payload size:
- `max_payload_bytes` (int, default: `250000`): Truncates large old/new texts.

## Security Controls

Domain policies:
- `target_domain_allowlist` / `target_domain_denylist`
- `webhook_domain_allowlist` / `webhook_domain_denylist`

SSRF / local dev:
- `allow_localhost` (bool, default: `false`): Allow `localhost` / loopback only for local development (blocked on Apify platform).

Logging:
- `redact_logs` (bool, default: `true`)
- `debug` (bool, default: `false`)
- `structured_logs` (bool, default: `false`): Emit one-line JSON log events to stdout.

## Storage

- `state_store_name` (string, default: `sentinel-state`): KV store for baseline snapshots.
- `compress_snapshots` (bool, default: `false`): Gzip+base64 snapshots in KV (reduces storage size).
- `snapshot_history_limit` (int, default: `0`): Keep last N snapshot metadata entries per target (0 disables).
- `history_dataset_name` (string, default: `sentinel-history`)
- `history_mode` (string, default: `changes_only`)
- `dead_letter_dataset_name` (string, default: `sentinel-dead-letter`)
- `artifact_store_name` (string, default: `sentinel-artifacts`)
- `store_debug_artifacts` (bool, default: `false`): Store snapshot artifacts (redacted when `redact_logs=true`).

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
