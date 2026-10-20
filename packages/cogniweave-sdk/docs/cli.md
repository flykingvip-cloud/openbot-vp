# CLI

CogniWeave SDK ships with a minimal CLI for local service startup and adapter schema bootstrap.

For a workspace checkout, build the package before invoking the package bin directly:

```bash
pnpm --dir packages/cogniweave-sdk run build
```

## Commands

### Serve

Start the HTTP service with the selected backend configuration.

```bash
pnpm --dir packages/cogniweave-sdk exec cogniweave serve --metadata-backend memory --graph-backend memory --vector-backend memory
```

### Bootstrap Schema

Bootstrap supported adapter schemas and exit.

```bash
pnpm --dir packages/cogniweave-sdk exec cogniweave bootstrap-schema --metadata-backend postgres --graph-backend neo4j --vector-backend pgvector
```

## Common Options

- `--host <host>`
- `--port <port>`
- `--base-path <path>`
- `--environment <local|service|cloud>`
- `--metadata-backend <backend>`
- `--graph-backend <backend>`
- `--vector-backend <backend>`
- `--evidence-backend <backend>`
- `--bootstrap-schemas` / `--no-bootstrap-schemas`
- `--json`
- `--output <file>`
- `--default-workspace-id <id>`
- `--default-project-id <id>`
- `--default-agent-id <id>`
- `--default-visibility <private|shared>`
- `--reasoning-timeout-ms <ms>`
- `--print-config`
- `--dry-run`
- `--version`

## Notes

- The CLI uses the same runtime contracts as the SDK.
- The published/bin entry resolves to compiled `dist` output, not raw TypeScript sources.
- Schema bootstrap is best-effort for adapters that expose `bootstrapSchema()`.
- The memory backend is useful for local smoke tests and examples.
- `--print-config` prints the resolved serve plan without binding a socket.
- `--dry-run` validates serve startup and exits before opening a listener.
- `--json` emits machine-readable single-line JSON for CLI outputs.
- `--output <file>` writes the final CLI output to a file and still prints to stdout.

## JSON Envelope

When `--json` is enabled, output is wrapped in a stable envelope:

```json
{
  "ok": true,
  "action": "version | print-config | bootstrap-schema | bootstrap-schemas | dry-run | serve-started",
  "code": "VERSION_OK | PRINT_CONFIG_OK | BOOTSTRAP_SCHEMA_OK | BOOTSTRAP_SCHEMA_PARTIAL | BOOTSTRAP_SCHEMAS_OK | BOOTSTRAP_SCHEMAS_PARTIAL | DRY_RUN_OK | SERVE_LISTENING",
  "timestamp": "2026-04-08T16:00:00.000Z",
  "data": {}
}
```

For failures, the CLI emits an error envelope with explicit error code:

```json
{
  "ok": false,
  "action": "error | serve | bootstrap-schema | bootstrap-schemas",
  "code": "INVALID_ARGUMENT | BOOTSTRAP_FAILED | LISTEN_FAILED | INTERNAL_ERROR",
  "timestamp": "2026-04-08T16:00:00.000Z",
  "error": {
    "message": "Invalid port: abc"
  }
}
```
