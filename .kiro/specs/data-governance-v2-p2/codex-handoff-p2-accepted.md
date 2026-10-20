# Data Governance v2 — P2 Final Acceptance Package

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/data-governance-v2-p0` (PR #320)  
**Request:** Review this package and decide **P2 Accepted** or **Changes Required**.  
**This document does not claim P2 Accepted.**

> Gate Pass ≠ P2 Accepted. P3 coding is **not** started.

## Slice status

| Slice                     | Implementation SHA                                | Docs / review tip                                                                          | Status                                |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------- |
| P2-a foundation           | `9745c28a24`                                      | `.kiro/specs/data-governance-v2-p2/codex-handoff.md` (`cb75ef157a`)                        | **Accepted**                          |
| P2-b conversation_archive | `e61c307101` (CR4)                                | `.kiro/specs/data-governance-v2-p2/codex-handoff-p2b.md` (`bfb90a49dc` / pin `8114920304`) | **Accepted**                          |
| P2-c memory forget        | `cfd7f08c77` (CR3)                                | `.kiro/specs/data-governance-v2-p2/codex-handoff-p2c.md` (`249de4bb35` / pin `9800ec2549`) | **Accepted**                          |
| P2-d purge closure        | `b48686f962` then CR (see `codex-handoff-p2d.md`) | `.kiro/specs/data-governance-v2-p2/codex-handoff-p2d.md`                                   | **Changes Required** → CR resubmitted |
| P2-e adapter + A7 matrix  | `b48686f962`                                      | this package                                                                               | **narrow contract accepted**          |

## P2-d — purge closure

**Impl:** `b48686f962`  
**Surfaces:** `lifecycle-purge.ts`, `lifecycle-purge-adapters.ts`, `lifecycle-p2d.test.ts`

### State machine

1. Owner `requestPurge` → Catalog `deletion_pending` + exclusive `activeLifecycleOperation` (`command=requestPurge`) + open receipt.
2. Worker/operator/system `resumePurge(operationId, attemptId)` continues **the same** op (never a second active op).
3. Re-validate Catalog + open receipt + logical deletion marker, then destructive erase.
4. Stages: `purge_execute` → `cloud_tombstone` → `catalog_close`.
5. Success: CAS `lifecycleState=purged`, clear `activeLifecycleOperation`, receipt `completed`.
6. `closeOnSuccess: false` is test-only (P2-a mid-flight). Default closes.

### Receipt

| Stage             | Success                               | Fail                                                             |
| ----------------- | ------------------------------------- | ---------------------------------------------------------------- |
| `purge_execute`   | `succeeded`                           | `failed`; Catalog stays `deletion_pending`; receipt stays `open` |
| `cloud_tombstone` | `not_applicable` when no cloud target | `failed` + `cloud_purge_adapter_missing` (no success stub)       |
| `catalog_close`   | `succeeded` then receipt `completed`  | not written if CAS loses                                         |

### Failure / recovery

| Case                                              | Catalog                                                                                                                    | Receipt / recovery                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Destructive `failed` / throw                      | stay `deletion_pending`; active op kept                                                                                    | receipt `open`; `recoverPurgeAttempt` can resume if still bound  |
| object-store / BYOS / `objectKey` without adapter | not `purged`                                                                                                               | `cloud_purge_adapter_missing`                                    |
| CAS lose after erase                              | not `purged`                                                                                                               | recovery receipt `purge_catalog_close`, `haltCompensation: true` |
| User `resumePurge`                                | unchanged                                                                                                                  | `actor_not_authorized`                                           |
| Restart                                           | `recoverPurgeAttempt`: open receipt + matching active op → `canResume`; prepared/failed/inconsistent → `recovery_required` |

### Tests (`lifecycle-p2d.test.ts`, 5)

- FS destructive + cloud `not_applicable` → Catalog `purged`, receipt `completed`, file gone
- Destructive adapter `failed` → stay `deletion_pending`, receipt `open` (no purged stub)
- object-store without cloud adapter → fail closed
- owner user `resumePurge` denied (A7 execute = worker/operator/system)
- Catalog CAS fail after destructive → `purge_catalog_close` recovery receipt

## P2-e — four-type adapter contract + A7 matrix

**Impl:** `b48686f962`  
**Surfaces:** `lifecycle-adapter-matrix.ts`, `lifecycle-p2e.test.ts`  
**Scope:** `adapter_contract` only — **no** full domain bridge.

Types: `workspace` | `agent` | `knowledge` | `operational_identity`  
Each: `scope=adapter_contract`, `forget=deny`, `purgeDestructive=filesystem`.

### A7 authorization (shape; callers still enforce tenant/ownership proofs)

| Command class                                                                  | Allowed actors             | Denied (evidence)                                    |
| ------------------------------------------------------------------------------ | -------------------------- | ---------------------------------------------------- |
| Owner: archive / restore / forget / `requestPurge` / `cancelDeletion` / retire | user / operator / system   | worker `requestPurge` is not in the owner allow-list |
| Hold: `applyLegalHold` / `releaseLegalHold`                                    | operator / system          | **user hold → `actor_not_authorized`**               |
| Purge execute: `resumePurge`                                                   | worker / operator / system | **user resumePurge → `actor_not_authorized`**        |
| Forget on the four types                                                       | —                          | **`command_denied_for_type`**                        |

### Tests (`lifecycle-p2e.test.ts`, 5)

- exactly four adapter-contract types
- CA `full` + forget deny; memory `forget_slice` + archive deny
- A7: owner `requestPurge` ok; user `resumePurge` / user hold denied; worker resume + operator hold ok
- forget denied on all four types
- FS purge adapter resolves for each of the four types

P2-d also covers the execute-actor negative at the `resumePurge` API (`actor_not_authorized`).

## Verification

```bash
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run \
  src/gateway/data-governance/lifecycle-p2a.test.ts \
  src/gateway/data-governance/lifecycle-p2b.test.ts \
  src/gateway/data-governance/lifecycle-p2c.test.ts \
  src/gateway/data-governance/lifecycle-p2d.test.ts \
  src/gateway/data-governance/lifecycle-p2e.test.ts
# → 76 passed (17 + 19 + 22 + 13 + 5)
```

## Not implemented (out of P2 Accepted scope unless Codex says otherwise)

- RPC wiring of `dataGovernance.lifecycle.*`
- Cloud tombstone / object-store / BYOS purge adapters (fail-closed only; no success stub)
- Full domain bridges for workspace / agent / knowledge / operational_identity
- Memory forget for CogniWeave / sqlite / objectKey (P2-c adapter is `markdown_root` / `filesystem` only)
- `retire` as a full two-phase (matrix only)
- Memory `requestPurge` / `cancelDeletion` / `resumePurge` as a dedicated two-phase (shared purge + matrix)
- P2-d filesystem erase uses parent-dir fsync (`lifecycle-durable-fs.ts` `removePathDurable`); see P2-d CR
- P3 and later phases — **not started**

## Tips

| Milestone                  | SHA                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| P2-d / P2-e implementation | `b48686f962a5079c2c04527b92206ae0801c0189`                                                 |
| P2-d CR impl               | `29f6e5b3b492063c98caec55daa3887548bf80f0`                                                 |
| **This docs package**      | `a2246cc3062cbe01d803d42de3b879bdcaeb04e4` (superseded for P2-d by `codex-handoff-p2d.md`) |

## Ask of Codex

1. Prior package `a2246cc306` was **Changes Required** on three P2-d P0s. Re-review the incremental tip `.kiro/specs/data-governance-v2-p2/codex-handoff-p2d.md`.
2. P2-a/b/c remain Accepted; P2-e narrow contract remains accepted.
3. Implementation owner does **not** mark P2 Accepted. P3 stays locked until Codex verdict.
