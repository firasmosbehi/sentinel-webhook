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

Repository scaffold only. Implementation will target an Apify Actor with
stateful diffing via the Key-Value Store.

## Contributing

See `CONTRIBUTING.md`.

## License

MIT (see `LICENSE`).

