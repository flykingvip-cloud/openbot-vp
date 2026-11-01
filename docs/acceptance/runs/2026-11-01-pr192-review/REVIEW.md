# PR #192 Independent Review — 2026-11-01

**Reviewer role:** independent (no rubber-stamp of PR author gates)  
**Repo (verified):** `flykingvip-cloud/openbot-vp` via `origin` = `git@github.com-flykingvip:flykingvip-cloud/openbot-vp.git`  
**Worktree:** `/Users/daniel/AI VP/openbot-p1fix-f68a3c56b` (PR branch)  
**Base worktree (detached):** `/Users/daniel/AI VP/openbot-pr192-main-f68a3c56b` @ `f68a3c56b`  
**Timezone:** Asia/Shanghai (CST / UTC+8)  
**Authorization:** review + acceptance docs only — **no merge, no deploy, no live credentials**

## Verdict

### **可合并（条件）**

Product DEF-001 / DEF-002 / DEF-004 fixes independently verified; acceptance docs oxfmt’d; branch rebased onto `origin/main` `#191` tip; post-rebase gates green; **format:check delta vs tip = 0**.  
**Conditions / still open:** SwiftPM build remains **BLOCKED** (not substituted by `protocol:check`); live credential tests **NOT RUN**; no merge/deploy in this remediation.

---

## main 状态

| Item                                      | Value                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| Review-start `origin/main`                | `f68a3c56b00fe060209678921bfdc28dbd4138b5` (`运行时接入平台模型能力准入 (#190)`)              |
| Review-end `origin/main` (after re-fetch) | `5815006dccd3287676e836ad8238a8ca6becdab4` (`fix: 缓存计费／零价覆盖… (#191)`)                |
| Tip drift?                                | **YES — 1 commit** (`#191`) landed on main after PR opened                                    |
| Drift file overlap with PR #192?          | **None** (billing/cost-version only)                                                          |
| merge-tree conflicts vs current main?     | **None observed** (`CONFLICT`/`changed in both` count 0)                                      |
| Format on base @ `f68a3c56b`              | `pnpm format:check` **FAIL — 29 files** (pre-existing)                                        |
| tsgo on base @ `f68a3c56b`                | **FAIL exit 2** — 196 `error TS*` (`logs/00-tsgo.on-BASE.*`) including DEF-001 + DEF-004 loci |

---

## PR 候选状态

| Item                         | Value                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| PR                           | https://github.com/flykingvip-cloud/openbot-vp/pull/192                                |
| Base (PR)                    | `f68a3c56b00fe060209678921bfdc28dbd4138b5`                                             |
| Head                         | `7b92f67c15f3222e9021605fc6516525b93e4a21` (post-remediation; see remediation section) |
| Commits                      | 2 (`c1c31855a` fix; `433906f5b` docs gates)                                            |
| Ahead/behind vs current main | **2 ahead / 1 behind**                                                                 |
| Changed files                | 61 (mostly acceptance logs + Swift models + targeted src/tests)                        |

### Unrelated / surprise paths?

**No product drive-bys.** All non-doc code paths map to DEF fixes or tip-`tsgo` collateral errors visible on base:

- DEF-001: `src/plugins/runtime/types-core.ts`, `types.contract.test.ts` + producer-side tip errors in listed test files / `enterprise-data-events.ts`
- DEF-002: `apps/macos/.../GatewayModels.swift`, `apps/shared/OpenBotKit/.../GatewayModels.swift`
- DEF-004: `src/gateway/enterprise-data/event-driven-projection-materializer.ts`
- Loom: `.loom/registry.yaml` (ownership for this fix run)
- Docs/logs under `docs/acceptance/**` (expected for P1)

Minor note: loom paths list a non-existent `apps/shared/OpenBotKit/Sources/OpenBotKit/GatewayModels.swift` (typo vs `OpenBotProtocol`); registry-only, not a product bug.

### Per-DEF independent verdicts

#### DEF-001 — PluginMemoryToolFactory continuity fields — **PASS (fix verified)**

| Check                         | Evidence                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pre-fix locus on base         | `extensions/memory-core/index.ts:28,36` TS2353 — `authenticatedUserId` not in factory type (`logs/00-tsgo.on-BASE.log`)                                                                                                        |
| Root cause                    | `PluginMemoryToolFactory` on base omitted fields that producer (`extensions/memory-core/index.ts`) and runtime (`src/agents/tools/memory-tool.ts`) already use                                                                 |
| Fix                           | `src/plugins/runtime/types-core.ts:8-11` adds `authenticatedUserId?: string \| null`, `securityProfile?: "personal_local" \| "managed_enterprise"`, `accessContext?: MemoryIndexAccessContext` — **not `any` / not over-wide** |
| Producer/consumer consistency | Producer still passes the fields; runtime tools already declare matching options                                                                                                                                               |
| Contract test                 | `src/plugins/runtime/types.contract.test.ts` new case exercises both factories with continuity fields via `expectTypeOf`                                                                                                       |
| HEAD tsgo                     | **PASS exit 0** (`logs/01-tsgo.on-HEAD.*`)                                                                                                                                                                                     |
| Collateral tip fixes          | Test typing / mock shape fixes in bash-tools, cron delivery, authorize-shadow, chat.restore, enterprise-data-events\*, memory-continuity, collaboration-rules-summary — all appear in base tsgo error list                     |

#### DEF-002 — Swift GatewayModels / protocol:check — **PASS (gen repeatable; SwiftPM still BLOCKED)**

| Check                 | Evidence                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical commands    | `package.json`: `protocol:gen`, `protocol:gen:swift`, `protocol:check` (= gen + gen:swift + `git diff --exit-code` on schema + both GatewayModels)                                                                                                                                                                                  |
| Pre-fix               | On base, `protocol:check` regenerates Swift with real drift (parentTaskId/parentAgentId, collab linked deliverable fields, human-attention params, …)                                                                                                                                                                               |
| Fix                   | Committed regenerated models (+116 lines each path)                                                                                                                                                                                                                                                                                 |
| HEAD `protocol:check` | **PASS exit 0**, tree clean (`logs/02-protocol-check.on-HEAD.*`)                                                                                                                                                                                                                                                                    |
| Re-run gen on HEAD    | `protocol:gen` + `protocol:gen:swift` → **no unexpected drift** (repeatable)                                                                                                                                                                                                                                                        |
| **Not** Swift compile | `protocol:check` is schema/codegen drift only                                                                                                                                                                                                                                                                                       |
| SwiftPM full build    | **BLOCKED** — `swift build --target OpenBotProtocol` hung on dependency fetch (`Fetching https://github.com/steipete/ElevenLabsKit` / `textual`); see prior `docs/acceptance/runs/2026-11-01-p1-fix/logs/03c-swift-build-OpenBotProtocol.*`. Light `swiftc`+AnyCodable only supplementary — **does not substitute package compile** |

#### DEF-004 — SarGovernanceProvider wrong import — **PASS (fix verified)**

| Check         | Evidence                                                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-fix locus | Base `event-driven-projection-materializer.ts:23` imports `SarGovernanceProvider` from `./types.js` → TS2305 (`logs/00-tsgo.on-BASE.log`)    |
| Root cause    | Type lives in `sar-governance-bridge.ts:51` (`export type SarGovernanceProvider`); **not** exported from `types.ts` (empty on base and HEAD) |
| Fix           | `event-driven-projection-materializer.ts:23` → `import type { SarGovernanceProvider } from "./sar-governance-bridge.js"`                     |
| Module load   | `node --import tsx` import → `OK keys [ 'runEventDrivenProjectionsForEvent' ]` (`logs/04b-materializer-module-load.*`)                       |
| Focused tests | materializer + sar-governance-bridge + controlled-sar + types.contract: **19 tests PASS** (`logs/04-focused-def-regressions.log`)            |
| Call path     | Materializer still accepts `sarProvider?: SarGovernanceProvider` (`:105`); bridge export remains canonical                                   |

### Format: base vs HEAD (same env)

| Env              | Result                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| BASE `f68a3c56b` | FAIL — **29** files (`logs/03-format-check.BASE.log`)                                                                              |
| HEAD `433906f5`  | FAIL — **33** files (`logs/03-format-check.HEAD.log`)                                                                              |
| Attribution      | Pre-existing 29 **identical** intersection. **PR introduced 4 new failures** (all acceptance docs authored by this PR):            |
|                  | `docs/acceptance/p1-fix-2026-11-01/defect-status.md`                                                                               |
|                  | `docs/acceptance/runs/2026-11-01-p1-fix/00-pin.md`                                                                                 |
|                  | `docs/acceptance/runs/2026-11-01-p1-fix/gates-summary.md`                                                                          |
|                  | `docs/acceptance/runs/2026-11-01-p1-fix/scope-coverage.md`                                                                         |
| Product TS in PR | Not among the format-fail list (changed TS previously oxfmt-clean per author; independently, fail list is docs-only for the delta) |

**Required before merge:** `oxfmt --write` those 4 paths (or equivalent) so HEAD does not _add_ format debt.

### Re-run gates on HEAD (this review)

| Gate                                                 | Result                | Log                                         |
| ---------------------------------------------------- | --------------------- | ------------------------------------------- |
| `pnpm exec tsgo`                                     | PASS (0)              | `logs/01-tsgo.on-HEAD.*`                    |
| `pnpm protocol:check`                                | PASS (0)              | `logs/02-protocol-check.on-HEAD.*`          |
| Focused DEF regressions (4 files / 19 tests)         | PASS                  | `logs/04-focused-def-regressions.log`       |
| `pnpm test:auth:compat`                              | PASS (43)             | `logs/05-test-auth-compat.log`              |
| `OPENBOT_TEST_PROFILE=low pnpm build`                | PASS                  | `logs/06-build-low.log`                     |
| `pnpm format:check`                                  | FAIL (33; +4 PR docs) | `logs/03-format-check.HEAD.log`             |
| SwiftPM `swift build --target OpenBotProtocol`       | **BLOCKED**           | prior p1-fix 03c logs; not re-hung this run |
| Live WeCom/Feishu/DingTalk / live agent / live creds | **NOT RUN**           | not authorized                              |

---

## 未验证范围

- Full `swift build` / Xcode / iOS / Android / Harmony / Windows packaging
- Live IM channels, live agent turns, live credentials, multi-tenant production boot
- Repo-wide `pnpm check` / full vitest / Windows CI matrix
- Stages 4–6 end-to-end product acceptance; install/delivery from `openbot.love` sibling
- Control UI interactive ports beyond `build` artifact existence
- Collab/AOR package runtime beyond package tree presence
- SBOM CycloneDX artifact produced (`logs/sbom-cyclonedx.json`); treat as supply-chain inventory only, not product PASS
- Rebase onto `5815006dc` then re-run tsgo/protocol/build (recommended; overlap empty but not executed here)

---

## Required changes for 可合并

1. Format the 4 new acceptance markdown files so `format:check` delta vs base is not worse (ideally those 4 pass oxfmt).
2. Update/rebase branch onto current `origin/main` (`5815006dc` / #191) before merge; reconfirm tsgo + protocol:check + focused DEF tests on the rebased HEAD.

Optional follow-ups (non-blocking for these three DEFs): SwiftPM dep-resolve hang, SBOM timeout investigation, loom path typo.

---

## Remediation (2026-11-01, Asia/Shanghai)

Executed on USER Mac worktree `/Users/daniel/AI VP/openbot-p1fix-f68a3c56b` — **no merge, no deploy, live NOT RUN, SwiftPM stays BLOCKED**.

| Step                                                                 | Result                                                                                    |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| oxfmt 4 PR acceptance docs + review md                               | PASS (`defect-status`, `00-pin`, `gates-summary`, `scope-coverage`, REVIEW, coverage, 08) |
| Commit review package                                                | `7a5e5f3e3` then rebased → see HEAD below                                                 |
| `git fetch` + rebase onto `origin/main`                              | **OK** onto `5815006dccd3287676e836ad8238a8ca6becdab4` (#191); **0 conflicts**            |
| Post-rebase `pnpm exec tsgo`                                         | **PASS** exit 0 (`logs/post-rebase-tsgo.*`)                                               |
| Post-rebase `pnpm protocol:check`                                    | **PASS** exit 0 (`logs/post-rebase-protocol-check.*`)                                     |
| Changed-file `oxfmt --check`                                         | **PASS** exit 0 (`logs/post-rebase-oxfmt-changed.*`)                                      |
| `OPENBOT_TEST_PROFILE=low pnpm build`                                | **PASS** exit 0 (`logs/post-rebase-build-low.*`)                                          |
| `pnpm test:auth:compat`                                              | **PASS** 43 tests (`logs/post-rebase-auth-compat.*`)                                      |
| Focused DEF regressions (4 files / 19 tests)                         | **PASS** (`logs/post-rebase-focused-def-regressions.*`)                                   |
| Materializer module load                                             | **PASS** (`logs/post-rebase-materializer-module-load.*`)                                  |
| format:check tip (`5815006dc`)                                       | FAIL **29** pre-existing (`logs/post-rebase-format-check.BASE.*`)                         |
| format:check HEAD (after relocating untracked SBOM JSON out of tree) | FAIL **29** (`logs/post-rebase-format-check.HEAD.after-sbom-move.*`)                      |
| **format delta (PR-added failures)**                                 | **0**                                                                                     |
| Force-with-lease push                                                | see push log / PR #192                                                                    |

### Updated separated status

#### main 状态

- Tip at remediation: `5815006dccd3287676e836ad8238a8ca6becdab4` (#191 caching/billing)
- Tip drift vs original PR base: **cleared** by rebase

#### PR 候选状态

- Branch: `fix/p1-def001-002-004-20261101`
- HEAD (pre-push expected): rebased tip including oxfmt + review docs
- Verdict: **可合并（条件）** — gates green, format delta 0, SwiftPM BLOCKED, live NOT RUN

#### 未验证范围

- SwiftPM / `swift build` (BLOCKED)
- Live credentials / production or HK LIVE paths (NOT RUN)
- Full Stage 4–6 / multi-channel / installer cross-repo (coverage denominator still open; light CLI/static already logged)
