# Failure cases：仅收敛三模块后仍在的真实缺口

> mainSha = `2b9776708832d2cd3e533f0bf03a8498b0fc3f4a`（origin/main，含 PR #23）
> 核心问：若不建 Meta-Schema，只收敛 execution-preflight + ConversationTask + task-orchestration，哪些**真实**问题仍未解？
> 合格条：可复现 / 具体代码缺口 / 证明既有机制不足 / 可量化 / 非臆测未来风险 / 非命名问题 / 非 B1/B2 合成分类成功。

## 总判

本文件记录 **3 个在 origin/main 可复现的结构性缺口**。它们证明「只把三模块彼此收敛」**不能自动闭合**旁路与跨域终态化。  
但在 `alternatives-matrix.md` 中，方案 **D** 对这三例均**无**相对 A–C 的清晰、不可廉价替代的可度量优势（有限 GO 也不授权 Path/Gate/旁路强制收口）。  
因此三场景用于回答核心问题与否决「术语式 GO」；**不**构成 GO 的独特收益证明 → 见 `decision.md` **NO-GO**。

---

## FC-01 — HTTP `/tools/invoke` 绕过 execution-preflight

| 字段                                 | 内容                                                                                                                                                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| failureId                            | `FC-01-tools-invoke-bypasses-preflight`                                                                                                                                                                                                                    |
| symptom                              | 经 Gateway HTTP `POST /tools/invoke` 执行工具时，不经过 `buildExecutionPreflight`、不挂 `armCompletionHold`、不发 `issueValidationReceipt`、不写入预检 trace；与聊天热路径（`attempt.ts`）治理包络不对等。                                                 |
| affectedUserOrOperator               | 使用 HTTP 工具调用的集成方 / 自动化；安全与审计 Operator（误以为「预检已覆盖所有工具执行」）。                                                                                                                                                             |
| reproduction                         | 见下方「复现命令与结果」。                                                                                                                                                                                                                                 |
| currentMainEvidence                  | `src/gateway/tools-invoke-http.ts`：**0** 处引用 execution-preflight / CTR / orch。`buildExecutionPreflight(` 非测试调用点仅 `attempt.ts:1111`。Phase A `execution-entry-inventory.md` §10 已标该入口「是否复用预检：unknown」——本轮升格为**可证不复用**。 |
| rootCause                            | 工具策略管线（`pi-tools.policy` / `tool-policy-pipeline`）在 HTTP 面存在，但**交付完成权威与预检 trace**只挂在嵌入式 Pi attempt；HTTP 面是结构旁路（C10 家族），不是命名问题。                                                                             |
| existingMechanismsTried              | 收敛 preflight↔CTR↔orch **不会**自动给 `tools-invoke-http.ts` 增加 import；三模块共享路径不含该文件。B1/B2 web_read 影子亦未覆盖此入口。                                                                                                                   |
| whyExistingConvergenceIsInsufficient | 「仅收敛三模块」的 scope 按定义不包含 HTTP 工具入口；不扩展 A 类补丁则副作用入口仍无预检完成语义。                                                                                                                                                         |
| proposedContractBenefit              | （假设 D）统一「副作用入口必须声明 CompletionAuthority + EvidenceSink」契约，可强迫清单化。但**同等收益**可用 A：在 `tools-invoke-http.ts` 调用既有 `buildExecutionPreflight` / hold API，无需新包。                                                       |
| measurableOutcome                    | 基线：预检覆盖的工具执行入口 = **1**（attempt）。目标（若修）：HTTP 面纳入后 ≥2；或旁路表将该入口从「unknown 预检」改为「显式复用/显式豁免+break-glass」。审计「无预检 trace 的工具执行」占比可门禁。                                                      |
| securityProfileImpact                | Profile A：HTTP 面仍受 gateway auth + deny list，但完成宣称/校验回执不对齐。Profile B：租户/席位上下文若仅靠工具策略，缺预检交付证据会加大跨面审计重建成本。不合并 A/B。                                                                                   |
| owner                                | 材料：`grok-bot`；执行链复核槽：`conversation-task-runtime:kiro-conversation-task-runtime`；安全槽：`security-reviewer:profile-ab-tenant`                                                                                                                  |

### 复现命令与结果（2026-09-24 Asia/Shanghai）

```text
$ grep -cE 'execution-preflight|buildExecutionPreflight|completion-hold|ConversationTask|task-orchestration' \
    src/gateway/tools-invoke-http.ts
0

$ grep -rn 'buildExecutionPreflight(' src --include='*.ts' | grep -v '\.test\.'
src/agents/execution-preflight/resolve.ts:165:export function buildExecutionPreflight(...)
src/agents/pi-embedded-runner/run/attempt.ts:1111:    const executionPreflight = buildExecutionPreflight({
```

**合格性：** 可复现、具体缺口、证明「只收敛三模块」不足。  
**独特 D 收益：** **否**（A 可直接接线）。→ 计入「未解问题」，**不**计入 GO 独特收益。

---

## FC-02 — ConversationTask 关闭不咨询技能交付完成门

| 字段                                 | 内容                                                                                                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| failureId                            | `FC-02-ctr-close-ignores-delivery-hold`                                                                                                                                                                                                                 |
| symptom                              | `observeConversationTaskReplyCompleted` 在助手回复派发后可将匹配任务 `transitionTask(..., "closed")`，**不**读取 `judgeCompletionSend` / completion-hold / validation receipt。技能交付域仍可能阻断「完成宣称」，协作域任务却已 closed → 跨域终态漂移。 |
| affectedUserOrOperator               | 开启 CTR activation 的员工/管理员；依赖「任务 closed ≈ 交付完成」的运营看板。                                                                                                                                                                           |
| reproduction                         | 见下方命令：`reply-completion.ts` 对预检符号匹配数 = 0；调用点在 `dispatch-from-config.ts:680`，位于回复派发路径，无 hold 咨询。                                                                                                                        |
| currentMainEvidence                  | `src/conversation-task/reply-completion.ts`（关闭逻辑）；`src/agents/execution-preflight/completion-claim.ts`（`completion_claim_blocked_pending_validation`）；Phase A 权威文：跨域终态化协议 = **缺失**。                                             |
| rootCause                            | 两域各有局部权威（符合 C11「域内单一」），但**显式 finalization protocol 不存在**：CTR 关闭条件 = 激活旗 + 身份 + goal/对齐，不含交付证据。                                                                                                             |
| existingMechanismsTried              | 三模块「收敛」若只做词汇对齐 / 共享 reason code，仍不会在 `reply-completion.ts` 增加对 hold 的依赖。orch 休眠且 `wroteLedger:false`，不参与关闭。                                                                                                       |
| whyExistingConvergenceIsInsufficient | 缺口是**协议**，不是三模块内部命名。但协议可用 C：在 CTR 关闭前调用既有 `evaluateDeliveryEvidence` / hold 查询；或 A：在 dispatch 路径上先判 delivery 再调 observe。                                                                                    |
| proposedContractBenefit              | D 可提供跨域 finalization 消息类型。然而无生产观测分母时，无法证明新包优于在 CTR 增加一次既有 API 调用。                                                                                                                                                |
| measurableOutcome                    | 基线：CTR 关闭路径对 delivery-hold 咨询次数 = **0**（静态）。目标：关闭前咨询率 = 100%（activation on 且存在 skill contract 时）；「CTR closed ∧ completion_claim_blocked」联合事件 = 0。                                                               |
| securityProfileImpact                | 不合并 Profile。B 下错误 closed 可能触发下游企业流程误前进；A 下主要表现为本地任务看板误导。                                                                                                                                                            |
| owner                                | 材料：`grok-bot`；执行链复核：`conversation-task-runtime:kiro-conversation-task-runtime`                                                                                                                                                                |

### 复现命令与结果

```text
$ grep -cE 'execution-preflight|judgeCompletion|completion-hold|allowedToDeliver|issueValidation' \
    src/conversation-task/reply-completion.ts
0

$ grep -n 'observeConversationTaskReplyCompleted' src/auto-reply/reply/dispatch-from-config.ts
11:import { observeConversationTaskReplyCompleted } from ...
680:    observeConversationTaskReplyCompleted({
```

**合格性：** 可复现协议缺口。  
**独特 D 收益：** **弱/不足**（C/A 可补握手）。→ 不支撑 GO。

---

## FC-03 — 多副作用入口在三模块收敛 scope 外（旁路表未闭合）

| 字段                                 | 内容                                                                                                                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| failureId                            | `FC-03-side-effect-entrypoint-inventory-open`                                                                                                                                                                  |
| symptom                              | `node.invoke`、enterprise capability invoke、（及 Phase A 所列 ACP/AOR/inter-agent 等）与 `/tools/invoke` 一样，**静态上不调用** `buildExecutionPreflight`。只收敛三模块无法宣称 C10「无隐藏旁路」改善。       |
| affectedUserOrOperator               | 安全评审者（若只审 `attempt.ts`）；平台 Owner（错误宣告旁路表闭合）。                                                                                                                                          |
| reproduction                         | 对三个入口文件统计 preflight 引用均为 0；`ORCHESTRATION_LIVE_INVOKE=false` 且影子旗默认 unset。                                                                                                                |
| currentMainEvidence                  | Phase A 入口清单 §10；差距评估 C10=`fail`；本轮 grep 实证。                                                                                                                                                    |
| rootCause                            | 治理包络历史挂在 Pi attempt；其他执行面并行生长。                                                                                                                                                              |
| existingMechanismsTried              | B1/B2 只读 web_read 影子；明确不执行、不收紧 Gate、不改旁路。三模块收敛不扩展入口集合。                                                                                                                        |
| whyExistingConvergenceIsInsufficient | 问题集合 ⊃ {preflight, CTR, orch}。                                                                                                                                                                            |
| proposedContractBenefit              | D 的「入口登记契约」有文档价值，但有限 GO **不**授权 Gate 收紧/Path；闭合旁路仍要逐入口 A 类工程。D 不比「继续维护 Phase A 旁路表 + 逐入口接线」多出可度量生产收益。                                           |
| measurableOutcome                    | 基线：无预检引用的已点名副作用入口数 ≥ **3**（tools-invoke / capability-agent-invoke-runtime / nodes.ts）。目标（既有收敛路径）：旁路表每条为「复用预检 \| 显式豁免+break-glass \| 删除」三态之一，unknown=0。 |
| securityProfileImpact                | 安全评审必须按 Profile 分列 Fail Closed；禁止用 D 合并 A/B。                                                                                                                                                   |
| owner                                | 安全槽：`security-reviewer:profile-ab-tenant`；架构槽：`codex-architecture`                                                                                                                                    |

### 复现命令与结果

```text
$ grep -n 'ORCHESTRATION_LIVE_INVOKE' src/task-orchestration/types.ts
22:export const ORCHESTRATION_LIVE_INVOKE = false;

$ for f in src/gateway/tools-invoke-http.ts \
    src/gateway/enterprise-data/capability-agent-invoke-runtime.ts \
    src/gateway/server-methods/nodes.ts; do
    echo -n "$f: "; grep -cE 'buildExecutionPreflight|execution-preflight' "$f" || true
  done
src/gateway/tools-invoke-http.ts: 0
src/gateway/enterprise-data/capability-agent-invoke-runtime.ts: 0
src/gateway/server-methods/nodes.ts: 0

$ test -z "${OPENBOT_CONVERSATION_TASK_ORCH_SHADOW:-}" && echo ORCH_SHADOW unset
$ test -z "${OPENBOT_CONVERSATION_TASK_WEB_READ_SHADOW:-}" && echo WEB_READ_SHADOW unset
ORCH_SHADOW unset
WEB_READ_SHADOW unset
```

**合格性：** 可复现；说明三模块收敛 scope 不足。  
**独特 D 收益：** **否**（在允许的有限 GO 范围内 D 也不能强制闭合）。→ 不支撑 GO。

---

## 明确拒绝的「假失败」

| 拒绝项                              | 原因                                        |
| ----------------------------------- | ------------------------------------------- |
| B1/B2 web_read 分类准确率 / holdout | 合成+夹具评估；禁止当业务失败或生产效果     |
| 「没有统一 Path 类型名」            | 命名/优雅；且真实 Path 即使 GO 也不在授权内 |
| 「术语不统一」                      | 禁止作为 GO 依据                            |
| 臆测「未来某插件会绕过」            | 非当前 main 复现                            |
