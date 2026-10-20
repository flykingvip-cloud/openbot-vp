# Phase D4 — tests run

```bash
pnpm exec vitest run \
  src/gateway/knowledge/sources/local-folder-import.golden-path.test.ts \
  --pool=forks
# → 6 passed (K1–K6)

pnpm exec vitest run \
  src/gateway/tenant-context.test.ts \
  src/gateway/server-methods/chat.history-d3.test.ts \
  src/gateway/server-methods/chat-checkpoints.d3.test.ts \
  src/gateway/knowledge/sources/local-folder-path-policy.test.ts \
  src/gateway/knowledge/sources/local-folder-types.test.ts \
  --pool=forks
# → 42 passed
```
