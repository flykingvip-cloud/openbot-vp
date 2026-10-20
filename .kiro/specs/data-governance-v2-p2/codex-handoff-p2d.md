# Data Governance v2 — P2-d Codex Handoff (CR3: trusted purge roots)

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/data-governance-v2-p0` (PR #320)  
**Prior CR2 tip:** `688b3e2ea2` / impl `521ec838a0` — **Changes Required** (caller could expand `allowedRoots`)  
**P2-a / P2-b / P2-c:** Accepted — **unchanged**  
**P2-e:** narrow adapter contract accepted — **unchanged**  
**This document does not claim P2 Accepted.**

> Re-review **this P2-d incremental**. Path containment algorithm is unchanged. P3 is **not** started.

## Already closed

- Durable file/dir/missing-on-resume parent-dir fsync
- PostgreSQL fail-closed
- Catalog `purged` + evidenced open receipt heal
- realpath containment: cross-tenant, root-equal, symlink escape, missing parent

## Closed this round

| Finding                                                                   | Fix                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0 `ResumePurgeParams.allowedRoots` let a worker/operator expand the root | **Removed** from the production resume API. Excess `allowedRoots` on the call object is ignored                                                                                                                                                        |
| Caller override beat the tenant root                                      | `resolvePurgeAllowedRoots` only uses trusted `stateDir` + envelope `tenantId` (`tenants/<tenantId>`). Never locator, never caller paths                                                                                                                |
| No bound handle                                                           | Optional `storageHandle` from `issuePurgeStorageHandle` (server-derived roots only). Resume checks resourceId, tenantId, bindingId, operationId. Handle roots must stay inside the trusted tenant root — expansion or cross-resource reuse fail-closed |

## Evidence tests (`lifecycle-p2d.test.ts`)

- worker / operator excess `allowedRoots` (dirname / stateDir) **inexpressible at the type** and **ignored at runtime** — cross-tenant file retained
- issued handle with expanded root → `purge_handle_root_not_contained`
- handle reused across resource / operation / binding / tenant → mismatch, not `purged`

## Verification

```bash
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run \
  src/gateway/data-governance/lifecycle-p2a.test.ts \
  src/gateway/data-governance/lifecycle-p2b.test.ts \
  src/gateway/data-governance/lifecycle-p2c.test.ts \
  src/gateway/data-governance/lifecycle-p2d.test.ts \
  src/gateway/data-governance/lifecycle-p2e.test.ts
# → 83 passed (17 + 19 + 22 + 20 + 5)
```

## Surfaces

- `src/gateway/data-governance/lifecycle-purge.ts` (`ResumePurgeParams` has no `allowedRoots`)
- `src/gateway/data-governance/lifecycle-purge-handle.ts` (new)
- `src/gateway/data-governance/lifecycle-durable-fs.ts` (`resolvePurgeAllowedRoots` has no override)
- `src/gateway/data-governance/lifecycle-p2d.test.ts`

## Tips

| Milestone             | SHA                                        |
| --------------------- | ------------------------------------------ | --- |
| Prior CR2 impl        | `521ec838a0`                               |
| Prior CR2 pin         | `688b3e2ea2`                               |
| **This CR3 impl**     | `0b99d624460b163f64179201216320142a360e02` |
| **This docs package** | `f2b7ee9212eb7620c6f99296213c95cc900dc1a3` |     |

## Ask of Codex

1. Review **this tip**. If allowed roots are a server-side fact (not a caller path list) → **P2-d Accept** (and then P2 verdict).
2. Else **Changes Required** with file/line.
3. Implementation owner does **not** mark P2 Accepted. P2-a/b/c stay Accepted. P3 stays locked.
