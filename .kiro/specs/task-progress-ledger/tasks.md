# Implementation Plan

> Feature: Task Progress Ledger。需求 `./requirements.md`，设计 `./design.md`，执行手册 `./execution-plan.md`。

## Agents

- cursor-grok · role: owner · scope: Progress Ledger 规格、实现与生产对齐记录 · paths: `.kiro/specs/task-progress-ledger/**`, `src/progress-ledger/**`, `src/auto-reply/turn-contract/**`, `src/cron/**`, `src/gateway/workbench/pending-tasks-read-model.ts`, `src/gateway/server-methods/progress-ledger.ts`, `ui/src/ui/ports/employee/views/personal-cron-*.ts`, `ui/src/ui/ports/employee/views/workbench-capability-contracts.ts`, `ui/src/ui/ports/employee/views/workbench-signals.ts`, `deploy/production/RELEASE_RECORD.md`, `docs/design/evidence/task-progress-ledger-*` · since: 2026-08-22
- historical, not live: `deploy/production/releases.jsonl` was a pre-split copy claimed by this spec. It is not the live ledger and must not be recreated in openbot-vp. Live ledger: https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl

## Tasks

- [x] 规格冻结（二次评审）：Event→State、Evidence 类型、executed/verified/completed、双进度、blocked\_\*、I1–I8、lastMeaningfulChangeAt
- [x] P0 Schema / Contract：`src/progress-ledger` 类型 + 状态机 + evidence 白名单 + I1–I8 + fold 单测；无 UI — cursor-grok
- [x] 验收补丁：VALIDATION_PASSED / STEP_VERIFIED / STEP_COMPLETED / ACCEPTANCE_MET（及 UNMET）必须在事件 payload 自带合法 evidence，禁止复用历史累计证据 — cursor-grok
- [x] P1 Projection Engine：`projectProgress` 纯函数（验收/执行双计数 + mode + gate + quiet 不推送 + stale）；无 UI — cursor-grok
- [x] P2 Runtime Writer：只追加合法事件；先接长程 cron；禁止 run 摘要当 canonical — cursor-grok
- [x] P3 Canonical UI：Chat / Cron / Detail 只渲染 Projection；flag 默认 off — cursor-grok
- [x] P4 Replan 产品化：planVersion 历史 — 模型只提议，runtime 追加 REPLAN_APPENDED；历史 step 只退役；详情展示「任务曾于 HH:MM 重新规划」— cursor-grok
- [x] P5 人闸进 pending-tasks；quiet 不通知 — 仅 blocked_user/blocked_authorization 进待办；执行步骤不进；quiet 不 notify — cursor-grok
- [x] P6 观测指标与管理后台只读同一 Projection — I1–I8 计数；`progress-ledger.admin.list` 只读 `projectProgress`；文档见 observability.md — cursor-grok
- [x] #597 squash 进 `main`：`25df222f26971854b00f52a611e810c26e2e8b91` — cursor-grok
- [x] 灰度签字（2026-08-22）：隔离单租户 `openbot-ledger-canary` 七项验收通过（第 4 项 pass-with-residual）。回执 `canary-signoff-20260822.md` + `docs/design/evidence/task-progress-ledger-canary-signoff-20260822.json` — cursor-grok
- [x] RELEASE_RECORD 对齐 + Ledger UI pin（2026-08-22）：LIVE 仍为 `c393dca8fe`；pin `index-Dpg8P1UR.js` / `ledger-ui-pin-r1`；针对 LIVE SHA 的 `verify-delivery-alignment.sh` PASS；生产 flag 仍关。— cursor-grok
- [x] 验收签字（2026-08-22 21:08）：**合并验收批准**；当时生产 flag 未批准。回执 `acceptance-signoff-20260822.md` — user + cursor-grok
- [x] 生产打开 Progress Ledger（2026-08-22 21:13）：用户指令「启用flag」。当时记录 LIVE `c393dca8fe`；`gateway.progressLedger.enabled=true`；`.env.docker` 写了 `OPENBOT_PROGRESS_LEDGER_ENABLED=1`（进程 env 待 recreate 才注入）。runtime `enabled=true`。— cursor-grok
- [x] RELEASE_RECORD live 对齐（2026-08-22 22:18）：fresh fetch 后容器 LIVE 已是 `5c221b9ec38c6316b98797342a01fb39ffd80562`（image `localhost/openbot:rc-amd64-provenance-5c221b9ec3`，StartedAt 21:21）。Latest Source revision 改为该 SHA。随后用户批准 cutover `affda8bc`。— cursor-grok
- [x] 生产 cutover `affda8bc`（2026-08-22 22:54）：用户指令「批准 cutover affda8bc」。干净 `git archive` + `pnpm build:docker` 全量 dist overlay；LIVE `affda8bce88939e42c57000896c13fc8a457f536`；UI pin 仍 `index-Dpg8P1UR.js`；Progress Ledger flag 保持开。未 recreate 镜像，未用脏树。回执 `docs/design/evidence/task-progress-ledger-affda8bc-cutover-20260822.json`。— cursor-grok
- [x] 生产 cutover `7cd74d4c`（2026-08-22 23:10）：用户指令「帮我批准」干净发布工作树流程。`/tmp/openbot-release-wt` @ `origin/main`；`git archive` + `pnpm install --frozen-lockfile` + `pnpm build`；LIVE `7cd74d4c5c69e7492eb6d624531f27592d6c809a`（#610）；flag 未改。回执 `docs/design/evidence/task-progress-ledger-7cd74d4c-cutover-20260822.json`。— cursor-grok
- [x] 独立门禁复验（2026-08-22 23:26）：干净工作树 forward-only **allow**（LIVE 来自容器）；无参 alignment PASS 但只覆盖 2026-07 夹具；live-matched alignment **FAIL**（`origin/main` RELEASE_RECORD 无 `7cd74d4c`）。**生产发布验收不通过。** 回执 `production-cutover-acceptance-20260822.md` + `docs/design/evidence/task-progress-ledger-7cd74d4c-independent-reverify-20260822.json`。— cursor-grok
- [x] #614 合入后复验（2026-08-23 08:15）：Latest `Source revision` = live `7cd74d4c`；live-matched alignment **PASS=8 FAIL=0**。**记录验收通过。** 当前 tip `e1cbc1e804` 三项门禁未全过，未 cutover。回执 `docs/design/evidence/task-progress-ledger-7cd74d4c-origin-main-reverify-20260823.json`。— cursor-grok
- [x] 生产 cutover `e6f26e13795a`（2026-08-23 10:41）：用户批准 #630 并批准 cutover 当时 `origin/main`。干净 `git archive` + `pnpm install --frozen-lockfile` + `pnpm build`；LIVE `e6f26e13795a86084e9f227453ee1d439d25d018`（#627）；flag 未改；容器未 recreate。回执 `docs/design/evidence/task-progress-ledger-e6f26e13795a-cutover-20260823.json`。— cursor-grok
- [x] 生产 cutover `5a3952679849`（2026-08-23 11:40）：用户要求对齐最新主干，不能把 `e6f26e13795a` / `7cd74d4c` 当最终发布。干净工作树 `/tmp/openbot-progress-release` fresh fetch；`git archive` + `pnpm install --frozen-lockfile` + `pnpm build`；LIVE `5a39526798493464ff0a7f29ab65ab66ad7670ed`（#631）；flag 未改；容器未 recreate。回执 `docs/design/evidence/task-progress-ledger-5a3952679849-cutover-20260823.json`。— cursor-grok
- [x] 生产 cutover `bad5f90a1d33`（2026-08-23 14:42）：用户授权 Production Main Alignment Cutover。干净工作树 `/tmp/openbot-progress-release` fresh fetch；`git archive` + `pnpm install --frozen-lockfile` + `pnpm build`；LIVE `bad5f90a1d33082d9fa6b6c6e361044ac7017f13`（#628）；flag 未改；容器未 recreate。回执 `docs/design/evidence/task-progress-ledger-bad5f90a1d33-cutover-20260823.json`。— cursor-grok
- [x] 生产 cutover `b576641a96eb`（2026-08-23 16:06）：用户批准最新 origin/main 对齐生产。干净工作树 `/tmp/openbot-main-alignment` fresh fetch；`git archive` + `pnpm install --frozen-lockfile` + `pnpm build`；LIVE `b576641a96eb49285e8454f30e060de0eabc49a0`（#638）；flag 未改；容器未 recreate。回执 `docs/design/evidence/task-progress-ledger-b576641a96eb-cutover-20260823.json`。— cursor-grok
- [x] 生产 cutover `33993e52e554`（2026-08-23 17:28）：用户批准最短安全路径。干净工作树 `/tmp/openbot-ledger-release` fresh fetch；`git archive` + `pnpm install --frozen-lockfile` + `pnpm build`；LIVE `33993e52e5540f76e57d66ab75d8955420437d3a`（#643）；flag 未改；容器未 recreate。回执 `docs/design/evidence/task-progress-ledger-33993e52e554-cutover.json`。— cursor-grok
- [x] 运行观察开窗（2026-08-23 19:16）：LIVE 仍为 `33993e52e5540f76e57d66ab75d8955420437d3a`；`origin/main`=`0229c93c`（#647）是其后裔。healthz live / readyz ready；Ledger flag 未改；admin.list `canonical` 7 项，metrics writesRejected=0 / projectionViolations=0 / I1–I8=0；与 cron.list progress 一致。未部署、未删备份。回执 `docs/design/evidence/task-progress-ledger-33993e52e554-observation-20260823.json`。— cursor-grok
- [x] 云端发布确认（2026-08-23 20:02）：LIVE 仍为 `33993e52e5540f76e57d66ab75d8955420437d3a`；healthz live / readyz ready；flag 未改；admin.list `canonical` 8 项，writesRejected=0 / projectionViolations=0 / I1–I8=0。未部署 `399d0759`。回执 `docs/design/evidence/task-progress-ledger-33993e52e554-cloud-release-confirm-20260823.json`。对外状态：云端生产发布完成，进入运行观察。— cursor-grok
- [ ] Cron 进度续写 + 可验收闭合（2026-09-10）：每个 long-horizon isolated tick 写 `EVIDENCE_RECORDED`/`STEP_STARTED`；失败步可重试；仅工具成功或投递回执才 `VALIDATION_PASSED`/`STEP_COMPLETED`/`ACCEPTANCE_MET`。禁止 run summary。— cursor-grok
- [ ] 后续重构（非上线前置）：独立 Turn Contract 模块

## 设计原则

OpenBot 不向用户展示「AI 想做什么」，而向用户展示「数字员工已经完成什么、正在执行什么、为什么停下，以及距离验收还缺什么」。

P0+P1 未绿不排 UI。P2 未写出真实事件不上 canonical 进度。空账本优于假进度。
