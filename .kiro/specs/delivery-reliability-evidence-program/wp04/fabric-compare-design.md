# WP-04 Fabric 决策比较设计（compare-before-migrate）

- 状态：**DESIGN + HARNESS_SLICE**（只读 approvals 注入已落地；**仍不宣称 G3-A**；无执行迁移）
- 日期：2026-10-24（Asia/Shanghai）
- HEAD（撰写时）：`2df36a55748f891d6eb05ad067318bc8783fd794`
- 作者：grokbot-verifiable-delivery
- 协调：需 **kiro-fabric** 知情；**不夺取 Fabric execute 所有权**；本专项只设计影子比较与证据合同。

## 1. 目标与非目标

**目标：** 在既有执行路径之后（或并行只读），捕获不可变脱敏快照，用 Fabric `check` / `replayDecision` / `dryRunDiff` / `isRelaxation` / `decisionTrace` 比较候选决策；证明比较路径 **零新交互审批、零业务写入**（或标清残留风险）。

**非目标：** 不切换执行入口；不调用 `FabricService.execute` / `stream` 作为影子主路径；不弹第二次审批；不改 `isFabricEnabled` 默认 OFF；不改 LICENSE / 生产 flag 默认。

## 2. API 与调用链地图

### 2.1 核心符号

| 符号                                        | 文件                                                 | 行为摘要                                                                              |
| ------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `FabricService.check`                       | `src/fabric/service.ts` L145–148                     | Dry-run：`decideFor` only；**never execute**（注释 R7.2）                             |
| `FabricService.execute` / `stream`          | 同文件 `runPipeline`                                 | compile → 可选 cost gate → `runGraph` → `onRecord` → **可能** `reportUsage`           |
| `replayDecision`                            | `src/fabric/replay.ts` L59+                          | 用记录内 `policyInputs` + `requestFromSnapshot` 再 `decide`；缺 `policyInputs` 则抛错 |
| `dryRunDiff`                                | `src/fabric/replay.ts` L123+                         | 对历史记录纯再裁决；无工具执行；统计 `relaxationCount`                                |
| `isRelaxation`                              | `src/fabric/replay.ts` L77+                          | DENY→非 DENY，或 sandbox/network 约束放松                                             |
| `decide` + `decisionTrace`                  | `src/fabric/policy-runtime.ts` / `decision-trace.ts` | 纯函数裁决；trace 绑在 `PolicyDecision`（contract R21.6）                             |
| `createProbeDecideFor`                      | `src/fabric/probes.ts` L122+                         | 生产 decideFor：读 allowlist/approval 探针 → `decide`                                 |
| `snapshotRequest` / `FabricExecutionRecord` | `src/fabric/audit.ts` L57–132                        | 脱敏 args/env；含 `policyInputs` 供 replay                                            |

### 2.2 已接线调用点（非测试）

| 调用点                    | 路径                                                                                              | 用途                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Gateway HTTP policy check | `src/gateway/fabric-v1-http.ts` ~L104：`service.check(request)`                                   | `/v1` 控制面 check                                                               |
| Gateway fabric methods    | `src/gateway/server-methods/fabric.ts`：`service.check`                                           | RPC check                                                                        |
| Seat-rules drill          | `src/gateway/seat-rules/drill.ts`：`runSeatPolicyDrill` / `runSeatDryRunDiffDrill`                | **闸门 6**：只 check / dryRunDiff；`preAuthorization: false`、`persisted: false` |
| Seat-rules server methods | `src/gateway/server-methods/seat-rules.ts`：构造 `createFabricService` + `resolveExecApprovals`   | 演练入口                                                                         |
| Gateway bootstrap         | `src/gateway/server.impl.ts` ~L957–982：`createGatewayFabricService` + `setFabricServiceProvider` | 安装控制面；`isFabricEnabled()` 门控对外服务                                     |
| Loopback execute 后端     | `src/fabric/loopback-invoker.ts`：`POST /tools/invoke`                                            | **仅 execute 路径**；比较设计不得走此环                                          |

### 2.3 比较路径副作用审计

| 副作用面                               | 结论                                | 证据                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 工具执行 / 业务写                      | **SAFE（check/replay/dryRunDiff）** | `check` 只 `decideFor`；`dryRunDiff` 注释 “NO side effects”；`replayDecision` 只 `decide`                                                                                                                                                                                                        |
| Billing / usage 写入                   | **SAFE（check 路径）**              | `reportUsage` 仅在 `runPipeline`（execute/stream）且 `result.status !== "denied"`（`service.ts` L137–139）；`check` 不进入                                                                                                                                                                       |
| 交互式新审批弹窗                       | **SAFE（设计意图）**                | probes：未解析 approval → DENY（`buildExecPolicyInputs`）；seat drill：`wouldRequireApprovalIfExecuted` 只计算不弹窗                                                                                                                                                                             |
| 审批文件 / auth 相关磁盘写             | **CONDITIONAL RISK（非零）**        | 默认 `createProbeDecideFor` → `buildExecPolicyInputs` → `resolveExecApprovals`（`probes.ts` `defaultResolveApprovals`）→ `ensureExecApprovals`（`exec-approvals.ts` L380+）可 **`saveExecApprovals`**（补 socket path/token）。**不是**写入 allowlist 放行，但是对 approvals 文件的潜在 mutation |
| Auth session cache（gateway token 等） | **UNKNOWN**                         | 未见 check 直接改 gateway auth cache；未做全量运行时追踪                                                                                                                                                                                                                                         |
| Fabric audit store append              | **CONDITIONAL**                     | `onRecord` 挂在 execute 管线；纯 `check` 默认不 `onRecord`。若调用方自行 append 演练结果 → 进程内审计缓冲写入（`createFabricAuditStore`），非业务账本                                                                                                                                            |
| Loopback `/tools/invoke`               | **禁止用于影子比较**                | 会触达真实工具边界                                                                                                                                                                                                                                                                               |

**安全结论（本轮）：** 比较 API 本身设计为 decide-only，**billing 与工具执行可标 SAFE**；但生产 probe 默认链可能触发 `ensureExecApprovals` 写盘 → **不能宣称「零磁盘 mutation」**，除非注入只读 `resolveApprovals`（seat-rules 已有注入点模式）或先保证 approvals 文件已稳定且 ensure 成 no-op。G3-A 证据必须覆盖该点。

## 3. 不可变脱敏快照合同（草案字段）

快照在「原策略已决定之后」捕获；候选决策只读该快照（或历史 `FabricExecutionRecord`）。字段对齐现有 `RequestSnapshot` + `PolicyDecision` + `PolicyInputs` + `ExecutionConstraints`，并显式补齐比较维度：

| 字段组             | 建议字段                                                                                                          | 来源 / 映射                                                   | 脱敏规则                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 身份 / 租户        | `tenantId`, `userId`, `source.type`, `sessionId`, `taskId`, `correlationId`                                       | `ToolRequest.source` / `trace`；`FabricExecutionRecord`       | 无密钥；禁止拷贝 token                                                                   |
| 工具 / 资源        | `tool.name`, `tool.version`, `cwd`, `fileScope`, `networkAccess`, redacted `args`                                 | `snapshotRequest`                                             | `redactArgs` / `redactEnv`（既有）                                                       |
| allow / deny / ask | `decision`∈{ALLOW,DENY,MODIFY}；`reason`；`matchedRules`；探针 `approval.requiresApproval` + `resolution`（若有） | `PolicyDecision`；`PolicyInputs.approval`                     | 未决批准标 `approval_required` **语义**，不得与永久 DENY 或 ALLOW 混同（比较报告层枚举） |
| sandbox            | `sandboxMode`, `allowedPaths`, `blockedPaths`                                                                     | `ExecutionConstraints`                                        |                                                                                          |
| 网络 / 文件        | `allowNetwork`, path lists                                                                                        | 同上；TOL 映射见 `constraints.ts` `toTolControls`             |                                                                                          |
| 成本               | `costLimit`, optional `costUsd` estimate                                                                          | constraints + audit `costUsd`                                 | 估计值不得当计费回执                                                                     |
| 策略版本           | `policyVersion`（**缺口：当前 contract 无独立 version 字段 → UNKNOWN/待增**）, `decisionTrace[]`                  | trace stages：loom/scope/allowlist/approval/sandbox/cost/risk | detail 禁凭据                                                                            |
| 所有权元数据       | `ownership`（Loom）                                                                                               | `FabricExecutionRecord.who.ownership`                         | neutral；不单独改裁决                                                                    |
| 完整性             | `snapshotHash`（拟）, `occurredAt`, `baselinePathId`（legacy vs fabric）                                          | 比较层计算                                                    |                                                                                          |

**既有可复用：** `FabricExecutionRecord` + `policyInputs` 已是 replay 快照；seat drill 已区分 `preAuthorization`/`persisted`。

**缺口：** 显式 `policyVersion` / `approval_required` 对外枚举尚未在 contract 单列 → 比较报告 schema 可先放在本专项 docs，落地时再与 kiro-fabric 协商是否升 contract。

## 4. Diff 分类法

| 类别                | 定义（操作化）                                                                        | 处置                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `safety_relaxation` | `isRelaxation(baseline, candidate) === true`（DENY→非 DENY，或 sandbox/network 放松） | **阻断迁移**；需人确认 + ADR                                                                        |
| `extra_deny`        | baseline ALLOW/MODIFY → candidate DENY（收紧）                                        | 可接受但需解释与误阻断评估                                                                          |
| `constraint_diff`   | 同决策字面，但 constraints 不等且非 relaxation（如 timeout/path/costLimit）           | ADR 允许列表；禁止只看 overall equal rate                                                           |
| `explanation_only`  | `decisionsEqual` 为真，仅 `decisionTrace`/matchedRules 文案差异                       | 可记录；不阻 G3-A                                                                                   |
| `incomparable`      | 缺 `policyInputs`、快照不完整、入口未鉴权假设不成立、工具类无探针覆盖                 | 必须逐条处置；**不得**从「旧入口已鉴权」推广到新入口（probes 注释已警告 method-already-authorized） |

映射注意：现有 `DryRunDiff.entries[].relaxation` 覆盖 safety_relaxation 子集；其余类别由比较报告层派生（本轮仅设计）。

## 5. 入口 × 工具 × profile 矩阵骨架

单元格：`legacy_owner` / `fabric_check` / `compare_ready` / `notes`。未知标 **UNKNOWN**。

| 入口（E0 matrix）                      | 代表工具类                     | profile 例    | legacy 决策面                                 | Fabric check 可达？                                                          | 比较就绪                             |
| -------------------------------------- | ------------------------------ | ------------- | --------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------ |
| `http_tools_invoke`                    | memory*search / exec / web*\*  | gateway-http  | `tools-invoke-http.ts` + tool-policy pipeline | 间接：控制面 check API；**invoke 本身默认不经 Fabric execute**（Fabric OFF） | PARTIAL — observe preflight 另有 env |
| `interactive_chat`                     | 会话工具集                     | chat-default  | pi-embedded attempt + pi-tools.policy         | Fabric service 若 enabled 可 check；聊天主路径 UNKNOWN 是否调用 check        | UNKNOWN                              |
| `fabric_control_plane`                 | 经 Fabric 规范化的 tool        | fabric-on     | policy-runtime                                | 是（`check`/`execute`）                                                      | 适合作为比较实验室；execute 非本 WP  |
| `cron`                                 | cron→agent tools               | cron          | cron auth + agent policy                      | UNKNOWN                                                                      | UNKNOWN                              |
| `subagent`                             | sessions_spawn 子跑工具        | subagent      | subagent policy                               | UNKNOWN                                                                      | UNKNOWN                              |
| `node_host`                            | node_fs_read / node_exec       | node          | tool policy；orch node flag 默认 off          | UNKNOWN                                                                      | UNKNOWN                              |
| `browser`                              | browser tools                  | browser       | allowlist+sandbox；orch browser 默认 off      | UNKNOWN                                                                      | UNKNOWN                              |
| `core_channels` / `extension_channels` | 通道外发                       | channel       | channel allowlists                            | 外发写操作 **不进本 WP 试点**                                                | out-of-scope for first compare       |
| `collab_group`                         | collab executors               | collab        | handoff/collab flags                          | UNKNOWN                                                                      | UNKNOWN                              |
| `orchestration_plane`                  | memory/web_read/skill readonly | orch-readonly | orch flags；`ORCHESTRATION_LIVE_INVOKE=false` | 可读工具可作 WP-05 候选；比较可先人工构造 ToolRequest                        | PREP→WP-05                           |
| `constitutional_shadow`                | preflight                      | shadow        | observe NOOP                                  | 不选路径                                                                     | out-of-scope                         |

**首轮建议填充：** `fabric_control_plane` × exec-class × default-ask；`http_tools_invoke` × memory_search × pre-auth；`orchestration_plane` × web_read/memory × readonly。其余保持 UNKNOWN。

## 6. G3-A 成功标准与「双零」证明计划

G3-A（摘自工作包，本轮不宣称达成）：

1. 选定范围内无未解释的 `safety_relaxation`。
2. 全部 `incomparable` 有处置记录。
3. 实时比较故障不改变原执行结果（比较失败 fail-open 到「仅记录」，不改 legacy 决定）。

**零新审批 / 零业务写证明计划（拟）：**

| 证明项                | 方法                                                                                                      | 通过标准                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 无 `execute`/`stream` | 影子路径静态只引用 `check`/`replayDecision`/`dryRunDiff`；测试 spy                                        | 零调用                                                                                        |
| 无 usage/billing      | spy `reportUsage` / usage ingest                                                                          | 零调用                                                                                        |
| 无交互审批 UI         | seat-drill 风格断言 `preAuthorization===false`；无 approvals grant API                                    | 零弹窗/零放行写入                                                                             |
| 审批文件 mutation     | 注入只读 `resolveApprovals` **或** 夹具中断言 `saveExecApprovals` 未被调用；记录 ensureExecApprovals 基线 | 零 `saveExecApprovals` **或** 文档化「仅 socket bootstrap」并经人接受（不得称为完全零磁盘写） |
| 无业务工具副作用      | 禁止 loopback invoker；禁止真实 outbound                                                                  | 零工具业务写                                                                                  |
| 原路径不变            | 比较包装 try/catch；legacy 返回值金片                                                                     | 字节级/结构化结果一致                                                                         |

## 7. 归属与协调

- Fabric 运行时与 `src/fabric/**` execute 所有权：**kiro-fabric**（及既有宣称方）；本任务 **不** loom-register 夺取 execute。
- 本专项可落：`.kiro/specs/delivery-reliability-evidence-program/wp04/**` 设计与后续证据目录；比较报告 schema；只读 harness（若未来实施，另开接管表）。
- 已存在可复用演练：`src/gateway/seat-rules/drill.ts` — WP-04 应 **扩展证据与矩阵**，避免平行第二套 drill 语义。

## 8. 状态声明

- 状态：**DESIGN**。
- 无迁移代码；无 G3-A；无 ACCEPTED。
- 关键安全发现：`check`→默认 probes→`ensureExecApprovals` **可能写 approvals 文件** — 影子比较默认必须注入只读 approvals 视图或先固化文件。

## 落地记录（2026-10-24，Asia/Shanghai）— 只读 approvals 夹具

- `resolveExecApprovalsReadonly`（`src/infra/exec-approvals.ts`）：`loadExecApprovals` only，不调用 `ensure`/`save`。
- `createReadonlyResolveApprovals`（`src/fabric/probes.ts`）：影子比较注入点。
- Seat drill（`seat-rules.ts`）改为 readonly resolve。
- 证据测：`src/fabric/shadow-compare-readonly.test.ts`（check 路径零 `saveExecApprovals`）。
- **未改** `defaultResolveApprovals` 生产默认（仍可 ensure）；未夺 Fabric execute 所有权；未宣称 G3-A。
