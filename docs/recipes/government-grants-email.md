# Recipe: Government Grants -> Email

Goal:
- Monitor a grants/tenders page.
- Email yourself when new items appear.

## Sentinel Setup

1. Set `target_url` to the grants page.
2. Use `selector` to scope to the main list/table content (e.g. `main` or `.grants-list`).
3. Add noise reduction:
   - `ignore_selectors` for “last updated” timestamps, cookie banners
   - `ignore_regex_presets` for timestamps
4. Set `webhook_url` to an automation tool (Zapier/Make.com) or your own receiver.
5. Schedule the Actor (e.g. hourly).

## Email Delivery

Examples:
- Zapier: Webhook -> Gmail/Email action
- Make.com: Webhook -> Email module

