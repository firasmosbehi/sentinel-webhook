# Apify Store Listing Copy (Draft)

## Tagline

Turn any URL into a webhook when it changes.

## Description

Sentinel is a developer-first change detection Actor for event-driven workflows.

Give it:
- A `target_url` (or `targets[]`)
- A `webhook_url`

Sentinel will:
- Fetch the target(s) on a schedule
- Persist baseline state in Apify storage
- Diff the current snapshot vs the previous snapshot
- POST a structured JSON payload only when a meaningful change is detected

## Key Features

- Stateful diffing via Apify Key-Value Store
- Structured diffs:
  - `fields[]` extraction for price/stock/etc
  - JSON deep diff for `application/json` endpoints
- Noise reduction options (selectors, attributes, regex presets)
- Webhook idempotency (`event_id`) + optional HMAC signature
- Dead-letter dataset for failed deliveries + replay mode
- SSRF-safe URL fetching (blocks localhost/private ranges)

## Suggested Use Cases

- Competitor price monitoring
- Government grants / tenders alerts
- Job listings monitoring
- Inventory/stock status tracking

## Store Assets

Generated files (run `npm run generate:assets`):
- Actor icon: `assets/icon.png`
- Store screenshots:
  - `assets/store/screenshot-1.png`
  - `assets/store/screenshot-2.png`
- Demo video: `assets/demo.webm`
