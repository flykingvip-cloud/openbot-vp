# Data Governance v2 — P1 Implementation

## Agents

- cursor-data-governance · role: owner · scope: P1 governance envelope + Resource Catalog (wave1 Accepted; P1-2 Gate Accepted; Phase C Knowledge/Memory/OI) · paths: src/gateway/data-governance/**, src/gateway/server-methods/data-governance\*.ts, src/gateway/server-methods/packs/{manifest,registry}.ts, src/gateway/workspace/handler-bridge.ts, src/gateway/server-methods/agents.ts, src/gateway/server-methods/chat.ts, src/gateway/knowledge/**, src/memory/**, src/gateway/enterprise-seat-assets-store*.ts, src/gateway/*operational-identity\*, .kiro/specs/data-governance-v2-p1/** · since: 2026-08-11

## Prerequisites

- [x] Gate 0 / P0 Accepted (`0382ee2a42` baseline; PR #320) — cursor-data-governance
- [x] P1 unlocked by Codex — cursor-data-governance
- [x] P1 first wave Accepted (`995e60ec71`) — cursor-data-governance / codex-data-governance
- [x] P1-2 execution order issued (`cursor-execution-instruction-p1-wave2.md`) — cursor-data-governance
- [x] P1-2 Gate Accepted (`ec85ef1f9c`) — cursor-data-governance / codex-data-governance

## First wave milestones (Accepted)

- [x] P1 plan through P1-m round 8 + first-wave Accepted (`995e60ec71`) — cursor-data-governance / codex-data-governance

## Second wave (P1-2)

**Instruction:** `.kiro/specs/data-governance-v2-p1/cursor-execution-instruction-p1-wave2.md`

### Phase A — P1-2 Gate — Accepted

- [x] P1-2-gate-A1…A3 + lifecycle authority repair — **Accepted** (`ec85ef1f9c`)

### Phase B — Design + inventory — Accepted with Gate

- [x] design / inventory / runbook — Knowledge grain + Memory canonical frozen — Accepted

### Phase C — Implementation (unlocked)

- [x] P1-2-a Knowledge Asset Envelope + canonical binding — cursor-data-governance _(types+envelope+register pending→active; inventory accepts knowledge; no bodies in Catalog)_
- [x] P1-2-b Memory Asset Envelope (raw vs Catalog min projection) — cursor-data-governance _(Managed=CogniWeave only; Personal Local markdown_root allowed; derived indexes; no atom bodies)_
- [x] P1-2-c Operational Identity Envelope + AgentAsset continuity refs — cursor-data-governance _(identityId resourceId; credentialHandleId ref only; AgentAsset continuity; no secrets in Catalog)_
- [x] P1-2-d Inventory APIs + tenant isolation + write fail-closed — cursor-data-governance *(write-gate; managed tenant required; inventory lists knowledge/memory/OI; require*ContentWrite hooks)\*
- [x] P1-2-e Diagnostics (orphan / duplicate canonical / wrong owner scope) — cursor-data-governance _(diagnoseWrongOwnerScope + OI AgentAsset continuity; inventory/RPC diagnose extended)_
- [x] P1-2-f Migration + rollback + fault-injection tests — cursor-data-governance _(second-wave-migrate; exclude OI secrets; dual-read; fault→recovery_required)_
- [x] P1-2-g First-wave regression + Codex handoff — cursor-data-governance _(141 passed / 5 skipped; handoff package ready for P1-2 Accepted)_
- [x] P1-2 Changes Required remediation — cursor-data-governance _(wire production writers; envelope projection allowlist; ownership proof; migration equivalence; 170 passed / 5 skipped)_
- [x] P1-2 Changes Required round 2 — cursor-data-governance _(managed create txn; CogniWeave per-scope sourceId + injected proof; enterprise OI stream; call-entry ownership proofs; **179 passed / 5 skipped**)_
- [x] P1-2 Changes Required round 3 — cursor-data-governance _(objectKey uniqueness; CogniWeave caller/cache epoch; logical compensate for shared stores; multi-resource + cache tests; **196 passed / 5 skipped**)_
- [x] P1-2 Changes Required round 4 — cursor-data-governance _(Memory revoke fail-closed; sync seat invalidate on assign/handover/release; abort defaults false; marker stateDir; real KB compensate; **199 passed / 5 skipped**)_
- [x] P1-2 Changes Required round 5 — cursor-data-governance _(legacyLocator selector; migrate/tsgo fixes; seat production-entry epoch tests; **203 passed / 5 skipped**)_
- [x] P1-2 Changes Required round 6 — cursor-data-governance _(OI tenantId model+stamp; RPC generic T; governance/catalog test types; ownership-path tsgo **OWNERSHIP_ZERO**; **203 passed / 5 skipped**)_
- [x] P1-2 Changes Required round 7 — cursor-data-governance _(managed simulate-complete tenant store routing; lifecycle tenantId; **204 passed / 5 skipped**)_
- [x] P1-2 Changes Required round 8 — cursor-data-governance _(strict sessionTenantId!==tenantId; managed storePath canonical-only; bypass regressions; **204 passed / 5 skipped**)_
- [x] **P1-2 Phase C Accepted** (`1596cb15af` / `5779ffb1e4`) — cursor-data-governance / codex-data-governance _(204 passed / 5 skipped; ownership-path tsgo zero)_

## P2 (unlocked — Lifecycle Command)

- [x] P2 execution instruction issued (`.kiro/specs/data-governance-v2-p2/`) — cursor-data-governance
- [x] P2 Gate Round 2 package (H2+D1, CA-first, CAS API, deletion auth marker) — cursor-data-governance
- [ ] Lifecycle closure implementation — **locked until Codex Gate Round-2 Pass**

## Notes

- **P1-2 Accepted** 2026-08-12 (Round 8 tip `5779ffb1e4`). Phase C closed. P2 Lifecycle Command unlocked. — cursor-data-governance / codex-data-governance
- Loom session: `9c1e4b2a-7f03-4d8e-9a11-6b2d0f8e3c17`. — cursor-data-governance
- Regression (Accepted): directed suite **204 passed / 5 skipped**; ownership-path `tsgo` **OWNERSHIP_ZERO**. — cursor-data-governance
