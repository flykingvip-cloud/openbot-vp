# Pre-commit main alignment check

Task: constitutional-phase-d-governance-ratification
Agent: grok-bot-4ab694d6

## Summary

- Check time: 2026-09-28 09:26:32 Asia/Shanghai (UTC+08:00)
- Origin URL: `https://github.com/upbeyond/openbot.git`
- `git fetch origin`: succeeded locally (exit 0)
- origin/main SHA: `29a554a3ac23a8cfbaa3e15788bfd1fbb9831208`
- Branch: `grok-bot/constitutional-phase-d-governance-ratification-recovery`
- Branch base SHA at check time: `29a554a3ac23a8cfbaa3e15788bfd1fbb9831208` (HEAD == origin/main before the two task commits)
- `git merge-base --is-ancestor origin/main HEAD` exit code: `0`
- Reviewed main SHA: `d8379ed919424c50d04c3be92cd2ef671f5e4580`
- constitutionalScopeChanged=false

All SHAs above come from local refs after a local `git fetch origin`, not from the GitHub API.

## Constitutional scope drift check

Command:

```sh
git diff --name-status d8379ed919424c50d04c3be92cd2ef671f5e4580..origin/main -- \
  packages/constitutional-contracts \
  packages/constitutional-registry \
  packages/constitutional-conformance \
  packages/constitutional-runtime \
  src/task-orchestration/constitutional-runtime-facade.ts \
  src/task-orchestration/constitutional-runtime-facade.test.ts \
  src/agents/execution-preflight/constitutional-runtime-facade.ts \
  src/agents/execution-preflight/constitutional-runtime-facade.test.ts
```

Paths checked:

1. `packages/constitutional-contracts`
2. `packages/constitutional-registry`
3. `packages/constitutional-conformance`
4. `packages/constitutional-runtime`
5. `src/task-orchestration/constitutional-runtime-facade.ts`
6. `src/task-orchestration/constitutional-runtime-facade.test.ts`
7. `src/agents/execution-preflight/constitutional-runtime-facade.ts`
8. `src/agents/execution-preflight/constitutional-runtime-facade.test.ts`

Result: the diff output was empty (exit 0). No Constitutional-scope file changed between the reviewed main SHA and the current origin/main.

## Registry entry

The `.loom/registry.yaml` task entry `constitutional-phase-d-governance-ratification:grok-bot-4ab694d6` (session `e32c44f7-a992-4667-85ea-0dca04180d8e`) was re-applied as an exact 17-line task entry on the current main baseline and committed separately by the authorized `kiro-loom` lander-proxy. The Registry commit contains no spec files or unrelated Registry formatting changes.

## Scope of this evidence

This file is additive evidence only. It does not modify the frozen review package, the review receipts, or the original `evidence/main-drift-check.md`.
