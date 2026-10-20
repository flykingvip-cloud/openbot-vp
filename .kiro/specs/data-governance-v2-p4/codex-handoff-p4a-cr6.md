# Data Governance v2 — P4-a Codex Handoff CR6

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/merge-live-into-main`  
**Prior review tip:** P4-a CR5 Changes Required on `9d33491a04c6456916ac1abc3a08f7030c93c484` / impl `8f7e8560173c49a35e07d604ccd7a245ed0fd7bc`  
**This document does not claim P4-a Accepted, P4 first-wave Accepted, or P4 Accepted.**  
**P4-b/c/d stay locked until P4-a Accept. P5 coding stays locked until P4 first-wave Accept.**

---

## Closed this round

| Finding                                                                                                                                                                 | Fix                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `installPlacementPlatformAuthority({ stateDir })` was a normal export. Any production importer could write custom Catalog/consent files and rebind the global verifier. | Production `installPlacementPlatformAuthority()` takes **no arguments**. It binds `resolveStateDir()` **once**. A second call returns `alreadyBound: true` and does not switch directories. Extra arguments throw.                                                                            |
| Test reset shared that production callable                                                                                                                              | Directory rebind lives in `placement-platform-bindings.ts` as `replacePlacementAuthorityBindingsForTests`, gated to Vitest / `OPENBOT_TEST_PROFILE`. The harness calls it. Production `placement-platform-root.ts` does not export or accept `stateDir`.                                      |
| Loader read `envelope.projection?.dataSubjectIds` as a comma-separated string. Official Envelope forbids first-wave `projection`. Tests wrote Catalog JSON directly.    | First-wave subjects come from `envelope.owner` when `kind === "user"`. Position/group/system owners yield no scope. Loader uses `loadValidatedCatalogRecordSync` → official `parseCatalogRecord` / Envelope validator. Corrupt or illegal rows return null. Tests seed through Catalog `put`. |

Startup / rebind policy:

- Process start: gateway calls `installPlacementPlatformAuthority()` (no args, `resolveStateDir()`).
- Later production calls: no-op, same directory.
- Changing `OPENBOT_STATE_DIR` after bind does not rebind.
- Test-only rebind: `resetPlacementAuthorityForTests` / `replacePlacementAuthorityBindingsForTests`.
- Adapters re-read durable Catalog / `placement-consents.json` on each verify.

Retained from CR5: Gateway startup bind, `GovernanceAuthenticatedCall`, extra-key reject, cross-tenant deny, HMAC, server clock, revoke/expiry, `reverifySubjectConsent`.

---

## Implementation SHA

| Milestone                         | SHA                                        |
| --------------------------------- | ------------------------------------------ |
| Prior P4-a CR5 (Changes Required) | `8f7e8560173c49a35e07d604ccd7a245ed0fd7bc` |
| Prior CR5 review tip              | `9d33491a04c6456916ac1abc3a08f7030c93c484` |
| **This CR6 implementation**       | `d8c746828fa5249be00544c750af46114cb04765` |
| **This review tip**               | `9e604b43a959f16df3ad6268c59a9273d7e7bc8a` |

---

## Tests

```bash
OPENBOT_TEST_PROFILE=low VITEST_CACHE_DIR=/tmp/vitest-p4a-cr6 pnpm exec vitest run \
  src/gateway/data-governance/placement-resolve.test.ts \
  src/gateway/data-governance/placement-platform-root.test.ts
```

**85 passed** (2 files). Cache dir is explicit so this worktree does not depend on `.vite-temp` write permission.

New / changed coverage:

- production install rejects any arguments, including `{ stateDir }`
- production install is once-only; changing `OPENBOT_STATE_DIR` does not steal the binding
- non-harness test: `OPENBOT_STATE_DIR` + no-arg install + official Catalog `put` + consent file → verify + `resolvePlacement`
- position owner and group owner fail closed
- first-wave `projection.dataSubjectIds` is rejected by official `put`
- tampered illegal projection and corrupt Catalog JSON fail closed through the official parser
- partial coverage uses two official `put`s (owner B proof vs owner A scope), not a comma-joined projection string

Gate CR3 contract tests still pass (`node --test .kiro/specs/data-governance-v2-p4/gate-p4-cr2.test.mjs`, 2 passed). `trustedRegionDefault: string | null;` is unchanged in `design-p4.md`.

---

## Fail-before / pass-after

**Fail-before** (impl `8f7e8560173c49a35e07d604ccd7a245ed0fd7bc`):

1. `installPlacementPlatformAuthority({ stateDir: attackerDir })` rebound the global verifier onto attacker-written files.
2. Loader accepted `projection.dataSubjectIds`. The harness wrote illegal Catalog JSON, so multi-subject tests did not prove real Catalog data.

**Pass-after** (impl `d8c746828fa5249be00544c750af46114cb04765`):

```text
OPENBOT_TEST_PROFILE=low VITEST_CACHE_DIR=/tmp/vitest-p4a-cr6 pnpm exec vitest run \
  src/gateway/data-governance/placement-resolve.test.ts \
  src/gateway/data-governance/placement-platform-root.test.ts
# Test Files  2 passed (2)
# Tests  85 passed (85)
```

1. Production install is no-arg / once / `resolveStateDir()` only.
2. Subjects come from the Catalog user owner. Loader uses the official Catalog parser. Tests seed via `put`.

---

## Stop

P4-a CR6 is submitted for Codex Accept. **Do not start P4-b** until P4-a is Accepted.
