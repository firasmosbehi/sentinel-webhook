# Sentinel Webhook

Turn any static web URL into a developer-friendly webhook that fires only when
meaningful changes are detected.

## What It Is

Most websites don't push events. Developers end up writing polling jobs, storing
previous state, diffing HTML, and dealing with noise. Sentinel aims to provide a
simple "URL in, webhook out" change-detection bridge.

## Inputs

- `mode` (optional): `monitor` (default) or `replay_dead_letter`.
- `target_url`: URL to monitor.
- `selector` (optional): CSS selector to scope what is monitored (e.g. `.price`).
- `targets` (optional): Multi-target mode. Provide an array of `{ target_url, selector?, fields?, ignore_json_paths? }`.
- `rendering_mode` (optional): `static` (default) or `playwright` for JS-rendered pages.
- `wait_until` / `wait_for_selector` (optional): Playwright wait strategy controls.
- `fields` (optional): Structured extraction (CSS selectors + optional attributes) to produce a clean field-level diff.
- `ignore_json_paths` (optional): JSON Pointer paths to ignore when monitoring `application/json` endpoints (e.g. `/meta/timestamp`).
- `politeness_delay_ms` (optional): Add a minimum delay between requests to the same hostname during a run (helps avoid rate limits).
- `max_concurrency` (optional): Concurrency for `targets[]` processing (default `1`).
- `replay_limit` / `replay_use_stored_webhook_url` / `replay_dry_run`: Replay controls when `mode=replay_dead_letter`.
- `webhook_url`: Callback URL to POST change events to.

## Webhook Payload

```json
{
  "schema_version": 1,
  "event_id": "…",
  "event": "CHANGE_DETECTED",
  "url": "https://example.com/product/xyz",
  "timestamp": "2026-05-12T10:00:00Z",
  "changes": {
    "text": {
      "old": "Old text…",
      "new": "New text…",
      "delta": -4.99
    },
    "fields": {
      "price": { "old": "49.99", "new": "45.00", "delta": -4.99 }
    },
    "json": {
      "diffs": [{ "path": "/meta/version", "op": "replace", "old": 1, "new": 2 }]
    }
  },
  "previous": { "contentHash": "…", "fetchedAt": "2026-05-12T09:45:00Z" },
  "current": { "contentHash": "…", "fetchedAt": "2026-05-12T10:00:00Z" }
}
```

JSON Schema: `schemas/webhook-payload.schema.json`

## Status

MVP implemented (Apify Actor + stateful diffing via Key-Value Store).

## Documentation

- Quickstart: `docs/quickstart.md`
- Roadmap: `docs/roadmap.md`
- Input reference: `docs/input-reference.md`
- Webhook payload: `docs/webhook-payload.md`
- Security model: `docs/security.md`
- Signature verification: `docs/signature-verification.md`
- Privacy: `docs/privacy.md`
- Limitations: `docs/limitations.md`
- Zapier guide: `docs/integrations/zapier.md`
- Make.com guide: `docs/integrations/make.md`
- Recipe (price drop -> Zapier): `docs/recipes/competitor-price-drop-zapier.md`
- Example receiver (Express): `examples/express-receiver/README.md`

## Local Development

```bash
npm install
cp INPUT.example.json INPUT.json
npm run dev
```

Notes:
- State is persisted across runs in a named Key-Value Store (`state_store_name`, default `sentinel-state`).
- If you're not using `INPUT.json`, you can set `SENTINEL_INPUT` to a JSON string.

## Contributing

See `CONTRIBUTING.md`.

## License

MIT (see `LICENSE`).
