# Known Limitations

Sentinel is designed for developer-first change detection, but some real-world sites are hard to monitor reliably.

## Website Constraints

- CAPTCHAs / bot protection can block both `static` and `playwright` modes.
- Authenticated content may require a real browser session; cookies are supported but full interactive login flows are not.
- Terms of Service and robots policies vary by site; you are responsible for compliant usage.

## Technical Limitations (Current)

- `rendering_mode=playwright` currently supports `target_method=GET` only (no `target_body`).
- Screenshot mode is Playwright-only (`screenshot_on_change=true`).
- Playwright mode is heavier and more expensive than static mode.
- Large pages can exceed `max_content_bytes` or produce truncated webhook payloads (`max_payload_bytes`).
