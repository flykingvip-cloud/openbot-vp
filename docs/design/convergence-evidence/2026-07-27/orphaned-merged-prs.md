# Orphaned merged PRs: #90 and #91

**Status:** open defect, scoped here, not yet remediated.
**Cause:** the non-fast-forward update of `origin/main` on 2026-07-27 (recorded in `deploy/production/RELEASE_RECORD.md` under "Trunk restoration").
**Recovery source:** tag `archive/main-pre-baseline-20260727`, branch `backup/main-pre-forcepush-20260727`.

## The defect

Two pull requests are reported by GitHub as **MERGED** while their merge commits are no longer
reachable from the trunk:

| PR  | Title                                              | Merge commit | On `origin/main` |
| --- | -------------------------------------------------- | ------------ | ---------------- |
| #90 | Gateway: restore main dangling module refs (L1–L9) | `f3379fd056` | **no**           |
| #91 | Types: clear post-recovery main type drift         | `999988406`  | **no**           |

This is the exact failure mode the delivery governance work exists to eliminate — a claim of
"shipped" that the repository does not back — and the governance pass itself created two instances
of it. It was found by an independent ref-by-ref audit, not by the actor who caused it.

## What is actually missing

Path existence alone overstates the loss, and file-level difference overstates it too, because the
trunk lineage kept evolving the same files for 17 days. Breaking it down:

| PR  | files touched (excl. `.tmp/`) | identical on `main` | absent from `main` | present but different |
| --- | ----------------------------- | ------------------- | ------------------ | --------------------- |
| #90 | 243                           | 156                 | 14                 | 73                    |
| #91 | 69                            | 3                   | 8                  | 58                    |

Of the 131 differing files, **96 are larger on `main`** (61 of 73 for #90, 35 of 58 for #91), i.e.
the trunk is generally ahead. Size is a proxy and not proof, but it narrows review sharply:

> Real review scope is **22 absent + 35 archive-larger = 57 files**, not 153.

## Tier 1 — absent from the trunk (22 files)

### PR #90 (14)

```
src/auto-reply/reply/experience-capsule-backflow.ts
src/auto-reply/reply/learning-recall-context.ts
src/auto-reply/reply/learning-recall.ts
src/auto-reply/reply/learning-skill-curation.ts
src/gateway/agent-growth/experience-capsule.ts
src/gateway/agent-growth/experience-capsule.test.ts
src/gateway/agent-growth/skill-draft-curation.ts
src/gateway/agent-growth/working-style-store.test.ts
src/gateway/collaboration-learning/review-rejection-experience.ts
src/gateway/tenant-dedicated-cost.ts
src/gateway/tenant-isolation-entitlement.ts
src/gateway/tenant-registry-store.ts
ui/src/ui/controllers/knowledge-universe-local-folder-upload.ts
ui/src/ui/controllers/knowledge-universe-personal-space.ts
```

**Nine of these are under live edit in the shared worktree right now** (the learning / experience
capsule / agent-growth cluster). They are being re-created independently, so they must be left to
their owners rather than restored from the archive — restoring would collide with in-flight work.
Cross-reference: the "do not touch" list in `fold-forward-gap.md` and the frozen L0 patches in this
same directory.

### PR #91 (8)

```
src/gateway/actor-scope.test.ts
src/gateway/collaboration-learning/collaboration-vacancy-archive.test.ts
src/gateway/server-methods/task-context.ts
src/gateway/tenant-isolation-entitlement.ts
src/memory/query-atoms-acl.test.ts
ui/src/ui/app.group-deliverable-preview.node.test.ts
ui/src/ui/wiring/deliverable-save.ts
ui/src/ui/wiring/deliverable-save.test.ts
```

`actor-scope.test.ts` and `query-atoms-acl.test.ts` are the **tests** for the Security P1.1 access
controls in group G1 of `fold-forward-gap.md`. Landing the implementation without them would put an
untested ACL layer on the trunk.

## Tier 2 — archive version is larger, review needed (35 files)

Ranked by gap, since a large gap is where behaviour is most likely missing rather than merely
reformatted.

| file                                                                 | archive | main   | note                                  |
| -------------------------------------------------------------------- | ------- | ------ | ------------------------------------- |
| `src/gateway/collaboration-learning/capsule-governance.ts`           | 12282 B | 3845 B | trunk has under a third; review first |
| `src/gateway/server-methods/platform-tenant.ts`                      | 18913 B | 9660 B | trunk has about half                  |
| `src/gateway/server-methods/enterprise-memory-governance.ts`         | 4894 B  | 3387 B |                                       |
| `packages/collaboration-runtime/src/contracts/learning-promotion.ts` | 8797 B  | 6581 B |                                       |
| `src/gateway/agent-growth/growth-events.ts`                          | 2694 B  | 1884 B |                                       |
| `packages/collaboration-core/src/types/learning.ts`                  | 4134 B  | 3553 B |                                       |
| `src/gateway/collaboration-learning/capsule-governance.test.ts`      | 3409 B  | 2705 B | pairs with the file above             |
| `ui/src/ui/capability/ai-workforce-governance/types/index.ts`        | 10089 B | 9196 B |                                       |
| `ui/src/ui/views/knowledge-universe-ui-prefs.ts`                     | 8265 B  | 8096 B |                                       |
| `src/gateway/user-modeling/record-signal.ts`                         | 3679 B  | 3540 B |                                       |

The remaining 25 differ by tens of bytes and are most likely formatting or a single line; they are
listed in full by re-running the check below.

`.loom/registry.yaml` appears in both PRs' archive-larger sets. It is a registry, not code — do not
restore it wholesale; reconcile ownership rows instead.

## Reproducing this analysis

```bash
MC=f3379fd05660   # or 99998840604e for #91
git diff --name-only "$MC^1" "$MC" | grep -v '^\.tmp/' | sort | while read -r f; do
  git cat-file -e "origin/main:$f" 2>/dev/null || { echo "ABSENT  $f"; continue; }
  a=$(git rev-parse "$MC:$f"); b=$(git rev-parse "origin/main:$f")
  [ "$a" != "$b" ] && echo "DIFFER  $f"
done
```

Recover any single file with:

```bash
git show archive/main-pre-baseline-20260727:<path>
```

## Remediation plan

1. **Do not bulk-restore.** The trunk is ahead on 96 of 131 differing files; a blanket restore would
   regress it. This is the same trap as cutting over from a stale lineage.
2. **Tier 1, non-conflicting subset first** — the 13 absent files not under live edit, grouped with
   the matching `fold-forward-gap.md` groups (G1 security tests, G3 deliverable preview, G5 tenant
   isolation).
3. **Tier 1, live-edit subset** — leave to the owning agents; track via `pnpm loom claim`.
4. **Tier 2** — review the four large-gap files individually before anything else.
5. **Correct the GitHub state** — comment on #90 and #91 pointing here, so no reader treats MERGED
   as "present on the trunk".

## Guardrail already in place

`git-hooks/pre-push` (installed 2026-07-27 by a separate agent) now rejects non-fast-forward pushes
and deletions on `main`, `release/*` and `backup/*`, with `OPENBOT_ALLOW_FORCE_PUSH=1` as an
explicit escape valve that also requires a row in `RELEASE_RECORD.md`. That hook is what prevents a
third instance of this defect.
