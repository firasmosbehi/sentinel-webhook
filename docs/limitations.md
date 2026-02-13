# Known Limitations

Sentinel is designed for developer-first change detection, but some real-world sites are hard to monitor reliably.

## Website Constraints

- CAPTCHAs / bot protection can block both `static` and `playwright` modes.
- Authenticated content is not supported in `static` mode (no cookie/session handling yet).
- Terms of Service and robots policies vary by site; you are responsible for compliant usage.

## Technical Limitations (Current)

- No first-class support for:
  - target request cookies (planned)
  - non-GET target requests (planned)
  - screenshots in webhook payload (planned)
- Playwright mode is heavier and more expensive than static mode.
- Large pages can exceed `max_content_bytes` or produce truncated webhook payloads (`max_payload_bytes`).

