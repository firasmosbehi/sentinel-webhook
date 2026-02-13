# Release / Versioning Strategy (Draft)

## Versioning

- Use Semantic Versioning for the Actor code (`MAJOR.MINOR.PATCH`).
- Webhook payloads include `schema_version`.
  - Increment `schema_version` only for breaking payload changes.

## State Compatibility

- Snapshot state keys are versioned internally.
- Changes to snapshot semantics should change the state key material to avoid corrupt comparisons.

## Release Checklist

1. Update `CHANGELOG.md`.
2. Ensure `npm test`, `npm run lint`, `npm run build` pass.
3. Verify `INPUT_SCHEMA.json` matches runtime validation defaults.
4. Update docs (quickstart, payload reference, input reference).
5. Tag a release in Git and publish notes (GitHub Releases).
6. Deploy updated Actor to Apify and validate one end-to-end scheduled run.

