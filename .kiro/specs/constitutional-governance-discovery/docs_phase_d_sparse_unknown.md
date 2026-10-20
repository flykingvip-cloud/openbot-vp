# Phase D 稀疏 unknown 复核注（S3；discovery；不接线）

> 书面范围：`sparse_unknown_docs`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/docs_phase_d_sparse_unknown.md`。  
> 日期：2026-09-25  
> 对照：FC-08 / FC-08b / FC-08c；`docs_phase_d_claim_level.md`；Doc02 Tier S 候选  
> 本页只改 discovery 文档。不改 `src/`、不新开旗标、不新增 `buildExecutionPreflight` 调用点、不调用 `applyPreflightToTools` / `armCompletionHold`、不打开 enforce / live invoke / Fabric default-on。不改写 Phase C freeze / NO-GO。

## 1. 一句话

在 FC-08b（§6 ConversationTask）与 FC-08c（§9 插件未授权失败形态）之后，把**仍保持 `unknown` 且本轮只做文档复核**的格子记账：Cron / subagent 相对闭合预检三态、以及 Profile B（`managed_enterprise` / Gate 0）是否被相关入口闭合。复核结论是**确认仍 unknown**，不是升格，也不是新刀。

## 2. 范围与非范围

| 做 | 不做 |
| --- | --- |
| 按已读源码核对 Cron 隔离回合、主会话 Cron→heartbeat、subagent spawn/announce 的调用链 | 新开观察旗标或把上述行收成 explicit reuse-observe |
| 核对插件装载与 ConversationTask 是否读 `security-profile` / Gate 0 | 宣称 Profile B 已闭合或 production-proven |
| 更新 inventory 交叉引用（FC-08d 后记） | 改 Phase C 决策；接线 stdio 桥 / AOR；P8b/P8c/enforce |

主张等级：本注本身是文档事实；其中涉及的 Phase D 包主张天花板仍见 `docs_phase_d_claim_level.md`（`code-present`）。`production-proven` 在未探测 `openbot-gateway-rc` 前一律 `unknown`。

## 3. Cron / subagent（相对闭合预检三态）

闭合三态仍是：「复用预检（reuse-observe）| 显式豁免+break-glass | 删除」。

### 3.1 已读覆盖（不升格为 reuse-observe）

| 路径 | 源码 | 进入执行的方式 | 本注结论 |
| --- | --- | --- | --- |
| 隔离 Cron `agentTurn` | `src/cron/isolated-agent/run.ts` → `runCronIsolatedAgentTurn` | 调用 `runEmbeddedPiAgent`（`trigger: "cron"`）→ `runEmbeddedAttempt`；热路径预检仍在 `attempt.ts` | **回到热路径 ≠ 本行已收成 explicit reuse-observe**。本文件未调用 `buildExecutionPreflight` / `applyPreflightToTools` |
| 主会话 Cron | `sessionTarget === "main"` 不直接 `runEmbeddedPiAgent` | 入队 system event，并可经 `runHeartbeatOnce` → `getReplyFromConfig`（`src/infra/heartbeat-runner.ts`） | 回复路径（热路径或 ACP dispatch）。**不**记为已证明的预检旁路，也**不**把 Cron 行写成豁免/删除 |
| subagent spawn | `src/agents/subagent-spawn.ts` → `spawnSubagentDirect` | `callGateway({ method: "agent" })` | 进入网关 agent 热路径；spawn 文件自身无预检调用 |
| subagent announce | `src/agents/subagent-announce.ts` | 完成/直达 announce 同样 `callGateway({ method: "agent" })` | 同上；投递回执 / announce 不是 proof |

本注**未**在上述四个文件中读到对 `buildExecutionPreflight` 或 `applyPreflightToTools` 的直接调用（Cron 仅类型向引用 hook-delivery 结果类型，不构成入口级预检三态登记）。

### 3.2 仍 unknown（相对三态）

- Cron / subagent **自己的清单行**仍在闭合预检三态之外（与 FC-08 正文一致）。
- 只审 `attempt.ts` 就宣称 Cron / subagent 已收口，仍是 **C10 失败形态**。
- 本注**不**发明观察旗标，**不**把「回到热路径」改写成 explicit reuse-observe。

## 4. Profile B ↔ 入口闭合

Profile B = `managed_enterprise`（Gate 0 / 专用租户卷），解析在 `src/gateway/security-profile.ts`（`OPENBOT_SECURITY_PROFILE` / `gateway.security.profile` / 由 `data.mode` 推导）。

| 入口 | 是否读 `resolveSecurityProfile` / Gate 0 | 本轮结论 |
| --- | --- | --- |
| ConversationTask 库路径（§6 / FC-08b） | `openTenantScopedDb` 做租户文件隔离；**不**读 security-profile | Profile B 是否由此闭合：**仍 `unknown`**（租户文件隔离 ≠ Gate 0 专用卷证明） |
| 插件装载（§9 / FC-08c） | `loadOpenBotPlugins` 链路**不**读 security-profile | Profile B 是否由此闭合：**仍 `unknown`** |
| Cron / subagent 上述四文件 | 本轮未读到 security-profile 引用 | 不把「未引用」写成「已豁免 Profile B」；Profile 格保持 **unknown** 直至安全 Owner 补表 |

`production-proven`：本注未探测 `openbot-gateway-rc`，全部保持 `unknown`。

## 5. 与 FC-08 系列的关系

| 注 | 覆盖 | 本 S3 增量 |
| --- | --- | --- |
| FC-08 | C10 / bypass 缺口；Cron/subagent 覆盖与缺口；明确非刀（stdio、AOR） | 无改写；交叉引用 |
| FC-08b | §6 稀疏格（旗标、ACL、失败语义） | Profile B / 未读转移仍 unknown — 本注重申 |
| FC-08c | §9 未授权装载失败形态 | Profile B / production-proven 仍 unknown — 本注重申 |
| **FC-08d（本注）** | 把 Cron/subagent 三态外状态 + Profile-B↔入口 仍 unknown **收成一页书面范围** | 仅文档；inventory 后记 |

明确非刀不变：ACP stdio 桥另挂预检；`packages/aor-core` 内预检；为观察打开 Fabric。

## 6. C10

stdio 桥、AOR、Cron/subagent 仍在闭合预检三态之外时，**C10 不能标 pass**。本注不打开 Phase D 续刀，不改 `.kiro/specs/constitutional-governance-phase-c-decision/`。

## 7. 验收提示（独立验收 bot）

**PASS** 当且仅当：

1. 仅 discovery 文档变更；无 `src/` / 旗标 / Phase C freeze 改动。  
2. 文中 Cron/subagent 与 Profile B 结论均为「仍 unknown / 不在三态内」，无 `runtime-enabled`、`production-proven`、C10 pass、或「Profile B 已闭合」。  
3. 未新增观察旗标名，未要求接线。

**FAIL**：任何把「回到热路径」写成已 reuse-observe、把租户文件隔离写成 Profile B 已闭合、或改写 Phase C NO-GO。
