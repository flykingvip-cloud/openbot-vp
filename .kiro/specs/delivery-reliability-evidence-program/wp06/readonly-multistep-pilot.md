# WP-06 — Readonly multi-step pilot（memory → web_read → acceptance）

- 状态：**READONLY_MULTISTEP_PICK + PILOT**（选型已冻结；最小纯 helper + 单测已落；**不**写 Progress Ledger；**不**翻转 `ORCHESTRATION_LIVE_INVOKE`；**不**武装调度器；**非 G4-A**）
- 日期：2026-10-24（Asia/Shanghai）
- 作者：grokbot-verifiable-delivery
- 前置：
  - `wp06/field-mapping-adr.md`（推荐下一刀：只读有限步骤工作流）
  - `wp06/orchestration-persistence-lease-design.md` §6 step 2
  - WP-05 `wp05/path-convergence-prep.md`（单路径 / dual-exec 拒绝）
- 代码：
  - `src/task-orchestration/readonly-multistep-pilot.ts`（+ unit test）
  - 既有：`considerReadonlyInvoke` / `invokeReadonlySurface` / `path-binding` / `lease-store`

## 1. 选型（冻结）

| 项 | 决定 |
| --- | --- |
| Pilot ID | `orch.readonly.multistep.memory-web-acceptance` |
| 步骤序列 | **1 memory → 2 web_read → 3 acceptance** |
| 执行面 | 仅既有只读路径；acceptance **无工具**（名级核对） |
| Planner / LIVE | 冻结；不经 `considerDispatch` live 路径 |
| Ledger | **禁止**从本 pilot / readonly invoke 写 Progress Ledger |
| Fabric | 不夺取 execute 所有权；默认 path=`legacy`；fabric 仅 decide-only（WP-05） |

备选（未选）：ledger event extension — 仅当本 pilot 证明命名不够用且人审同意时再开。

## 2. 精确步骤序列与既有 API

| Ordinal | stepKind | 既有 API | 输入 | 输出（pilot 形状） |
| --- | --- | --- | --- | --- |
| 1 | `memory` | `considerReadonlyInvoke({ intent: "recall_memory", query, … })` → `routeStep` → `invokeReadonlySurface({ surface: "memory" })` → `memory_search` | `query`（回忆检索串） | `untrustedText`；`wroteLedger: false`；可选 `pathBinding` |
| 2 | `web_read` | `considerReadonlyInvoke({ intent: "read_web", query, … })` → `invokeReadonlySurface({ surface: "web_read" })` → `web_fetch` 或 `web_search` | `query`（URL 或搜索串） | 同上 |
| 3 | `acceptance` | **无** `considerReadonlyInvoke`；纯函数 `evaluateReadonlyMultistepAcceptance` | 前两步 `resultRef` + 非空 `untrustedText` 标志 | `{ ok, reason, checkedResultRefs }`；`wroteLedger: false` |

约束：

- 每步调用 **独立** `logicalActionId` / path-binding `actionId`（见 §3），避免 WP-05 `dual_exec_refused`。
- 注入 `deps`（memory/web factories）时 **无网络**；单测只走 mock。
- `ReadonlyInvokeResult.wroteLedger` 类型已钉死为 `false`；pilot 报告同样钉死。

## 3. ADR 字段映射（每步）

命名空间与 ADR「幂等键 / resultRef / lease」对齐；**生产租约仍未发放**——本 pilot 只验证键是否够用。

| ADR 概念 | 本 pilot 命名规则 | 例（`taskId=t1`） |
| --- | --- | --- |
| `logicalActionId` | `orch.ro.ms.{taskId}.{stepKind}` | `orch.ro.ms.t1.memory` |
| `jobStepId`（合成 job+step） | `{taskId}::{stepKind}::{ordinal}` | `t1::memory::1` |
| lease key | **= `jobStepId`**（与 `OrchLeaseRecord.jobStepId` 同键） | `t1::memory::1` |
| `attempt` | 默认 `1`；同 `jobStepId` 重试时单调 +1（pilot 默认不重试） | `1` |
| `resultRef` | `orch-ro-result:{jobStepId}:a{attempt}`（指向只读产物占位；**不是** WP-01 信封落库，也不是 ledger 证据） | `orch-ro-result:t1::memory::1:a1` |
| path-binding `actionId` | **= `logicalActionId`**（单路径绑定键） | `orch.ro.ms.t1.memory` |
| acceptance | 无 lease / 无 tool；核对前两步均有非空 `resultRef` 且 `wroteLedger===false` | stepKind=`acceptance` |

可选演练（helper 内、**内存** `createOrchLeaseStore()`）：对 memory/web_read 步 `tryAcquireLease` → `submitResult({ resultRef })` → `release`。证明 lease 键与 `resultRef` 可挂在既有形状上；**不**宣称生产 holder 授予，**不**写文件除非测试注入 `rootDir`（默认内存）。

## 4. Dual-exec / path-binding（WP-05）

1. 同一 `actionId`（=`logicalActionId`）在进程内第二次 `bindReadonlyPilotAction` → `dual_exec_refused`；pilot **禁止**复用已绑定 id 重跑同一步。
2. 默认 `OPENBOT_ORCH_READONLY_PATH_PILOT` 未设 → path=`legacy`；单次适配器调用。
3. path=`fabric` 时必须注入 decide-only `policyCheck`；DENY 不调工具；ALLOW 仍只调原只读适配器一次——**不**经 loopback 再入 Fabric execute。
4. acceptance 步不进入 path-binding（非 pilot tool surface）。

## 5. 成功标准（未来代码 / 本轮最小 pilot）

本轮已落地的最小证明（`readonly-multistep-pilot.test.ts`）：

| # | 断言 | 含义 |
| --- | --- | --- |
| S1 | `ORCHESTRATION_LIVE_INVOKE === false` | LIVE 未翻 |
| S2 | 三步 plan 顺序固定 memory→web_read→acceptance | 选型冻结 |
| S3 | 每步 `logicalActionId` / `jobStepId` / lease key / `resultRef` 符合 §3 | 命名够用 |
| S4 | memory + web_read 经 injectable readonly invoke（mock，无网络）返回 `wroteLedger: false` | 真实只读路径形状 |
| S5 | acceptance 在两步均有 `resultRef` 时 `ok`；缺一步则失败 | 名级验收 |
| S6 | 可选内存 lease-store：acquire→submitResult→release 成功且 `resultRef` 回读一致 | 键可挂既有形状 |
| S7 | 同 `logicalActionId` 二次 bind → `dual_exec_refused`（复用 path-binding） | WP-05 约束 |

**明确不算成功 / 不宣称：**

- G4-A / 生产 ledger 证据包 / kill 挂生产存储
- 打开 `ORCHESTRATION_LIVE_INVOKE` 或武装调度器
- 从 readonly 路径写 Progress Ledger
- Fabric execute 所有权迁移 / G3-B

## 6. 为何可落最小代码（非 docs-only）

- 无需改 gateway / Fabric execute / ledger writer。
- 复用既有 `considerReadonlyInvoke` 形状（经注入 mock）+ `path-binding` + 内存 `lease-store`。
- Helper 纯编排命名与顺序；acceptance 为纯函数。

若未来要把 acceptance 变成真实 CTR/ledger GATE 事件，须另开切片且仍保持 LIVE=false，并禁止 readonly 自动写 ledger。

## 7. 状态声明

- **READONLY_MULTISTEP_PICK**：选型 = memory → web_read → acceptance。
- **PILOT**：`readonly-multistep-pilot.ts` + test 已落。
- LIVE 仍 **false**；无 G4-A。
- 下一步（延期）：ledger event 增量草案（仅当命名不够）**或** 将 lease 权威挂到 Progress Ledger / ConversationTask 增量（仍不解锁 live）。
