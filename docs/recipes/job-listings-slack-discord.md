# Recipe: Job Listings -> Slack / Discord

Goal:
- Monitor a jobs page.
- Send a message when listings change.

## Sentinel Setup

1. Set `target_url` to the jobs page.
2. Use `selector` to scope extraction to the listings container (e.g. `.job-listings`).
3. Configure noise reduction if needed:
   - `ignore_selectors` for cookie banners, ads, tracking widgets
   - `ignore_regex_presets` for timestamps/tokens
4. Set `webhook_url` to your receiver (Zapier/Make.com/own endpoint).
5. Schedule the Actor.

## Receiver Setup (Slack/Discord)

Options:
- Zapier: Webhooks trigger -> Slack action
- Make.com: Webhooks trigger -> Discord/Slack module
- Custom: Use `examples/express-receiver/` and forward to Slack/Discord via their webhook APIs

