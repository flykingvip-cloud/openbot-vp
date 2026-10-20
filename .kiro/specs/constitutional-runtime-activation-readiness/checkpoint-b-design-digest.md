# Checkpoint B — Design package freeze digest

Task: `constitutional-runtime-activation-readiness`
Agent: `kiro-constitutional-activation` (Loom takeover from `network-9aeee1a3`)
Checkpoint: **B — design freeze cycle 2** (docs only; no Checkpoint C)

## Current freeze — cycle 2

| Field                                 | Value                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| checkpointBFreezeCycle                | `2`                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| combinedDesignDigest                  | `08a12fe9ce6352ff161d22f01c026b516069b6bf7169be37bb2a68115763ce21`                                                                                                                                                                                                                                                                                                                                                                         |
| frozen-at                             | `2026-09-28T20:05:00+08:00` (Asia/Shanghai)                                                                                                                                                                                                                                                                                                                                                                                                |
| PR                                    | #204 — **MERGED** 2026-09-29T06:36:09Z (rebase; merge SHA `364c2e8131dc1fccaa292c192a6c54b2dbbc90c5`); source branch `kiro-constitutional-activation/checkpoint-b-cycle2-revise` preserved at `ac004e12327e0ad90f73d0e32bee627667f1f33a`                                                                                                                                                                                                   |
| designHeadSha                         | `7a87dfdfcd0ff74e069a02df78faaa54f25a4cf9` (last commit that changes the 11 frozen files); landed on main as `c11e904b84be7566d63077d4313a4c97002d5b3c` (same patch, same bytes)                                                                                                                                                                                                                                                           |
| registryCommitSha                     | `532e995a67c942fec41b790797b05303c747c2b4` (Loom takeover; changes only `.loom/registry.yaml`)                                                                                                                                                                                                                                                                                                                                             |
| statusHeadSha (Architecture-reviewed) | `3b1eec593ac8df871b8bf3ecf63e0ba8bd4b59e7` (status-metadata commit; cited by the cycle-2 Architecture receipt, the Architecture main-drift addendum and both review requests)                                                                                                                                                                                                                                                              |
| statusHeadSha (current)               | `derived-from-git-head` — the post-merge closeout commit; the PR #204 final receipt/status commit `dbc7cc519e9f29843de2bf5e865d1704860c7ddb` landed as `364c2e8131dc1fccaa292c192a6c54b2dbbc90c5`                                                                                                                                                                                                                                          |
| Verification baseline (origin/main)   | `fdfec5d2b36448c55e514e58b08fb647235836c9`; re-verified at `e4576c9a6ffefd7a07d32f1bf1e638731d1aba2d`, `d36d1a035dc94edbaaef2e7ef376af3f6bc59fc3`, `b6f83ce98b9d0bbf69f1f3cf8be4fcd3567366a0` and `8bfecac4db4f9746fc9b2d085ed15ca970459fbf` (the only reviewed-path change up to `8bfecac4db4f9746fc9b2d085ed15ca970459fbf` is the Architecture-adjudicated binding-prompt wording change in `src/agents/execution-preflight/resolve.ts`) |
| Branch base                           | design commits on origin/main `e4576c9a6ffefd7a07d32f1bf1e638731d1aba2d`; origin/main `d36d1a035dc94edbaaef2e7ef376af3f6bc59fc3` merged by `763780bb345dd4748e20f3eaa24125701430331e`, origin/main `b6f83ce98b9d0bbf69f1f3cf8be4fcd3567366a0` merged by `d2c6ce13140a3e72657df98b857c6c82bf6af01f` and origin/main `8bfecac4db4f9746fc9b2d085ed15ca970459fbf` merged by `e2a5c0564317c40084b5ecb4f29b93a2c3aa970d` (merges, no rewrite)    |
| Reviewed main (cycle 2)               | architectureOriginalReviewedMainSha `e4576c9a6ffefd7a07d32f1bf1e638731d1aba2d`; architectureUpdatedReviewedMainSha `b6f83ce98b9d0bbf69f1f3cf8be4fcd3567366a0`                                                                                                                                                                                                                                                                              |
| Latest merged main (cycle 2)          | latestMergedMainSha `8bfecac4db4f9746fc9b2d085ed15ca970459fbf` (`b6f83ce98..8bfecac4d` contains no reviewed-path change)                                                                                                                                                                                                                                                                                                                   |
| Reason for cycle 2                    | Close cycle-1 Security REVISE (S1, S2, S3) and Execution-chain REVISE (direct caller scope)                                                                                                                                                                                                                                                                                                                                                |
| Architecture (cycle 2)                | `AGREE_SHADOW_WIRING` (conditions none)                                                                                                                                                                                                                                                                                                                                                                                                    |
| Architecture receipt (cycle 2)        | `reviews/architecture-review-checkpoint-b-cycle2.md` — SHA-256 `6ff86b774f77a11361e5d318eaaefce7b12bbf0f18e6cd6689a9e83363d66ec1`                                                                                                                                                                                                                                                                                                          |
| Main drift (cycle 2)                  | resolvePromptWording (`e4576c9a6..b6f83ce98`): `src/agents/execution-preflight/resolve.ts` — `NON_IMPACTING`; Architecture `AGREE_SHADOW_WIRING`, conditions none; addendum `reviews/architecture-main-drift-addendum-cycle2.md` — SHA-256 `97ec470c53281d590457b740796a7a45e162cec2998caa7531256ec784bee73e`. laterMainDrift (`b6f83ce98..8bfecac4d`): reviewedPathsChanged `false`                                                       |
| Security (cycle 2)                    | `AGREE_SHADOW_WIRING` (conditions none)                                                                                                                                                                                                                                                                                                                                                                                                    |
| Security receipt (cycle 2)            | `reviews/security-review-checkpoint-b-cycle2.md` — SHA-256 `ced8906517a1c397444ac54721a1d89c67efb2eb8edcd3639e4d7df48ca5904f`                                                                                                                                                                                                                                                                                                              |
| Execution-chain (cycle 2)             | `AGREE_SHADOW_WIRING` (conditions none)                                                                                                                                                                                                                                                                                                                                                                                                    |
| Execution-chain receipt (cycle 2)     | `reviews/execution-chain-review-checkpoint-b-cycle2.md` — SHA-256 `b6530fc25addfb0047419d41a525b89421ff582d0576e08f760a3cf7002765c2`                                                                                                                                                                                                                                                                                                       |
| Checkpoint B                          | **APPROVED** — final acceptance `checkpoint-b-final-acceptance-cycle2.md` — SHA-256 `5ff47d139ae7d04831c3859eafb7a643c5fc2303c39ddfecd5b1fe36e1b012fd` (landed as `d6d13ffc8c0285ebaa31fbe496e1a98e1be8ff968f1b30fa548c02eeddc68ed9`)                                                                                                                                                                                                      |
| Landing (cycle 2)                     | `checkpoint-b-landing-record-cycle2.md` — SHA-256 `6f13dc79bfad85a6a66d3c9825995b9a10338684488ec2135f88d77e6f94e604`; landed design commit `c11e904b84be7566d63077d4313a4c97002d5b3c`; postMergeMainSha `52b8bba1087b087b03eca1ad9558a49664735c64`; postMergeReviewedPathDrift `false`                                                                                                                                                     |
| checkpointCImplementationAuthorized   | `true` (allows creation of a new default-off implementation task only)                                                                                                                                                                                                                                                                                                                                                                     |
| runtimeEnabled                        | `false`                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| productionProven                      | `unknown`                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Combined design digest algorithm (unchanged from cycle 1)

1. For each of the 11 frozen files, compute SHA-256 of the **file contents** as they exist at the cycle's design commit (`git show <designHeadSha>:path`). For cycle 2, `designHeadSha` is `7a87dfdfcd0ff74e069a02df78faaa54f25a4cf9`.
2. Emit one line per file in the form below (two ASCII spaces between hash and basename, matching `sha256sum` output):

   ```text
   <file-sha256>  <basename>\n
   ```

3. Sort those lines **lexicographically by basename** (`LC_ALL=C sort -k2`).
4. **combined SHA-256** = SHA-256 of that newline-terminated sorted listing.

## Freeze rule

The 11 files listed below **must not be modified** after this digest. Status / digest / README / baseline / tasks / review files are **not** part of the frozen set. Verify against any later head of PR #204:

```bash
git diff 7a87dfdfcd0ff74e069a02df78faaa54f25a4cf9..<HEAD> -- \
  .kiro/specs/constitutional-runtime-activation-readiness/requirements.md \
  .kiro/specs/constitutional-runtime-activation-readiness/design.md \
  .kiro/specs/constitutional-runtime-activation-readiness/candidate-comparison.md \
  .kiro/specs/constitutional-runtime-activation-readiness/shadow-wiring-scope.md \
  .kiro/specs/constitutional-runtime-activation-readiness/data-minimization-contract.md \
  .kiro/specs/constitutional-runtime-activation-readiness/failure-mode-analysis.md \
  .kiro/specs/constitutional-runtime-activation-readiness/threat-model.md \
  .kiro/specs/constitutional-runtime-activation-readiness/observability-contract.md \
  .kiro/specs/constitutional-runtime-activation-readiness/rollback-plan.md \
  .kiro/specs/constitutional-runtime-activation-readiness/test-plan.md \
  .kiro/specs/constitutional-runtime-activation-readiness/design-decision.md
```

Empty diff (or identical blob SHAs) is required.

## Per-file SHA-256 (cycle 2)

All paths are under `.kiro/specs/constitutional-runtime-activation-readiness/`.

| Basename                      | SHA-256                                                            | Changed vs cycle 1  |
| ----------------------------- | ------------------------------------------------------------------ | ------------------- |
| candidate-comparison.md       | `2cac0d199521ba14975c8116c9b8ecbb84942e616b093fec09e9e69b80cc9e14` | no (byte-identical) |
| data-minimization-contract.md | `bc58bcf2df0541174af84cf1092e32b2940bb3f912cafe8eb6bccda4e56c9ec7` | yes                 |
| design-decision.md            | `9525fb1f87b0f287ffc5eb93a50537746005be7d6f4eb88d7fab66d3013a9b06` | yes                 |
| design.md                     | `71e34a004a6357ef18f04041b31df8ebc973c861125d07e9cb3bb3f6b6c90673` | yes                 |
| failure-mode-analysis.md      | `0aee9f9d0e38a30061faa7ba2726f97e33c347ecfe70e9d85298a156229fb103` | yes                 |
| observability-contract.md     | `b41f1708b33dab6ed5820dbed82f1f6d00a9d8a24a43bde053f3ee9043da25b3` | yes                 |
| requirements.md               | `d6b914cea9437d9bb67d320591b6171e690315c982ff804f8014c7b7c75f94a5` | yes                 |
| rollback-plan.md              | `782215f7f210e197f83bfe73c2edae9e60f77b4dad02fd1748ae3a3d4bb99424` | yes                 |
| shadow-wiring-scope.md        | `7c690dcb944260089b8c00aa4531033d63074324b3d8291972b775cc9f98500e` | yes                 |
| test-plan.md                  | `912558b3dff03170cf15cb74afdad50d129b0577b3097dcca2f778ece76107cf` | yes                 |
| threat-model.md               | `f75646716e51b927a16dd1f8296ec431f3728afedce60d112c2dd7fab039e0ba` | yes                 |

## Sorted listing used for the cycle-2 combined digest

```text
2cac0d199521ba14975c8116c9b8ecbb84942e616b093fec09e9e69b80cc9e14  candidate-comparison.md
bc58bcf2df0541174af84cf1092e32b2940bb3f912cafe8eb6bccda4e56c9ec7  data-minimization-contract.md
9525fb1f87b0f287ffc5eb93a50537746005be7d6f4eb88d7fab66d3013a9b06  design-decision.md
71e34a004a6357ef18f04041b31df8ebc973c861125d07e9cb3bb3f6b6c90673  design.md
0aee9f9d0e38a30061faa7ba2726f97e33c347ecfe70e9d85298a156229fb103  failure-mode-analysis.md
b41f1708b33dab6ed5820dbed82f1f6d00a9d8a24a43bde053f3ee9043da25b3  observability-contract.md
d6b914cea9437d9bb67d320591b6171e690315c982ff804f8014c7b7c75f94a5  requirements.md
782215f7f210e197f83bfe73c2edae9e60f77b4dad02fd1748ae3a3d4bb99424  rollback-plan.md
7c690dcb944260089b8c00aa4531033d63074324b3d8291972b775cc9f98500e  shadow-wiring-scope.md
912558b3dff03170cf15cb74afdad50d129b0577b3097dcca2f778ece76107cf  test-plan.md
f75646716e51b927a16dd1f8296ec431f3728afedce60d112c2dd7fab039e0ba  threat-model.md
```

## Combined design digest (cycle 2)

```text
08a12fe9ce6352ff161d22f01c026b516069b6bf7169be37bb2a68115763ce21
```

## Superseded freeze — cycle 1 (audit record)

| Field                   | Value                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| checkpointBFreezeCycle  | `1`                                                                                                                                                                                              |
| combinedDesignDigest    | `ebdc3bff1c7e417b1c87397ce319cae9088c18c302147e51c53c6f63034bc987`                                                                                                                               |
| status                  | **superseded**                                                                                                                                                                                   |
| reason                  | Security and Execution-chain REVISE                                                                                                                                                              |
| PR                      | #183 — superseded and closed; branch `network-9aeee1a3/constitutional-runtime-shadow-wiring-design-revise` preserved at remote head `ff5ca33bd8e9b570f81d8a56cd2a4ba186ba4dc0`                   |
| designHeadSha           | `6779fffcd71d64dade6a07381df4b6a44c60a712`                                                                                                                                                       |
| reviewedMainSha         | `fdb47dfe4ef076201d30ae223b8dc6f8c63753ca`                                                                                                                                                       |
| statusHeadSha           | `ff5ca33bd8e9b570f81d8a56cd2a4ba186ba4dc0`                                                                                                                                                       |
| frozen-at               | `2026-09-28T15:33:44+0800`                                                                                                                                                                       |
| Architecture receipt    | `reviews/architecture-review-checkpoint-b.md` — `AGREE_SHADOW_WIRING`, conditions none — binds to this cycle only — SHA-256 `4879cbd4e070a88e238b97f4e898b7871aafe0a2c6efe2881cba433e96e2b287`   |
| Security receipt        | `reviews/security-review-checkpoint-b.md` — `REVISE` — SHA-256 `484990a9742b139c772d59352d9d8549a04a657982ec93fd0c9afc18ac857367`                                                                |
| Execution-chain receipt | `reviews/execution-chain-review-checkpoint-b.md` — `REVISE` — SHA-256 `7d8d7c6df752615b7699c9fae686a21f247ce838e4c636d07f0f23754bb097a0`                                                         |
| Rebased copies in #204  | `dbaf769d4` / `a9614bcec` / `a7385822a` are the current rebased SHAs of `551b6031c` / `6779fffcd` / `ff5ca33bd`; spec trees identical. The originals stay reachable on the preserved #183 branch |

Cycle-1 sorted listing (retained for audit):

```text
2cac0d199521ba14975c8116c9b8ecbb84942e616b093fec09e9e69b80cc9e14  candidate-comparison.md
043fe6ae3d8b9c68965c94fd1d6cd235eef849f6053020b2e0fe785f7544f758  data-minimization-contract.md
e60b052de1a6d68f3ea8eea893812569384e2f760274968bccc4a7b163834fa6  design-decision.md
69f3e7292391d1c6b8181c02cfa8b7cb7204894abb4a8c3d0c2c1fab22cc7215  design.md
c4d9dfea3851372a5fa35e3c0fb70f733e82ba1ff75ebc24bbe4ea0cd0373bfb  failure-mode-analysis.md
2b83290c3f88da414f9581fde7b1c8c1d211197626ce07c415c7cac335ee6522  observability-contract.md
e148196e39ff18cd5720ea05125207b3548919624414309c2191316cc5bf90b2  requirements.md
f8b68015496521d4e84b4365fedbaeb708035c1caedb50c16ec0f171e5ad1a26  rollback-plan.md
8f1c1357b56160290a1e72e1bf89894cad72ba2e220939a565ea2bed9c2066b2  shadow-wiring-scope.md
d3a855ea4479cdd3efc6e781d74d0ab59583429e8eaa9c2cc9b1916eee923938  test-plan.md
b28139109f577e21ab6c6ff665c90ad3f9a1b4b63dab7866e495a81c35eecd21  threat-model.md
```

Cycle-1 receipts are retained unmodified and are never re-bound to the cycle-2 digest.

## Invalidation statement

Any byte change to any of the 11 frozen design files **invalidates** the cycle-2 combined digest and any Architecture / Security / Execution-chain receipt that binds to it. A re-freeze (re-hash + new cycle) is then required before further review binding.

## Checkpoint C

Authorized: creation of a new default-off implementation task only (`checkpointCImplementationAuthorized=true`). Architecture, Security and Execution-chain returned `AGREE_SHADOW_WIRING` with `conditions: none` against this cycle-2 digest (final acceptance: `checkpoint-b-final-acceptance-cycle2.md`), and PR #204 was rebase-merged into main (`checkpoint-b-landing-record-cycle2.md`). This does not authorize enabling the flag, production wiring, SELECT, EXECUTE, deployment, or a production-proven claim; `runtimeEnabled=false`; `productionProven=unknown`. Checkpoint C has not started; it starts only after the post-merge closeout lands on main.
