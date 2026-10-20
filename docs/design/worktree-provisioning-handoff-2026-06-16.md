# Loom Provisioning M-Prov-1 Merge Handoff (2026-06-16)

> Audience: maintainer landing this work, and `kiro-fabric` (Fabric Stage-2 owner).
> Spec: `.kiro/specs/loom-provisioning/`. Architecture: `docs/design/worktree-provisioning-architecture-2026-06-16.md`.
> Status: M-Prov-1 acceptance PASS (42-point gate). Awaiting maintainer landing via PR.

## 1. Scope declaration (responsibility boundary)

Loom Provisioning has completed its product responsibility: **it provides a
stable Ownership / Attribution Signal Boundary** (worktree isolation lifecycle,
provisionId binding, reconcile/recovery, and the compile-time `LoomAttribution`
shape).

**Stage-2 Signal Consumption is NOT in Loom's scope.** Wiring these signals into
the Fabric Policy Runtime (Stage 2), running the policy Replay validation, and
accepting it is the responsibility of **OpenBot Fabric (`kiro-fabric`)**, done
independently inside the `openbot-fabric` spec. `kiro-loom` does not and must not
modify the Fabric Policy Runtime.

## 2. What landed (commits to cherry-pick for the PR)

## 2. Landing status (corrected after execution 2026-06-16)

Execution of the plan revealed the real remote topology: **there is no
`origin/main`.** The remote default branch IS the shared
`codex/openbot/localization-workspace` (the de-facto trunk). Consequently most of
this work is **already on the trunk**. Push status of every provisioning commit:

| Commit       | Subject                                            | On trunk?    |
| ------------ | -------------------------------------------------- | ------------ |
| `0c14ab6f3e` | spec: author Phase 2 spec                          | PUSHED       |
| `54a2bb2b19` | spec: adopt architecture review                    | PUSHED       |
| `b723be860d` | spec: operational-safety hardening                 | PUSHED       |
| `45cf2247ec` | feat: git.ts (Wave 0)                              | PUSHED       |
| `ae950d740c` | feat: provision.ts core (Wave 1)                   | PUSHED       |
| `65bb67c7ff` | feat: task start (Wave 2)                          | PUSHED       |
| `f7f0c96390` | feat: task land + abandon (Wave 3)                 | PUSHED       |
| `dd2fa6e63f` | feat: task list + reconcile/repair (Wave 4)        | PUSHED       |
| `71e84fc3cd` | test: real-git e2e (Wave 5)                        | PUSHED       |
| `35d9b886e2` | spec: mark M-Prov-1 done                           | PUSHED       |
| `8cefe54ee7` | docs: architecture diagrams                        | PUSHED       |
| `b70cea5c55` | feat: abandon secondary-confirm + coverage (E4/B1) | **UNPUSHED** |
| `8cda7f2175` | docs: merge handoff                                | **UNPUSHED** |

So **M-Prov-1 Waves 0–5 are already on the de-facto trunk**. Two deltas remain
unpushed, embedded inside 78 unpushed mixed-author commits on the shared branch.

### Attribution correction (governance)

`b70cea5c55` was committed with a `printf` directive error that **truncated its
message and dropped the mandatory `Task:` / `Agent:` trailers** (it ends mid-word
at "git.ts 98"). Its subject prefix `feat(loom):` still identifies it as Loom
work. Authoritative attribution for the record:

- `b70cea5c55` -> `Task: loom-provisioning` / `Agent: kiro-loom`

History rewrite to re-add the trailer is NOT performed: the commit sits under 78
later mixed-author commits on a shared branch, so rebasing it would be a
forbidden cross-cutting history change. This note is the recoverable record.

## 3. Exact file set (only these 11 files)

```
.kiro/specs/loom-provisioning/requirements.md
.kiro/specs/loom-provisioning/design.md
.kiro/specs/loom-provisioning/tasks.md
docs/design/worktree-provisioning-architecture-2026-06-16.md
scripts/loom/git.ts
scripts/loom/provision.ts
scripts/loom/status.ts                 (additive: worktree/branch in status view)
scripts/loom.ts                        (additive: `task` subcommand router)
scripts/__tests__/loom/git.test.ts
scripts/__tests__/loom/provision.test.ts
scripts/__tests__/loom/provision.e2e.test.ts
```

No `src/**` changes. No other agent's files. `scripts/loom.ts` and
`scripts/loom/status.ts` are shared hot files edited additively only.

## 4. Final landing path (corrected — Plan A as written is N/A)

Plan A (cherry-pick onto `origin/main` + PR) is **infeasible**: no `origin/main`
exists. It is also **moot**: Waves 0–5 are already on the trunk. The only
remaining work to reach the remote is the 2 unpushed deltas (`b70cea5c55`,
`8cda7f2175`), which live among 78 unpushed mixed-author commits.

Pushing the trunk carries all 78 commits (many other agents'), which is a
maintainer-owned `sync`/push, not a `kiro-loom` action and not a direct-merge.
Recommended:

- **Maintainer**: when next syncing the trunk (`git pull --rebase` then
  `git push` of `codex/openbot/localization-workspace`), the 2 deltas land
  naturally with the rest. No isolated PR is needed because there is no separate
  `main` to PR into.
- If an isolated, reviewable PR of ONLY Loom is still desired, base it on the
  pushed trunk tip (which already contains the Loom MVP + Waves 0–5) and
  cherry-pick just `b70cea5c55` (+ this handoff) onto a clean branch:

```sh
git fetch origin
git checkout -b kiro-loom/loom-provisioning-tail origin/codex/openbot/localization-workspace
git cherry-pick b70cea5c55 8cda7f2175
pnpm exec vitest run scripts/__tests__/loom/      # expect 171 passed
node --import tsx scripts/loom.ts check --strict  # expect 0 diffs
git push -u origin kiro-loom/loom-provisioning-tail && gh pr create --fill
```

`kiro-loom` did NOT execute any push/branch/history-rewrite: pushing the shared
78-commit trunk is disallowed, and there is no `main` to open the originally
planned PR against. This requires a maintainer decision.

### (superseded) original Plan A draft

```sh
# from an up-to-date main  (N/A: no origin/main exists)
git checkout -b kiro-loom/loom-provisioning origin/main
git cherry-pick 0c14ab6f3e 54a2bb2b19 b723be860d 45cf2247ec ae950d740c \
                65bb67c7ff f7f0c96390 dd2fa6e63f 71e84fc3cd 35d9b886e2 8cefe54ee7
# verify, then open PR
pnpm exec vitest run scripts/__tests__/loom/
node --import tsx scripts/loom.ts check --strict   # expect 0 diffs
git push -u origin kiro-loom/loom-provisioning
gh pr create --fill
```

PR required checks must include `loom check` (parity). Land via Merge Queue per
`/landpr`.

## 5. Acceptance evidence (M-Prov-1 gate = PASS)

- Unit: 171 Loom tests green. Coverage: `git.ts` 98.0% stmt / 86.6% branch;
  `provision.ts` 92.5% stmt / 85.1% branch (>= 90/85 bar).
- e2e (real git, gated): 7/7 green (start, refuse-overwrite, land merge + GC,
  dirty -> DIRTY_WORKTREE, abandon refuse -> --force --yes, ORPHANED -> repair,
  list health).
- Zero regression: `loom check --strict` parity `ok=true, 0 diffs`.
- Security: argv-only git (no shell), path/branch injection rejected, forced
  abandon requires `--force --yes` + loss summary.
- Boundary: `grep src/fabric scripts/loom` = 0; `grep registry.yaml src/fabric` = 0.

Caveats (non-blocking):

- `provision.ts` statement coverage 92.5% (below the 95% aspirational; residual
  is real-git edge paths exercised by the gated e2e, not counted in unit run).
- The gated e2e is excluded from `pnpm test` by `**/*.e2e.test.ts`; wiring it
  into `pnpm test:e2e` needs a maintainer to give `vitest.e2e.config.ts` a
  worktree-audit landing disposition. Run it meanwhile via a one-off include.

## 6. Interface for kiro-fabric (M4 Stage-2 consumption)

Loom exposes its signal ONLY through the existing stable boundary; Fabric adapts
real Loom output into this shape at compile time. No runtime Loom lookup.

- Boundary type: `LoomAttribution` in `src/fabric/mappers.ts`
  - `{ owner?, agent?, taskId?, matchedRules?, conflict?, unattributed? }`
- Mappers (already present, Fabric-side):
  - `attributionToOwnership(attr)` -> `OwnershipMetadata` (the "who" for PolicyDecision)
  - `attributionTraceEntry(attr)` -> `DecisionTraceEntry` with `effect: "neutral"`
- Provisioning metadata available to feed the adapter (from the registry, at
  compile time): `session.worktree`, `session.metadata.{branch, provisionId}`,
  task `state`, and reconcile findings (`OK|ORPHANED|MISSING_BRANCH|UNTRACKED_WORKTREE|STALE`).

Rules kiro-fabric must hold when consuming (per `openbot-fabric` Rule #1..#4 and
the target architecture doc):

1. Consume at **Stage 2 (Governance Signals)** only. Never gate at Stage 1; never
   author constraints at Stage 3 from Loom alone.
2. `effect` stays `neutral`: a Loom signal must never, by itself, flip
   ALLOW <-> DENY. (D3 Replay: identical request with/without Loom signal may
   differ only in `decisionTrace`, never in the decision.)
3. No runtime registry read (D4). Bake the signal into `PolicyDecision` at decide
   time via the mapper; do not read `.loom/registry.yaml` from `src/fabric`.
4. Do not import provisioning internals (Worktree/GitStatus/provisionId) into the
   Policy Runtime; only `LoomAttribution` crosses the boundary (D2).

kiro-fabric owns: the Stage-2 wiring, the D3 policy-replay test, and M4 acceptance.

## 7. Decision record

- B (this handoff): executed now.
- A (clean PR branch + push): prepared above; **pending maintainer approval** (human authorizes isolation/push).
- C (do nothing): not selected.
- Direct merge to main: not allowed.
- kiro-loom modifying Fabric Policy Runtime: not allowed.
