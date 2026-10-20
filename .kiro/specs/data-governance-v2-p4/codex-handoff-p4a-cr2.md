# Data Governance v2 — P4-a Codex Handoff CR2

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/merge-live-into-main`  
**Prior review tip:** P4-a CR Changes Required on `e06f69b228e503ca4d2bf9fa915213789ad23d04`  
**This document does not claim P4-a Accepted, P4 first-wave Accepted, or P4 Accepted.**  
**P4-b/c/d stay locked until P4-a Accept. P5 coding stays locked until P4 first-wave Accept.**

---

## Closed this round

| Finding                                                                                                                    | Fix                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `placement-platform-authority.ts` issued branded receipts/consent from raw strings. “Not in the barrel” was not a boundary | Production issuer deleted. `placement-platform-proofs.ts` only verifies membership in an in-memory verified set. P4-a consumes proofs; it does not issue them. Unauthenticated raw mint exists only in `placement-resolve.test-harness.ts`.          |
| Any internal module could `import { issueSubjectConsentProof }`                                                            | Static scan of `src/gateway/**/*.ts`: production files must not import `issue*` / `mint*ForTests` / `registerVerified*ForTests` / the test harness. `placement-platform-proofs.ts` has no `export function issue`. Barrel does not export mints.     |
| Consent checked only `proof.tenantId === input.tenantId`                                                                   | Input now has verified `resourceConsentScope` (`resourceId` + authoritative `dataSubjectIds`) and `evaluationTime`. Proof must bind the same tenant/resource/purpose/`consentVersion`, cover **every** scope subject, and not be revoked or expired. |

Retained from CR1: offline request cannot relax tenant `offlineRequired=true`; missing consent still `consent_required`; unregistered `{ issuer: "platform" }` objects still fail.

---

## Implementation SHA

| Milestone                        | SHA                                        |
| -------------------------------- | ------------------------------------------ |
| Prior P4-a CR (Changes Required) | `e06f69b228e503ca4d2bf9fa915213789ad23d04` |
| **This CR2 implementation**      | `1405eff0ac9acca5f19cd7150894961971d83691` |
| **This review tip**              | `d1bf9b99d7bdcffa32acbc9e293c1abda747f27f` |

---

## Tests

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/data-governance/placement-resolve.test.ts
```

**70 passed** (1 file).

New coverage:

- unregistered / grant-shaped consent still denied
- missing resource scope denied
- proof covering only one of two authoritative subjects denied
- same-tenant proof bound to another `resourceId` denied
- revoked and expired consent denied
- production issuer import scan over `src/gateway`

Gate CR3 contract tests still pass (`gate-p4-cr2.test.mjs`, 2 passed).

---

## Fail-before / pass-after

**Fail-before** (impl `e06f69b228e503ca4d2bf9fa915213789ad23d04`):

1. `issueSubjectConsentProof({ tenantId, subjectId, consentVersion })` in a production module minted a valid proof from raw strings.
2. A same-tenant proof for subject A authorized cloud projection for a resource whose data subjects included A and B.

**Pass-after** (impl `1405eff0ac9acca5f19cd7150894961971d83691`):

```text
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/data-governance/placement-resolve.test.ts
# Test Files  1 passed (1)
# Tests  70 passed (70)
```

1. No production `issue*` remains. Raw mint is harness-only and statically forbidden from production imports.
2. Incomplete subject coverage, wrong resource, revoked, and expired consent all return `consent_required`.

---

## Stop

P4-a CR2 is submitted for Codex Accept. **Do not start P4-b** until P4-a is Accepted.
