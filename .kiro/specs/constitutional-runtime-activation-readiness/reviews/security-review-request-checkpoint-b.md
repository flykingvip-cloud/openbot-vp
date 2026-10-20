# Security Review Request — Constitutional Runtime Activation Checkpoint B (cycle 2)

Task: `constitutional-runtime-activation-readiness`
Agent: `kiro-constitutional-activation` (Loom takeover from `network-9aeee1a3`)
Checkpoint: **B — cycle-2 dual review (Security slot)**
PR: `#204` (Draft; do not merge) — branch `kiro-constitutional-activation/checkpoint-b-cycle2-revise`
Reviewer: `security-reviewer:profile-ab-tenant`
Receipt target: `reviews/security-review-checkpoint-b-cycle2.md`

## Binding identity (cycle 2; must match the cycle-2 Architecture receipt and its main-drift addendum)

| Field                               | Value                                                              |
| ----------------------------------- | ------------------------------------------------------------------ |
| designHeadSha                       | `7a87dfdfcd0ff74e069a02df78faaa54f25a4cf9`                         |
| architectureOriginalReviewedMainSha | `e4576c9a6ffefd7a07d32f1bf1e638731d1aba2d`                         |
| updatedReviewedMainSha              | `b6f83ce98b9d0bbf69f1f3cf8be4fcd3567366a0`                         |
| latestMergedMainSha                 | `8bfecac4db4f9746fc9b2d085ed15ca970459fbf`                         |
| statusHeadSha                       | `3b1eec593ac8df871b8bf3ecf63e0ba8bd4b59e7`                         |
| combinedDesignDigest                | `08a12fe9ce6352ff161d22f01c026b516069b6bf7169be37bb2a68115763ce21` |
| architectureReceiptSha256           | `6ff86b774f77a11361e5d318eaaefce7b12bbf0f18e6cd6689a9e83363d66ec1` |
| Architecture decision               | **AGREE_SHADOW_WIRING** (conditions: **none**)                     |
| Architecture receipt                | `reviews/architecture-review-checkpoint-b-cycle2.md`               |
| Architecture main-drift decision    | **NON_IMPACTING** (`AGREE_SHADOW_WIRING`, conditions: **none**)    |
| Architecture main-drift addendum    | `reviews/architecture-main-drift-addendum-cycle2.md`               |
| architectureMainDriftAddendumSha256 | `97ec470c53281d590457b740796a7a45e162cec2998caa7531256ec784bee73e` |

Digest algorithm: SHA-256 of the newline-terminated records below, sorted by basename (see `checkpoint-b-design-digest.md`):

```text
<file-sha256>  <basename>\n
```

Subsequent merge and status commits after `statusHeadSha` do not modify the 11 frozen design files. Reviewers must bind to `designHeadSha`, `combinedDesignDigest`, the Architecture receipt, and the Architecture main-drift addendum rather than to a fixed count of later metadata commits. The freeze-rule command in `checkpoint-b-design-digest.md`, run against the PR #204 head, returns an empty diff. The reviewed-path drift contains only the Architecture-adjudicated binding-prompt wording change in execution-preflight/resolve.ts. See architecture-main-drift-addendum-cycle2.md. b6f83ce98..latestMergedMainSha contains no reviewed-path change.

## Request

Security Reviewer: independently recompute the 11 frozen per-file SHA-256 values at `designHeadSha` and the `combinedDesignDigest` above, then review the frozen cycle-2 design package (Candidate A) and return one of the allowed outcomes below. Review against `updatedReviewedMainSha` and consider the Architecture main-drift addendum; the receipt must bind `designHeadSha`, `combinedDesignDigest`, `architectureReceiptSha256`, `updatedReviewedMainSha` and `architectureMainDriftAddendumSha256` above. This is an independent cycle-2 review; cycle-1 conclusions do not carry over. Do **not** modify the 11 frozen design files.

Cycle-1 context (superseded; reference only):

- The cycle-1 package (digest `ebdc3bff1c7e417b1c87397ce319cae9088c18c302147e51c53c6f63034bc987`, PR #183, closed) received Security `REVISE`. Receipt: `reviews/security-review-checkpoint-b.md` (SHA-256 `484990a9742b139c772d59352d9d8549a04a657982ec93fd0c9afc18ac857367`).
- How cycle 2 responds to each cycle-1 condition is mapped in `checkpoint-b-review-status.md` (cycle-1 REVISE closure map).

Review focus:

- Whether the runtime-shadow flag can only come from the server-side runner (`run.ts`), read once per run.
- Whether request, tool, model, header or other caller-provided data can control the flag.
- Whether anything beyond the `runtimeShadowEnabled` boolean, such as an environment object, copy or map, can cross into attempt parameters or shadow modules.
- Whether Profile A and Profile B stay isolated, and whether the first-slice profile category can be inferred or synthesized.
- Whether the whitelist blocks PII, URLs, hashes and correlatable IDs.
- Whether the production sink is a synchronous no-op with no logs, OTel, JSONL or ledger writes, and whether sink double faults are contained.
- Whether the flag stays isolated from SELECT, EXECUTE, PATH_GAP, orchestration and ConversationTask flags.
- Whether fail-open applies to the observation only and cannot bypass preflight or security gates.

## Allowed outcomes

- `AGREE_SHADOW_WIRING`
- `REVISE`
- `DISAGREE`

If AGREE, state `conditions: none` or list explicit conditions. Conditions other than none do **not** authorize Checkpoint C.

## Authorization boundary

`checkpointCImplementationAuthorized` remains **`false`** until Security **and** Execution-chain both return `AGREE_SHADOW_WIRING` with `conditions: none` against the **same** cycle-2 `combinedDesignDigest` that Architecture accepted.

Cycle-2 Architecture AGREE alone does **not** authorize Checkpoint C, runtime wiring, flag enablement, SELECT/EXECUTE activation, gateway/orchestration/CTR/ACP/AOR/tenant wiring, deployment, or a runtime-enabled / production-proven claim.

## Current claim ceiling

| Claim                                 | Value                                                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Checkpoint B                          | **REVISE** (cycle-2 review in progress)                                                                                          |
| Cycle-2 Architecture                  | **AGREE_SHADOW_WIRING** (conditions none)                                                                                        |
| Cycle-2 main drift                    | **NON_IMPACTING** (Architecture main-drift addendum; conditions none); `b6f83ce98..latestMergedMainSha`: no reviewed-path change |
| Cycle-2 Security                      | **PENDING** (this request)                                                                                                       |
| Cycle-2 Execution-chain               | **PENDING**                                                                                                                      |
| `checkpointCImplementationAuthorized` | `false`                                                                                                                          |
| `runtimeEnabled`                      | `false`                                                                                                                          |
| `productionProven`                    | `unknown`                                                                                                                        |

PR #204 must remain **Draft**. Do not merge. Do not start Checkpoint C.
