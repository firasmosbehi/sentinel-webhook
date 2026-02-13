# Tutorial: Competitor Pricing Monitor (End-to-End)

This tutorial builds an end-to-end monitor:
- Extract competitor price as a field.
- Send a webhook only on change.
- Trigger an automation when price drops.

## 1. Configure Sentinel

Use `fields[]` to extract the price:
- `{ \"name\": \"price\", \"selector\": \".price\", \"type\": \"text\" }`

Recommended settings:
- `history_mode: changes_only`
- `max_payload_bytes`: keep reasonable (payloads stay small)
- `ignore_regex_presets`: start with `timestamps` and `tokens`

## 2. Receive The Webhook

Pick one:
- Zapier: Catch Hook
- Make.com: Custom webhook
- Custom receiver: `examples/express-receiver/`

Deduplicate:
- Use `event_id` (`x-sentinel-event-id`) as the idempotency key.

## 3. Trigger Actions

Examples:
- If `changes.fields.price.delta < 0`, post to Slack and send email.
- Write changes into a spreadsheet or database.

