# Security Model And Safe Defaults

## SSRF Protection

Sentinel refuses to send requests to:
- `localhost` / `.localhost`
- Private IP ranges (IPv4 and IPv6)
- Non-HTTP(S) schemes (e.g. `file://`)

This protection applies to:
- `target_url` (including redirects)
- `webhook_url`
- Playwright-rendered page subrequests (when `rendering_mode=playwright`)

## Domain Policy

You can restrict allowed destinations with allow/deny lists:
- `target_domain_allowlist` / `target_domain_denylist`
- `webhook_domain_allowlist` / `webhook_domain_denylist`

Patterns:
- Exact hostnames (e.g. `example.com`)
- Wildcard subdomains (e.g. `*.example.com`)

## Payload Signing

If `webhook_secret` is set, Sentinel signs each request with HMAC-SHA256.
See `docs/signature-verification.md`.

## Data Minimization Defaults

Defaults are biased toward safer storage/logging:
- `redact_logs: true` (default): redacts sensitive-looking tokens in logs/datasets.
- `max_content_bytes`: hard cap on downloaded response size.
- `max_payload_bytes`: hard cap on webhook payload size (truncates large diffs).

