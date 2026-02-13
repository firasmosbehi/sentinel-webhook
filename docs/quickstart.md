# Quickstart

## Local Development

Requirements:
- Node.js `>=20`

Steps:
1. `npm install`
2. `cp INPUT.example.json INPUT.json`
3. Edit `INPUT.json` (at minimum: `target_url`, `webhook_url`)
4. Run: `npm run dev`

Notes:
- State is persisted across runs in a named Key-Value Store (`state_store_name`, default `sentinel-state`).
- If you don't want to use `INPUT.json`, you can set `SENTINEL_INPUT` to a JSON string.

## Local Webhook Receiver

By default, Sentinel blocks `localhost` / private IPs for `webhook_url` (SSRF protection).

Options:
1. Local development only: set `allow_localhost=true` and use a `http://127.0.0.1:PORT/...` webhook URL.
2. Production/Apify: expose your receiver via a public tunnel (e.g. ngrok) or deploy it publicly, then use the public `https://...` URL as `webhook_url`.

## Apify Schedule (Production)

1. Deploy the Actor to Apify.
2. Create an Apify Schedule to run every N minutes (e.g. 15m).
3. Monitor:
   - Default dataset (run events)
   - `history_dataset_name` (optional history)
   - `dead_letter_dataset_name` (failed deliveries)
