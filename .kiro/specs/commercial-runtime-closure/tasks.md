# commercial-runtime-closure

| Owner                       | Task                         | Role        |
| --------------------------- | ---------------------------- | ----------- |
| **grok-commercial-closure** | `commercial-runtime-closure` | implementer |

## Agents

- grok-commercial-closure · role: owner · scope: platform catalog upper bound, entitlement force, AOR real catalog, preflight credit reserve, usage outbox, no-bypass audit · paths: `src/gateway/billing/**`, `src/gateway/model-entitlement/**`, `src/gateway/resource-catalog/**`, `src/auto-reply/reply/agent-runner-execution.ts`, `src/cron/isolated-agent/run.ts`, `src/gateway/supervisor/**`, `.kiro/specs/commercial-runtime-closure/**` · since: 2026-07-19

## Checklist

### 1 — Preflight credits reservation

- [x] Credit reservation store (idempotent by runId) — grok-commercial-closure
- [x] authorizeCommercialRun always estimates min reservation for credits mode — grok-commercial-closure
- [x] settle/release reservation after run — grok-commercial-closure
- [x] Tests: block deny shortfall, PAYG meter/price preflight, reserve idempotency — grok-commercial-closure

### 2 — Usage outbox

- [x] Durable usage outbox store + drain consumer — grok-commercial-closure
- [x] Chat + cron await enqueue before delivery — grok-commercial-closure
- [x] Maintenance tick drains outbox — grok-commercial-closure
- [x] Tests: retry after failure, idempotent enqueue — grok-commercial-closure

### 3 — Platform catalog upper bound

- [x] EffectiveModelSet catalog bound from resource catalog enabled models — grok-commercial-closure
- [x] Disable/tier change re-projects entitlements — grok-commercial-closure
- [x] Catalog empty fail-closed for managed (requirePlatformCatalog default) — grok-commercial-closure

### 4 — AOR real catalog

- [x] ResourceModelCatalogEntry → ModelProfile adapter — grok-commercial-closure
- [x] Production AOR candidates from platform catalog — grok-commercial-closure
- [x] Tests: set conservation, cost ranking, unknown cost degrade — grok-commercial-closure

### 5 — Entitlement force for managed tenants

- [x] Managed-tenant effective policy helper (strict / all-bot-runs) — grok-commercial-closure
- [x] Wire helper into employee gate + CLI/supervisor modelGateInput (all-bot-runs bot/seat path) — grok-commercial-closure
- [x] Drain settles credit reservation with actual creditsCharged — grok-commercial-closure
- [x] **P0 fix**: apply managed policy **before** enforce=off / scope early-exit; always probe bot ownership — grok-commercial-closure
- [x] **P0 fix**: atomic tryHold under lock (concurrent last-credit race) — grok-commercial-closure
- [x] **P0 fix**: outbox drain failure keeps hold; settle only after real debit — grok-commercial-closure
- [x] **P1 fix**: tsgo-clean authorize pricing path + test types — grok-commercial-closure
- [x] Regression tests: managed cron default config, concurrent hold, hold lifecycle — grok-commercial-closure

### 6 — No-bypass audit

- [x] Registry supports gateOwnerPaths / delegation chain — grok-commercial-closure
- [x] Supervisor task-create chain audited — grok-commercial-closure
- [x] Negative test for missing gate — grok-commercial-closure
