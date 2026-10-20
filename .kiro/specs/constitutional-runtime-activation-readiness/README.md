# Constitutional runtime activation readiness — Checkpoint B (APPROVED, freeze cycle 2)

Task: `constitutional-runtime-activation-readiness`
Agent: `kiro-constitutional-activation` (Loom takeover from `network-9aeee1a3`)
Checkpoint: **B — APPROVED** (freeze cycle 2; Architecture, Security and Execution-chain `AGREE_SHADOW_WIRING`, conditions none, against the same cycle-2 digest; final acceptance `checkpoint-b-final-acceptance-cycle2.md`; PR #204 rebase-merged into main; landing record `checkpoint-b-landing-record-cycle2.md`)
Cycle-2 PR: #204 — **MERGED** 2026-09-29T06:36:09Z by rebase (merge SHA `364c2e8131dc1fccaa292c192a6c54b2dbbc90c5`); source branch `kiro-constitutional-activation/checkpoint-b-cycle2-revise` preserved at `ac004e12327e0ad90f73d0e32bee627667f1f33a`; design commits based on origin/main `e4576c9a6ffefd7a07d32f1bf1e638731d1aba2d`; origin/main `d36d1a035dc94edbaaef2e7ef376af3f6bc59fc3`, `b6f83ce98b9d0bbf69f1f3cf8be4fcd3567366a0`, `8bfecac4db4f9746fc9b2d085ed15ca970459fbf` and `b9c830ad214363b933e3eed478fe8b22f61aabf2` merged into the source branch before the rebase merge
Cycle-2 designHeadSha: `7a87dfdfcd0ff74e069a02df78faaa54f25a4cf9` (source branch; landed on main as `c11e904b84be7566d63077d4313a4c97002d5b3c`, same patch)
Cycle-2 registryCommitSha: `532e995a67c942fec41b790797b05303c747c2b4` (source branch; landed on main as `bc39e33a54c704398fdb735440fa2bb438e2e9ee`)
Cycle-2 Architecture-reviewed statusHeadSha: `3b1eec593ac8df871b8bf3ecf63e0ba8bd4b59e7` (cited by the cycle-2 Architecture receipt, the Architecture main-drift addendum and both review requests; landed on main as `cd721d4468bad0a9d8f84cb716021ba28fead549`)
Cycle-2 mergeCommitSha (first): `763780bb345dd4748e20f3eaa24125701430331e` (merges origin/main `d36d1a035dc94edbaaef2e7ef376af3f6bc59fc3`)
Cycle-2 architectureAcceptanceStatusCommitSha: `bd4634170fa61a7b65c8520899c15cef58276342` (records the cycle-2 Architecture receipt and the cycle-2 review requests)
Cycle-2 mergeCommitSha (second): `d2c6ce13140a3e72657df98b857c6c82bf6af01f` (merges origin/main `b6f83ce98b9d0bbf69f1f3cf8be4fcd3567366a0`)
Cycle-2 driftStatusCommitSha: `030c2e993d5a5d0dc106d9af42e2d015ced03034` (records the Architecture main-drift addendum)
Cycle-2 mergeCommitSha (third): `e2a5c0564317c40084b5ecb4f29b93a2c3aa970d` (merges origin/main `8bfecac4db4f9746fc9b2d085ed15ca970459fbf`)
Cycle-2 mergedMainStatusRefreshCommitSha: `b74f802c7a7add4e93ff24774a293ae361ee89f6` (refreshes the merged-main status)
Cycle-2 finalReceiptStatusCommitSha: `dbc7cc519e9f29843de2bf5e865d1704860c7ddb` (landed on main as `364c2e8131dc1fccaa292c192a6c54b2dbbc90c5`)
Cycle-2 mergeCommitSha (fourth): `ac004e12327e0ad90f73d0e32bee627667f1f33a` (merges origin/main `b9c830ad214363b933e3eed478fe8b22f61aabf2` under the pre-authorized rule; source head at merge)
Cycle-2 statusHeadSha (current): `derived-from-git-head` (the post-merge closeout commit; its actual SHA is recorded in the closeout PR, not in this file)
architectureOriginalReviewedMainSha: `e4576c9a6ffefd7a07d32f1bf1e638731d1aba2d` (origin/main at the cycle-2 Architecture review)
architectureUpdatedReviewedMainSha: `b6f83ce98b9d0bbf69f1f3cf8be4fcd3567366a0` (reviewed main of the Architecture main-drift addendum; Security and Execution-chain review against it)
latestMergedMainSha: `8bfecac4db4f9746fc9b2d085ed15ca970459fbf` (origin/main merged by the third merge; `b6f83ce98..8bfecac4d` contains no reviewed-path change)
mainDrift.resolvePromptWording (cycle 2): reviewedRange `e4576c9a6..b6f83ce98`; file `src/agents/execution-preflight/resolve.ts`; classification `NON_IMPACTING`; architectureAddendumSha256 `97ec470c53281d590457b740796a7a45e162cec2998caa7531256ec784bee73e` (`reviews/architecture-main-drift-addendum-cycle2.md`; architectureDecision `AGREE_SHADOW_WIRING`; conditions none)
mainDrift.laterMainDrift (cycle 2): range `b6f83ce98..8bfecac4d`; reviewedPathsChanged `false`
checkpointBFreezeCycle: `2`
combinedDesignDigest (cycle 2): `08a12fe9ce6352ff161d22f01c026b516069b6bf7169be37bb2a68115763ce21`
Cycle-2 Architecture receipt: `reviews/architecture-review-checkpoint-b-cycle2.md` (SHA-256 `6ff86b774f77a11361e5d318eaaefce7b12bbf0f18e6cd6689a9e83363d66ec1`)
Cycle-2 Security receipt: `reviews/security-review-checkpoint-b-cycle2.md` (SHA-256 `ced8906517a1c397444ac54721a1d89c67efb2eb8edcd3639e4d7df48ca5904f`; formatting-only / no-semantic-change confirmed by the reviewer)
Cycle-2 Execution-chain receipt: `reviews/execution-chain-review-checkpoint-b-cycle2.md` (SHA-256 `b6530fc25addfb0047419d41a525b89421ff582d0576e08f760a3cf7002765c2`; formatting-only / no-semantic-change confirmed by the reviewer)
Cycle-2 final acceptance: `checkpoint-b-final-acceptance-cycle2.md` (SHA-256 `5ff47d139ae7d04831c3859eafb7a643c5fc2303c39ddfecd5b1fe36e1b012fd`; landed as `d6d13ffc8c0285ebaa31fbe496e1a98e1be8ff968f1b30fa548c02eeddc68ed9`)
Cycle-2 landing record: `checkpoint-b-landing-record-cycle2.md` (SHA-256 `6f13dc79bfad85a6a66d3c9825995b9a10338684488ec2135f88d77e6f94e604`)
postMergeMainSha: `52b8bba1087b087b03eca1ad9558a49664735c64`; postMergeReviewedPathDrift: `false`
Cycle-1 PR: #183 — superseded and closed; branch `network-9aeee1a3/constitutional-runtime-shadow-wiring-design-revise` preserved at `ff5ca33bd8e9b570f81d8a56cd2a4ba186ba4dc0`
Superseded digest (cycle 1): `ebdc3bff1c7e417b1c87397ce319cae9088c18c302147e51c53c6f63034bc987` (reason: Security and Execution-chain REVISE)
Verification baseline: origin/main `fdfec5d2b36448c55e514e58b08fb647235836c9` (re-verified at `e4576c9a6ffefd7a07d32f1bf1e638731d1aba2d`, `d36d1a035dc94edbaaef2e7ef376af3f6bc59fc3`, `b6f83ce98b9d0bbf69f1f3cf8be4fcd3567366a0` and `8bfecac4db4f9746fc9b2d085ed15ca970459fbf`; the only reviewed-path change up to `8bfecac4db4f9746fc9b2d085ed15ca970459fbf` is the Architecture-adjudicated binding-prompt wording change in `src/agents/execution-preflight/resolve.ts`)
Design merge on trunk: `677a7aa1f1b0f4c00bde4dce6d2d823a58f26715` (#181)

## Claim ceiling (authoritative)

| Claim                                 | Value                                                                                                                                                                                                                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkpoint B                          | **APPROVED**; PR #204 **MERGED** (rebase, merge SHA `364c2e8131dc1fccaa292c192a6c54b2dbbc90c5`); landing record `checkpoint-b-landing-record-cycle2.md`                                                                                                                           |
| Cycle-1 Architecture                  | `AGREE_SHADOW_WIRING` (superseded digest; no carryover)                                                                                                                                                                                                                           |
| Cycle-1 Security                      | **REVISE**                                                                                                                                                                                                                                                                        |
| Cycle-1 Execution-chain               | **REVISE**                                                                                                                                                                                                                                                                        |
| Cycle-2 Architecture                  | `AGREE_SHADOW_WIRING` (conditions none; receipt SHA-256 `6ff86b774f77a11361e5d318eaaefce7b12bbf0f18e6cd6689a9e83363d66ec1`)                                                                                                                                                       |
| Cycle-2 main drift                    | `NON_IMPACTING` (`execution-preflight/resolve.ts` binding-prompt wording only; Architecture `AGREE_SHADOW_WIRING`, conditions none; addendum SHA-256 `97ec470c53281d590457b740796a7a45e162cec2998caa7531256ec784bee73e`); `b6f83ce98..8bfecac4d` contains no reviewed-path change |
| Cycle-2 Security                      | `AGREE_SHADOW_WIRING` (conditions none; receipt SHA-256 `ced8906517a1c397444ac54721a1d89c67efb2eb8edcd3639e4d7df48ca5904f`)                                                                                                                                                       |
| Cycle-2 Execution-chain               | `AGREE_SHADOW_WIRING` (conditions none; receipt SHA-256 `b6530fc25addfb0047419d41a525b89421ff582d0576e08f760a3cf7002765c2`)                                                                                                                                                       |
| `checkpointCImplementationAuthorized` | `true` (allows creation of a new default-off implementation task only; see Authorization boundary)                                                                                                                                                                                |
| `runtimeEnabled`                      | `false`                                                                                                                                                                                                                                                                           |
| `productionProven`                    | `unknown`                                                                                                                                                                                                                                                                         |
| Code posture                          | `code-present`, `default-off`, `not-wired`, `not-runtime-enabled`                                                                                                                                                                                                                 |
| Checkpoint B scope                    | **design only** (no wiring, no flag enable, no deploy); Checkpoint C not started                                                                                                                                                                                                  |

See `checkpoint-b-review-status.md` (authoritative for review state) and `checkpoint-b-design-digest.md` (freeze and digest). The cycle-1 Architecture receipt is not reused for the cycle-2 digest.

This checkpoint does **not** modify `src/**` or `packages/**`, does **not** enable flags, does **not** wire Constitutional into gateway / preflight / ConversationTask, and does **not** deploy.

## Decision snapshot

- **Selected:** Candidate A — execution-preflight post-decision observe (`observePreflightRuntimeFacade`).
- **Rejected:** Candidate B — orchestration post-dispatch observe (higher mutation adjacency / flag confusion; see `design-decision.md`).
- **Proposed flag (design only):** `OPENBOT_CONSTITUTIONAL_RUNTIME_SHADOW` (default off; ≠ SELECT/EXECUTE/PATH_GAP/ORCH/CTR).
- **First slice:** fully **synchronous**; production default sink = module-level **`NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK`**; `run.ts` reads the one flag once per run and passes frozen `{ runtimeShadowEnabled, sink, now }` via the required `EmbeddedRunAttemptParams.constitutionalRuntimeShadowDeps`.

## Cycle-1 outcomes and cycle-2 closure

| Reviewer (cycle 1) | Outcome                                   | Cycle-2 closure                                                                                                                                                                                               |
| ------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture       | `AGREE_SHADOW_WIRING` (superseded digest) | Re-reviewed on the cycle-2 digest: `AGREE_SHADOW_WIRING`, conditions none                                                                                                                                     |
| Security           | **REVISE**                                | S1 minimal boolean deps (no env object/copy/map); S2 `safeRecord` / `safeRecordError` double-fault containment; S3 `profileCategory: "unspecified"`. Cycle-2 Security: `AGREE_SHADOW_WIRING`, conditions none |
| Execution-chain    | **REVISE**                                | Both direct-caller test files added to exact-path scope with explicit deps; required field; direct-caller allowlist lock (B-36, B-37). Cycle-2 Execution-chain: `AGREE_SHADOW_WIRING`, conditions none        |

## Checkpoint B deliverables

| File                                      | Role                                                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `checkpoint-b-design-digest.md`           | Cycle-2 per-file SHA-256 + combined digest; cycle-1 superseded audit record                                                                                                                      |
| `checkpoint-b-review-status.md`           | Claim ceiling, cycle-1 / cycle-2 PR and SHA mapping, receipts, closure map (authoritative for review state)                                                                                      |
| `checkpoint-b-final-acceptance-cycle2.md` | Cycle-2 tripartite final acceptance: Checkpoint B APPROVED; Checkpoint C authorization boundary                                                                                                  |
| `checkpoint-b-landing-record-cycle2.md`   | Post-merge landing record: rebase mapping, merge SHA, post-merge main, Checkpoint C start conditions                                                                                             |
| `requirements.md`                         | Invariants R1–R17, functional F1–F14 (**frozen, cycle 2**)                                                                                                                                       |
| `design.md`                               | Architecture sketch (**frozen, cycle 2**)                                                                                                                                                        |
| `tasks.md`                                | B APPROVED and merged; C authorized as a new default-off task only (not started)                                                                                                                 |
| `shadow-wiring-scope.md`                  | Exact future file paths + direct-caller allowlist (**frozen, cycle 2**)                                                                                                                          |
| `candidate-comparison.md`                 | A vs B matrix (**frozen**, byte-identical to cycle 1)                                                                                                                                            |
| `design-decision.md`                      | Select A; eliminate B; cycle-2 binding (**frozen, cycle 2**)                                                                                                                                     |
| `data-minimization-contract.md`           | Whitelist / ban list / deps minimization (**frozen, cycle 2**)                                                                                                                                   |
| `failure-mode-analysis.md`                | FM1–FM19 incl. sink double faults (**frozen, cycle 2**)                                                                                                                                          |
| `threat-model.md`                         | T1–T16, trust boundary (**frozen, cycle 2**)                                                                                                                                                     |
| `observability-contract.md`               | Metrics / labels / failure behavior (**frozen, cycle 2**)                                                                                                                                        |
| `rollback-plan.md`                        | Flag off OR single-commit revert (**frozen, cycle 2**)                                                                                                                                           |
| `test-plan.md`                            | **39** planned cases B-01..B-39, minimum 37 (**frozen, cycle 2**)                                                                                                                                |
| `reviews/`                                | Receipts (cycle 1 retained and superseded by cycle 2; cycle-2 Architecture with its main-drift addendum, Security and Execution-chain) and the fulfilled cycle-2 review requests (kept verbatim) |

## Design freeze

The 11 core design files are frozen as cycle 2 at `designHeadSha` `7a87dfdfcd0ff74e069a02df78faaa54f25a4cf9` with combined digest `08a12fe9ce6352ff161d22f01c026b516069b6bf7169be37bb2a68115763ce21`. **Any byte change to those 11 files invalidates cycle-2 receipts.** The cycle-1 digest `ebdc3bff1c7e417b1c87397ce319cae9088c18c302147e51c53c6f63034bc987` is superseded and kept as an audit record. Status-only files (this README, baseline, review-status, tasks, digest, final acceptance, landing record, reviews) may update.

## Authorization boundary

- Cycle 1: Architecture `AGREE_SHADOW_WIRING` on the superseded digest; Security `REVISE`; Execution-chain `REVISE`.
- Cycle 2: Architecture, Security and Execution-chain `AGREE_SHADOW_WIRING`, conditions none, against the same digest `08a12fe9ce6352ff161d22f01c026b516069b6bf7169be37bb2a68115763ce21`. Architecture adjudicated the main drift to `b6f83ce98b9d0bbf69f1f3cf8be4fcd3567366a0` as `NON_IMPACTING` (`reviews/architecture-main-drift-addendum-cycle2.md`); `b6f83ce98..8bfecac4d` contains no reviewed-path change. Checkpoint B is **APPROVED** (`checkpoint-b-final-acceptance-cycle2.md`). PR #204 was rebase-merged into main at 2026-09-29T06:36:09Z (`364c2e8131dc1fccaa292c192a6c54b2dbbc90c5`; `checkpoint-b-landing-record-cycle2.md`).
- `checkpointCImplementationAuthorized=true`: Checkpoint C authorization allows creation of a new default-off implementation task only. It does not authorize enabling the flag, production wiring, SELECT, EXECUTE, deployment, or a production-proven claim. `runtimeEnabled=false`; `productionProven=unknown`.
- PR #204 received the final remote acceptance and is merged; PR #183 stays closed. Checkpoint C starts only after this post-merge closeout lands on main, as the new task `constitutional-runtime-shadow-wiring-implementation` (new branch, new isolated worktree, new Loom task/session, latest origin/main, design-approved exact paths, default-off, tests B-01..B-39, no flag enablement, no deploy). Do **not** wire, enable flags, deploy, force-push, or claim production readiness.

## Loom

Task `constitutional-runtime-activation-readiness:network-9aeee1a3` (paths `.kiro/specs/constitutional-runtime-activation-readiness/**`) is owned by `kiro-constitutional-activation` (session `9b1b2751-e37e-49cc-b865-c567faba2e56`, IDE kiro). The original `network-9aeee1a3` session and history are preserved; `ownerHistory` records the takeover. The registry takeover landed separately as `532e995a67c942fec41b790797b05303c747c2b4` (`.loom/registry.yaml` only), committed by `kiro-constitutional-activation` as the explicitly authorized `kiro-loom` lander-proxy for that one diff.
