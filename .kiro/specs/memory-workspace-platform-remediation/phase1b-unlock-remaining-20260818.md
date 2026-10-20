# Phase 1B unlock 剩余项（2026-08-18）

From: `cursor-sot-reviewer`  
Unlock: **未签发**。`phase1bExecutionBlocked=true`。`deployAuthorized=false`。不是 LIVE。

Canonical receipt: `docs/design/evidence/memory-workspace-phase1b-unlock-decision.json`  
Decision: `no-valid-issued-receipt`。签署人：无。`issuedAt`：无。  
Reviewer: `cursor-sot-reviewer` @ `2026-08-18T16:01:00.000Z`。Baseline: `origin/main` `4daa854e78c1c17279eac48516521809a40e003a`。

此前本文与 `tasks.md` 声称 unlock-first 已签发，但主干没有对应 issued stamp。该声称已撤销。scorecard 的 `unlock=not-issued` 是有效字段，现与本 receipt 对齐。

## 2026-08-19 issued stamp revoke

Side worktrees still held an `unlock=issued` / `path=unlock-first` stamp. That stamp is archived at `docs/design/evidence/memory-workspace-phase1b-unlock-decision-issued-superseded.json` and revoked by `docs/design/evidence/memory-workspace-phase1b-unlock-issued-stamp-revoke.json`. Canonical receipt remains `not-issued`. Item 5 closeout stays not-met; Items 6/7 stay locked; `wiredToProductionResolver` stays false.

## 对账后状态

| 项  | 真实状态       | 说明                                                                                                               |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | **not-issued** | 无有效签发 receipt。不得把缺失文件或口头 unlock-first 当成签发。                                                   |
| 2   | **not-met**    | host Catalog merge 不是 runtime SoT。                                                                              |
| 3   | **met**        | 写开关接受包仍 `enablesProduction=false`。                                                                         |
| 4   | **met**        | `files_v2` DDL 已在 `memory-schema-v2` 发布单元准备；写路径关闭，未接线 manager-sync-ops。                         |
| 5   | **met**        | #492 点名授权翻 `wiredToProductionResolver=true`。本对账不翻旗。                                                   |
| 6   | **not-met**    | receipt `status/backup/fencing/rollback=green`，`live=false`。真实 SQLite drill，不是生产 snapshot，不得打成 met。 |
| 7   | **not-met**    | `productionWriteWatchIndex=38`。                                                                                   |

## 仍禁止

翻 `phase1bExecutionBlocked`、`deployAuthorized=true`、LIVE、写生产 Catalog、再翻 `wiredToProductionResolver`、启用 schema v2 写路径、删 38 个写点、把 receipt green / 合成 backup 写成 item 6 met、把本 receipt 当成 unlock-first 签发。
