# Implementation Plan: evolution-runtime-closure

## Agents

- grok-evolution-closure · role: owner · scope: 四闭环收敛（执行绑定、调用事件、服务端模式、DNA 后台、治理持久化与调度）· paths: `.kiro/specs/evolution-runtime-closure/**`, `src/gateway/skill-execution-binding/**`, `src/gateway/pattern-detection/**`, `src/gateway/skill-invocation/**`, `src/gateway/evolution-governance/**` · since: 2026-07-19
- cursor-evolution-closure · role: contributor · scope: collaboration learning governance + capsule promote loop + growth humanTakeover UI · paths: `src/gateway/collaboration-learning/**`, `src/auto-reply/reply/collaboration-*`, `ui/src/ui/ports/employee/views/group-profile-governance.ts`, `ui/src/ui/controllers/collaboration-governance-actions.ts`, `ui/src/ui/controllers/chat.ts` · since: 2026-07-23

## Overview

Phase 0 审计已完成。验收曾夸大完成度（2026-07-19 验收驳回）。以下勾选以**代码证据**为准；不得将「接口存在」标为闭环完成。

每个提交 trailers：

```
Task: evolution-runtime-closure
Agent: grok-evolution-closure
```

---

## Phase 0 — 审计、契约与规格

- [x] **0.1** 工作树检查：他人 WIP 不触碰 — grok-evolution-closure
- [x] **0.2** 阅读 AGENTS + 相关规格 — grok-evolution-closure
- [x] **0.3** 代码级七断点审计 — grok-evolution-closure
- [x] **0.4** 本 spec requirements/design/tasks + Loom 注册 — grok-evolution-closure
- [x] **0.5** Fail-before 固化为测试 — grok-evolution-closure

---

## Phase 1 — 技能真实执行闭环

- [x] **1.1** `SkillExecutionBinding` 投影模块 — grok-evolution-closure
- [x] **1.2** install/enable/upgrade/remove/disable → 物化；禁用后不加载 — grok-evolution-closure
- [x] **1.3** 版本 pin：rollback 同步更新 `installedVersion` 并 refresh 物化 — cursor-evolution-closure
- [~] **1.4** 调用事件：started/completed 事件含 toolCallId/toolName/attributionResolution — **部分**（attempt/CLI 已接共享 helper；compact 无 tool 执行路径）— cursor-evolution-closure
- [~] **1.5** usage/lastInvokedAt/健康：真实调用路径更新；治理指标优先 agent 作用域 events — **部分**— grok-evolution-closure
- [x] **1.6** 健康窗口磁盘持久化 — grok-evolution-closure
      | **1.7** snapshot/cron 路径：cron snapshot 合并 binding | **通过** — `skills-snapshot.ts` + `mergeSkillSnapshotWithExecutionBindings` — cursor-evolution-closure

---

## Phase 2 — 稳定模式 → 候选技能

- [~] **2.1** 服务端样本：RPC/UI ingest 传 toolsUsed + 分离 input/output hash — **部分**（runner 完整）— cursor-evolution-closure
- [x] **2.2** 模式聚合独立键：taskId（cron/collab/lineage）≠sessionKey，否则 runId — grok-evolution-closure
- [~] **2.3** candidate contract.toolsRequired 来自 toolsUsed 名 — **部分**（回放引擎仍浅）— grok-evolution-closure
- [x] **2.4** publish 硬门禁 approved + 不 auto-install + draft 不可物化；approve/reject/publish 属 operator.approvals — grok-evolution-closure
- [~] **2.5** 前端 sampleCount：gateway 连接时 CTA 仅认服务端 `pc_*` candidate — **部分**（manual-iteration bypass 仍在）— cursor-evolution-closure

---

## Phase 3 — Agent 行为进化自动闭环

- [~] **3.1** tool + humanTakeover + satisfaction RPC/协作 — **部分**（task/review/memory flush satisfaction 已接；humanTakeover 已接 stop/abort + `humanTakeoverObserved` on checkpoint restore/undo 重发；`recordToolOutcome` 仍无调用点）— cursor-evolution-closure
- [x] **3.2** 后台节流 recompute+DNA — grok-evolution-closure
- [x] **3.3** 后台 DNA 节流/无信号测试 — grok-evolution-closure
- [x] **3.4** 二阶 raw score — grok-evolution-closure

---

## Phase 4 — 系统治理闭环

- [~] **4.1** 持久化 state + effectVerifications + metrics — **部分**— grok-evolution-closure
- [~] **4.2** pause 规则 + effect window 后 resume/hold；low_skill_success 仅 pending — **部分**— grok-evolution-closure
- [x] **4.3** kill switch + job cursor + action idempotencyKey 日键 — grok-evolution-closure
- [~] **4.4** pause → binding disabled；resume → active；投影尊重 disabled — **部分**— grok-evolution-closure
- [~] **4.5** human-gate UI：enterprise 挂载 actions 页 + limit/redirect 手动表单 + browser e2e — **部分**（无 live gateway WS e2e）— cursor-evolution-closure

---

## Phase 5 — 端到端验收

- [x] **5.1** 链路单测 + RPC integration + dispatch 层 + live Gateway WS + trusted-proxy 全链路 — cursor-evolution-closure
- [x] **5.2** scope + legacy tenantId backfill + shared-agent tenant RBAC（读可见 / 写需平台管理员）— cursor-evolution-closure
- [x] **5.3** 交付报告（诚实勾选）— grok-evolution-closure

### 2026-07-20 三门槛进度（验收门禁，非自动进化就绪）

| 门槛                               | 状态                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| draft/reviewing/candidate 禁止物化 | 代码门禁已上：EXECUTABLE_LIFECYCLES 白名单 + publish 需 approved + 不 auto-install |
| 真实技能选择/使用点产生 invocation | tool-match + prompt-only **named use**；loaded-on-run 不计                         |
| 模式样本真实输出与工具轨迹         | input≠output + structure shape hash + tool names for contract                      |

### 2026-07-20 五项验收门槛

| 门槛               | 状态                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| prompt-only 归因   | **基本通过**：assistant 显式点名才计次；否则诚实 uncounted                                                 |
| 结构哈希升级       | **基本通过**：outline/schema 主导 + `structureHashFromToolTrace` + `toolsUsed`→contract                    |
| 治理读运营指标     | **部分通过**：skill success/latency 驱动 pause / human-gate anomaly；无 auto-recover / limit / redirect UI |
| operator.approvals | **基本通过**：approve/reject/publish 改 `operator.approvals`；agentDir ACL 仍为对象级                      |
| 链路单测           | **通过**：`evolution-runtime-closure-chain.test.ts` 覆盖 candidate→health                                  |

### 2026-07-20 归因/安全收敛 + 剩余项

| 项                                     | 状态                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------- |
| selectedSkillId / toolCallId 上下文    | **基本通过**                                                                                    |
| 共享工具扇出                           | **通过**（不归因）                                                                              |
| 身份包装工具 `ob_sk_<skillId>__<tool>` | **基本通过** + unique-owner execute 注入                                                        |
| 低成功率自动 pause                     | **已关闭** → pending human review                                                               |
| agent 作用域治理指标                   | **基本通过**                                                                                    |
| 治理效果验证                           | **部分通过**：pause 开 effect window → 到期 resume/hold                                         |
| 效果窗口可配置                         | **通过**：scheduler effectVerifyMs / configureEffectVerifyMs / env OPENBOT_GOV_EFFECT_VERIFY_MS |
| 模式 taskId                            | **基本通过**：cron/collab/shared-task refs/lineage/deliverable；普通 turn 仍 runId              |
| 归因可观测                             | **通过**：readAttributionStats 计数 identity/unique_owner/none                                  |
| agent 分区健康窗口                     | **部分通过**：key=`agent:…                                                                      | skill:…` + 全局镜像 |
| prompt-only                            | **部分**                                                                                        |

**仍不得宣称全自动进化就绪**：prompt-only 不可靠、无完整人工 UI、非 collab 会话仍按 turn。

---

### 2026-07-23 Collaboration learning governance closure (cursor-evolution-closure)

| 项                                                         | 状态                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| memory flush → candidate（去掉 auto-approve/promote）      | **通过** — `memory-flush-outcome-capsule.ts` + backflow 薄包装                     |
| task/review/memory flush satisfaction 统一                 | **通过** — `collaboration-satisfaction.ts` + `state-machine.ts`                    |
| capsule approve → promote → learning asset → prompt 注入   | **通过** — `capsule-promotion.ts` + `collaboration-capsule-promotion-loop.test.ts` |
| RPC `collaboration.capsule.transition` 注册                | **通过** — `method-scopes.ts`                                                      |
| Workbench Capsules 列表 + 详情 + 审批 UI                   | **通过** — `group-profile-governance.ts`                                           |
| false_ready WS + workbench badge                           | **通过** — `growth-events.ts` + `workbench-growth-badge.ts`                        |
| humanTakeoverObserved UI（checkpoint restore / undo 重发） | **通过** — `chat.send` + `app.ts` / `app-chat.ts`                                  |
| humanTakeover stop/abort（同 run abortSignal）             | **通过** — `agent-runner-execution.ts`（prior commit）                             |

### 2026-07-23 Phase 1–2 / 4.5 / 5.x 收敛 (cursor-evolution-closure)

| 项                                                | 状态                                                         |
| ------------------------------------------------- | ------------------------------------------------------------ |
| rollback → installedVersion pin 跟随新 head       | **通过** — `skill-lifecycle-store.ts` + store test           |
| gateway 启动注册 binding hooks                    | **通过** — `server.impl.ts`                                  |
| invocation 事件 toolCallId/toolName/attribution   | **通过** — `skill-invocation/types.ts` + chain test          |
| pattern RPC/UI toolsUsed + 分离 input/output hash | **通过** — `pattern-detection.ts` RPC + `from-chat-final.ts` |
| 连接 gateway 时 CTA 仅服务端 candidate            | **通过** — `asset-suggestion-trigger.ts`                     |
| enterprise 挂载 human-gate actions 页             | **通过** — `enterprise-workforce-governance-surface.ts`      |
| governanceApi limit/redirect/clear wrappers       | **通过** — `governanceApi.ts` + redirect 清除按钮            |
| evolution scope 单测扩展                          | **通过** — `pattern-approvals-scope.test.ts`                 |

### 2026-07-23 Phase 1.7 / 4.5 / 5.x 第二轮 (cursor-evolution-closure)

| 项                                                  | 状态                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| cron snapshot 合并 lifecycle bindings               | **通过** — `mergeSkillSnapshotWithExecutionBindings` + `skills-snapshot.test.ts` |
| legacy candidate tenantId backfill                  | **通过** — `resolveCandidateTenant` in `store.ts`                                |
| toolsRequired 不再 fallback hash 字符串             | **通过** — 无 toolsUsed 时为空数组                                               |
| manual-iteration 显式人工门（不伪造 sampleCount=3） | **通过** — `decideAssetSuggestionFromManualIteration`                            |
| human-gate 手动 limit/redirect 表单                 | **通过** — `actions-page.ts`                                                     |
| RPC chain: ingest toolsUsed → limit → redirect      | **通过** — `evolution-governance.test.ts`                                        |
| enterprise 挂载 actions 页 browser 断言             | **通过** — `mesh-governance-redesign.browser.test.ts`                            |
| gateway 连接时本地 heuristic 不触发 CTA             | **通过** — `asset-suggestion-trigger.test.ts`                                    |

### 2026-07-23 Phase 1.4 / 5.1 第三轮 (cursor-evolution-closure)

| 项                                                        | 状态                                                                                                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| lifecycle tool attribution 共享 helper                    | **通过** — `lifecycle-tool-attribution.ts` + unit test                                                                                             |
| attempt runner 接入 helper（含 selectedSkillId fallback） | **通过** — `run/attempt.ts`                                                                                                                        |
| gateway dispatch 层 scope + ingest + apply-limit          | **通过** — `evolution-runtime-closure-dispatch.test.ts`                                                                                            |
| compact/CLI 调用事件路径                                  | **CLI 通过**（`commands/agent` → `runEmbeddedAttempt` → helper）；**compact N/A**（无 tool 执行）— `agent.lifecycle-attribution-path.node.test.ts` |

### 2026-07-23 Phase 4.5 / 5.1 第四轮 (cursor-evolution-closure)

| 项                                                 | 状态                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| governance actions 手动 limit/redirect browser e2e | **通过** — `actions-page.browser.test.ts`（click → RPC wrapper → reload snapshot） |
| gateway dispatch 层 params 修复                    | **通过** — `req.params` + agent-runtime-store mock                                 |

### 2026-07-23 Phase 5.1 第五轮 — live Gateway WS (cursor-evolution-closure)

| 项                                           | 状态                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| live WS ingest → limit → redirect → snapshot | **通过** — `evolution-runtime-closure-ws.test.ts`（真实 `withServer` + `rpcReq`；membership stub） |
| live WS approve scope 拒绝                   | **通过** — 无 `operator.approvals` 时拒绝                                                          |

### 2026-07-23 Phase 5.1 第六轮 — trusted-proxy 全链路 (cursor-evolution-closure)

| 项                                                   | 状态                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| platform bootstrap → enterprise activate → cookie WS | **通过** — 无 membership stub                                   |
| scopesHeader 强制 session scopes（覆盖 client 自报） | **通过** — hello.auth.scopes 含 admin/approvals                 |
| ingest → limit → redirect → snapshot                 | **通过** — `evolution-runtime-closure-trusted-proxy-ws.test.ts` |
| candidate.tenantId = 真实 enterprise id              | **通过**                                                        |

### 2026-07-23 Phase 5.2 — Shared-agent tenant RBAC (cursor-evolution-closure)

| 项                                                             | 状态                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------ |
| unique-owner helper `isRuntimeAgentUniqueOwnerForTenant`       | **通过** — `operator-access.ts` + unit tests           |
| 租户对 shared agent 写治理拒绝                                 | **通过**（既有 + ACL 单测）                            |
| pending-approvals 去掉不可写 actions + `requiresPlatformAdmin` | **通过** — `evolution-governance.ts`                   |
| snapshot `sharedAgentWriteDenied`                              | **通过** — 租户可见但 UI 不展示写按钮                  |
| actions-page 共享 Agent 文案门闩                               | **通过**                                               |
| pattern list/approve 跨租户隔离 on shared agent                | **通过**（既有 `pattern-detection shared-agent` 套件） |

Land: shared-agent RBAC 已 push（`6c0c09c9ce`）。

---

### 2026-07-20 人工门 API + 会话任务边界

| 项                                                                   | 状态                                                  |
| -------------------------------------------------------------------- | ----------------------------------------------------- |
| evolution-governance.snapshot / list-effects / attribution-stats     | **通过**（operator.read）                             |
| human-resume / human-hold / kill-switch / configure-effect-verify-ms | **通过**（operator.approvals）                        |
| 非 collab 多轮：session+structure 30m 窗口                           | **基本通过**（`sess-struct:…`）                       |
| prompt-only 默认不计次                                               | **通过**（需 OPENBOT_PROMPT_NAMED_USE_ATTRIBUTION=1） |

### 2026-07-20 limit/redirect + 人工门 UI

| 项                                         | 状态                                             |
| ------------------------------------------ | ------------------------------------------------ |
| limit / clear_limit                        | **通过**：降 routingPriority + degraded；可恢复  |
| redirect / clear_redirect                  | **通过**：暂停源 + 持久化 target 意图            |
| high_latency / low_success 自动 soft limit | **通过**（非 full pause）                        |
| governance Actions 页 Evolution 面板       | **基本通过**：snapshot + resume/hold/clear-limit |

### 2026-07-20 路由重定向 + 审批队列

| 项                                       | 状态                            |
| ---------------------------------------- | ------------------------------- |
| resolveAgentRoute 消费 redirects         | **通过**（sessionKey 同步改写） |
| resolveSessionAgentIds 消费 redirects    | **通过**                        |
| pending-approvals / resolve-approval RPC | **通过**                        |
| Actions 页 pending 审批条                | **基本通过**                    |

### 2026-07-20 有限 ABD

| 项                            | 状态                                           |
| ----------------------------- | ---------------------------------------------- |
| A 飞行检查 harness            | **通过** `flight-check.test.ts`                |
| B redirect 运维说明 + UI 提示 | **通过** runbook + Actions 角标                |
| D mode=assist 默认            | **通过**（auto 才自动恢复；off 关闭 pipeline） |

### 2026-07-20 技能自动安装（安全回退）

| 项                                          | 状态                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| OPENBOT_SKILL_AUTO_EVOLUTION 默认 **off**   | **通过**（fail-closed）                                                   |
| 非法 env → off                              | **通过**                                                                  |
| 治理 mode 默认 **assist**                   | **通过**（不改 runtime）                                                  |
| 后台 **禁止** auto-approve                  | **通过**（仅人工 approve）                                                |
| 安装需 skill-auto=on **且** governance=auto | **通过**                                                                  |
| skillAutoJobs 阶段可补偿重试                | **通过**                                                                  |
| 恢复仅限 owned job / autoInstallIntent      | **通过**                                                                  |
| cancel/abort + 重试前重验授权               | **通过**                                                                  |
| approvedBy / approvedAt / policy snapshot   | **通过**                                                                  |
| redirect 租户缺失 fail-closed               | **通过**                                                                  |
| 本任务 tsgo 范围零错误                      | **通过**（全仓其它并行任务错误不计）                                      |
| enroll/cancel 三方归属 ACL                  | **通过**（membership ∩ agent ownership ∩ candidate.tenantId；非目录解析） |
| candidate.tenantId=企业 id + operatorUserId | **通过**                                                                  |
| run-skill-auto-pass RPC                     | **通过**（不绕过审批）                                                    |

### 2026-07-23 Skill-auto opt-in readiness (cursor-evolution-closure)

| 项                                                     | 状态                                 |
| ------------------------------------------------------ | ------------------------------------ |
| 默认仍 fail-closed（skill-auto off / mode assist）     | **保持** — 禁止默认 fail-open        |
| 人审 UI：approve `autoInstallIntent` checkbox          | **通过** — `actions-page.ts`         |
| 人审 UI：enroll / cancel + `skillAutoJobs` 列表        | **通过**                             |
| Kill-switch UI 切换（mode/skill-auto 仍只读 env）      | **通过**                             |
| 安装前 critical scan 硬门禁（warn 放行）               | **通过** — `scanSkillAutoInstallDir` |
| 安装后 `health_watch` → 低成功率 `rolled_back`+disable | **通过**                             |
| 观察窗到期样本不足 → `installed`（不伪造失败）         | **通过**                             |

**可宣称**：显式双重授权下的已批准技能自动安装 + 扫描门禁 + 健康回滚就绪。  
**仍不得宣称**：全自动进化默认开启 / 生产默认自动安装。

## 完成定义（否定清单）— 仍适用

不得在以下情况宣称任务完成：仅 UI/endpoint、仅字段状态机、仅内存 Map、仅建议无生效、仅单测无入口集成、安装禁用不影响下次运行、健康非真实调用、DNA 仅 UI 推进、定时任务未真正治理、自动动作不改真实对象、无回滚/幂等/租户隔离证明、后台静默审批、默认 fail-open 自动安装。
