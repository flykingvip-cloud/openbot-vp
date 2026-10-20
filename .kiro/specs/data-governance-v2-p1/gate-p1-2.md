# P1-2 Gate Evidence Package (lifecycle authority repair)

**Owner:** `cursor-data-governance`  
**Date:** 2026-08-11  
**Instruction:** `cursor-execution-instruction-p1-wave2.md` Phase A  
**Verdict:** **Pass** (A1 / A2 / A3 + lifecycle authority closers)

## Evidence command

```bash
OPENBOT_TEST_PROFILE=low pnpm test \
  src/gateway/data-governance/ \
  src/gateway/server-methods/data-governance.test.ts \
  src/gateway/workspace/handler-bridge.test.ts \
  src/gateway/workspace/resource-resolver.perf.test.ts \
  src/gateway/workspace/resource-resolver.test.ts \
  src/gateway/workspace/managed-fail-closed.test.ts \
  src/gateway/server-methods/agents-mutate.test.ts
```

**Result:** 15 files, **115 passed / 5 skipped / 0 failed**.

---

## Codex Changes-required closers (this tip)

| Finding                                       | Fix                                                                                                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Access reactivates non-active lifecycle       | `upsertWorkspaceGovernanceRecord` is first-registration only; existing rows preserve lifecycle; only `transitionCatalogLifecycle` changes it |
| processCatalog invents active from classifier | `ensureCatalogResource` projects via `projectDurableWorkspaceToResolver` from durable record                                                 |
| Non-active still usable                       | Resolver denies `recovery_required` / `quarantined` / `archived` / `pending` / `retired` with `lifecycle_blocks_access`                      |
| Receipt path traversal                        | Safe token charset + resolve-under-root checks; RPC returns INVALID_REQUEST                                                                  |

Negative tests: `lifecycle-access.test.ts`, `resource-resolver.test.ts` lifecycle deny, `data-governance.test.ts` traversal.

## A1–A3 (still Pass)

Prior Gate Repair evidence retained: composite cache key, epoch/TTL, refresh/backoff, degraded personal_local read, recovery list/receipts/runbook, duplicate-canonical RPC, durable-first authority model (now projection-complete).

## Design freezes

Knowledge grain + Memory canonical remain frozen in `design-p1-wave2.md`.

## Gate decision

| Gate                | Verdict  |
| ------------------- | -------- |
| A1                  | **Pass** |
| A2                  | **Pass** |
| A3                  | **Pass** |
| Lifecycle authority | **Pass** |
| **Overall**         | **Pass** |

Phase C remains locked until Codex records Gate Pass + design ack.
