# Phase C Independent Security Review (Profile A/B tenant)

## Review identity

| Field              | Value                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------- |
| reviewerStableId   | `security-reviewer:profile-ab-tenant`                                                     |
| role               | Independent Security Reviewer (Profile A/B tenant)                                        |
| reviewedMainSha    | `2b9776708832d2cd3e533f0bf03a8498b0fc3f4a`                                                |
| reviewedAt         | `2026-09-24T14:42:37+08:00` (Asia/Shanghai)                                               |
| materialOwner      | `constitutional-governance-phase-c-decision:grok-bot`                                     |
| architectureSlot   | `codex-architecture` (receipt present: `AGREE_NO_GO`; not re-signed here)                 |
| executionChainSlot | `conversation-task-runtime:kiro-conversation-task-runtime` (independent; not filled here) |
| decision           | `AGREE_NO_GO`                                                                             |
| conditions         | none                                                                                      |
| signature          | `security-reviewer:profile-ab-tenant`                                                     |

This receipt fills **only** the Security Reviewer slot. It does not fill Architecture or Execution-chain. It was written by the Security Reviewer after independent investigation. Network of Networks / Material Owner / Grok Bot did not author these findings.

## Reviewed material (frozen digests verified)

Worktree: `/Users/daniel/AI VP/openbot-phase-c-decision`  
Branch: `grok-bot/constitutional-governance-phase-c-decision`  
`git rev-parse HEAD` = `2b9776708832d2cd3e533f0bf03a8498b0fc3f4a` (matches `reviewedMainSha`).

Authoritative per-file SHA-256 (recomputed on disk; exact match required):

| File                         | SHA-256                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| `failure-cases.md`           | `55475cd9e3a4c007206f32e411d379a4f418ceb78db8f43772913ce026abb6b9` |
| `alternatives-matrix.md`     | `44c75c25fe4b0570adc23ea26a412913ca2d7221b97180e3b6963fbbe0ece4c5` |
| `metrics-and-evidence.md`    | `651225d3eff3d03f029dd830760231e621c0e4b8a165de582fb4879f7dcf4b60` |
| `security-profile-review.md` | `ce86af449fc8cac1a2aba6170e64f26a0312236e14e1e9bfd72901e404596be7` |
| `decision.md`                | `bba958653f902f519f9d902b75423e4510c1d8eb025d3732b0149f3cebfd762b` |

| Field                   | Value                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| reviewedFilesAndDigests | table above (authoritative)                                                                                                        |
| combinedDigest          | `c5e527340f8d551e0569e62a956d6d615b241e92ebdee4e53d8320eae0c73a20` (optional; frozen for-loop \| shasum from `decision-digest.md`) |

Also read (not in the five-file freeze set): `decision-digest.md`, `reviews/architecture-review.md`, `SECURITY.md`, `src/gateway/security-profile.ts`, `src/gateway/security-profile.test.ts`, `src/gateway/tools-invoke-http.ts`, `src/conversation-task/reply-completion.ts`, `src/conversation-task/acl.ts`, `src/conversation-task/store.ts` (`openTenantScopedDb`), `src/gateway/enterprise-data/capability-agent-invoke-runtime.ts`, `src/gateway/server-methods/nodes.ts`, `src/task-orchestration/types.ts`, `packages/evolution-core/src/lineage.ts`.

**No frozen body was modified.**

## Independent checks (required)

### 1. Profile A / Profile B remain mutually exclusive

**PASS.** `SECURITY.md` defines Profile A `personal_local` and Profile B `managed_enterprise` as mutually exclusive trust contracts. `resolveSecurityProfile` rejects `SECURITY_PROFILE_CONFLICT` when `personal_local` is paired with managed data mode, rejects client profile hints (`SECURITY_PROFILE_CLIENT_OVERRIDE_REJECTED`), and requires dedicated tenant execution boundary + tenants root for Managed Enterprise. Material Owner NO-GO does not merge A/B. Option D is correctly blocked from being used to unify contracts.

### 2. sessionKey is not Path or auth boundary

**PASS.** `SECURITY.md` states session identifiers (`sessionKey`, session IDs, labels) are routing controls, not per-user authorization boundaries. Failure cases and Material Owner security notes preserve this. No GO path in the packet elevates sessionKey to Path or authz.

### 3. Plugin install ≠ capability authorization

**PASS.** Trusted Plugin concept: install/enable = trusted computing base for that gateway, not a capability grant directory. Managed Enterprise rejects unrestricted in-process plugin tenant access (`SECURITY_PROFILE_UNRESTRICTED_PLUGIN_ACCESS`). NO-GO keeps that separation; Option D is not authorized to redefine install as grant.

### 4. Receipt is not promoted to proof

**PASS.** Packet rejects receipt→proof promotion. Code still separates receipt-only ledger events via `ledgerEventIsReceiptNotProof` / `receiptOnly` in `packages/evolution-core/src/lineage.ts`. NO-GO does not introduce a new evidence store that would blur that line.

### 5. FC-01 and FC-03 impact on both Profiles is accurate

**PASS (independently reproduced on this SHA).**

- **FC-01:** `src/gateway/tools-invoke-http.ts` has **0** matches for execution-preflight / `buildExecutionPreflight` / completion-hold / ConversationTask / task-orchestration. Non-test `buildExecutionPreflight(` call site remains `attempt.ts:1111` only. HTTP path still has gateway auth (`authorizeHttpGatewayConnect`) + gateway HTTP deny list — so Profile A is not “open HTTP”; the accurate claim is **missing preflight completion / validation-receipt envelope**, not missing all auth. Profile B impact (harder cross-surface audit rebuild without preflight evidence) is fair and does not imply A/B merge.
- **FC-03:** `tools-invoke-http.ts`, `capability-agent-invoke-runtime.ts`, and `server-methods/nodes.ts` each have **0** `buildExecutionPreflight|execution-preflight` refs. `ORCHESTRATION_LIVE_INVOKE = false`. Claim that three-module convergence alone cannot close C10-family bypass inventory is accurate for both Profiles; Fail Closed must stay Profile-split.

FC-02 was spot-checked: `reply-completion.ts` has **0** delivery-hold / validation consultation refs and can `transitionTask(..., "closed")` — supports cross-domain finalization-gap narrative; Execution-chain owns deeper call-chain sign-off.

### 6. Managed Enterprise tenant fail-closed is not weakened

**PASS under NO-GO.** Gate 0 Managed Enterprise still requires dedicated execution boundary and rejects shared browser/credential/queue roots and unrestricted plugin tenant access in `security-profile.ts`. CTR ACL remains fail-closed (`acl.ts` tenant/conversation/employee guards; `openTenantScopedDb` + tenant binding). Material Owner NO-GO / Architecture AGREE_NO_GO do **not** authorize disabling those gates, merging A←B semantics, or deploying Option D in a way that softens B.

**Honesty bound (non-blocking):** this AGREE_NO_GO does **not** certify runtime cross-tenant isolation as `production-proven`. Phase B eval evidence remains echo-level for `tenantId`; production-proven stays unknown without container probe. That is a reason **against GO**, not a reason to reopen Meta-Schema engineering.

### 7. Option D would / would not create cross-tenant or cross-domain unified write authority

**Would create unacceptable risk if mis-scoped; must not proceed.** Alternatives matrix correctly marks D as risking a new evidence/authority plane and forbidding a fifth state machine / global completion writer. Even a “limited GO” that only added `constitutional-contracts` without Path/Gate would still add package surface without unique measurable benefit and would pressure toward cross-domain terminal writers (already rejected C11 rewrite). **NO-GO is the security-preserving choice:** keep domain-local writers; fix FC-01/02/03 with A/B/C patches and explicit finalization handshake — not a unified write authority.

### 8. Whether NO-GO is safer with clearer rollback than GO

**YES.** Current blast radius is local docs + default-off shadow flags. Rollback = discard worktree / keep flags unset. GO (even limited) would add package + consumer surface + future maintenance without unique security benefit, and would muddy Profile A/B Fail Closed ownership. **NO-GO is safer and has clearer rollback.**

## Finding

| Field                | Value                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| finding              | Material Owner draft **NO-GO** is correct on security grounds. Digests match. FC-01/FC-03 reproduce on `reviewedMainSha`. Profile A/B mutual exclusion, sessionKey≠Path/authz, plugin≠capability, receipt≠proof hold. Option D is not uniquely helpful and risks cross-domain authority / extra evidence plane. Agree stop Meta-Schema / `constitutional-contracts` / four-product milestones; keep Meta-Schema as vocabulary / review lens only. |
| profileAResult       | Keep `personal_local`. Do not impose Managed Enterprise tenant semantics on A. sessionKey remains routing-only. HTTP `/tools/invoke` retains gateway auth + deny list but lacks preflight completion envelope (FC-01) — fix via existing preflight wiring (Option A/B), not a new contract product.                                                                                                                                               |
| profileBResult       | Keep `managed_enterprise` mutually exclusive. Preserve Gate 0 dedicated boundary + CTR/enterprise fail-closed. Do not treat plugin install as tenant-wide data grant. FC-02/FC-03 remain Profile-split Fail Closed work on existing modules; do not merge A/B.                                                                                                                                                                                    |
| tenantBoundaryResult | Tenant fail-closed machinery (`security-profile` Gate 0, CTR `openTenantScopedDb` / ACL) is not weakened by this NO-GO. Runtime cross-tenant isolation is **not** elevated to production-proven by this receipt.                                                                                                                                                                                                                                  |
| receiptProofResult   | Receipt≠proof preserved; no new proof store authorized.                                                                                                                                                                                                                                                                                                                                                                                           |
| decision             | `AGREE_NO_GO`                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| conditions           | none                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Gate results (security lane)

| Gate                                                      | Result               |
| --------------------------------------------------------- | -------------------- |
| Frozen digests match exactly                              | `PASS`               |
| Profile A/B mutual exclusion preserved                    | `PASS`               |
| sessionKey ≠ Path / authz                                 | `PASS`               |
| Plugin install ≠ capability authz                         | `PASS`               |
| Receipt ≠ proof                                           | `PASS`               |
| FC-01 / FC-03 Profile impacts accurate on this SHA        | `PASS`               |
| Managed Enterprise fail-closed not weakened by NO-GO      | `PASS`               |
| Option D unique security benefit                          | `FAIL`               |
| Option D cross-domain / cross-tenant write-authority risk | `UNACCEPTABLE if GO` |
| NO-GO safer rollback than GO                              | `PASS`               |
| Security decision                                         | `AGREE_NO_GO`        |

## Explicit non-authorization

This receipt does **not** authorize:

- enabling B1/B2 shadow flags; deploy; production canary
- Phase D; creating `constitutional-contracts`; real Path; Gate tightening
- `ORCHESTRATION_LIVE_INVOKE=true`; Fabric default-on
- merging Profile A and Profile B
- physical Registry consolidation
- receipt→proof promotion
- cross-domain terminal-state writer / fifth execution state machine / new production evidence log store
- claiming runtime cross-tenant isolation or any metric as `production-proven` without a real container/probe denominator
- commit / push / PR of this worktree by this reviewer
- writing or signing `execution-chain-review.md`

## Follow-on hygiene (not conditions; out of Phase C Meta-Schema GO/NO-GO)

`SECURITY.md` still carries dual Gate 0 operator language (`OPENBOT_SECURITY_PROFILE` / dedicated boundary vs later `data.mode` / `OPENBOT_DATA_MODE` / `OPENBOT_MULTITENANT`) and still points vulnerability reporting at `gmood2008/openbot` while SoT is `upbeyond/openbot`. Reconcile as product-contract hygiene under existing Security Owner process. **Do not** “fix” that by merging Profiles or softening B fail-closed. These items do **not** flip this decision away from `AGREE_NO_GO`.

## Other independent slots (observed, not co-signed)

- Architecture: `reviews/architecture-review.md` present with `AGREE_NO_GO` (not re-signed here).
- Execution-chain: `reviews/execution-chain-review.md` present with `AGREE_NO_GO` and conditions none (observed on disk after this reviewer's investigation; **not** authored or co-signed by Security).

This Security receipt stands on its own digests and code checks. Multi-slot convergence is for Network of Networks / Material Owner to record without altering the five frozen bodies. That does **not** reopen Option D.

— `security-reviewer:profile-ab-tenant`
