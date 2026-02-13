# Zapier Integration Guide

This guide shows a simple flow:
- Sentinel Actor detects a change.
- Zapier receives the webhook.
- Zapier deduplicates by `event_id`.

Demo asset: `assets/demo.webm`

## Steps

1. In Zapier, create a Zap.
2. Trigger: `Webhooks by Zapier` -> `Catch Hook`.
3. Copy the provided webhook URL.
4. In Sentinel input, set `webhook_url` to the Zapier hook URL.
5. (Recommended) Deduplicate:
   - Add an action step (e.g. `Storage by Zapier`) using the key `{{bundle.raw_request.headers.x-sentinel-event-id}}`.
   - If the key already exists, stop the Zap.
6. Add any downstream actions (Slack, email, database, etc.).

## Tips

- Use `changes.fields` for price monitoring and numeric delta triggers.
- For high-frequency schedules, keep `max_payload_bytes` reasonable to reduce webhook size.
