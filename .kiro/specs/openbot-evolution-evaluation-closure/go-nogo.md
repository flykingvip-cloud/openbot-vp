# Track B Go / No-Go — Evolution Evaluation Closure

Date: 2026-09-22
Baseline: `origin/main` `f1c2669353487da23b49f4b9c8b3671b5c510600`
A4 consumed: `#1217` `b20c28825cd98f3f2fb4a5cb639c1f996a42ba46`
A4 close consumed: `#1222` `7c1a196320674b9d7311645960f93a44d3915389`
Author: cursor-grok

## Verdict

| Question                                                            | Verdict                                           |
| ------------------------------------------------------------------- | ------------------------------------------------- |
| First-period evaluation loop for Working DNA and Skill Installation | **Go** — C4 live Recheck on A4 port               |
| System evolution is fully single-track                              | **No-Go**                                         |
| Default assist / no auto expansion                                  | **Go**                                            |
| Production cutover of runtime auto / skill auto                     | **No-Go** (needs a later, separately approved PR) |

Do **not** announce “系统进化评价闭环完成”. Track A being done also does not close this. The remaining hole is historical auto still mutating beside the control plane.

## Landed on `origin/main`

| Slice                                                 | PR    | SHA                                         |
| ----------------------------------------------------- | ----- | ------------------------------------------- |
| E0 evaluation contracts                               | #1203 | `3a01fe0963`                                |
| Track A producer freeze / A1 DTO                      | #1204 | `83bb072cb7` (producer freeze `a4368cfade`) |
| E1 + Skill Installation WAL ingest                    | #1206 | `28ff3afef3`                                |
| E2 / E3-eval / E4 EvaluationPolicy + authorityRecheck | #1207 | `1e3358e241`                                |
| E5 shadow (not cutover)                               | #1209 | `8c3b5e5508`                                |
| A4 DiagnosisRecheckPort (Track A)                     | #1217 | `b20c28825c`                                |
| A4 close / live SoT + P26 No-Go                       | #1222 | `7c1a196320`                                |

Rejected preview SHAs `c7d7aa54f2` and `bb97b44ce6` remain unconsumed.

## Completion checklist from the original brief

| Condition                                                        | Status                                                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Proposal/Candidate submit recoverable and idempotent             | **Go** — `submitDiagnosisCandidate` WAL                                                                             |
| Apply has grant, experiment, and a frozen baseline               | **Go** on diagnosis-origin Working DNA / Skill Installation via control plane                                       |
| Domain SoT proves the change happened                            | **Go** — read-after-write verifiers + authorityRecheck                                                              |
| Diagnosis Recheck proves the original finding improved           | **Go** — live A4 port + B observer; VERIFIED without SoT change stays HOLD                                          |
| Primary + guardrail metrics together                             | **Go** — no global three-vote score                                                                                 |
| Insufficient samples are not success                             | **Go** — INCONCLUSIVE / BLOCKED, never “no regression”                                                              |
| Promote/Hold/Rollback replay from Ledger                         | **Go** — `recheckAuthorityFromLedger`                                                                               |
| Old runtime auto / skill auto no longer bypass the control plane | **No-Go** — live tick still calls `applyGovernanceRuntimeAction`; skill-auto still calls `installSkillToRobotAsset` |
| Default assist; surface auto still needs its own approval        | **Go** — `autoApply=false`; assist mutates nothing                                                                  |

## What E5 shadow proved

Shadow rows under `evolution-governance/control-plane-application-shadow.jsonl`:

- match the live mutation target
- `scope: shadow`, `appliedToRuntime: false`, `cutoverReady: false`
- do not register a Proposal, start an Experiment, or Apply

Assist and kill switch still write no executed shadow and no runtime mutation.

## What a later cutover PR must do (not this report)

1. Tick generates/consumes control-plane Proposal → Experiment → Application only.
2. Skill-auto only applies an already-approved control-plane Application.
3. Keep kill switch, `autoInstallIntent`, approval audit, compare-and-restore.
4. Assist remains zero mutation.
5. Do not flip `autoApply` or widen production auto.

Until that PR is separately approved and landed, single-track evolution stays **No-Go**.

## C4 residual (not E5)

A4's port treats `observedHash === baselineHash` as `STILL_OPEN` (`sot_unchanged`).
A rollback that restores the exact baseline therefore HOLDs via Recheck, not REGRESS.
`REGRESSED` needs a third live hash. B documents this; B does not rewrite A's port.

`#1222` is consumed from `origin/main`. Baseline-exact rollback stays STILL_OPEN → HOLD. E5 single-track remains **No-Go**.

## C4 regression classification

| Suite                                                         | Result                                                              | Owner | Disposition                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------ |
| `diagnosis-recheck-observer` + `diagnosis-recheck-closure.c4` | **pass**                                                            | B     | Live A4 port + WDNA/Skill observer + EvaluationPolicy + Ledger replay                      |
| `working-dna-evaluation` / `skill-installation-evaluation`    | **pass**                                                            | B     | Promote requires Recheck RESOLVED                                                          |
| `packages/evolution-core` test + typecheck                    | **pass**                                                            | B     |                                                                                            |
| WDNA / Skill / Org / Runtime live-loops                       | **pass** after aligning experiment `now` after last baseline sample | B     | Window semantics were fail-closed; fixtures now match current SoT                          |
| `missing-production-sensors.contract`                         | **pass**                                                            | B     | Missing owner-skill sensors still block canary                                             |
| `evolution-grant` platform issuer trusted remap               | **pass**                                                            | B     | B remaps platform issuer to `{ tenantId: null }`. Does not rewrite A's delegation machine. |
| `production-p26.1` / `production-p26.2`                       | **pass** after `#1222`                                              | A     | Historical No-Go fixtures stay false. Do not relax to Production Ready.                    |
| `src/gateway/evolution-control` full suite                    | **304/304 pass**                                                    | B     | C4.1 after `#1222` rebase + grant remap                                                    |
| `src/diagnosis`                                               | **81 files / 521 tests pass**                                       | A/B   | P26 stay historical No-Go                                                                  |
| `packages/evolution-core` test + typecheck                    | **pass**                                                            | B     |                                                                                            |
| `pnpm tsgo` / `pnpm format` / `git diff --check`              | **pass**                                                            | B     |                                                                                            |
| `pnpm check` `lint:core:composition-root-loc`                 | **pre-existing**                                                    | UI    | `ui/src/ui/app.ts` 4557 > budget 4347 on `origin/main`; C4.1 does not touch UI             |

## EvaluationPolicy / Ledger replay

Diagnosis-origin Promote still requires experiment improved + sample + confidence + guardrails + Authority Gate + domain verified + rollback drill + Recheck=`RESOLVED`.
STILL_OPEN→HOLD, REGRESSED→ROLLBACK, INCONCLUSIVE→OBSERVE, BLOCKED→BLOCK.
Operator-origin does not require Recheck.
C4 closure test replays Ledger after Promote.

## E5 single-track residual (unchanged)

- Live tick still calls `applyGovernanceRuntimeAction`.
- Skill-auto still calls `installSkillToRobotAsset`.
- Assist remains zero mutation. Auto stays closed. No production cutover in C4.

## E5.1 cutover readiness (not a switch)

Baseline `22feb4c71f` contains `#1223` `89eef8c698` and A5 `#1224`. Named A5.1 squash: **none**.

`evaluateControlPlaneApplicationConsumption` calls `evaluateSurfaceAutonomy` and checks grant actions, Proposal/Experiment expiry, and the Candidate Store payload. A caller boolean cannot approve autonomy. Registered surfaces stay `autonomy_not_approved`. Readiness counts every deny reason; `e52SwitchAllowed` stays false. The shadow does not execute. Live `readSingleTrackCutoverReadiness` keeps `cutoverReady=false`.

E5.2 remains **No-Go** until a separately approved PR switches the direct mutators, and only after `e52SwitchAllowed` is true. E5.1 does not complete single-track evolution.

## E5.1.2 shadow evidence and C5 joint matrix

Corrupt, truncated, unsupported-schema, and failed shadow writes set `observationStoreHealthy=false` and `cutoverReady=false`. An empty window or any unresolved denial is also No-Go. A shadow row is not a kill-switch or rollback drill receipt. `executedConsumer` stays false. The live reader passes `directMutatorsRetired=false`, so `e52SwitchAllowed` stays false while direct mutators remain.

C5 (`c5-joint-matrix.md`): A supplies `DiagnosisRecheckResult`; B `decideEvaluationOutcome` returns Promote / Hold / Rollback / Observe / Block. B does not call Adapter Apply. This joint check does not declare the system single-track.

## E5.1.3 persisted shadow store health

Write failure, read failure, corrupt lines, truncation, and unsupported schema are latched on disk. Gateway restart does not clear that latch. A readiness read that throws returns `cutoverReady=false` and `e52SwitchAllowed=false`. Direct mutators stay in place.

## E5.1.4 fail-closed health ledger

The durable fact is the append-only hash chain `evolution-shadow-ledger/events.jsonl`. `control-plane-application-consumption.health.json` is a mirror. If the mirror cannot be written, the chain records the fault with `mirrorPersisted=false`. Clearing process memory does not restore `observationStoreHealthy`. A missing, corrupt, deleted, or hash-tampered ledger stays No-Go.

`recoverPersistedShadowStoreHealth` does not accept client `audited` or `observationWindowRevalidated` values. The server verifies the admin, writes its own recovery event, and accepts the window only when the shadow schema is current, the window is non-empty and intact, no denial is unresolved, and `executedConsumer` is false. A failed recovery leaves the previous latch in place. `directMutatorsRetired=false` forces `e52SwitchAllowed=false`.

E5.1.4 is not E5.2. Live tick still calls `applyGovernanceRuntimeAction`. Skill-auto still calls `installSkillToRobotAsset`. No direct mutator is switched.

## E5.1.5 A9 M1 observation

Fresh `origin/main` is `b88a67a116` (`#1233`). It already contains `#1230` `313b58661b` and the `#1232` squash `6fe49507d9`. E5.1.5 starts from that tip. Delivery files from `#1230` are unchanged. The hash chain and health mirror stay the durable health design.

`observeA9M1Shadow` records a server-matched Proposal, Experiment, and Application binding into the existing shadow store. The readiness report exposes the observation window, denial counts, and health chain. `directMutatorsRetired` stays false. An A9 M1 event that carries `cutoverReady`, drill flags, `executedConsumer`, or `directMutatorsRetired` is still not an E5.2 cutover receipt.

Shadow corruption, an empty window, an unresolved denial, a missing health chain, or a live direct mutator each force `cutoverReady=false` and `e52SwitchAllowed=false`. `executedConsumer` stays false. `recoverPersistedShadowStoreHealth` accepts only an admin object issued by `resolveServerAdmin`. A client boolean or a raw admin id does not clear the latch.

E5.1.5 is not E5.2. See `a9-joint-matrix.md`. The system is not fully single-track.

## C6 M1 evidence audit

Fresh `origin/main` is `516c4ba34f` (#1236). It contains `470bf68e82` (#1235) and the A10 001 M1 closure. C6 reads that replay: tenant `001`, proposal `evo:diag:8bee2c37b1f39478`, experiment `exp:cmd-a9-exp-down`, active application `app:cmd-a9-active-up`, verification `ver:cmd-a9-verify-ok`, recheck `STILL_OPEN`. Tenant, target, surface, candidate, commandId, and the observation window are checked before a decision.

`projectC6M1Status` keeps `applicationVerified`, `recheckOutcome`, `evaluationDecision`, `promotionEligible`, and `promotionCompleted` as separate fields. VERIFIED plus RESOLVED can enter the promote gate. STILL_OPEN holds, REGRESSED rolls back, INCONCLUSIVE observes, and a missing recheck fail-closes. `已完成进化` appears only when the ledger already contains `promotion.completed`. The A10 replay does not, so the visible status stays `已验证，进化未完成`.

A9/M1 stays a shadow observation. `executedConsumer` stays false. `directMutatorsRetired=false` keeps `e52SwitchAllowed=false`. An empty window, a damaged chain, an unresolved denial, or forged cutover fields stay No-Go. A manual `application.applied` is not a runtime or skill-auto cutover.

C6 is not E5.2. See `c6-joint-matrix.md`.

## C6.1 promotion event binding

`promotionCompleted` no longer treats a list of event type strings as completion. The ledger fact must be one structured `promotion.completed` event bound to the current tenant, Proposal, Experiment, Application, Verification, target, surface, and candidate. The Application must not be `rolled_back` or `failed`. Recheck must be `RESOLVED`, EvaluationPolicy must return `promote`, `authorityOk` must be true, and `guardrailDegraded` must be false. Another proposal's event is ignored. A repeated or conflicting event for this proposal fail-closes. The visible sentence `已完成进化` appears only for that full match.

C6.1 does not edit Track A Apply, Verification, or Recheck. Shadow flags stay closed. C6.1 is not E5.2. See `c6.1-joint-matrix.md`.

## C7 completion contract

`decideEvolutionCompletion` is the only completion judge. `projectDiagnosisM1Closure` and `projectC6M1Status` both call it. The previous C6 completion formula is gone. An Application must be `applied`. The promotion event must be unique, bound to the whole object chain, and later than Verification and Recheck. `authorityOk` must be true and `guardrailDegraded` must be false. Anything conflicting, duplicated, mis-bound, or missing fail-closes. The judge does not Promote, Apply, or Rollback.

`executedConsumer` stays false. `directMutatorsRetired` stays false, so `e52SwitchAllowed` stays false. C7 is not E5.2. The system is not single-track. See `c7-completion-contract.md`.

## C8 ledger evidence

The completion judge reads a server ledger query. Proposal, Experiment, Application, Verification, Recheck, and `promotion.completed` come from that query. A caller-supplied promotion event is rejected before the ledger is read. The real A10 snapshot still has only `verification.completed` for `app:cmd-a9-active-up`, so both projections say `已验证，进化未完成`. A labeled closed loop in the same fixture completes only for its own application. Cross-tenant, cross-proposal, and cross-application events stay outside the query. A fresh file read returns the same decision.

`executedConsumer` stays false. `directMutatorsRetired` stays false. `e52SwitchAllowed` stays false. `singleTrack` stays false. C8 is not E5.2. See `c8-consistency-report.md`.
