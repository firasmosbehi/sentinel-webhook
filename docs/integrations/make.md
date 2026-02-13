# Make.com Integration Guide

This guide shows a basic scenario:
- Sentinel Actor detects a change.
- Make.com receives the webhook.
- Make.com deduplicates by `event_id`.

Demo asset: `assets/demo.webm`

## Steps

1. In Make.com, create a new Scenario.
2. Add module: `Webhooks` -> `Custom webhook`.
3. Copy the webhook URL.
4. In Sentinel input, set `webhook_url` to the Make.com webhook URL.
5. (Recommended) Deduplicate:
   - Use a `Data store` to store processed `event_id` values.
   - If `event_id` already exists, stop the scenario.
6. Add downstream modules (Slack, email, HTTP calls, etc.).

## Example Blueprint

See `docs/integrations/make.blueprint.example.json` for a placeholder blueprint-style example you can adapt.
