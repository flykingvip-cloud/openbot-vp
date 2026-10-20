# Git baseline — Checkpoint A (REVISE)

assessedAt: 2026-09-28T12:10:00+08:00
Transcript: `evidence/git-baseline-probe.txt`

## Identity

| Field                                   | Value                                                                |
| --------------------------------------- | -------------------------------------------------------------------- |
| Remote `origin`                         | `https://github.com/upbeyond/openbot.git`                            |
| Worktree                                | `<isolated-worktree>`                                                |
| Primary checkout (not used as baseline) | `<primary-openbot-worktree>`                                         |
| Branch                                  | `network-9aeee1a3/constitutional-runtime-activation-readiness`       |
| HEAD at freeze                          | `6628f4bf364bd6d0560847b938b00e74035a8947`                           |
| `origin/main`                           | `6628f4bf364bd6d0560847b938b00e74035a8947`                           |
| Tip subject                             | Docs: Constitutional runtime activation Checkpoint A baseline (#174) |

The isolated worktree tracks this feature branch after `git fetch` of current `origin/main`. The dirty feature branch in `<primary-openbot-worktree>` was not used as the baseline and is not part of this commit.

## Prior freeze (stale)

Expert REVISE rejected freeze tip `a722492c6793b36075cb9c0ca488ca17fc7c345b` (`Governance: add offline shadow JSONL metrics (#171)`). Before #174 landed, main tip was `f0e9bed…` (#175). After #174 squash-merge, current `origin/main` is `6628f4bf364bd6d0560847b938b00e74035a8947`. This packet freezes that tip.

## Drift from prior freeze `a722492c…` → `origin/main`

Constitutional runtime path name-status (must be empty):

```
git diff --name-status a722492c6793b36075cb9c0ca488ca17fc7c345b..origin/main -- \
  packages/constitutional-contracts packages/constitutional-registry \
  packages/constitutional-conformance packages/constitutional-runtime \
  src/task-orchestration/constitutional-runtime-facade.ts \
  src/task-orchestration/constitutional-runtime-facade.test.ts \
  src/agents/execution-preflight/constitutional-runtime-facade.ts \
  src/agents/execution-preflight/constitutional-runtime-facade.test.ts \
  src/conversation-task src/task-orchestration/feature.ts \
  src/task-orchestration/types.ts src/gateway/security-profile.ts
```

Result: **empty**. Runtime Constitutional scope is unchanged.

Recorded separately (non-runtime):

| Path                           | Status | Via                                                                |
| ------------------------------ | ------ | ------------------------------------------------------------------ |
| `scripts/governance/README.md` | M      | `f0e9bed89` Docs: add the governance shadow staging runbook (#175) |

Commits in range:

```
6628f4bf364bd6d0560847b938b00e74035a8947 Docs: Constitutional runtime activation Checkpoint A baseline (#174)
f0e9bed89d Docs: add the governance shadow staging runbook (#175)
7d72684d3b Governance: add the capability invoke adapter (#173)
```

## Ancestry

- `git merge-base --is-ancestor origin/main HEAD` exited 0. At freeze, HEAD and `origin/main` are the same commit.
- `git rev-list --left-right --count origin/main...HEAD` printed `0	0` (behind, ahead).
- Phase D ratification merge `cdcf9a0a2ef4387ca7c6c57d5ebf43da1f0e030a` (`Docs: ratify Phase D bounded retention (#170)`) is an ancestor of this HEAD.
- Spec directory `.kiro/specs/constitutional-phase-d-governance-ratification/` is present on this commit.

## Working tree at the probe

`git status --porcelain` filtered to `src/` and `packages/` was empty. No runtime files are dirty.

This REVISE docs commit is the only intended divergence from `origin/main`. It is limited to `.kiro/specs/constitutional-runtime-activation-readiness/**`. The Loom registry row for this task is already on `origin/main` via #174; this PR does not retarget other registry rows. Registry lander remains `loom-workspace-orchestrator:kiro-loom` (shared path `.loom/registry.yaml`).

## Attribution

Ownership for this task is the Loom task `constitutional-runtime-activation-readiness:network-9aeee1a3`, paths `.kiro/specs/constitutional-runtime-activation-readiness/**` only. `.loom/registry.yaml` stays a pre-existing shared path (first `sharedPaths` match: lander `loom-workspace-orchestrator:kiro-loom`).

Gate command, run from this worktree before finish:

```
bun scripts/agent-attribution.ts --fail-on-unattributed --fail-on-conflict
```
