# Checkpoint B Landing Record — Cycle 2

task: constitutional-runtime-activation-readiness
agent: kiro-constitutional-activation
recordedAt: 2026-09-29

checkpointBStatus: APPROVED
checkpointCImplementationAuthorized: true
runtimeEnabled: false
productionProven: unknown

pr: 204
prState: MERGED
mergeMethod: rebase
mergedAt: 2026-09-29T06:36:09Z
mergeSha: 364c2e8131dc1fccaa292c192a6c54b2dbbc90c5

sourceBranch: kiro-constitutional-activation/checkpoint-b-cycle2-revise
sourceBranchPreserve: true
sourceHeadSha: ac004e12327e0ad90f73d0e32bee627667f1f33a

landedDesignCommitSha: c11e904b84be7566d63077d4313a4c97002d5b3c
combinedDesignDigest: 08a12fe9ce6352ff161d22f01c026b516069b6bf7169be37bb2a68115763ce21

postMergeMainSha: 52b8bba1087b087b03eca1ad9558a49664735c64
postMergeReviewedPathDrift: false

## Acceptance and Merge

- Final remote acceptance: https://github.com/upbeyond/openbot/pull/204#issuecomment-5884967649
  (2026-09-29T06:32:43Z).
- Marked ready for review at 2026-09-29T06:36:01Z and merged at
  2026-09-29T06:36:09Z by rebase. `mergeSha` is the landed copy of the final
  receipt/status commit.

## Rebase Mapping

The rebase merge re-created each non-merge source commit on main with a new SHA
and dropped the source merge commits. Each landed commit has the same
`git patch-id --stable` as its source commit.

| Source commit (PR branch)                                                            | Landed commit (main)                                                 | Subject                                                             |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `dbaf769d4145f2e917d2c0867a82e926f8e15017`                                           | `8a4f4970967ce2d120985b7057726679d8f46cf1`                           | Docs: revise Constitutional Checkpoint B shadow wiring design       |
| `a9614bcecbda8e3d12ed7733d48964ae8ea23b0f`                                           | `d69b414f4755380a6a3dc26f9cafc80d8155c586`                           | Docs: lock Checkpoint B deps injection via EmbeddedRunAttemptParams |
| `a7385822ab8815bd285c4aa6cd083ab12f4f68f6`                                           | `42e472120b6bf98b7482a63f0845d896cd8439c2`                           | Docs: freeze Checkpoint B design digest; Architecture AGREE         |
| `7a87dfdfcd0ff74e069a02df78faaa54f25a4cf9` (`designHeadSha`)                         | `c11e904b84be7566d63077d4313a4c97002d5b3c` (`landedDesignCommitSha`) | Docs: revise Checkpoint B shadow wiring after dual review           |
| `532e995a67c942fec41b790797b05303c747c2b4` (`registryCommitSha`)                     | `bc39e33a54c704398fdb735440fa2bb438e2e9ee`                           | Loom: transfer Constitutional activation readiness owner            |
| `3b1eec593ac8df871b8bf3ecf63e0ba8bd4b59e7` (`statusHeadSha` (Architecture-reviewed)) | `cd721d4468bad0a9d8f84cb716021ba28fead549`                           | Docs: align Checkpoint B cycle-2 status metadata                    |
| `bd4634170fa61a7b65c8520899c15cef58276342`                                           | `86f50d5cd989b7844c868a4e5cf2d2f6e0f5e99b`                           | Docs: record Checkpoint B cycle-2 Architecture acceptance           |
| `030c2e993d5a5d0dc106d9af42e2d015ced03034`                                           | `6c6441f0b8db1dcc16387a056f5333bc2c0e8079`                           | Docs: adjudicate Checkpoint B cycle-2 main drift                    |
| `b74f802c7a7add4e93ff24774a293ae361ee89f6`                                           | `813d26abe068e05624d70652b6933e3cc54d1e79`                           | Docs: refresh Checkpoint B cycle-2 merged-main status               |
| `dbc7cc519e9f29843de2bf5e865d1704860c7ddb` (final receipt/status commit)             | `364c2e8131dc1fccaa292c192a6c54b2dbbc90c5` (`mergeSha`)              | Docs: close Checkpoint B cycle-2 tripartite acceptance              |

The source merge commits are not on main. They stay reachable from the source
branch:

| Source merge commit                                          | Merged origin/main                         |
| ------------------------------------------------------------ | ------------------------------------------ |
| `763780bb345dd4748e20f3eaa24125701430331e`                   | `d36d1a035dc94edbaaef2e7ef376af3f6bc59fc3` |
| `d2c6ce13140a3e72657df98b857c6c82bf6af01f`                   | `b6f83ce98b9d0bbf69f1f3cf8be4fcd3567366a0` |
| `e2a5c0564317c40084b5ecb4f29b93a2c3aa970d`                   | `8bfecac4db4f9746fc9b2d085ed15ca970459fbf` |
| `ac004e12327e0ad90f73d0e32bee627667f1f33a` (`sourceHeadSha`) | `b9c830ad214363b933e3eed478fe8b22f61aabf2` |

## Source SHAs Cited by the Receipts

The receipts and the final acceptance cite source SHAs: `designHeadSha`
`7a87dfdfcd0ff74e069a02df78faaa54f25a4cf9` and `statusHeadSha`
`3b1eec593ac8df871b8bf3ecf63e0ba8bd4b59e7`. The status files also cite
`registryCommitSha` `532e995a67c942fec41b790797b05303c747c2b4`. These commits are
not on main. They stay reachable from the source branch and from
`refs/pull/204/head`, both at `sourceHeadSha`, so the source branch must be kept
and must not be deleted, rewritten or force-pushed.

The receipt bindings are unchanged. Their landed equivalents carry identical
patches, and the 11 frozen files are byte-identical at `landedDesignCommitSha`.

## Verification at postMergeMainSha

- The spec directory is unchanged from `mergeSha` to `postMergeMainSha`.
- The 11 frozen design files are byte-identical to `landedDesignCommitSha` and
  recompute to `combinedDesignDigest`. On main, run the freeze-rule command in
  `checkpoint-b-design-digest.md` with `landedDesignCommitSha` in place of
  `designHeadSha`.
- Receipt SHA-256 values on main are unchanged: Architecture
  `6ff86b774f77a11361e5d318eaaefce7b12bbf0f18e6cd6689a9e83363d66ec1`, main-drift
  addendum `97ec470c53281d590457b740796a7a45e162cec2998caa7531256ec784bee73e`,
  Security `ced8906517a1c397444ac54721a1d89c67efb2eb8edcd3639e4d7df48ca5904f`,
  Execution-chain `b6530fc25addfb0047419d41a525b89421ff582d0576e08f760a3cf7002765c2`.
- The reviewed-path diff to `postMergeMainSha` is empty from
  `b9c830ad214363b933e3eed478fe8b22f61aabf2` (the last main merged into the source
  branch) and from `mergeSha`. The `src/agents/pi-embedded-runner` and
  `src/agents/execution-preflight` trees are unchanged, there are still 3 direct
  `runEmbeddedAttempt(` callers, and `attempt.ts` still has 2 `process.env`
  references.

## Final Acceptance Revision

The final acceptance landed with SHA-256
`d6d13ffc8c0285ebaa31fbe496e1a98e1be8ff968f1b30fa548c02eeddc68ed9`. This closeout
changes only its PR-state text (Draft to merged) and adds two landing pointers.
The revised SHA-256 is `5ff47d139ae7d04831c3859eafb7a643c5fc2303c39ddfecd5b1fe36e1b012fd`. The receipts, the addendum and the frozen
design files are not modified.

## Authorization Boundary

Checkpoint C authorization allows creation of a new default-off
implementation task only.

It does not authorize enabling the flag, production wiring, SELECT, EXECUTE,
deployment, or a production-proven claim. `runtimeEnabled` stays `false` and
`productionProven` stays `unknown`.

## Checkpoint C Start Conditions

Checkpoint C starts only after this post-merge closeout lands on main, as the new
task `constitutional-runtime-shadow-wiring-implementation`. It must use:

- a new branch;
- a new isolated worktree;
- a new Loom task and session;
- the latest `origin/main`;
- only the exact paths approved in `shadow-wiring-scope.md`;
- a default-off implementation;
- tests B-01 to B-39 from `test-plan.md`;
- no flag enablement and no deployment.

## Status

- Checkpoint B governance approval: done.
- Checkpoint B remote merge: done (PR #204, `mergeSha`).
- Checkpoint B status archive: this post-merge closeout; complete when it lands
  on main.
- Checkpoint C implementation: may start after the archive lands.
