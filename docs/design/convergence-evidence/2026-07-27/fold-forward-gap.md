# Fold-forward gap: what the archived main lineage still holds

**Status:** scoped, not executed. Each group below needs an owner working in an isolated worktree.
**Baseline anchor:** tag `baseline/2026-07-27`
**Archived source:** tag `archive/main-pre-baseline-20260727` (previous `origin/main` tip `0536504b9e`)

## Why this document exists

`main` was re-pointed on 2026-07-27 to the lineage production actually runs. The previous `main`
was a side branch forked at `4f1d8d603c` (2026-07-09, PR #32) that ran for 17 days and accumulated
40 commits. Those commits are preserved in the archive tag but are **not on the trunk**.

Blind cherry-picking is the wrong move: the trunk moved 1307 commits over the same period, so most
of that work already exists there, and part of what is missing is being re-implemented right now in
the shared worktree.

## Measured gap

Files touched by the 40 archived commits, excluding the `.tmp/workspace-audit-20260723` scratch dir
(299 files that should never have been on a trunk):

| Metric                                                              | Count  |
| ------------------------------------------------------------------- | ------ |
| files touched by archived commits                                   | 573    |
| already present on `main`                                           | 489    |
| **absent from `main`**                                              | **84** |
| absent, excluding generated `node_modules/.bin` shims               | 79     |
| absent but under live edit in the shared worktree (leave to owners) | 10     |
| **absent and safe to fold forward**                                 | **69** |

**Caveat on method.** Detection is by path existence, not content comparison. The 489 present files
were not diffed, so a file can exist on `main` and still lack a behaviour the archived commit added.
Treat the 69 below as the floor of the gap, not the ceiling.

## Do not touch: 10 files under live edit

These paths are dirty in the shared worktree right now — agents are re-creating this cluster.
Folding forward here would collide with in-flight work. The dirty state is captured in
`docs/design/convergence-evidence/2026-07-27/`.

```
.kiro/specs/knowledge-workbench-import-ia/tasks.md
src/auto-reply/reply/experience-capsule-backflow.ts
src/auto-reply/reply/learning-recall-context.ts
src/auto-reply/reply/learning-recall.ts
src/auto-reply/reply/learning-skill-curation.ts
src/gateway/agent-growth/experience-capsule.test.ts
src/gateway/agent-growth/experience-capsule.ts
src/gateway/agent-growth/skill-draft-curation.ts
src/gateway/agent-growth/working-style-store.test.ts
src/gateway/collaboration-learning/review-rejection-experience.ts
```

## Groups to fold forward

Each group is independently landable as one PR off `main`. Ordered by risk-weighted value.

### G1 — Security P1.1: actor scope, response DLP, query-atoms ACL (8 files)

Highest value: these are access-control surfaces, and their absence is silent.

```
src/gateway/actor-scope.ts
src/gateway/actor-scope.test.ts
src/gateway/response-dlp.ts
src/gateway/response-dlp.test.ts
src/infra/redact-secret-text.ts
src/memory/query-atoms-acl.test.ts
src/gateway/server-methods/rpc-tenant-scope.test.ts
src/gateway/server-methods/cross-tenant-task-memory.test.ts
```

Source commit: `43a03037d1 Security P1.1: actor scope, RPC isolation, DLP audit, queryAtoms ACL`

Before landing, check whether the trunk grew an equivalent control under a different name — the
recovery lineage has its own tenant-context isolation work. Do not stack two ACL layers.

### G2 — Context lifecycle: retention, export, context budget (15 files)

```
src/conversations/retention-policy.ts + .test.ts
src/conversations/retention-enforcer.ts + .test.ts
src/conversations/tenant-retention-config.ts
src/conversations/conversation-export.ts + .test.ts
src/agents/resolve-context-budget.ts + .test.ts
src/auto-reply/reply/context-budget-assembler.ts + .test.ts
src/auto-reply/reply/context-constraints-capsule.ts + .test.ts
ui/src/ui/ports/enterprise/views/enterprise-retention-policy-surface.ts
ui/src/ui/ports/employee/views/employee-data-retention-summary-card.ts
```

Source commit: `0e7e2fc7ee Context lifecycle: P1 retention, memory governance, export, constraints`
Design note also missing: `docs/design/openbot-agent-context-lifecycle-architecture-v1.1-2026-07-24.md`

Note: `main` already has `src/conversations/context-budget.ts` and `context-assemble.ts`. Reconcile
rather than add a parallel budget path.

### G3 — Collaboration deliverable preview (16 files)

```
src/gateway/knowledge/deliverables/group-manifest.ts + .test.ts
src/gateway/knowledge/deliverables/save-and-archive.ts + .test.ts
src/gateway/server-methods/group-workspace-file.ts, group-workspace-file.pack.ts
ui/src/ui/controllers/group-workspace-file.ts, group-deliverable-manifest.ts
ui/src/ui/wiring/group-workspace-file.ts, deliverable-save.ts + .test.ts
ui/src/ui/wiring/group-deliverable-preview-flow.ts
ui/src/ui/views/artifact-sidebar-deliverable.test.ts
ui/src/ui/app.group-deliverable-preview.node.test.ts
.kiro/specs/collaboration-deliverable-preview/design.md, tasks.md
```

Source commits: `7ba978c4ed`, `f15ee5de34`, `881ef8777d`, `1b339687bc`
Note: PR #86-era work; `deploy/production/RELEASE_RECORD.md` records a v95 cutover for it, so this
shipped once and was then lost when the trunk changed. Highest embarrassment risk if left out.

### G4 — Task context store and group decision capsule (5 files)

```
src/auto-reply/reply/task-context-store.ts
src/auto-reply/reply/group-decision-capsule.ts + .test.ts
src/gateway/server-methods/task-context.ts, task-context.pack.ts
```

### G5 — Tenant isolation leftovers (4 files)

```
src/gateway/tenant-registry-store.ts
src/gateway/tenant-isolation-entitlement.ts
src/gateway/tenant-dedicated-cost.ts
src/gateway/user-modeling/tenant-membership.ts
```

`tenant-membership.ts` is the file named in the `delivery-alignment-guard` acceptance fixture as the
one a stale commit deleted. Check against the trunk's own tenant-context work before landing.

### G6 — Employee system authorization UI (2 files)

```
ui/src/ui/ports/employee/system-authorization.ts + .node.test.ts
```

Source commits: `832e0cfb55`, `5c8d0d0047`, `838cda84b1`, `d68dc3eae0`

### G7 — Data directory: memory list (2 files)

```
src/data/memory-list.ts + .test.ts
```

Source commits: `e06998b28c`, `72db0d35d7`, `a915dce051`, plus `0cec8a3d53 Types: type data.memory.list via request generic`

### G8 — Knowledge universe UI leftovers (3 files)

```
ui/src/ui/collaboration/resolve-group-scope.ts
ui/src/ui/controllers/knowledge-universe-personal-space.ts
ui/src/ui/controllers/knowledge-universe-local-folder-upload.ts
```

### G9 — Docs and ops scratch (7 files, judgement call)

```
docs/design/openbot-agent-context-lifecycle-architecture-v1.1-2026-07-24.md
docs/design/openbot-system-sandbox-security-implementation-plan-2026-07-24.md
docs/design/templates/saas-employee-security-context.template.json5
scripts/ops/verify-ghost-bot-health.sh
deploy/production/scripts/{consistency-report,final-gateway-auth-fix,final-repair-summary,gateway-auth-fix}.md
deploy/production/scripts/rebuild-gateway.sh
```

The two design docs belong on the trunk (they document G1/G2). The four
`deploy/production/scripts/*.md` files are incident scratch notes and the retirement default for
them is: leave in the archive tag, do not fold forward.

## Recovery command

Anything in this document is retrievable without network access to the archive:

```bash
git show archive/main-pre-baseline-20260727:<path>
```

## Explicitly not folded forward

`.tmp/workspace-audit-20260723/**` — 299 files of audit scratch that were committed to a trunk.
They stay in the archive tag.
