# Main drift check (constitutional scope)

checkedAt: 2026-09-27T10:58:31+08:00
reviewedMainSha: d8379ed919424c50d04c3be92cd2ef671f5e4580
latestOriginMain: 656bdddb26c89ffdf793b9f8fea67b23aa228724
branchHeadAfterFf: 656bdddb26c89ffdf793b9f8fea67b23aa228724
constitutionalScopeChanged: false
ancestryOriginMainIsAncestorOfHead: true

## Command

```
git diff --name-status \
  d8379ed919424c50d04c3be92cd2ef671f5e4580..origin/main \
  -- packages/constitutional-contracts packages/constitutional-registry \
  packages/constitutional-conformance packages/constitutional-runtime \
  src/task-orchestration/constitutional-runtime-facade.ts \
  src/agents/execution-preflight/constitutional-runtime-facade.ts
```

## Output

(empty — no constitutional-scope path changes)

## Non-constitutional tip movement

origin/main advanced via PR #124 meeting confirm card UI only (relative to reviewed tip).
Receipts remain valid against reviewedMainSha d8379ed9…; final-acceptance will record both SHAs.
