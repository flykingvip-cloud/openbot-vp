# Integration Testing (Rollback Path)

This document defines the real-container rollback check for CogniWeave SQL/Cypher adapters.

## Scope

Current integration runner validates rollback behavior for:

- Postgres metadata table writes
- PgVector seed document writes
- Neo4j graph writes (constraint-violation transaction rollback path)

The target is to ensure transaction abort paths do not leave committed side effects.

## Runner

- Script: `scripts/integration-rollback.mjs`
- Compose file: `scripts/docker-compose.integration.yml`
- Package command: `pnpm --dir packages/cogniweave-sdk run integration:rollback`

## Usage

Run and auto-clean containers:

```bash
pnpm --dir packages/cogniweave-sdk run integration:rollback
```

Keep containers for debugging:

```bash
pnpm --dir packages/cogniweave-sdk run integration:rollback -- --keep-containers
```

Write JSON report:

```bash
pnpm --dir packages/cogniweave-sdk run integration:rollback -- --output /tmp/cogniweave-integration-rollback.json
```

## Output

The runner prints a JSON report including:

- `status`: `PASS` | `FAIL` | `ERROR`
- per-check `passed` boolean and details
- start and finish timestamps

## Notes

- This runner requires Docker with `docker compose`.
- It is wired into CI job `cogniweave-sdk-integration-rollback`, which uploads `.runtime/cogniweave-integration-rollback.json` as an artifact.
- It is intended for pre-release hardening and CI environments with container support.
