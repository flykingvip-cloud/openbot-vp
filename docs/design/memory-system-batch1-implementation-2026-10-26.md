# 记忆系统首批优化实施记录（2026-10-26）

| 字段    | 值                                                                                                                                              |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档 ID | `memory-system-batch1-implementation-2026-10-26`                                                                                                |
| 日期    | 2026-10-26（Asia/Shanghai）                                                                                                                     |
| 授权    | 最后一轮限定收尾：O2 作用域来源+入口测试、O8 状态模型+分层标签、证据回归；**不含** O4/O5 产品改动、整套端到端验收、push/PR/部署                 |
| 工作树  | `/private/tmp/openbot-memory-batch1-rework`                                                                                                     |
| 分支    | `codex/openbot-memory-batch1-rework`（已 rebase 到 `origin/main`；验证后 `merge-base --is-ancestor origin/main HEAD` = **0**）                  |
| Loom    | `memory-system-batch1-2026-10-26:grok-bot`（session `batch1-rework-2026-10-26`）                                                                |
| 状态    | **TS7016 已修；任务范围类型干净**；最终集成对齐验证完成（本地）；相关测试绿；全仓 `pnpm tsgo`/`check` 仍有无关错误（见 §8–§9）；未 push/PR/部署 |

## 0. 基线与归属

- 唯一写入目录：`/private/tmp/openbot-memory-batch1-rework`。
- 起点 tip（历史）：`01bae00b`。
- **最终集成对齐（本轮）**：`git fetch origin` 后若祖先不满足，仅在本工作树本分支 `rebase origin/main`（已完成）。
- **未**触碰 `/Users/daniel/AI VP/openbot` 或 `openbot-wt-t34-c1-c2` 写入；**未**操作真实记忆；**未** push / PR / 部署。

## 1. 本轮审核结论（收尾）

| ID       | 结论                            | 说明                                                                                                   |
| -------- | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **O1**   | **局部通过**                    | 不按全库数量归给每个数字人；不以路径存在/库可读单独报后端健康                                          |
| **O2**   | **本轮已修正**                  | 作用域来自正式身份解析链路（见 §4）；补充真实脚本入口测试；无发明生产字段                              |
| **O3**   | **局部通过**                    | ACL 四态保留                                                                                           |
| **O4**   | **产品预期待核实**              | 已观察 tentative 默认不可见；**未**改 `includeTentative`                                               |
| **O5**   | **缺陷未证实；撤回成立**        | 不提 lifecycle 修复；不实施遗忘产品改动                                                                |
| **O8**   | **本轮已修正状态模型+分层标签** | not-run 不进 passed；helper ≠ gateway-handler-chain；新 v3 证据。**完整工具/回复链和模型效果仍未验证** |
| O6/O7/O9 | 不做                            | —                                                                                                      |

**可关闭**：首批已完成的局部工作（O1/O2/O3 局部、O5 撤回、O8 脚手架分层）。  
**后续任务**：完整记忆效果验收（真实工具链、回复注入、模型采用、网关处理链）。

## 2. 修改文件（本轮收尾）

### 产品 / 脚本

- `scripts/memory-platform-audit.mjs` — 正式作用域来源；忽略 invented `memoryScope`/`expectedEmpty`
- `scripts/memory-platform-audit.d.mts` — **TS7016 修复**：为脚本导出提供准确类型声明边界（仓库既有旁挂 `.d.mts` 模式）

### 测试 / 证据

- `src/memory/memory-platform-audit.o2.test.ts` — 正式 scope + **真实脚本入口** spawn
- `src/memory/memory-batch1-o8-baseline-v3.test.ts` — 新 harness（保留 v1/v2）
- `docs/design/evidence/memory-e2e-baseline-v3-post-rework-2026-10-26.json`
- `docs/design/evidence/memory-e2e-baseline-v3-coverage-matrix-2026-10-26.md`
- 旧 v1/v2 文件仅追加 superseded / currentBaseline 指针，主体保留
- `docs/design/memory-system-batch1-implementation-2026-10-26.md`（本文）
- `.loom/registry.yaml`（仅追加本 session 说明）

## 3. O1 / O3（保留）

见前轮：O1 作用域可信计数与 backendHealth 分离；O3 ACL 四态。本轮未再改产品逻辑。

## 4. O2 作用域来源策略（本轮）

**正式配置核查**：`AgentConfig` / `MemoryCogniWeaveConfig` / schema.help **无** `agents.list[].memoryScope`、`memory.cogniweave.defaultScope`、`expectedEmpty`、`expectedNoData`。

**实际来源策略**：

1. 从现有规范链路派生默认私有作用域（对齐 `CogniWeaveMemoryManager` legacy）：
   - `workspaceId = stableId("ws", resolve(stateDir))`
   - `projectId = agent:${agentId}`
   - `visibility = private`
   - `scopeSource = formal-default-legacy-ws+resolveCogniWeaveSearchScope`
2. **不**读取 / **不**发明生产配置字段；fixture 中即使写入 `memoryScope`/`expectedEmpty` 也被脚本忽略。
3. `AgentConfig` 无 `createdAt`/`expectedEmpty` → 脚本路径上 `expectedEmptyEvidence=false`、`agentCreatedAt=null`；无证据时 **不得** 判 new-empty。
4. `MemoryWorkspaceHandle.resourceId` 不在 agents.list → 无法从配置重建 handle 身份时，不足即 **diagnostic-insufficient / unknown**（合法结果）。
5. `dataRoot`：配置优先，对齐 `resolveDataRoot`。
6. 完整可信作用域才计数；非空 MD 不直接 scope-ok。

**入口测试**：`src/memory/memory-platform-audit.o2.test.ts` 通过 `spawnSync(node, scripts/memory-platform-audit.mjs --json)` 验证真实 CLI 路径。

## 5. O8 v3 状态模型与分层

- 状态枚举：`passed` / `failed` / `not-run`；**not-run 不计入 passed**。
- S4：`forgetMemoryEntry` → 层标签 **`helper-integration`**（非 `gateway-handler-chain`）。
- 显式 not-run：`GW-v3-auth-not-run`、`GW-v3-managed-reject-not-run`、`GW-v3-handler-chain-not-run`、`MODEL-v3-untimed`。
- 汇总（本轮跑出）：**total=12 passed=8 failed=0 not-run=4**。
- v1/v2 证据文件保留；v2 标注 superseded by v3。

### 两个证据回归

1. `not-run model-effect does not increase passed count`
2. `direct forgetMemoryEntry helper is not classified as gateway-handler-chain coverage`

## 6. O4 / O5（不变）

- **O4**：tentative 默认不可见，产品预期待核实；未改 `includeTentative`。
- **O5**：缺陷未证实；撤回成立；不提 lifecycle 修复。

## 7. 明确未做 / 风险

- 未改主目录 / T34；未真实记忆写；未重启网关；未部署；未 push/PR。
- 未做完整工具/回复链与模型效果验收（明确后续）。
- 未扩展 O4/O5 产品改动。
- 全仓 `pnpm check`：最终集成轮已实跑；**未通过**（无关文件阻断，见 §8）；**不得**报告全仓通过。

## 8. 最终集成对齐验证（post-rebase，2026-10-26 Asia/Shanghai）

### 8.1 fetch 三元组与 rebase

| 项                                                 | 值                                                                                                                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `origin/main`（fetch 后）                          | `ad711a54a7d94c1dedfda9ef0016dc9b5adbae82`（短 `ad711a54`）                                                                                                    |
| `HEAD` before rebase                               | `592f98995867518ee8894465ffeb878d80a9314b`（短 `592f9899`）                                                                                                    |
| `merge-base --is-ancestor origin/main HEAD` before | exit **1**（不满足）                                                                                                                                           |
| 动作                                               | 仅本树本分支 `git rebase origin/main`                                                                                                                          |
| 冲突                                               | `.loom/registry.yaml`：main 追加 `askOutcome-p0-task-outcome-contract`，本任务追加 memory review/batch1 登记；**保留双方**（手术式插入），未改 askOutcome 语义 |
| `HEAD` after rebase（验证 SHA）                    | `2441ccbeb88d09ed36c1f1eb60af4df49edd0dc1`（短 `2441ccbe`）                                                                                                    |
| ancestor after                                     | exit **0**                                                                                                                                                     |

### 8.2 相关测试（均在验证 SHA `2441ccbe` 上执行）

| 命令                                                                                                                                                                                              | 结果                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vitest.unit`：`memory-platform-audit.o2.test.ts`、`memory-batch1-o8-baseline-v3.test.ts`（含两回归）、`health-probe.test.ts`、`health-probe-run.test.ts`、`memory-batch1-o8-baseline-v2.test.ts` | **5 files / 30 tests passed**                                                                                                                                                                                                                                                                                                                                                                                            |
| `vitest.gateway`：`doctor-memory-health.test.ts`                                                                                                                                                  | **10 tests passed**                                                                                                                                                                                                                                                                                                                                                                                                      |
| 变更 14 个 `.ts/.mjs`：`oxfmt --check`                                                                                                                                                            | pass                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 同上：`oxlint --type-aware`                                                                                                                                                                       | 0 warnings / 0 errors                                                                                                                                                                                                                                                                                                                                                                                                    |
| `pnpm tsgo`（全仓）                                                                                                                                                                               | exit **2**；当时 **145** 个 `error TS`；任务触及中曾有：`src/memory/memory-platform-audit.o2.test.ts` **TS7016**（`.mjs` 无声明）。**已在 §9 修复**；本轮历史日志保留：`memory-batch1-tsgo-post-rebase-2026-10-26-1325.log`                                                                                                                                                                                              |
| 全仓 `pnpm check`                                                                                                                                                                                 | exit **2**；通过 `check:host-env-policy:swift` 后死于 **`format:check`**：`docs/integrations/device-digital-human/openapi.yaml:821` `SyntaxError: Nested mappings are not allowed in compact mappings`（`description: sha256 hex, optional sha256: prefix`）。该文件 **不在** `origin/main...HEAD` 本任务 diff；同源存在于 `origin/main`。**范围判断：无关文件阻断；不能报告全仓通过。** 未进入后续 build/tsgo/lint 链。 |

### 8.3 证据策略

- **历史保留**：v1 / v2 / 既有 v3（`memory-e2e-baseline-v3-post-rework-2026-10-26.json`）**不覆盖**。历史 v3 产生于旧 tip；**本轮验证 SHA=`2441ccbe`**。
- **本轮新证据**（均注明 post-rebase / 新时间戳）：
  - `docs/design/evidence/memory-e2e-baseline-v3-post-rebase-2026-10-26-1325.json`（`phase=post-rebase`，`codeVersion=2441ccbe…`，summary total=12 passed=8 failed=0 not-run=4）
  - `docs/design/evidence/memory-batch1-pnpm-check-post-rebase-2026-10-26-1325.log`
  - `docs/design/evidence/memory-batch1-tsgo-post-rebase-2026-10-26-1325.log`

## 9. TS7016 修复轮（2026-10-26 Asia/Shanghai，终审前）

### 9.1 fetch / 祖先

| 项                                          | 值                                         |
| ------------------------------------------- | ------------------------------------------ |
| `git fetch origin`                          | 已执行                                     |
| `origin/main`                               | `ad711a54a7d94c1dedfda9ef0016dc9b5adbae82` |
| `HEAD`（修复前）                            | `6914f4816c65c9c1d9a1c2d084664adc43239216` |
| `merge-base --is-ancestor origin/main HEAD` | exit **0**（已是祖先；**未**再 rebase）    |

### 9.2 修复方式

- **阻塞**：`src/memory/memory-platform-audit.o2.test.ts(18,8): error TS7016` — Could not find a declaration file for module `../../scripts/memory-platform-audit.mjs`。
- **采用仓库既有模式**：为脚本旁挂准确类型声明 `scripts/memory-platform-audit.d.mts`（同 `openbot-surface.d.mts` / `check-collab-runtime-authority.d.mts` / `run-node.d.mts`）。
- 声明覆盖测试用到的导出：`classifyEmptyMarkdown`、`classifyAgentRecovery`、`resolveAuditDataRoot`、`resolveFormalDefaultScopeHint`、`resolveTrustedScopeAtomCount`、`stableId`，以及同文件其他 export。
- **未**使用 `@ts-ignore` / `@ts-nocheck` / `any` / 放宽全仓 tsconfig；**未**改产品行为；保留真实 `spawnSync(audit.mjs)` 入口测试与既有断言。

### 9.3 验证

| 命令                                                                                                  | 结果                                                                               |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `vitest.unit`：`src/memory/memory-platform-audit.o2.test.ts`                                          | **1 file / 10 tests passed**（含真实脚本入口）                                     |
| `oxfmt --check`：`scripts/memory-platform-audit.d.mts`、`src/memory/memory-platform-audit.o2.test.ts` | pass                                                                               |
| `oxlint --type-aware`：同上                                                                           | 0 warnings / 0 errors                                                              |
| `pnpm tsgo`（全仓）                                                                                   | exit **2**；**144** 个 `error TS`；**61** 个无关文件。**本任务文件零错误**（见下） |

**本任务文件零错误证明**（完整诊断中无下列路径的 `error TS` / 无 TS7016）：

- `src/memory/memory-platform-audit.o2.test.ts`
- `scripts/memory-platform-audit.mjs`
- `scripts/memory-platform-audit.d.mts`
- `src/memory/memory-batch1-o8-baseline*.test.ts`
- 其它 `src/memory/` / `health-probe` 诊断亦无 error 行

**无关错误摘要**（可保留；不属本任务）：仍集中在 `ui/src/ui/ports/**`、`src/gateway/collaboration-*`、`src/agents/tools/collaboration-board-tool.test.ts`、`src/auto-reply/reply/get-reply-run.ogui-wait.test.ts`、`src/task-orchestration/readonly-invoke.test.ts` 等既有全仓债务。

### 9.4 证据

- **历史失败日志保留**：`docs/design/evidence/memory-batch1-tsgo-post-rebase-2026-10-26-1325.log`
- **本轮新证据**：`docs/design/evidence/memory-batch1-tsgo-ts7016-fix-2026-10-26-1335.log`
- **未**触碰主目录 `/Users/daniel/AI VP/openbot`、T34 `openbot-wt-t34-c1-c2`；**未** push / PR / 部署；**未**扩 O4/O5；**未**重做基线/效果验收。

## 10. 全仓修绿轮（2026-10-26，`codex/openbot-memory-batch1-rework`）

目标：全仓 `pnpm tsgo` / `pnpm check` 以**实际退出码 0**验收；按根因修类型与 check 链失败；不放宽检查、不 skip、不用 `@ts-ignore`/`@ts-nocheck`、不滥用 `any`；不 push / 不开 PR / 不部署；不触碰主目录与 T34。

### 10.1 fetch / 基线

| 项                                  | 值                                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `git fetch origin`                  | 已执行（协调方完成后本树再确认）                                                                                                 |
| `origin/main`                       | `ad711a54a7d94c1dedfda9ef0016dc9b5adbae82`                                                                                       |
| `HEAD`（本轮开始 / openapi 提交后） | `58e006df…`（ahead origin/main；ancestor exit 0；behind 0）                                                                      |
| 新鲜基线 tsgo                       | **144** `error TS` → `docs/design/evidence/memory-batch1-tsgo-baseline-fresh-20261026-1349.log`                                  |
| 新鲜基线 check 首错                 | `format:check` / openapi YAML compact mapping → `docs/design/evidence/memory-batch1-pnpm-check-baseline-fresh-20261026-1349.log` |

历史失败日志保留：`memory-batch1-tsgo-post-rebase-*`、`memory-batch1-tsgo-ts7016-fix-*`、`memory-batch1-pnpm-check-post-rebase-*` 等。

### 10.2 openapi.yaml YAML

- 文件：`docs/integrations/device-digital-human/openapi.yaml:821`
- 根因：`description: sha256 hex, optional sha256: prefix` 未加引号，YAML 把 `sha256:` 当成嵌套 mapping
- 修复：为 description 加引号（最小改动）
- 提交：`58e006df` `fix(openapi): quote checksum description to fix YAML compact mapping`
- 后续：`format:check` 暴露全仓 oxfmt 漂移与更多 TS/lint/守卫失败，继续按根因处理

### 10.3 TypeScript 分批（根因）

| 批  | 根因                                                                                                    | 代表路径                                                                                                                                                                              | 结果                   |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| A   | 测试夹具 / 接口契约不一致（GovernedTask vs Task.responsibility、trust level、SelfAdvanceResult 收窄等） | collaboration claim/handoff、self-advance、delivery-actor-binding、soft-observe-dh-loop、enterprise MFA/security/data、meeting、UI agents/tenants generics、artifactPreviewMissIds 等 | 144 → 少数             |
| B   | 泛型 / `vi.fn` 调用签名不匹配；误改 `issueMeetingApprovalConfirmation` 已回退                           | board-tool 测试、meeting.ts                                                                                                                                                           | 收敛                   |
| C   | TS2349 not callable：DOM `EventListener` 不可直接调用；Promise `resolve` 经闭包后 CFA 收窄为 `never`    | `desktop-session-runtime.test.ts`（`as unknown as (ev)=>void`）；`daibai-team-onboarding.node.test.ts`（`refreshGate` 可变盒）                                                        | **`pnpm tsgo` exit 0** |

### 10.4 check 链后续（format / lint / 守卫）

| 失败点                                                                                       | 根因修复                                                                                    |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `format:check` 漂移                                                                          | `oxfmt --write` 本轮触及文件（含先 19 后全仓）                                              |
| oxlint unused import / unnecessary assertion / `no-base-to-string` / `no-array-sort` / curly | 删除死 import、去掉多余断言、`String(err)`→安全空串、`sort`→`toSorted`、补 `{}`             |
| `lint:ui:capability-boundaries`                                                              | `app.ts` 已有控制器 import，allowlist 补齐（与 main 同内容，预算漂移）                      |
| `lint:core:composition-root-loc`                                                             | 预算锁定到当前 `origin/main` 行数（`split("\n").length`）                                   |
| `lint:gateway:isolation-fail-closed`                                                         | `seat-tenant-index.ts` 全局 store 读取加入 allowlist（跨租户索引正当）                      |
| `lint:collab:runtime-capabilities`                                                           | `group-task-heartbeat-scheduler`：`setInterval`→递归 `setTimeout`（Floor Runtime §2.2 (a)） |
| `lint:collab:policy-consumption`                                                             | `coordinatorBotId` 读迁到 `hasDeliveryMembershipSurface`（delivery-actor-binding）          |

### 10.5 最终验收

| 命令         | 退出码 | 证据                                                                          |
| ------------ | ------ | ----------------------------------------------------------------------------- |
| `pnpm tsgo`  | **0**  | `docs/design/evidence/memory-batch1-tsgo-final-green-20261026-1424.log`       |
| `pnpm check` | **0**  | `docs/design/evidence/memory-batch1-pnpm-check-final-green-20261026-1424.log` |

残留：无（类型与 check 链均绿）。

### 10.6 边界

- **未** push / 强推 / 开 PR / 部署
- **未**触碰 `/Users/daniel/AI VP/openbot` 与 T34 `openbot-wt-t34-c1-c2`
- 本地多 commit 按 landing/committer 拆分；本文件与证据随修绿轮一并提交

## 11. O4/O5 后续处置（2026-10-26，契约核实，无产品改动）

| 项        | 内容                                                                        |
| --------- | --------------------------------------------------------------------------- |
| 授权      | 核实产品契约、完善处置记录、可审核方案；**禁止**实施记忆产品逻辑修改        |
| 起点 HEAD | `aaab116a…`（工作区干净；`origin/main`=`ad711a54…`；ancestor 0；behind 0）  |
| Loom      | `memory-system-batch1-2026-10-26:grok-bot`（追加 session 登记，不覆盖他人） |

### 交付

- [memory-system-o4-o5-disposition-2026-10-26](/design/memory-system-o4-o5-disposition-2026-10-26) — O4/O5 证据、关闭判断、缺口、重开条件
- [memory-center-candidate-view-plan-2026-10-26](/design/memory-center-candidate-view-plan-2026-10-26) — 候选视图方案（**待审核，禁止实施**）
- `src/memory/memory-batch1-o4-o5-diagnose.test.ts` — 补强 status×permission 矩阵与 O5 关闭断言（合成数据）

### 结论摘要

- **O4**：tentative 默认不可见已观察；**未证实违反产品契约**；推荐默认 active + 独立候选筛，交审。
- **O5**：**未证实，关闭当前缺陷判断**；验证缺口另行跟踪；文案相对单文件删除有过承诺，拟改建议不实施。
- **未**改 `includeTentative`、召回、晋升、遗忘 lifecycle、真实记忆、push/PR/部署。

## 本轮主干对齐交付收尾（2026-10-26 晚）

- 两次 rebase：`d00bdcca`（#85）→ 再对齐 `29f4edd0`（#86）；冲突仅 Loom registry 与一处 `result-service`（保留主干 scope/commandId 语义）。
- 最终 tip：`96082662`；`origin/main` 为祖先；ahead/behind **162/0**。
- 验证：affected 145 pass；`pnpm tsgo` 0；`pnpm check` 0（基线 `29f4edd0`）。主干 #86 引入的 format/lint 债已最小修复并记入检查恢复组。
- 交付分组与 PR 草稿见 `docs/design/memory-batch1-grouped-delivery-checklist-2026-10-26.md`。
- **未** push / PR / 部署；**未**纳入 O4/候选视图/DS/完整效果验收。
