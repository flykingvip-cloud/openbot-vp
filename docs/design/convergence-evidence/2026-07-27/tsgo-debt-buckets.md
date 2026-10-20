# Type debt on the trunk, bucketed by vendor

**Source:** CI Gate run `30333105158` on `origin/main` (2026-07-28), job `check (types, lint, format)`, step `pnpm tsgo`.
**Totals:** 150 errors across 53 files. Every file is attributed; none left unassigned.

## Why this list exists

`pnpm check` is a serial chain of 20 gates. Until 2026-07-28 it failed at step 2 (`format:check`, 273
files), so nothing behind it had ever been evaluated — and before that, CI had produced **zero
completed runs for roughly two months**, because 30 of its 34 jobs target a runner provider this
repository never subscribed to. With the formatting layer cleared and a gate running on hosted
runners, `tsgo` is the first real verdict the trunk has produced.

Buckets are vendor-level on purpose: individual owners are not reliably recoverable for most of
these files.

## Summary

| bucket    | files  | errors  | share |
| --------- | ------ | ------- | ----- |
| cursor    | 31     | 69      | 46%   |
| codex     | 15     | 59      | 39%   |
| kiro      | 7      | 22      | 15%   |
| **total** | **53** | **150** |       |

## Highest-leverage single fix

`ui/src/ui/app-view-state-shell-slices.ts` carries **23 errors — 15% of the entire backlog — and they
are all one defect**: a block of nine enterprise-operational-identity members is declared twice in
the same interface (around lines 1006–1063, then again 1107–1120). 18 `TS2300` duplicate-identifier
plus 5 `TS2717` redeclaration. It reads as a merge that applied the same hunk twice. Deleting the
second block should clear all 23.

Caveat: this file is under active edit in the shared worktree, so its owner should make the change
rather than a drive-by commit.

## Error-code shape per bucket

```
## kiro  errors=22
    5  TS2339  property does not exist on type
    5  TS2678  case type not comparable to switch type
    3  TS2353  object literal has unknown property
    2  TS2307  cannot find module
    2  TS2551  property does not exist (did you mean…)
    2  TS2322  type not assignable
    1  TS2554  wrong number of arguments
    1  TS2367  comparison of non-overlapping types
    1  TS2345  argument type not assignable

## cursor  errors=69
   10  TS2322  type not assignable
   10  TS2339  property does not exist on type
    5  TS2352  unsafe conversion between types
    5  TS2493  tuple index out of range
    5  TS2353  object literal has unknown property
    5  TS2304  cannot find name
    5  TS2554  wrong number of arguments
    5  TS18046 value is of type 'unknown'
    4  TS2741  property missing in type
    3  TS18048 value is possibly 'undefined'
    3  TS2345  argument type not assignable
    2  TS7006  parameter implicitly has an 'any' type
    2  TS2367  comparison of non-overlapping types
    1  TS2552  cannot find name (did you mean…)
    1  TS18047 value is possibly 'null'
    1  TS2722  cannot invoke possibly 'undefined'
    1  TS2561  unknown property (did you mean…)
    1  TS2739  properties missing in type

## codex  errors=59
   18  TS2300  duplicate identifier
    8  TS7006  parameter implicitly has an 'any' type
    7  TS2339  property does not exist on type
    6  TS18046 value is of type 'unknown'
    5  TS2717  subsequent property declaration has a different type
    4  TS2353  object literal has unknown property
    2  TS2345  argument type not assignable
    2  TS2322  type not assignable
    2  TS2741  property missing in type
    1  TS18047 value is possibly 'null'
    1  TS2769  no overload matches this call
    1  TS2740  type missing many properties
    1  TS2561  unknown property (did you mean…)
    1  TS2537  type has no matching index signature
```

Reading the shapes:

- **codex** is dominated by the duplicate-declaration defect above (18 `TS2300` + 5 `TS2717` = 23 of
  59), plus 8 missing parameter annotations. Concentrated, so cheap per error.
- **cursor** is spread thin: 31 files, no single cluster, mostly assignability and
  property-existence drift. Most expensive per error despite similar totals.
- **kiro** is concentrated in the knowledge-space-import surface (18 of 22 errors in four files),
  where 5 `TS2678` suggest a union type that lost members.

## Files

```
## kiro  files=7 errors=22
    7  ui/src/ui/views/knowledge-universe-space-import.ts  [loom:kiro-web-ui]
    4  ui/src/ui/views/knowledge-universe-space-import-passive-connector.ts  [loom:kiro-web-ui]
    4  ui/src/ui/controllers/knowledge-universe-local-folder.ts  [loom:kiro-web-ui]
    3  ui/src/ui/views/knowledge-universe-space-import.node.test.ts  [loom:kiro-web-ui]
    2  src/gateway/agent-growth/background-recompute.test.ts  [loom:kiro-agent-growth]
    1  ui/src/ui/employee-shell/employee-embed-mobile.browser.test.ts  [loom:kiro]
    1  ui/src/ui/employee-shell/employee-embed-a11y.browser.test.ts  [loom:kiro]

## cursor  files=31 errors=69
    9  src/gateway/server-methods/enterprise-data-m1.ts  [branch?:cursor-main-recovery/fold-forward-tier2]
    8  src/conversations/conversation-lifecycle.archive-cw-retry.test.ts  [trailer:cursor-conversation-lifecycle]
    7  ui/src/ui/capability/ai-workforce-governance/pages/actions-page.browser.test.ts  [trailer:cursor-evolution-closure]
    5  ui/src/ui/app-render.ts  [loom:cursor-builder]
    4  src/gateway/billing/phase2-payg-stages.test.ts  [loom:cursor-main-recovery]
    3  ui/src/ui/controllers/enterprise-organization-monthly-usage.node.test.ts  [branch?:cursor-main-recovery/fold-forward-tier2]
    2  ui/src/ui/controllers/knowledge-universe-workspace.ts  [trailer:cursor-vault-sync]
    2  ui/src/ui/controllers/knowledge-universe-passive-connector.ts  [branch?:cursor-main-recovery/fold-forward-tier2]
    2  src/gateway/server-methods/user-operational-identity.ts  [trailer:cursor-auth-ui]
    2  src/gateway/server-methods/model-entitlement-management.ts  [trailer:cursor-enterprise-model-gov]
    2  src/gateway/knowledge/sources/local-folder-watcher.test.ts  [branch?:cursor-main-recovery/fold-forward-tier2]
    2  src/gateway/knowledge/kb-ingest.test.ts  [branch?:cursor-main-recovery/fold-forward-tier2]
    2  src/gateway/knowledge/agent-knowledge-generation-runtime.ts  [trailer:cursor-fable]
    2  src/gateway/enterprise-operational-identity.ts  [branch?:cursor-main-recovery/fold-forward-tier2]
    1  ui/src/ui/ports/platform/pricing/plan-form-helpers.node.test.ts  [loom:cursor-agent]
    1  ui/src/ui/ports/enterprise/views/enterprise-organization-surface.ts  [loom:cursor-composer]
    1  ui/src/ui/ports/enterprise/views/enterprise-organization-activation.browser.test.ts  [loom:cursor-composer]
    1  ui/src/ui/gateway-subscriptions/agent-growth.ts  [trailer:cursor-evolution-closure]
    1  ui/src/ui/controllers/knowledge-universe-vault-sync.ts  [trailer:cursor-vault-sync]
    1  src/organization/mention-task-converter.ts  [branch?:cursor-main-recovery/fold-forward-tier2]
    1  src/gateway/user-operational-identity-oauth.ts  [trailer:cursor-auth-ui]
    1  src/gateway/user-operational-identity-oauth.test.ts  [branch?:cursor-main-recovery/fold-forward-tier2]
    1  src/gateway/server-node-events.ts  [trailer:cursor-fable]
    1  src/gateway/server-methods/enterprise-memory-governance.test.ts  [trailer:cursor-conversation-lifecycle]
    1  src/gateway/server-methods/enterprise-data-m6.ts  [trailer:cursor-fable]
    1  src/gateway/server-methods/billing.ts  [loom:cursor-phase5]
    1  src/gateway/knowledge/sources/local-folder-binding-store.ts  [branch?:cursor-main-recovery/fold-forward-tier2]
    1  src/gateway/knowledge/sources/cloud-drive/baidu-oauth-http.ts  [trailer:cursor-conversation-lifecycle]
    1  src/gateway/evolution-governance/skill-auto-evolution.ts  [trailer:cursor-evolution-closure]
    1  src/gateway/collaboration-learning/collaboration-satisfaction.test.ts  [trailer:cursor-evolution-closure]
    1  src/gateway/auth.test.ts  [trailer:cursor-canvas]

## codex  files=15 errors=59
   23  ui/src/ui/app-view-state-shell-slices.ts  [loom:codex-v111-recovery]
   11  ui/src/ui/ports/employee/render-model-memory-center.ts  [loom:codex-v111-recovery]
    5  ui/src/ui/ports/employee/render-model.ts  [loom:codex-v111-recovery]
    3  ui/src/ui/ports/employee/views/memory-center-page.ts  [loom:codex-v111-recovery]
    3  src/conversations/source-identity-migration.ts  [trailer:codex-conversation-lifecycle]
    2  ui/src/ui/views/cost-budget-v2/pages/settings-page.browser.test.ts  [loom:codex-v111-recovery]
    2  src/conversations/purge/real-adapters.ts  [trailer:codex-conversation-lifecycle]
    2  src/conversations/memory-admission.ts  [trailer:codex-conversation-lifecycle]
    2  src/conversations/managed-planes.test.ts  [trailer:codex-conversation-lifecycle]
    1  ui/src/ui/ports/employee/views/workbench-stage-module.knowledge.node.test.ts  [loom:codex-v111-recovery]
    1  ui/src/ui/ports/employee/views/workbench-enterprise-operational-identity-section.ts  [loom:codex-v111-recovery]
    1  ui/src/ui/ports/employee/employee-workbench-agent-scope.node.test.ts  [loom:codex-v111-recovery]
    1  ui/src/ui/ports/employee/conversation-lifecycle-wire.ts  [loom:codex-v111-recovery]
    1  src/conversations/cogniweave-bridge.ts  [trailer:codex-conversation-lifecycle]
    1  src/conversations/catalog/sqlite-catalog.ts  [trailer:codex-conversation-lifecycle]
```

## Attribution method, and where to distrust it

Two signals, in priority order:

1. **`loom` registry path claims** — a file matching a task's `paths:` glob inherits that task
   owner's vendor. Marked `[loom:<owner>]`. Strongest signal available.
2. **Commit history** — the `Agent:` trailer on a commit touching the file, else the branch name
   from the merge commit that brought it in. Marked `[trailer:<agent>]` or `[branch:<name>]`.

Git author is **not** a signal: every agent commits under the same identity, so `git log --author`
cannot tell them apart. That is precisely why the registry and the trailers exist.

**Nine entries are marked `[branch?:…]` — low confidence.** They were attributed via
`cursor-main-recovery/fold-forward-tier2`, and fold-forward, rescue, recovery, replay and
consolidation branches **re-land other agents' work**, so the branch vendor is the lander, not the
author. Read those nine as "cursor is holding them", not "cursor wrote them".

**A false positive was removed before publishing.** The first pass credited three files to
`kiro-baseline-governance` — this governance task, which wrote no product code. Cause: the 273-file
`oxfmt` sweep carries that `Agent:` trailer and touched hundreds of files it did not author. A
formatting sweep is now excluded from the attribution signal. Without that correction kiro would
read 10 files / 22 errors instead of 7 / 22, and cursor would be understated by three files.

## Reproducing

```bash
# 1. get the verdict
gh run view <ci-gate-run-id> --log-failed > /tmp/main-gate.txt

# 2. per-file counts
grep -E 'error TS[0-9]+' /tmp/main-gate.txt \
  | sed -E 's/.*##\[error\]//; s/^([^(]+)\(.*/\1/' \
  | sort | uniq -c | sort -rn > /tmp/tsdebt-files.txt

# 3. bucket them
python3 docs/design/convergence-evidence/2026-07-27/tsgo-debt-attribution.py
```

Locally, without CI: `pnpm build:collaboration:packages && pnpm tsgo`. **Skipping the build step
inflates the count to 212 across 75 files**, because 64 of those are `TS2307` for
`packages/collaboration-*/dist/index.js` that the build produces. 150 is the honest number.

## What this does not say

Nothing here assigns blame. Every one of these 150 errors landed on a trunk that had no working CI
for two months — the gate that should have caught them at commit time did not exist in practice.
The buckets are for dispatching work, not for accounting fault.
