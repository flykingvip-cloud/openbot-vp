# Review package — Phase D governance ratification

assessedAt: 2026-09-27T10:31:00+08:00 (Asia/Shanghai)  
Material Owner / amanuensis: grok-bot (**not** authorizer)  
governance Owner: Thomas35 Joshua  
mainSha: `d8379ed919424c50d04c3be92cd2ef671f5e4580`  
setupTipWas: `618fc8eb2e16cd04910615085b2ce3a1fa0c5694` (advanced by unrelated PR #120 pptx-preview; constitutional paths untouched; re-verified)  
Owner Choice recorded: `SUPERSEDE_PHASE_C_BOUNDED` (Option A)  
Target independent verdict family (for real reviewers only): `AGREE_BOUNDED_RETENTION` with conditions none  
**Grok does not invent findings or verdicts.**

## Claim ceiling (FIXED — do not raise in this packet)

| Claim                 | Status                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------ |
| code-present          | YES (merged packages/facades exist on main)                                                |
| default-off           | YES (env snapshots unset=off; enforce/live/fabric hard false)                              |
| not-wired             | YES (0 outside-package callers of select/execute; observe facades not in hot-path barrels) |
| not-runtime-enabled   | YES (`runtimeEnabled: false`)                                                              |
| not-production-proven | YES (`productionProven: unknown`)                                                          |

## Prior audit citations (read-only)

- Report: `/workspace/phase-d-governance-reconciliation-report.md`
- Spec dir (DO NOT MODIFY): `/workspace/openbot-gov-recon/.kiro/specs/constitutional-phase-d-governance-reconciliation/**`
- Prior decision: **REVISE**
- Prior audit mainSha / branch HEAD: `618fc8eb2e16cd04910615085b2ce3a1fa0c5694`
- Prior loom session: `58cccc56-6524-4300-900e-36423544349a`

## 1. Phase C NO-GO + frozen digest

| Item                        | Value                                                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR                          | #26 MERGED                                                                                                                                                     |
| mergeSha                    | `4bc5566b95f551c71d86a8c70d92ea4df9f10519` (2026-09-24T13:06:51Z)                                                                                              |
| Decision                    | **NO-GO**                                                                                                                                                      |
| Independent acceptance      | **COMPLETE**                                                                                                                                                   |
| Architecture                | `codex-architecture` → `AGREE_NO_GO` (receipt sha256 `df95c2344e2cf6e8ebfed886526a2e3b84c6c5914c7ab0d0581b5a152cab84b9`)                                       |
| Security                    | `security-reviewer:profile-ab-tenant` → `AGREE_NO_GO` (receipt sha256 `6e8505ab22b394fa50407185e15229d9a3adf981f7e206fa2377a3181838aa39`)                      |
| Execution-chain             | `conversation-task-runtime:kiro-conversation-task-runtime` → `AGREE_NO_GO` (receipt sha256 `d6132d46d25eb427b13df8642edc43dabc8d9004acb86fd8153c6f6b7065a8d3`) |
| Combined digest             | `c5e527340f8d551e0569e62a956d6d615b241e92ebdee4e53d8320eae0c73a20`                                                                                             |
| Re-verified at ratification | **YES** (same for-loop \| shasum on this worktree)                                                                                                             |

Option A **limited supersede** touches only the Phase C freeze language that said to stop constitutional-contracts / Phase D engineering. Phase C NO-GO Decision, unique-benefit FAIL, and the three `AGREE_NO_GO` receipts remain in force.

## 2. Phase D PR list + merge SHAs (key)

| PR          | mergeSha                                                                                                                             | Note                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| #58         | `ba3dd5845e34d3dce74c8442cdb11bb7cc704a6d`                                                                                           | contracts first knife                              |
| #59         | `fe12f3ba3d696a960d195de619c758f035544e7e`                                                                                           | P8a no_valid_path                                  |
| #60         | `5a1b3f00492f72d1805e8edbc57c9a647f799e33`                                                                                           | runtime façade shadow                              |
| #62         | `2236d4807243a0253599cfea3a4b8beb7dbb9a3e`                                                                                           | Registry/Conformance/Runtime scaffolds             |
| #64/#65/#66 | `986ae103e3fa0ebdc447048e041cb8325cca0987` / `d3472e32d83969dd2dcb2709e7907aacbc46327c` / `1a762b1aba6a100e1820b06399ab33fc4476a3e0` | claim/sparse/Tier-D docs                           |
| #71 / #77   | `ad05d733f0b05d9f5f940145cb107041cb114640` / `7adf7999d3b63df43bf96f104a0d08437651b895`                                              | P8b scopes draft / parent accept                   |
| #74         | `f9254c7d08f5dde1881c9f67d4861dc7521f3cd3`                                                                                           | P8b Knife1 select-only                             |
| #78         | `8babbd4c90618d6502033f51dace6f32709f812b`                                                                                           | §9.2 D3 evidence                                   |
| #101        | `c9fdc09a3b1752186ae5aab79cef428eb25b6b8e`                                                                                           | Owner track (does not flip NO-GO)                  |
| #103/#104   | `4078ffd61a2e026115bf841ced2e3e167f9eac71` / `1bf1810c882c25ef0cf2e7a3662021736edbf0e6`                                              | Path-Gate report docs/code                         |
| #106/#107   | `687f94a7d0e980ca156fecad28bf73d4bc63f3e0` / `1ce3d77e655cd96f1dca87540fd3441e2a45d58d`                                              | Path-Gate diagnostics docs/code                    |
| #108/#111   | `bab68df9a7165d2d1bff43d260aa4f0b23e2b8d3` / `32672466c92a90fd99f72d7f26508a335f4f2b3d`                                              | P8b execute opt-in docs/code                       |
| #119        | `618fc8eb2e16cd04910615085b2ce3a1fa0c5694`                                                                                           | P8c compare docs-only; `shadowCompared` hard-false |

## 3. Package capabilities

| Package                               | Capability on tip                                                                                    | Deployable product? |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------- |
| `@openbot/constitutional-contracts`   | schemas, adapters, read-model, shadow eval, path-gap, runtime façade, legal-path select/execute stub | No (library)        |
| `@openbot/constitutional-registry`    | thin re-export of adapters/read-model                                                                | No                  |
| `@openbot/constitutional-conformance` | thin re-export of evaluator + path-gap                                                               | No                  |
| `@openbot/constitutional-runtime`     | thin re-export of `runRuntimeFacadeShadow`; “not a fifth execution story”                            | No                  |

## 4. Outside callers = 0

Re-verified at ratification (`rg` on `packages`/`src`/`extensions`, `*.ts`, excluding `packages/constitutional-contracts/`):

- `selectLegalPath` outside package: **0**
- `executeLegalPath` outside package: **0**

Inside package: select/execute used by own tests + `runtime-facade/shadow.ts` select bridge + exports from `src/index.ts`.

## 5. Hot-path

Observe facades exist but are **isolated**:

- `src/task-orchestration/constitutional-runtime-facade.ts` → `observeOrchestrationRuntimeFacade`
- `src/agents/execution-preflight/constitutional-runtime-facade.ts` → `observePreflightRuntimeFacade`

Prior audit + package tests assert they are **not** imported by `dispatch.ts` / `gateway-hook.ts` / preflight builder barrels. **Not on chat/tool/ACP/AOR hot-path.**

## 6. Execute reachability

**No production/hot-path execute.** `executeLegalPath` is package-local stub; with EXECUTE opt-in yields audit marker `package-local-execute-allowed` only; no gateway/tenant write; registry `executionAuthorized` stays false.

## 7. Flags (fail-closed)

| Name                                                        | Default                                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `OPENBOT_CONSTITUTIONAL_SHADOW`                             | unset = off (caller snapshot; package does not read process.env for production wiring) |
| `OPENBOT_CONSTITUTIONAL_PATH_GAP_REPORT`                    | unset = off                                                                            |
| `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT`                  | unset = off                                                                            |
| `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_EXECUTE`                 | unset = off                                                                            |
| `CONSTITUTIONAL_CONTRACTS_ENFORCE`                          | hard `false`                                                                           |
| `CONSTITUTIONAL_CONTRACTS_LIVE_INVOKE`                      | hard `false`                                                                           |
| `CONSTITUTIONAL_CONTRACTS_FABRIC_DEFAULT_ON`                | hard `false`                                                                           |
| `ORCHESTRATION_LIVE_INVOKE`                                 | hard `false` (distinct orch types)                                                     |
| `OPENBOT_CONVERSATION_TASK_ORCH_SHADOW` / `WEB_READ_SHADOW` | distinct; unset = off                                                                  |

P8c docs mention future `OPENBOT_CONSTITUTIONAL_SHADOW_COMPARE`; **not implemented** (`shadowCompared` hard-false).

## 8. Profile A/B

Preserved: schemas `personal_local` / `managed_enterprise` / `unspecified`; knife docs forbid merge; non-equivalence flags hold.

## 9. FSM / authority

**No new global hot-path FSM.** Façade explicitly not a fifth execution story. Residual risk = future wiring without new auth (banned by Option A / scope-freeze).

## 10. Tests (prior audit + this ratification re-run)

Prior reconciliation: `pnpm --filter constitutional-contracts test` → **37/37 PASS**; build PASS.  
This ratification re-runs the same filters; see `gate-evidence.md`.

## 11. Production gap

- `productionProven`: **unknown**
- `productionEvidenceSource`: **unavailable** (no container/live probe)
- Repo `deploy/production/releases.jsonl` historical tip is **non-baseline only**

## 12. Authorization honesty

Standing process after Phase C (Owner track #101 + accept+start-order) is **not** equivalent to Architecture/Security/Execution-chain legitimization. Prior audit Decision **REVISE**. Owner now chose Option A limited supersede for **retention**; independent reviewers must still file real receipts before any `BOUNDED_RETENTION_APPROVED`.

## 13. What reviewers are asked to decide

Independent reviewers fill only their slot templates under `reviews/`:

- Architecture → `codex-architecture`
- Security → `security-reviewer:profile-ab-tenant`
- Execution-chain → `conversation-task-runtime:kiro-conversation-task-runtime`

Expected successful family (when earned): `AGREE_BOUNDED_RETENTION` with conditions none — **against claim ceiling above**, not GO / flag-enable / wiring.

## 14. Explicit non-claims

This package does **not** claim: Phase D GO, C10 pass, Gate tightened, runtime-enabled, production-proven, Fabric-on, Profile merge, or `BOUNDED_RETENTION_APPROVED`.
