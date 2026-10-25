# WP-03 上下文唯一预算责任审计

- 状态：**AUDITING**（本轮仅代码链路审计与责任提案；**不宣称 G2-C / ACCEPTED**）
- 日期：2026-10-24（Asia/Shanghai）
- HEAD（撰写时）：`2df36a55748f891d6eb05ad067318bc8783fd794`
- 作者：grokbot-verifiable-delivery
- 拍板约束：design/audit first；禁止静默删政策；不改运行默认开关。

## 1. 最终模型调用组装顺序（代码实证）

在嵌入式 runner 一次 attempt 内，与「最终 prompt / messages」相关的预算面按时间顺序大致为：

| 序 | 组件 | 符号 / 位置 | 作用 | 是否裁剪最终 messages |
| --- | --- | --- | --- | --- |
| A | 会话历史截断/配对修复 | `attempt.ts`：`limitHistoryTurns` → `sanitizeToolUseResultPairing`（约 L2060–2080 一带） | 历史窗口与 tool_use/result 配对修复 | 是（transcript 级） |
| B | Legacy context engine assemble | `LegacyContextEngine.assemble`（`src/context-engine/legacy.ts` L79–104）→ 条件调用 `assembleMessagesWithBudget`（`src/conversations/context-assemble.ts` L135+） | 当 `OPENBOT_CONVERSATION_CONTEXT_PLANNER` / `contextPlannerEnabled` 为真且传入 `tokenBudget` 时，按 `planContextBudget` 分配 history/summary；超预算 **overflow，不静默丢 current input**（`context-budget.ts` L102–152） | 条件是 |
| C | Context-compiler transform | `installContextCompilerTransform`（`src/agents/context-compiler/install.ts` L33+）挂到 `agent.transformContext`；attempt 在 compiler 开启时安装（`attempt.ts` ~L1731） | `compileModelContext`（`compile.ts` L181+）按 lane budget 消化/剥离/丢弃 recent units，并注入 operating capsule | 是（Pi 循环 transformContext 时） |
| D | Model-boundary fail-closed | `wrapContextCompilerModelBoundary`（`install.ts` L94+；`attempt.ts` ~L2028） | 若 provider 请求仍带入预编译长 transcript，切片回编译后规模 | 是（streamFn 边界） |
| E | Outbound estimate guard | `wrapOutboundMessageEstimateGuard`（`install.ts` L137+；attempt 标 outermost） | 规范化 assistant 字符串等内容，避免 pi-ai 估 token 崩溃 | 规范化，非主预算策略 |
| F | Tool-result context guard | `installToolResultContextGuard`（`tool-result-context-guard.ts`；`attempt.ts` ~L1767） | 就地压缩/截断过大 tool result，使上下文回到预算 | 是（tool result 文本） |
| G | Active context system prompt（并行面） | `buildActiveContextSystemPrompt`（`context-budget-assembler.ts` L80+）经 `resolveContextBudget`（`resolve-context-budget.ts` L66+） | 按 segment priority 组装 **system prompt 侧** active context；与 message-list 预算分离 | 否（system 段） |
| H | Gateway context-scope evidence | `resolveContextBudget` / `applyContextBudgetToEvidence`（`src/gateway/context-scope/budget.ts`） | 检索证据文件/token 硬帽 | 否（证据检索） |
| I | Collab runtime assembly | `assembleCollaborationRuntimeContextParts`（`runtime-context-assembly.ts`；`get-reply-run.ts` ~L1110） | 协作任务 mission/context 注入 | 间接（system/parts） |

**标志默认值（代码）：**

- Context-compiler：**默认 ON**（`isContextCompilerEnabled`，`OPENBOT_CONTEXT_COMPILER` 缺省 true — `flag.ts`）。
- Conversation context planner：config/env 解析默认 **true**（`src/conversations/flags.ts` `contextPlannerEnabled`）；`LegacyContextEngine.assemble` 仍要求 env flag + `tokenBudget` 才真正裁剪。
- 因此存在 **双阶段同时可启用** 的路径：planner assemble 后再经 compiler transformContext。

## 2. 提议：最终 prompt 的单一预算责任人

### 裁决（提案，非落地）

**最终 messages 列表的权威预算所有者 = context-compiler：`compileModelContext` + `wrapContextCompilerModelBoundary`。**

理由（代码）：

1. 它挂在 `transformContext` 与 streamFn 边界，是进入 provider 前最后一次结构化裁剪（`install.ts`）。
2. 已有「当前轮被丢弃则拒绝发出截断上下文」的 fail-closed（`install.ts`：`currentTurnPreserved` 检查）。
3. Legacy planner（`planContextBudget` / `assembleMessagesWithBudget`）更适合作为 **准入/历史窗口预裁**，并已显式 overflow（不静默丢 current input）。

### CONDITIONAL 双阶段显式交接（推荐过渡形态）

| 阶段 | 所有者 | 允许做 | 禁止做 | 交接产物 |
| --- | --- | --- | --- | --- |
| Phase-A 准入 | `LegacyContextEngine.assemble` → `assembleMessagesWithBudget` / `planContextBudget` | 丢最旧 history；保留 summary（预算内）；报告 overflow | 不得丢 mandatory policy / 当前 user turn；不得拆散 tool_use/result 对（依赖上游 repair） | `AssembleWithBudgetResult` + `ContextBudgetTrace` |
| Phase-B 终裁 | `compileModelContext`（+ model-boundary wrap） | 按 lane 消化 digests、剥离、丢 recent units；注入 capsule（task/memory/evidence） | 不得静默丢「当前轮用户请求」；丢弃须进 `contextDropReasons` 遥测 | `CompileContextResult.messages` + telemetry |
| 旁路保护 | `installToolResultContextGuard` | 仅压缩 tool result 文本 | 不得删除配对的 tool_use；不得冒充 Phase-B | 就地 mutation + truncation notice |

**单一责任语句（拟写入后续 ADR）：** 任何「最终发往模型的 messages 是否超窗」的争议，以 Phase-B telemetry（`pre/postCompileEstimatedTokens`、`contextDropReasons`、`providerBoundaryMatch`）为准；Phase-A 只解释历史准入，不解释最终 prompt。

System-prompt 侧 `resolveContextBudget`（agents defaults）与 gateway evidence budget **不是**最终 message-list 所有者；后续若合并观测，只能挂从属指标，不能再做二次「静默」裁剪政策段。

## 3. 永不可静默丢弃清单

| 类别 | 依据 | 行为要求 |
| --- | --- | --- |
| 安全 / 系统政策 | `planContextBudget` 将 `mandatory_policy` 计入强制切片；超窗 → overflow（`context-budget.ts` L245–248） | overflow / 阻断 / 重规划；禁止当普通 history 丢掉 |
| 当前任务与验收 | compiler capsule 的 `task` 候选（`compile.ts` `buildOperatingContextCapsule` / `resolveCandidates`）；WP-01 结果信封对齐后须可追溯 | 预算不够则显式失败或重规划，不得只留闲聊 history |
| 最近用户纠正 | compiler `noteUserRequest` + `currentTurnPreserved`；assemble「Never drop the latest user turn」（`context-assemble.ts` 文件头） | 丢弃当前用户请求必须 error/refuse emit |
| 工具 call/result 原子对 | `attempt.ts` 在 limit 后 `sanitizeToolUseResultPairing`；transcriptPolicy | 禁止只留 result 或只留 use；压缩 tool result 时保留配对骨架 |

## 4. 精确接管路径表（仅提议；本轮 docs-only 通常无需 runtime takeover）

| 路径 | 当前触达 | 本轮是否改代码 | 若后续实施谁 land | 备注 |
| --- | --- | --- | --- | --- |
| `.kiro/specs/delivery-reliability-evidence-program/wp03/**` | 本审计 | 写文档 | grokbot-verifiable-delivery | 无需 loom runtime 路径 |
| `src/agents/context-compiler/**` | 终裁实现 | **不改** | 待协调（常有宽泛 `src/**` 宣称） | G2-C 实施前 verify-then-take |
| `src/conversations/context-budget.ts` / `context-assemble.ts` | Phase-A | **不改** | 同上 | |
| `src/context-engine/legacy.ts` | assemble 开关 | **不改** | 同上 | |
| `src/agents/pi-embedded-runner/run/attempt.ts` | 安装顺序 | **不改** | 多任务热点；禁止整片接管 | 仅在交接 ADR 批准后最小接线 |
| `src/auto-reply/reply/context-budget-assembler.ts` | system 段 | **不改** | | 非最终 message owner |
| `src/gateway/context-scope/**` | 证据帽 | **不改** | | 非最终 message owner |

## 5. 固定回放集大纲（仅命名；无假指标）

后续 G2-C 取证用，本轮不跑、不填数值：

1. `replay.long-session.multi-hour-chat` — 超长多轮会话，验证 Phase-A/B 交接与 drop 遥测。
2. `replay.cjk.zh-user-correction` — 中文用户连续纠正 + 验收句，验证当前轮与纠正不被静默丢。
3. `replay.tool-result.large-json` — 单次超大 tool result，验证 guard 与 call/result 配对。
4. `replay.mixed.policy-plus-task-capsule` — mandatory policy + 当前任务 capsule 同时紧张，验证 overflow/阻断而非静默删政策。
5. `replay.collab.group-recent-turns` — 协作 lane + `shouldApplyCollabCompileStrategy`，验证成员结论保留策略与预算交互。

## 6. 未知与风险

- **UNKNOWN**：生产环境 `OPENBOT_CONTEXT_COMPILER` / `OPENBOT_CONVERSATION_CONTEXT_PLANNER` 实际取值分布（代码默认 ON，生产 UNKNOWN）。
- **UNKNOWN**：字符/估 token（`estimateMessagesTokens` / `estimateTokensFromText`）相对真实 tokenizer 的偏差；规范禁止宣称精确计量。
- **风险**：双阶段同时 ON 时，若无显式交接文档，易出现「history 已被 planner 砍过、compiler 再砍」的双重裁剪；本提案用 Phase-A/B 界定，但**未改代码**。
- **风险**：`tool-result-context-guard` 就地 mutation 与 compiler 顺序依赖 attempt 安装点；若未来重排 hooks，需重审配对不变量。

## 7. 状态声明

- 本文件状态：**AUDITING**。
- **不宣称 G2-C**；无试点成本/质量对比数据；无 ACCEPTED。
- 下一步（非本轮）：人审预算责任提案 → 若批准，再对最小文件做 loom verify-then-take → 固定回放集落地与遥测对齐。
