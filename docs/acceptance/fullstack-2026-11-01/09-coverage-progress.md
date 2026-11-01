# 09 — Fullstack coverage progress (credential-free batch2)

**When:** 2026-11-01 23:40 Asia/Shanghai (coverage evidence); docs follow-up land 2026-11-01 Asia/Shanghai  
**Worktree (land):** `/Users/daniel/AI VP/openbot-acceptance-coverage-20261101`  
**Evidence pin (batch2):** `1ce8f5ee4e8c852d45a9c6a30a623e0bed082587`  
**Denominator:** N≈118 (see [`../runs/2026-11-01-pr192-review/coverage-denominator.md`](../runs/2026-11-01-pr192-review/coverage-denominator.md))  
**Constraints honored:** no live credentials; SwiftPM **BLOCKED**; no product drive-bys; `/Users/daniel/AI VP/openbot/` untouched.

> **Landing note:** PR #192 product fix is **MERGED** on main (`bc843c70…`, head that merged `1ce8f5ee…`). Coverage expansion commit `33c45c5c1` was stranded only on `fix/p1-def001-002-004-20261101`. **This PR is a docs-only follow-up** to put coverage denominator + this progress file on tip of main lineage. No product code.

## main 状态

| Item                                | Value                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `origin/main` tip (fetch at land)   | `d42fbc3ca2b4041ee70bb1dfb9cd70f33678370c` (`docs(memory): final closeout acceptance (draft) (#182)` lineage tip) |
| PR #192 merge commit on main        | `bc843c70ecdd3afdae0020403d4b4b22c8849371` — **MERGED** (outside coverage-agent no-merge auth)                    |
| Earlier review-end main             | `5815006dccd3287676e836ad8238a8ca6becdab4` (#191 billing)                                                         |
| Tip drift since PR #192 review docs | **YES** — main advanced past review-end; product fix already on main                                              |
| Live / deploy on main               | **NOT RUN** in this batch                                                                                         |
| SwiftPM on main                     | **BLOCKED** (policy; not executed)                                                                                |

## PR候选(已合入历史)

| Item                                                | Value                                                                                         |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Product PR (history)                                | https://github.com/flykingvip-cloud/openbot-vp/pull/192 — **MERGED**                          |
| Branch (historical)                                 | `fix/p1-def001-002-004-20261101`                                                              |
| HEAD that merged                                    | `1ce8f5ee4e8c852d45a9c6a30a623e0bed082587`                                                    |
| Merge commit                                        | `bc843c70ecdd3afdae0020403d4b4b22c8849371`                                                    |
| Independent verdict (REVIEW.md)                     | **可合并（条件）** — DEF-001/002/004 verified; format delta 0; SwiftPM BLOCKED; live NOT RUN  |
| Gates (from review/remediation)                     | tsgo PASS; `protocol:check` PASS; focused DEF tests PASS; oxfmt acceptance docs               |
| Docs follow-up (this PR)                            | branch `docs/acceptance-coverage-20261101` — coverage denominator + 09 progress only          |
| This batch product code                             | **none** (acceptance docs + logs only)                                                        |
| Remaining confidence gaps (product already on main) | SwiftPM compile; live credential surfaces; Stage4 credentials-omit FAIL; Stage6 audit network |

## 未验证范围

| Gap                                                                 | Status                      | Why                                                                           |
| ------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| Live Enterprise IM (WeCom/Feishu/DingTalk) + other channel live I/O | **BLOCKED / NOT RUN**       | No live credentials authorized                                                |
| Live gateway doctor / agent turn / pairing / tool invoke            | **NOT RUN**                 | Credential-free batch only; no loopback doctor this pass                      |
| SwiftPM / `swift build` (macos OpenBotProtocol and app)             | **BLOCKED**                 | Explicit policy + prior dep-fetch hang                                        |
| ios `xcodebuild -list` / compile                                    | **BLOCKED**                 | No generated `.xcodeproj` (project.yml; needs xcodegen)                       |
| windows `dotnet` build                                              | **BLOCKED**                 | SDK missing on Mac                                                            |
| harmony hvigor build                                                | **BLOCKED**                 | `hvigorw` missing                                                             |
| android `assembleDebug` / install                                   | **NOT RUN**                 | Only `./gradlew tasks` listed (signing-free assemble deferred)                |
| openbot.love install.sh / install-cli.sh / install.ps1              | **跨仓依赖 / NOT RUN**      | Sibling repo ABSENT on Mac                                                    |
| Stage4 full PASS                                                    | **CONDITIONAL**             | 1/26 FAIL — default backup archive credentials exclusion                      |
| Stage5 prod HA deploy                                               | **CONDITIONAL**             | Wiring PASS; docker compose HA profile skipped                                |
| Stage6 live `pnpm audit` + SBOM regen parity                        | **BLOCKED / FAIL(timeout)** | Corepack registry timeout; regen ETIMEDOUT — committed SBOM still PASS static |
| Packages (collab/AOR/evolution) runtime                             | **NOT RUN**                 | Presence only                                                                 |
| Control UI interactive ports / employee surfaces                    | **NOT RUN**                 | Build ≠ interactive coverage                                                  |
| Memory continuity e2e seats / governed SAR live                     | **NOT RUN**                 | After DEF land; needs seats/creds                                             |

### Batch2 measurable progress

- Stages **4–6** moved from “NOT RUN this review” → CURRENT credential-free evidence rows (see coverage-denominator batch2 table).
- CLI help coverage expanded beyond doctor/channels; channel docs↔plugins **24↔24** reconfirmed.
- Multi-end: all 6 roots PRESENT; android gradle task inventory PASS; macos dump-package PASS; three native toolchains BLOCKED.
- Primary N remains **118**; live/SwiftPM/跨仓 slices still dominate **未验证范围**.

### Artifact paths

- `docs/acceptance/runs/2026-11-01-pr192-review/coverage-denominator.md`
- `docs/acceptance/runs/2026-11-01-pr192-review/logs/10-*.log`
- This file: `docs/acceptance/fullstack-2026-11-01/09-coverage-progress.md`

## 2026-11-02 update (credentials-omit + denominator harden)

- Soft “约 N=118” **superseded** by row-tracked inventory: [`10-coverage-inventory-tracked.md`](./10-coverage-inventory-tracked.md) (**N=66** stable IDs).
- DEF-008 OPEN — backup credentials-omit FAIL on main `d42fbc3ca2…` (security boundary YES). Evidence: `../runs/2026-11-02-credentials-omit/`.
- Control UI: `ui:build` PASS + static smoke PASS; interactive NOT_RUN. Live creds NOT_RUN.
- Fullstack still **NOT PASS**. See [`10-acceptance-conclusion.md`](./10-acceptance-conclusion.md).

