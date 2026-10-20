# Decision digest — Phase D governance ratification

assessedAt: 2026-09-27T10:34:30+08:00 (Asia/Shanghai)
materialOwner: `constitutional-phase-d-governance-ratification:grok-bot`
governance Owner Choice: `SUPERSEDE_PHASE_C_BOUNDED` (Option A)
Independent acceptance status: **REVISE** (section 九 — tripartite receipts PENDING)

## Statuses

| Field                  | Value                                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| mainSha                | `d8379ed919424c50d04c3be92cd2ef671f5e4580`                                                                                                |
| setupTipWas            | `618fc8eb2e16cd04910615085b2ce3a1fa0c5694`                                                                                                |
| ratificationBranchHead | `d8379ed919424c50d04c3be92cd2ef671f5e4580`                                                                                                |
| mainMovedNote          | origin/main advanced via unrelated PR #120 pptx-preview; constitutional paths untouched; re-verified                                      |
| phaseCFrozenDigest     | `c5e527340f8d551e0569e62a956d6d615b241e92ebdee4e53d8320eae0c73a20` (re-verified)                                                          |
| ownerDecisionChoice    | `SUPERSEDE_PHASE_C_BOUNDED`                                                                                                               |
| architectureReview     | `LANDED` / `AGREE_BOUNDED_RETENTION` / conditions none / receiptSha256 `8db0c09461ef5afcdb5faaf420eeb536ef54043573c4225defa60085b7b60fe0` |
| securityReview         | `PENDING_REAL_REVIEWER` / verdict PENDING                                                                                                 |
| executionChainReview   | `PENDING_REAL_REVIEWER` / verdict PENDING                                                                                                 |
| finalAcceptanceStatus  | **REVISE**                                                                                                                                |
| runtimeEnabled         | `false`                                                                                                                                   |
| productionProven       | `unknown`                                                                                                                                 |
| claimCeiling           | code-present / default-off / not-wired / not-runtime-enabled / not-production-proven                                                      |

## Authoritative digests (post-oxfmt; post-main-move)

### ownerDecisionDigest

Algorithm: `shasum -a 256 owner-decision.md` in this directory.

```
06e14b8b1c3b6f1633f47db2380b8a84c4163c55302035158a561ae4c1ff4e21  owner-decision.md
```

### reviewPackageDigest

Algorithm: `shasum -a 256 review-package.md` in this directory.

```
a165bde3d0516a4f6a99a34c98eb9d3b8ca5bf97c421b1d4e7bfc220e439c9ae  review-package.md
```

### reviewPackageCombinedDigest (frozen command)

Optional combined digest of core reviewer materials. **Frozen command** (must re-run exactly):

```bash
cd .kiro/specs/constitutional-phase-d-governance-ratification
for f in review-package.md scope-freeze.md owner-decision.md baseline-manifest.yaml
do
  shasum -a 256 "$f"
done | shasum -a 256
```

Actual output (post-oxfmt; `2026-09-27T10:34:30+08:00`):

```
9982ab2bcb65bd7022064065c05590bd7cc2134b48a37fb0fa87f5a5fa43764c  -
```

Supporting per-file lines feeding the combined digest:

```
a165bde3d0516a4f6a99a34c98eb9d3b8ca5bf97c421b1d4e7bfc220e439c9ae  review-package.md
87d99c06077f4b6bbe060236f4598fe7150ad7169a0470b1ad922a8ab962fd3a  scope-freeze.md
06e14b8b1c3b6f1633f47db2380b8a84c4163c55302035158a561ae4c1ff4e21  owner-decision.md
3adff2ddfb47badcc9579555f9f67586f15ee895331d3b31249dc0806268f8b0  baseline-manifest.yaml
```

### phaseCFrozenDigest (must match prior freeze)

Re-verified on this worktree with Phase C frozen for-loop:

```
c5e527340f8d551e0569e62a956d6d615b241e92ebdee4e53d8320eae0c73a20  -
```

## Notes

- `decision-digest.md`, `tasks.md`, `requirements.md`, `final-acceptance.md`, `gate-evidence.md`, and `reviews/*` are **outside** the combined core set above.
- Architecture receipt landed at `reviews/architecture-review.md` with SHA-256 `8db0c09461ef5afcdb5faaf420eeb536ef54043573c4225defa60085b7b60fe0` (verbatim body as supplied by codex-architecture; oxfmt not applied to preserve signed bytes). Security and Execution-chain remain PENDING templates.
- Core `reviewPackageCombinedDigest` unchanged: `9982ab2bcb65bd7022064065c05590bd7cc2134b48a37fb0fa87f5a5fa43764c`.
- If oxfmt or content changes `owner-decision.md` / `review-package.md` / `scope-freeze.md` / `baseline-manifest.yaml`, recompute and update this file before reviewers sign.
- grok-bot must not fabricate Architecture / Security / Execution-chain `AGREE_*` receipts.
