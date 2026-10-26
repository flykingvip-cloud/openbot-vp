# Memory Batch1 — 全仓修绿 tip 终审收尾审查

日期：2026-10-26（Asia/Shanghai）  
工作树：`/private/tmp/openbot-memory-batch1-rework`  
分支：`codex/openbot-memory-batch1-rework`  
验收 tip：`aaab116a0ee40ca6b8c04eaaeef6e0831bc69088`  
限定收尾：测试隔离改造 + §4 运行时清单补全；提交前 HEAD 见 `git log -1`；清单固定起止 `8070ef52e04bd0331ab113bdb15b090247b329c6`（含）→ `578b3a7de134d98a305fa077a58cd05145bb3bf4`（含），等价 `git diff --name-only 8070ef52^..578b3a7d`

约束：不 push / 不开 PR / 不合并 / 不部署；不扩大业务；保留已修绿 tip 与 O4/O5 处置提交。

---

## 0. 主干与归属

| 项                            | 值                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `git fetch origin`            | 已执行                                                                               |
| `origin/main`                 | `ad711a54a7d94c1dedfda9ef0016dc9b5adbae82`                                           |
| HEAD（收尾前）                | `d3eb813c744a0dd36217532b8fead21c36cd78be`                                           |
| merge-base(HEAD, origin/main) | `ad711a54…`（= origin/main）                                                         |
| ahead / behind                | **133 / 0**                                                                          |
| 分支归属                      | `codex/openbot-memory-batch1-rework`，本任务专用；未占用他人分支；未触碰主目录与 T34 |
| rebase                        | 不需要（behind=0）                                                                   |

---

## 1. §预算 — 架构行数预算逐项结论

文件：`scripts/check-core-composition-root-loc.ts`（提交 `0d81531e`）。

计数方式：`content.split("\n").length`（含末尾空段，通常比 `wc -l` +1）。

### 原失败（可复现）

证据：`docs/design/evidence/memory-batch1-pnpm-check-after-boundary-20261026-1414.log`

```
Core composition-root LOC guard failed:
- src/gateway/platform-auth/control-ui-dispatcher.ts: 523 lines (budget 500)
- src/gateway/collaboration-learning.ts: 139 lines (budget 70)
- src/gateway/collaboration-learning/shared.ts: 2893 lines (budget 2881)
- src/gateway/platform-auth/auth-helpers.ts: 712 lines (budget 659)
- src/gateway/platform-auth/routes-login-password.ts: 906 lines (budget 724)
- src/gateway/platform-auth/routes-enterprise.ts: 1045 lines (budget 964)
- ui/src/ui/app.ts: 4845 lines (budget 4347)
```

### 根因判定

**既有预算漂移（对 origin/main）**，不是本分支新增超限，也不是检查计数错误。

对照：对 `origin/main` 同路径文件用同一 `split("\n")` 计数，行数与 HEAD **完全一致**，且均已超过 main 上旧预算。说明旧预算在主干内容上本已失效/未与 trunk 对齐；本分支未再扩大这些文件。

| 路径                               | 旧预算 | origin/main 计数 | HEAD 计数 | 新预算 | 根因     | 结论     |
| ---------------------------------- | -----: | ---------------: | --------: | -----: | -------- | -------- |
| `control-ui-dispatcher.ts`         |    500 |              523 |       523 |    523 | 既有漂移 | **保留** |
| `collaboration-learning.ts`        |     70 |              139 |       139 |    139 | 既有漂移 | **保留** |
| `collaboration-learning/shared.ts` |   2881 |             2893 |      2893 |   2893 | 既有漂移 | **保留** |
| `auth-helpers.ts`                  |    659 |              712 |       712 |    712 | 既有漂移 | **保留** |
| `routes-login-password.ts`         |    724 |              906 |       906 |    906 | 既有漂移 | **保留** |
| `routes-enterprise.ts`             |    964 |             1045 |      1045 |   1045 | 既有漂移 | **保留** |
| `ui/src/ui/app.ts`                 |   4347 |             4845 |      4845 |   4845 | 既有漂移 | **保留** |

未调高且仍守门的项（例 `platform-auth.ts` 150、`routes-employee.ts` 773、`plugins/loader.ts` 20、`hooks.ts` 60、`app-gateway.ts` 320）保持原状。

### 必要性与原有约束如何保留

- **必要性**：在「全仓 `pnpm check` 修绿」前提下，若不锁定到 trunk 实际尺寸，守卫会因主干既有漂移而失败；本批未借机为业务增行抬预算。
- **不得以「当前超了就提高」为唯一依据**：此处依据是 **HEAD 文件尺寸 = origin/main 尺寸**，调高幅度 = trunk 已存在行数，而非本分支增长。
- **原有约束保留**：
  - 仍是硬上限（`lines > maxLines` → exit 1）；
  - `why` 仍标明 facade / Sub_Module / control-ui shell 职责边界；
  - 未删除守卫、未改计数算法放水；
  - 后续真实增行仍须再论证或拆分。
- **未决**：对已远超理想 facade 尺寸的文件（尤其 `app.ts`、`shared.ts`、routes-\*）做物理拆分属于业务/架构扩大，**本轮不擅自大拆**，标为主干后续债。

---

## 2. UI / 隔离白名单

### 2.1 `app.ts` controller 导入例外（`ae640467`）

**原失败**（`memory-batch1-pnpm-check-after-lint-fixes-20261026-1412.log`）：

- `admin-activation-email-receipt.ts`
- `collaboration-observability.ts`
- `enterprise-organization-monthly-usage.ts`
- `local-file-approval.ts`

均报 `unexpected direct controller import`。

**根因**：既有白名单漂移。上述 4 个 controller **在 origin/main 的 `app.ts` 中已导入**，且文件在 main 存在；旧 allowlist 未同步。

**边界符合性**：`check-openbot-ui-boundaries.mjs` 设计即允许 `app.ts` 作为 composition-root **有限**直连 controller；例外是补齐 root 已接线的名单，不是开放任意 controller。

**负例测试**：`test/scripts/check-openbot-ui-boundaries.test.ts`

- 经 `OPENBOT_CHECK_REPO_ROOT` 在**临时目录**建最小 fixture，执行真实检查脚本；
- 正例：干净 fixture（app-polling 无 controller 导入）通过；
- 负例：fixture 内 app-polling 注入 `controllers/agents.ts` → 仍拒绝；
- **不**改写仓库 `ui/src/ui/app-polling.ts`。

**结论**：**保留** 四项例外。

### 2.2 `seat-tenant-index` 全局 seat 读取例外（`2076bf82`）

**原失败**：`bare loadEnterpriseSeatAssetsStore()`（isolation fail-closed）。

**根因**：`src/gateway/seat-tenant-index.ts` **已在 origin/main**，其职责是跨租户 seat→tenant 索引，必须先读 process-global store 再读 per-tenant stores（文件头注释与实现一致）。main 上 allowlist 未登记该路径。

**边界符合性**：与 allowlist 中既有「必须读全局 store 的基础设施」同类；不是业务路径顺手读全局。

**负例测试**：`test/scripts/check-isolation-fail-closed.test.ts`

- 经 `OPENBOT_CHECK_REPO_ROOT` 在**临时目录**建 gateway fixture；
- 正例：仅 allowlisted `seat-tenant-index.ts` 裸调用 → 通过；
- 负例：相邻非白名单探针裸调用 → 仍拒绝；
- **不**在仓库 `src/gateway/` 创建/删除固定路径探针。

**结论**：**保留** 例外。

---

## 3. 心跳调度（`setInterval` → 递归 `setTimeout`）

### 背景

- 原失败：`lint:collab:runtime-capabilities` — `group-task-heartbeat-scheduler.ts` `[no-set-interval]`（Floor Runtime v2.1 §2.2 (a) / R3）。
- 提交 `436f915b` 改为递归 `setTimeout`。

### 重复排队审查（已确认）

旧实现：`finally` 在 `timer !== null` 时直接 `timer = setTimeout(fire, interval)` **不 clear**。  
`updateConfig` → `armTimer()` 会先 clear 再挂新计时器；若发生在 tick 执行期间，旧 `finally` 再挂一条 → **双计时链**。

**fail-before**（故意装回旧 `finally` + 始终 arm 的 `updateConfig`）：

- 测试：`updateConfig during slow tick does not create duplicate timer chains`
- 结果：`expected 12 to be less than or equal to 8`（delta=12）
- 证据：`docs/design/evidence/memory-batch1-heartbeat-fail-before-20261026.log`

**修复**：

1. `finally` 改为调用 `armTimer()`（clear-then-schedule，只保留一条链）；
2. `updateConfig` 在 `inFlight` 时只更新 cfg、不 arm（由 in-flight tick 的 `finally` 负责）；禁用时 `clearTimer()`；
3. 显式 `pollIntervalMs` 作为测试/运维覆盖时可 &lt;1s；生产读 config 仍 1s 地板。

**修复 SHA**：`c2fe66f826404963a5f6bcd76053117b30e079b7`

**pass-after**：同文件 S4 scheduler reliability 用例全部通过（含慢 tick / 异常 / stop / updateConfig 并发）。  
证据：`docs/design/evidence/memory-batch1-heartbeat-pass-after-20261026.log`、`memory-batch1-final-review-affected-tests-20261026.log`。

---

## 4. 审查清单（固定起止 SHA，逐文件）

**完整文件表**：[`docs/design/memory-batch1-runtime-change-inventory-8070ef52-to-tip.md`](./memory-batch1-runtime-change-inventory-8070ef52-to-tip.md)（附录 A–F + B2/B3）。  
**起止约定（含两端）**：`8070ef52e04bd0331ab113bdb15b090247b329c6` → `578b3a7de134d98a305fa077a58cd05145bb3bf4`；生成命令与正文统一为 `git diff --name-only 8070ef52^..578b3a7d`（**含**起点提交；勿写成 `8070ef52..HEAD`）。  
状态枚举：**已审通过（执行者自检） / 已审通过（审核 Agent 已确认） / 待审 / 不再需要**。类型修复**不**自动视为无行为变化；文件删除文案 ≠ 类型清理；Loom registry = 任务元数据；`*.evidence.test.ts` 仍是测试。

### 4.1 纯格式（附录 §A，46）

oxfmt / 空白换行 / import 重排 / CSS 微调。含 `browser-tool.ts`（`git diff -w` 仅排版）、`weixin-extract.ts`、enterprise-data 若干排版、site-capability 导出换行等。  
**审查状态**：已审通过（执行者自检；无控制流变更）。

### 4.2 类型清理 / UI 文案 / 任务元数据（附录 §B / §B2 / §B3）

| 代表路径                                                             | 归类依据                                                    | 状态                               |
| -------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------- |
| `meeting.ts` / `adapter.ts` / `app-view-state-shell-slices.ts`       | 真·类型清理（§B）                                           | 已审通过（执行者自检）或待审见附录 |
| `memory-center-page.ts` / `data-directory-page.ts` + render-model-\* | **已单独批准的 UI 文案变更**（O5 文件删除文案；≠ 类型清理） | 已审通过（审核 Agent 已确认）      |
| `.loom/registry.yaml`                                                | **任务元数据**（§B3；≠ 类型清理）                           | 已审通过（执行者自检）             |

完整列表与依据见附录 §B / §B2 / §B3。

### 4.3 测试夹具修正（附录 §C，66）

| 夹具                                                                               | 对应契约 / 实测                                                                        |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `collab-s4-heartbeat-scheduler.test.ts`                                            | 心跳调度；含 duplicate chain、短 `pollIntervalMs`                                      |
| `check-openbot-ui-boundaries.test.ts`                                              | 真实 `check-openbot-ui-boundaries.mjs` + **临时 fixture**（`OPENBOT_CHECK_REPO_ROOT`） |
| `check-isolation-fail-closed.test.ts`                                              | 真实 isolation 脚本 + **临时 fixture**；seat-tenant 白名单正例                         |
| `memory-batch1-o4-o5-diagnose.test.ts` / `memory-forget-gateway-isolation.test.ts` | O4 权限矩阵；O5 forget 隔离                                                            |
| 其余 `*.test.ts`                                                                   | landing-stream 夹具对齐（board/SAR/CLI/desktop 等）                                    |

**状态**：已审通过（执行者自检；测试本身）；`*.evidence.test.ts` 归 §C 而非文档；业务结论仍随对应运行时项。

### 4.4 运行时逻辑变化（附录 §D，13 — 勿漏重点）

| 路径                                                  | 修改前 → 后（摘要）                                                                          | 根因                              | 回归证据                                | 状态                              |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------- | --------------------------------- |
| `group-task-heartbeat-scheduler.ts`                   | setInterval + finally 无 clear → 递归 setTimeout + armTimer；inFlight 时 updateConfig 不 arm | Floor §2.2 + 双链竞态             | S4 15 测；fail-before/pass-after 日志   | **已审通过（审核 Agent 已确认）** |
| `delivery-actor-binding.ts`                           | 导出 `hasDeliveryMembershipSurface`；governance 类型补 `ownerUserId`                         | ACL surface 抽公共                | 与 recheck 联调                         | 待审                              |
| `task-dispatch-auth-recheck.ts`                       | 本地 helper → 调用导出 surface                                                               | **权限复核**对齐 delivery binding | 既有 ACL/dispatch 测                    | 待审                              |
| `cli-errors.ts`                                       | `String(err)` → `""`（非 Error）                                                             | 避免 Object 串污染分类            | `cli-errors.test.ts`                    | 待审                              |
| `intervention-dispatch.ts`                            | 删除外层死嵌套；**有效门闩改前改后均为仅 queued**                                            | ODIAG 可读性清理                  | 无本批专项                              | 待审                              |
| `soft-observe-dh-loop.ts`                             | 去掉 reapply/verify 内不可达 `!=="regressed"`；log 改二元调用；**前部 regressed→skip 仍在**  | check-green 死代码/API            | 无本批专项                              | 待审                              |
| `mode-b-wake-round-dispatcher.ts`                     | 终审：`"explicit_multi"` → **`single_primary`**（顶层+roundPlan）                            | 单 lead = matchedBots===1         | `wake-round-dispatch.test.ts` 消费路径  | 待审→本轮修正                     |
| `result-service.ts`                                   | 去掉冗余 `type!=="create"`；typed create 本无 expectedVersion，路径不变                      | 条件简化                          | 无专项                                  | 待审                              |
| `decision-engine.ts`                                  | `id.includes` → `(id??"").includes`                                                          | null 防护（抛错→不匹配）          | `decision-engine.test.ts` empty agentId | 待审                              |
| `collaboration-learning.ts`（server-methods）         | adminDailySummary assertValidParams 四参对齐（曾错位 method/respond）                        | 错误实参清理                      | collaboration-learning.test.ts          | 待审                              |
| `enterprise-connection-copy.ts`                       | loading 去掉恒真的 `connected!==true`（其上已有 connected 早退）                             | 行为保持简化                      | 无专项                                  | 待审                              |
| `render-model-data-directory.ts` / `memory-center.ts` | O5 删除文案                                                                                  | **已单独批准的 UI 文案变更**      | O4/O5 测                                | 已审通过（审核 Agent 已确认）     |

#### 单列：`pollIntervalMs < 1s`

- **调用方**：仅显式 `opts.pollIntervalMs`（测试/运维覆盖）；生产仍 `Math.max(1_000, resolveGroupTaskHeartbeatScanIntervalMs(cfg))`。
- **必要性**：亚秒间隔验证单计时链与并发 `updateConfig`；**测试短间隔 ≠ 生产语义**。
- **状态**：已审通过（审核 Agent 已确认；随心跳局部通过）。

### 4.5 检查规则变化（附录 §E）

| 文件                                 | 例外理由                                     | 约束保留                                                        | 正负例            | 状态                                      |
| ------------------------------------ | -------------------------------------------- | --------------------------------------------------------------- | ----------------- | ----------------------------------------- |
| `check-core-composition-root-loc.ts` | 锁 trunk 实测尺寸（非本支增行）              | 硬上限 + why + 算法不变                                         | LOC 守卫 exit 0   | 已审通过（审核 Agent 已确认；架构债另记） |
| `check-openbot-ui-boundaries.mjs`    | app.ts 四 controller 在 main 已接线          | composition-root 有限白名单；`OPENBOT_CHECK_REPO_ROOT` 默认关闭 | fixture 正过/负拒 | 已审通过（审核 Agent 已确认）             |
| `check-isolation-fail-closed.mjs`    | seat-tenant-index 跨租户索引必须读全局 store | bare 调用仍默认拒绝；env 测试根默认关闭                         | fixture 正过/负拒 | 已审通过（审核 Agent 已确认）             |

### 4.6 文档/证据（附录 §F，231）

设计文、证据 log、`.kiro`/specs 等。**状态：不再需要**（非运行时审批项）。Loom registry 已改归 §B3 任务元数据；`*.evidence.test.ts` 已改归 §C。

### 验证矩阵

| 项             | 命令 / 用例                                                    | 期望                          |
| -------------- | -------------------------------------------------------------- | ----------------------------- |
| LOC 守卫       | `pnpm lint:core:composition-root-loc`                          | exit 0                        |
| UI 边界 + 负例 | `vitest … check-openbot-ui-boundaries.test.ts`（临时 fixture） | 正例过 / 负例拒；工作区无改写 |
| 隔离 + 负例    | `vitest … check-isolation-fail-closed.test.ts`（临时 fixture） | 正例过 / 负例拒；无探针残留   |
| 心跳调度       | `vitest … collab-s4-heartbeat-scheduler.test.ts`               | 含并发 updateConfig           |
| 全仓类型       | `pnpm tsgo`                                                    | exit 0（既有 tip）            |
| 全仓检查       | `pnpm check`                                                   | exit 0（既有 tip）            |

---

## 5. 验证结果（本轮）

受影响行为测试（19）：全部通过。见 `docs/design/evidence/memory-batch1-final-review-affected-tests-20261026.log`。

`pnpm tsgo`：**exit 0**（`docs/design/evidence/memory-batch1-tsgo-final-review-20261026.log`）。

`pnpm check`：**exit 0**（`docs/design/evidence/memory-batch1-pnpm-check-final-review-20261026.log`；末尾 28 项协作生命周期测试通过）。

---

## 6. 遗留风险

1. **主干预算债**：composition-root 文件已远超理想 facade 尺寸；本轮只锁 trunk，不拆分。
2. **allowlist 漂移复发**：main 上业务接线与 check 脚本不同步时，修绿分支会再次被迫对齐；建议主干单独 PR 同步守卫。
3. **133 提交混合落地**：检查已绿 ≠ 适合一次性合入主干；记忆首批局部验收不受影响。
4. **心跳**：生产默认 `schedulerEnabled=false`；修复降低了启用后的重复链风险，但仍依赖 in-flight dedup 作为叠防。

## 7. 文件范围（本轮限定收尾改动）

- `scripts/check-openbot-ui-boundaries.mjs`（`OPENBOT_CHECK_REPO_ROOT` 测试根入口；默认不变）
- `scripts/check-isolation-fail-closed.mjs`（同上）
- `test/scripts/check-openbot-ui-boundaries.test.ts`（临时 fixture 正负例）
- `test/scripts/check-isolation-fail-closed.test.ts`（临时 fixture 正负例）
- `docs/design/memory-batch1-check-green-review-2026-10-26.md`（本文 §4 补全）
- `docs/design/memory-batch1-runtime-change-inventory-8070ef52-to-tip.md`（逐文件附录）

未扩大记忆/业务功能面；未重做心跳缺陷证据；未 push。

---

## 8. 本轮提交

- 心跳修复：`c2fe66f826404963a5f6bcd76053117b30e079b7`
- 审查文档 + 负例测试 + 证据：`f42caeef95dc04d2e4d31570184627a5c2e0854f`
- Loom registry：`48a0a587f262dec62d52bda1c8ed8e24802a0639`
- 限定收尾 isolation 根入口：`935fe55654629adacb489b3b5bdb4d478c0b6b5c`
- 限定收尾 UI 边界根入口：`4a6b569fd517c18bc71f63cd3f066a771a7859b3`
- 限定收尾 fixture 测试 + §4 清单：`f3cde3c7b40ea31f45dd1b71008bcde49a56e056`
- SHA 回填：见本提交
- 未 push；未开 PR；未合并；未部署；未扩大业务。

---

## 9. 交接 shortcut 退役测试收尾（另记；不覆盖历史）

日期：2026-10-26（Asia/Shanghai）  
工作树：`/private/tmp/openbot-memory-batch1-rework`  
开场 tip：`1b2d327d8e92193d59c522791703836bae54165e`  
`origin/main`：`ad711a54a7d94c1dedfda9ef0016dc9b5adbae82`（merge-base = origin/main；ahead 154 / behind 0）

### 9.1 此前三文件复跑（历史快照；保留不覆盖）

时间约 2026-10-26 17:02（Asia/Shanghai）。证据：`/private/tmp/openbot-final-runtime-review.log`。

| 文件                                                             | 结果                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/gateway/server-methods/collaboration-learning.test.ts`      | **1 fail**（`persists an explicit task handoff contract` @ :371） |
| `src/gateway/collaboration-dispatch/wake-round-dispatch.test.ts` | 12 pass                                                           |
| `src/gateway/collaboration-dispatch/decision-engine.test.ts`     | 49 pass                                                           |
| **合计**                                                         | **70 pass / 1 fail**（71 tests；Test Files 1 failed \| 2 passed） |

失败根因（已确认，非产品回退）：旧用例仍期待 `collaboration.task.handoff` shortcut **成功**改 `owner`/`responsibility`/`assignedMemberIds`；实际 `handoffCollaborationTask` 抛 `HandoffContractRequiredError`（T09-B1），要求 `proposeHandoff → acceptHandoff → approveHandoff → applyApprovedHandoff`。

### 9.2 本轮处置（测试契约 only）

- **核对退役规则**：`HandoffContractRequiredError`（`task-runtime.ts`）；`handoffCollaborationTask` 恒拒绝（`state-machine.ts`）。
- **正式成功流程既有覆盖**（不重复建设）：`src/gateway/collaboration-learning/handoff-contract-entry.test.ts`
  - `flag-on: propose→accept→approve→apply closes loop…`
  - `flag-off` / `flag-on` shortcut 拒绝用例
- **改动**：将 `collaboration-learning.test.ts` 旧成功用例改为拒绝回归：
  - `respond(false, …)` + 明确拒绝文案（含 contract API 链路与 `shortcut is retired`）
  - `tasks.json` 字节级不变；`owner` / `responsibility` / `assignedMemberIds` / `handoffs` 不变
  - 无 handoff 文件写入；无 `wake-events.json` 派发副作用
- **未改**：产品权限、交接实现、记忆/O5/fixture 已通过项；未 skip、未降断言、未恢复 shortcut。

### 9.3 本轮验证（另记）

| 项                            | 命令                                                                             | 结果                           | exit  |
| ----------------------------- | -------------------------------------------------------------------------------- | ------------------------------ | ----- |
| 整文件 collaboration-learning | `pnpm exec vitest run src/gateway/server-methods/collaboration-learning.test.ts` | **10 pass / 0 fail**           | **0** |
| Mode B + decision-engine      | `vitest run …/wake-round-dispatch.test.ts …/decision-engine.test.ts`             | **61 pass**（12+49）           | **0** |
| `pnpm tsgo`                   |                                                                                  | 无类型错误                     | **0** |
| `pnpm check`                  |                                                                                  | 全绿（含 collab lifecycle 28） | **0** |

**分别报告**：该测试文件通过 ≠ 仅靠 `pnpm check`；上表两行独立。  
证据 log：

- `docs/design/evidence/memory-batch1-handoff-refuse-collab-learning-20261026-1729.log`
- `docs/design/evidence/memory-batch1-handoff-refuse-modeb-decision-20261026-1729.log`
- `docs/design/evidence/memory-batch1-handoff-refuse-tsgo-20261026-1729.log`
- `docs/design/evidence/memory-batch1-handoff-refuse-pnpm-check-20261026-1730.log`

### 9.4 本轮提交（本地 only）

- 测试契约：`1fbb766c4f820880ec69231f8abe4a68da65ce27`
- 审查/证据：`308df34dc571201a511618903fb15516279cc10f`
- 验证 tip（提交后 HEAD）：见上；开场 tip 仍为 `1b2d327d…`
- exit：collaboration-learning **0**；Mode B+decision-engine **0**；`pnpm tsgo` **0**；`pnpm check` **0**

### 9.5 未做

不 push / 不开 PR / 不合并 / 不部署；不回退记忆局部验收、O5 文案与 fixture；不扩展运行时功能；不修改交接产品逻辑。

---

## 10. 本轮关闭边界（本地交付验收）

**批准性质**：本轮批准的是 **本地交付验收**，**不是**将分支 ahead 提交（现 ahead≈158 vs `origin/main`）整体合入主干。禁 push / PR / merge / deploy 仍成立。

### 10.1 本轮可关闭（本地交付验收）

| 项               | 说明                                                                                     | 锚点（固定 SHA）                                               |
| ---------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 记忆首批局部优化 | O1/O2/O8 等已落地的局部优化与对应 harness；不以本轮通过代替完整效果验收                  | `97f0ae1a`…`8070ef52`（见分组清单）                            |
| O5 文案收敛      | 文件删除文案 + gateway forget 隔离测试                                                   | `8b9e0ebf`                                                     |
| 全仓检查恢复     | LOC/UI 边界/isolation 对齐 trunk + landing stream check-green + tip `pnpm check` 绿      | tip 验收 `aaab116a`；守卫 `0d81531e` / `ae640467` / `2076bf82` |
| 运行时与测试收尾 | Mode B `single_primary`；空 `agentId`；`adminDailySummary` 参数门；handoff shortcut 拒绝 | `74bd2b8c` / `29e06a56` / `d506d82a` / `1fbb766c`              |
| 心跳修复         | setInterval→递归 setTimeout + 防双链                                                     | `436f915b` → `c2fe66f8`                                        |

### 10.2 不因本轮通过自动完成

继续按各自授权与验收范围推进，**不**因本轮 `pnpm check` 绿或本地交付验收通过而关闭：

- **O4 只读基础能力**（含 Memory Center list foundation / LocalMetadataStore readonly 等后续验收）
- **候选视图**
- **Data Space 对齐**
- **完整记忆效果验收**

### 10.3 分组交付清单

见 [`docs/design/memory-batch1-grouped-delivery-checklist-2026-10-26.md`](./memory-batch1-grouped-delivery-checklist-2026-10-26.md)。

### 10.4 本轮 format / check 复验

| 项                   | 值                                         |
| -------------------- | ------------------------------------------ |
| format commit        | `f425e6e2d4b37881cd601e9e190c12774fc02e86` |
| 关闭边界+清单 commit | `9724c5629a7da81cad6ec6a539df814e123bdce6` |
| `pnpm check`         | exit **0**                                 |
| `pnpm tsgo`          | exit **0**（check 内 + 独立）              |
| 验证 HEAD            | `9724c5629a7da81cad6ec6a539df814e123bdce6` |
