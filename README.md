# Sentinel Webhook

Turn any static web URL into a developer-friendly webhook that fires only when
meaningful changes are detected.

## What It Is

Most websites don't push events. Developers end up writing polling jobs, storing
previous state, diffing HTML, and dealing with noise. Sentinel aims to provide a
simple "URL in, webhook out" change-detection bridge.

## Planned Inputs

- `target_url`: URL to monitor.
- `selector` (optional): CSS selector to scope what is monitored (e.g. `.price`).
- `webhook_url`: Callback URL to POST change events to.

## Planned Output (Webhook Payload)

```json
{
  "event": "CHANGE_DETECTED",
  "url": "https://example.com/product/xyz",
  "timestamp": "2026-05-12T10:00:00Z",
  "changes": {
    "price": { "old": 49.99, "new": 45.0, "delta": -4.99 },
    "stock_status": { "old": "In Stock", "new": "Low Inventory" }
  }
}
```

## Status

MVP implementation in progress (Apify Actor + stateful diffing via Key-Value Store).

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
