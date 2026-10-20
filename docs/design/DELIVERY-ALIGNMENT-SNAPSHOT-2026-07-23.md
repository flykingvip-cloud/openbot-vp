# Delivery Alignment Snapshot

**Generated:** 2026-07-23T15:01Z  
**Git:** `/usr/bin/git` 2.50.1  
**Action:** Phase A–F complete. **L3 verified 2026-07-23/24** via SSH `8.217.93.71`. Main reset 2026-07-24.

---

## L0 — Main tree (`~/AI项目/openbot`, branch `main`)

| Field               | Value                                      |
| ------------------- | ------------------------------------------ |
| HEAD                | `96bcb0877e`                               |
| vs `origin/main`    | **synced** (reset 2026-07-24 after rescue) |
| MERGE_HEAD / rebase | none                                       |
| Dirty count         | **0 tracked**                              |
| UU conflicts        | **0**                                      |

**Rescued 2026-07-24:** ahead-6 + 514-file WIP → `consolidation/main-wip-rescue-20260724` @ `a038f5c113`.

---

## L1 — Feature & release worktrees

| Worktree                                 | Branch                                      | vs origin             | Status                     |
| ---------------------------------------- | ------------------------------------------- | --------------------- | -------------------------- |
| `openbot-fix-scoped-package-templates`   | `fix-scoped-package-templates`              | synced @ `caff1dc1b3` | ✅ pushed                  |
| `openbot-knowledge-workbench-import-ia`  | `kiro-web-ui/knowledge-workbench-import-ia` | synced @ `6c15798995` | ✅ Phase C rescue          |
| `openbot-web-favicon-branding`           | `codex-favicon/web-favicon-branding`        | synced @ `d31e915298` | ✅ Phase C rescue          |
| `openbot-enterprise-ai-model-governance` | `kiro/enterprise-ai-model-governance`       | synced @ `a0120ae5a0` | ✅ Phase C rescue          |
| `consolidation/main-wip-rescue-20260724` | branch on origin                            | @ `a038f5c113`        | main WIP rescue 2026-07-24 |
| `openbot-enterprise-channels-release`    | `codex/openbot-enterprise-channels-release` | @ `e7a3a214e0`        | ✅ L3 SoT                  |
| `openbot-archives/openbot-rc`            | `release/candidate-20260712`                | @ `3337049cb4`+       | STALE RECORD               |
| `openbot-archives/openbot-convergence`   | `convergence/2026-07-20`                    | @ `385dcd8108`        | STALE RECORD               |
| `openbot-archives/openbot-nginx-ops`     | `wip/ops-nginx-hsts-https-redirect`         | synced                | clean                      |

### fix-scoped push record

```
2a9986604f..caff1dc1b3  fix-scoped-package-templates -> origin/fix-scoped-package-templates
```

Commits pushed (B + C):

- `663337e3f5` Employee settings: rework robots & groups UX
- `0b47c51bfe` Gateway: add cross-session user modeling for learned per-user preferences
- `caff1dc1b3` UI: user-modeling panel + delivery alignment snapshot update

---

## L2 / L3 — GitHub vs production (verified 2026-07-23)

| Role                                            | SHA / ref                                          | Notes                                                   |
| ----------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------- |
| **L3 live (SSH verified)**                      | `a5c9765ce73b5f04cb1e70b94cea035e82221f22`         | v91 · `rc-amd64-v91-enterprise-channels-secretref-save` |
| **L3 SoT RECORD**                               | `origin/codex/openbot-enterprise-channels-release` | v91 @ `ed42ed3a3b+`; live @ `a5c9765`                   |
| `origin/main`                                   | `96bcb0877e`                                       | policy trunk; main L0 clean                             |
| `origin/consolidation/main-wip-rescue-20260724` | `a038f5c113`                                       | unpushed-from-main WIP rescue                           |
| RC / convergence RECORDs                        | v54 / v55                                          | **STALE** — marked archived 2026-07-23                  |

**Gate defaults:** `verify-delivery-alignment.sh` prod SHA = `a5c9765` (enterprise-channels SoT).

---

## Gate script availability

| Ref                                                | `verify-delivery-alignment.sh`                   |
| -------------------------------------------------- | ------------------------------------------------ |
| `origin/codex/openbot-enterprise-channels-release` | ✅ SoT branch + RECORD                           |
| `origin/release/candidate-20260712`                | ✅ RC gate (prod defaults → enterprise-channels) |
| `fix-scoped-package-templates`                     | ✅ present                                       |
| `origin/main`                                      | ❌ absent                                        |

**Gate:** `./deploy/production/scripts/verify-delivery-alignment.sh` on RC worktree — **OK with warnings** (no tag/image yet).

---

## Worktree map (10 registered)

```
~/AI项目/openbot                              [main]           ← L0 shared, clean tracked
~/AI项目/openbot-fix-scoped-package-templates [fix-scoped]
~/AI项目/openbot-knowledge-workbench-import-ia [kiro-web-ui/knowledge-workbench-import-ia]
~/AI项目/openbot-web-favicon-branding         [codex-favicon/web-favicon-branding]
~/AI项目/openbot-enterprise-ai-model-governance [kiro/enterprise-ai-model-governance]
~/AI项目/openbot-enterprise-channels-release      [enterprise-channels] ← L3 SoT
~/AI项目/openbot-archives/openbot-rc          [release/candidate] STALE RECORD
~/AI项目/openbot-archives/openbot-convergence [convergence/2026-07-20]
~/AI项目/openbot-archives/openbot-nginx-ops   [wip/ops-nginx-...]
~/.openbot/supervisor/workspaces/sup_*        [supervisor]     ×2
```

---

## Phase C rescue summary

| Branch                                      | Commit       | Task                                           |
| ------------------------------------------- | ------------ | ---------------------------------------------- |
| `fix-scoped-package-templates`              | `caff1dc1b3` | cross-session-user-modeling UI + delivery docs |
| `kiro-web-ui/knowledge-workbench-import-ia` | `6c15798995` | knowledge-workbench-import-ia                  |
| `codex-favicon/web-favicon-branding`        | `d31e915298` | web-favicon-branding                           |
| `kiro/enterprise-ai-model-governance`       | `a0120ae5a0` | enterprise-ai-model-governance spec            |

**Left on main (owner TBD):** `deploy/` (ops notes), `.tmp/` (audit artifacts), `src/gateway/agent-runtime-health.ts` (new untracked)

---

## Phase E — L3 SoT closure (2026-07-23)

| Deliverable          | Location                                             |
| -------------------- | ---------------------------------------------------- |
| v91 RECORD patch     | `ed42ed3a3b` on enterprise-channels                  |
| STALE banners        | RC + convergence `RELEASE_RECORD.md`                 |
| verify prod defaults | `a5c9765` / v91 image                                |
| RC cutover doc       | **SUPERSEDED** — prod already on enterprise-channels |

---

## Phase F — expert acceptance fixes (2026-07-24)

| Deliverable                 | Status                                             |
| --------------------------- | -------------------------------------------------- |
| Main L0 reset               | ✅ `main` = `origin/main` @ `96bcb0877e`           |
| WIP rescue branch           | ✅ `consolidation/main-wip-rescue-20260724` pushed |
| verify STALE false-positive | ✅ RC + fix-scoped scripts fixed                   |
| Host RECORD pointer         | ✅ refreshed 2026-07-23                            |

### Original consolidation alignment

| Original goal                      | Status                      |
| ---------------------------------- | --------------------------- |
| Worktree map ≤10 + archives        | ✅                          |
| L3 SoT (enterprise-channels v91)   | ✅                          |
| Main not release tip / clean L0    | ✅ (re-restored 2026-07-24) |
| STALE RECORD on dead release lines | ✅                          |
| Automated verify gate              | ✅ (WARN-only pre-tag)      |

---

## Open decisions (maintainer)

1. **Land rescue WIP:** review `consolidation/main-wip-rescue-20260724` → split PRs by owner
2. **RC-line migration:** only if replacing enterprise-channels prod
3. **Hotfix tag policy:** document tag-exempt path for v88–v91 chain

Raw machine output: `.tmp/delivery-alignment-snapshot-20260723.txt`
