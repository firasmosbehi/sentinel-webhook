# Contributing

Thanks for considering contributing.

## Ground Rules

- Be respectful and constructive (see `CODE_OF_CONDUCT.md`).
- Prefer small, focused pull requests.
- If you're proposing a behavior change, open an issue first to align on scope.

## Development Setup

Requirements:
- Node.js `>=20`

Commands:
- Install: `npm install`
- Lint: `npm run lint`
- Build: `npm run build`
- Test: `npm test`

Local run:
- `cp INPUT.example.json INPUT.json`
- `npm run dev`

## Pull Requests

- Describe the problem being solved and the approach taken.
- Include test coverage where it makes sense.
- Avoid including secrets or credentials in commits.

## Issue Triage

When filing an issue, include:
- The exact input (sanitized), especially `target_url`, `selector`, and ignore rules.
- A sample payload (if relevant) with `event_id`.
- Whether you used `static` or `playwright` mode.
- Expected vs actual behavior.

Labeling conventions:
- `priority:P0|P1|P2`
- `area:*` (security, reliability, webhook, diffing, docs, ...)
- `mvp|v1|v2|launch`
