# Upgrade / Migration Policy

## Webhook Payload Compatibility

- Webhook payloads include `schema_version`.
- `schema_version` is bumped only for breaking payload changes.

Non-breaking changes may include:
- Adding new optional fields
- Adding new event types

## State Compatibility

Sentinel persists baselines in an Apify Key-Value Store.

To avoid incorrect comparisons, Sentinel changes the state key material when snapshot semantics change (examples):
- Rendering mode changes (`static` vs `playwright`)
- Diff inputs change (`fields[]`, `ignore_json_paths`, ignore rules)

Effect:
- A change in state key material behaves like a new baseline for that target.

## Recommended Upgrade Steps

1. Upgrade the Actor.
2. For critical monitors, run once with `baseline_mode=store_only` to confirm baseline behavior.
3. If you see unexpected diffs, set `reset_baseline=true` once to re-baseline.

