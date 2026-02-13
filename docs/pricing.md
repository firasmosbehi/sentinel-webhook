# Monetization / Pricing Notes (Draft)

Sentinel is naturally recurring-usage because it is most valuable when scheduled frequently.

## Compute-Unit Guidance

Cost is roughly driven by:
- Run frequency (e.g. every 15 minutes = 96 runs/day)
- Target count (`targets[]`)
- Rendering mode (`static` vs `playwright`)
- Page size (`max_content_bytes`)
- Retries (fetch + webhook)

Rules of thumb:
- Prefer `static` mode when possible.
- Use `fields[]` when you can extract a small, stable value (cheaper and cleaner diffs).
- Keep `max_concurrency` conservative when using Playwright.

## Suggested Pricing Approach

If offering a paid plan on top of compute:
- Charge per monitored URL per month, tiered by schedule frequency.
- Offer a free tier for low-frequency monitoring (e.g. 1h+ schedules).
- Add a premium tier for Playwright rendering and higher concurrency.

