# Recipe: Competitor Price Drop -> Zapier

Goal:
- Monitor a product page.
- Trigger a Zap only when the price decreases.

## Sentinel Setup

1. Set `target_url` to the product page.
2. Use `fields[]` to extract the price:
   - Example: `{ \"name\": \"price\", \"selector\": \".price\", \"type\": \"text\" }`
3. Set `webhook_url` to a `Catch Hook` URL from Zapier.
4. Schedule the Actor (e.g. every 15 minutes).

## Zapier Setup

1. Trigger: `Webhooks by Zapier` -> `Catch Hook`.
2. Filter step:
   - Require `changes.fields.price.delta < 0`
3. Actions:
   - Slack / Email / Google Sheets, etc.

## Notes

- If the site uses client-side rendering, set `rendering_mode=playwright`.
- For noisy pages, configure `ignore_selectors` and `ignore_regex_presets`.

