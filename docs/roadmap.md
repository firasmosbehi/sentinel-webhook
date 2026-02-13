# Roadmap (0.1 -> 2.0)

This document is a pragmatic ordering of Sentinel work from MVP to a scalable v2.

## Phase 0.1 (MVP)

Goal:
- A safe, stateful loop: URL(s) -> snapshot -> diff -> webhook on change.

Must-have:
- SSRF protection for target/webhook + redirect safety
- Baseline persistence (KV store)
- Change detection + payload size limits
- Webhook retries + dead-letter dataset
- CI (lint/test/build) + basic tests

## Phase 0.2 (Production Hardening)

Goal:
- Reliable operation every 5-15 minutes without alert fatigue.

Focus:
- Noise reduction defaults + configurable ignore rules
- Better observability (run events, metrics, schemas)
- Replay tools / recovery workflows (dead-letter replay)
- Input UX improvements (grouping, clearer descriptions)

## Phase 1.x (Advanced Monitoring)

Goal:
- Developer-first monitoring primitives.

Focus:
- Rendering improvements (Playwright performance controls, cookies/headers)
- Screenshot-based monitoring modes
- Additional diff formats (patches) and smarter suppression
- More webhook delivery options (fan-out, custom methods, circuit breakers)

## Phase Launch

Goal:
- Easy adoption.

Focus:
- Apify Store listing quality (copy, screenshots)
- Integration docs (Zapier, Make.com)
- Example receivers and recipes
- Support docs and contribution workflow

## Phase 2.x (Scale & Operations)

Goal:
- Scale to many targets per run with predictable costs.

Focus:
- Multi-target batching + concurrency controls + partial failure reporting
- Rate limiting and schedule jitter controls
- Storage optimizations (compression, snapshot history)
- More operational controls (alerts on fetch failures, heartbeats)

## Working Agreement

- Prefer safe defaults (SSRF protection, redaction).
- Avoid breaking webhook payload changes; bump `schema_version` if breaking changes are unavoidable.
- Changes to snapshot semantics should change the state key material to avoid incorrect comparisons.

