# Data Governance v2 — P4-a Codex Handoff CR5

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/merge-live-into-main`  
**Prior review tip:** P4-a CR4 Changes Required on `9c7f5022202c97ef62793d65312390f386640b3b` / impl `2fa96ed2cbb395a0d261b613dfb00ca17b7fa22b`  
**This document does not claim P4-a Accepted, P4 first-wave Accepted, or P4 Accepted.**  
**P4-b/c/d stay locked until P4-a Accept. P5 coding stays locked until P4 first-wave Accept.**

---

## Closed this round

| Finding                                                                                                                                       | Fix                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bindPlacementAuthority({ catalog, store })` existed only so tests could inject loaders. Production never called it, so bindings stayed null. | Deleted. Production bind is `installPlacementPlatformAuthority({ stateDir? })` in `placement-platform-root.ts`. It constructs the Catalog file adapter and `createFilePlacementConsentStore` internally. Gateway `server.impl.ts` calls it after `createDefaultDeps`. |
| Any module could still `import { bindPlacementAuthority }` and pass a fake loader                                                             | That export is gone from `placement-platform-verify.ts`. Install rejects extra keys (`catalog` / `store`). Not in the public barrel. Static scan: only `placement-platform-root.ts`, `server.impl.ts`, and tests may mention `installPlacementPlatformAuthority`.     |
| Test reset shared the production bind callable                                                                                                | Tests do not call a bind-with-adapters API. Harness `resetPlacementAuthorityForTests` creates a new fixture `stateDir` and calls the production install. Production install never accepts loaders.                                                                    |

Startup / rebind policy:

- Process start: gateway calls `installPlacementPlatformAuthority()` (default `resolveStateDir()`).
- Same `stateDir`: idempotent, `rebound: false`.
- New `stateDir` or process restart: rebind, `rebound: true`.
- Adapters re-read durable Catalog / `placement-consents.json` on each verify.

Retained from CR4: `GovernanceAuthenticatedCall`, extra-key reject, cross-tenant deny, HMAC, server clock, revoke/expiry, `reverifySubjectConsent`.

---

## Implementation SHA

| Milestone                         | SHA                                        |
| --------------------------------- | ------------------------------------------ |
| Prior P4-a CR4 (Changes Required) | `2fa96ed2cbb395a0d261b613dfb00ca17b7fa22b` |
| Prior CR4 review tip              | `9c7f5022202c97ef62793d65312390f386640b3b` |
| **This CR5 composition root**     | `1d0485091b38a4a8fb8143f8cad24bceb7ef01b3` |
| **This CR5 gateway startup bind** | `8f7e8560173c49a35e07d604ccd7a245ed0fd7bc` |
| **This review tip**               | `f34e9ea22763409b99fb854c447c2edfaf03e8c8` |

---

## Tests

```bash
OPENBOT_TEST_PROFILE=low VITEST_CACHE_DIR=/tmp/vitest-p4a-cr5 pnpm exec vitest run \
  src/gateway/data-governance/placement-resolve.test.ts \
  src/gateway/data-governance/placement-platform-root.test.ts
```

**80 passed** (2 files). Cache dir is explicit so this worktree does not depend on `.vite-temp` write permission.

New coverage in `placement-platform-root.test.ts` (does **not** import `placement-resolve.test-harness.ts`):

- production install rejects caller-supplied adapters
- real Catalog `put` + consent file + `installPlacementPlatformAuthority` issues scope/proof and `resolvePlacement` returns encrypted-cloud
- same `stateDir` is idempotent; a new `stateDir` rebinds
- `server.impl.ts` contains `installPlacementPlatformAuthority()`

Gate CR3 contract tests still pass (`node --test .kiro/specs/data-governance-v2-p4/gate-p4-cr2.test.mjs`, 2 passed).

---

## Fail-before / pass-after

**Fail-before** (impl `2fa96ed2cbb395a0d261b613dfb00ca17b7fa22b`):

1. Only the test harness called `bindPlacementAuthority({ catalog, store })`. A real process left `catalogBinding` / `storeBinding` null.
2. Any production file that imported `placement-platform-verify.ts` could call that bind with a structurally compatible fake.

**Pass-after** (impl `8f7e8560173c49a35e07d604ccd7a245ed0fd7bc`):

```text
OPENBOT_TEST_PROFILE=low VITEST_CACHE_DIR=/tmp/vitest-p4a-cr5 pnpm exec vitest run \
  src/gateway/data-governance/placement-resolve.test.ts \
  src/gateway/data-governance/placement-platform-root.test.ts
# Test Files  2 passed (2)
# Tests  80 passed (80)
```

1. Gateway startup binds real Catalog + consent store. Install accepts only `stateDir`.
2. A non-harness test seeds durable files, installs, verifies, and resolves placement.

---

## Stop

P4-a CR5 is submitted for Codex Accept. **Do not start P4-b** until P4-a is Accepted.
