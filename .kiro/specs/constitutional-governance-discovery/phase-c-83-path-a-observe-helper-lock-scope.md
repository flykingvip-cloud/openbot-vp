# Phase C §8.3 ABC Knife2 — Path A 六处 reuse-observe 助手收敛 / 回归锁（书面范围）

> 范围 id：`phase_c_83_path_a_observe_helper_lock`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-83-path-a-observe-helper-lock-scope.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 对照：Doc02 §8.3；`phase-c-83-operate-path-confirmation-scope.md`（#85）；`phase-c-83-path-c-bypass-table-lock-scope.md`（#86 scope；#87 实现 — 旁路表 code-present）；`phase-c-83-allowed-entry-disposition.md`（#68）；`execution-entry-inventory.md`  
> 前置：`phase-c-83-path-a-observe-helper-lock-acceptance.md` + `phase-c-83-path-a-observe-helper-lock-start-order.md`  
> **本 PR = docs-only 书面范围 / 接受 / 开工令**。编码实现须引用本开工令另开实现 PR；**不**在本 PR 改 `src/`。  
> **基线 tip：** `3949ff92e6316c295c3d573076115edaf4a88337`（#87 merge；Path C Knife1 旁路表已落地）。

## 0. 为何开 Path A（在 Path C 之后）

| 现象 | 证据 |
| --- | --- |
| Path C 已闭合旁路表 | #86 接受+开工令；#87 落地 `allowed-entry-disposition.ts` + vitest；六处 reuse-observe 与六处 exemption+break-glass + CTR 整行 n/a 已 **code-present** 锁定 |
| Path A 残余（#86 §7 / §1.1） | 「六处 observe 助手收敛 / 回归锁」— 更大 blast radius；**非**新 soft-observe；**非**给豁免入口接线 |
| 漂移风险 | 六处 helper 多为入口文件内联复制（仅 FC-07 已抽 `cli-steer-preflight-observe.ts`）；后续 PR 可静默改语义（apply allow 集 / armCompletionHold / 新旗标 / 把豁免写成 reuse-observe）而旁路表单测不覆盖调用点 |

本刀把 #86 残差中的 **Path A** 收成 **ABC Knife2**：在旁路表已冻结前提下，把**已接线**的六处 observe 助手与表行对齐并加回归锁；**停止**用新 soft-observe / 豁免接线冒充 §8.3 A 交付。

## 1. 主 tip 六处 reuse-observe 盘点（IN 具体化）

共同契约（inventory / disposition 账本；#87 表行 note）：旗标 **default-off**；开时只调 `buildExecutionPreflight` 记 trace / decision；**丢弃**返回 allow 集；**不** `applyPreflightToTools`；**不** `armCompletionHold`；observe 失败 `logWarn`，不改写既有成功/错误语义。

| 入口（与 #87 表 `reuse-observe` 行对齐） | 旗标 | 调用点（主 tip） | 助手形态 |
| --- | --- | --- | --- |
| FC-01 `/tools/invoke` | `OPENBOT_HTTP_TOOLS_INVOKE_PREFLIGHT_OBSERVE` | `src/gateway/tools-invoke-http.ts` — `observeHttpToolsInvokePreflight`（policy/deny 后、`tool.execute` 前） | **内联**同文件：ENV + `is*Enabled` + `*ObserveTaskId` + private observe |
| FC-03a 企业 capability invoke | `OPENBOT_ENTERPRISE_CAPABILITY_INVOKE_PREFLIGHT_OBSERVE` | `src/gateway/enterprise-data/capability-agent-invoke-runtime.ts` — seat/grant/quota 后、`invokeEnterpriseDataAction` 前 | **内联**同文件 |
| FC-03b `node.invoke` | `OPENBOT_NODE_INVOKE_PREFLIGHT_OBSERVE` | `src/gateway/server-methods/nodes.ts` — 会话/allowlist/sanitize 后、`nodeRegistry.invoke` 前 | **内联**同文件 |
| FC-05 ACP 进程内 `tryDispatchAcpReply` | `OPENBOT_ACP_TURN_PREFLIGHT_OBSERVE` | `src/auto-reply/reply/dispatch-acp.ts` — 政策/allowlist 后、`runTurn` 前 | **内联**同文件 |
| FC-06 inter-agent bus | `OPENBOT_INTER_AGENT_BUS_PREFLIGHT_OBSERVE` | `src/organization/inter-agent-bus.ts` — `sendAgentTask` / `sendAgentMention` 内、`callGateway` 前 | **内联**同文件 |
| FC-07 ACP CLI + steer | `OPENBOT_ACP_CLI_STEER_PREFLIGHT_OBSERVE` | `src/commands/agent.ts`（CLI 回合）；`src/auto-reply/reply/commands-acp/lifecycle.ts`（steer） | **已抽出** `src/acp/cli-steer-preflight-observe.ts`（`observeAcpCliSteerPreflight`） |

对照模块：`src/agents/execution-preflight/allowed-entry-disposition.ts`（#87）— 上述六行 disposition 必须保持 `reuse-observe`；豁免行（stdio / AOR / Cron / Fabric / knowledge / task-orch）必须保持 `exemption+break-glass`，**禁止**本刀改写或接线。

热路径对照（**非**本刀对象）：`attempt.ts` 已 `buildExecutionPreflight` + `applyPreflightToTools` + `armCompletionHold`（非 observe-only）。

## 2. 目标（Goal）

在 Decision **NO-GO** / Independent **COMPLETE** / unique-benefit **FAIL** / Path C 旁路表已 **code-present** 前提下，授权一把 **Path A** 窄工程刀：

1. 把六处已接线 reuse-observe 助手的契约与调用点收成可断言清单（与 #87 表六行一致）。  
2. 用回归测试（及可选的小范围共享助手抽取）锁定：旗标 default-off；truthy 时只记 trace；丢弃 allow 集；不 apply / 不 armCompletionHold；吞错；taskId / ENV 命名稳定。  
3. **不**新 soft-observe；**不**给豁免入口接线；**不** Path/Gate/enforce/live invoke/Fabric-on；**不**宣称 C10 pass / GO。

## 3. 范围内（IN）

### 3.1 本 scope PR（docs-only）

| 项 | 说明 |
| --- | --- |
| 书面三件套 | 本 scope + acceptance + start-order |
| 最小 xref | `phase-c-83-operate-path-confirmation-scope.md` §10；`phase-c-83-product-confirmation.md` §1；`phase-c-83-path-c-bypass-table-lock-scope.md` §7 残差一行 |
| 盘点正文 | §1 六处助手 / 旗标 / 文件 / 内联 vs 已抽 helper |

### 3.2 实现 PR（引用开工令；建议落点；可微调并回写）

| 落点 | 路径（建议） | 约束 |
| --- | --- | --- |
| 回归锁（优先） | 新增或扩展 vitest：例如 `src/agents/execution-preflight/reuse-observe-helper-lock.test.ts`（名可微调） | 断言：#87 表六行仍为 `reuse-observe`；六 ENV 名稳定；各入口源文件仍含 observe 调用契约关键字（`buildExecutionPreflight` + 对应 ENV + 无 `applyPreflightToTools` 于 observe 函数体）；可选：flag off 时 zero call / flag on 时 swallow error |
| 可选共享助手 | 仅当五处内联已明显复制且抽取 **不**改变运行时语义时：例如抽 `src/agents/execution-preflight/observe-only-preflight.ts`（名可微调），把 ENV gate + try/catch + discard allow 的公共壳抽出；FC-07 可迁入或保持专用模块并委托公共壳 | **禁止**借抽取改调用时机、新旗标、或扩到豁免入口 |
| 既有单测 | 可收紧既有 per-entry 测例（tools-invoke / capability / nodes / dispatch-acp / inter-agent-bus / cli-steer-preflight-observe）中与契约重复的断言，避免漂移 | 不删覆盖；不改为 enforce |
| discovery 后记（可选） | inventory / disposition / path-c scope 各一行 xref | docs only |

### 3.3 行为约束（实现时）

- Claim ceiling：**`code-present`** only。  
- **不**新开 `OPENBOT_*_PREFLIGHT_OBSERVE`（六旗标已存在；不新增第七）。  
- **不**在新点调用 `applyPreflightToTools` / `armCompletionHold`。  
- **不**改豁免行处置；**不**给 stdio / AOR / Cron / Fabric / knowledge / task-orch 挂 observe。  
- **不**把热路径 `attempt.ts` 收成 observe-only 或反之。  
- 共享抽取若做：必须保持 default-off 与吞错；导出不得被豁免入口或 enforce 路径误用为「打开观察」。

## 4. 范围外 / 禁止（OUT）

- **新 soft-observe**（含 knowledge.capability.invoke / ACP stdio / AOR / Cron·subagent / Fabric / task-orchestration）  
- 触碰豁免行（改表、接线、破玻璃开关）  
- Path / Gate / enforce / live invoke / Fabric-on / 新 observe 旗标  
- Meta-Schema / `packages/constitutional-*` / 四产品工程里程碑  
- 宣称 C10 / C11 pass、unique-benefit PASS、Decision GO、C GO、整段 D GO  
- Path B（CTR consult 抛光 / defer-close / enforce）— **本刀之后另开**；本 PR **不**开工 Path B  
- 改写 Phase C 五份冻结正文 / digests / 旧 `final-acceptance.md` 决策位  
- 本 scope PR 夹带 `src/` / `packages/` 编码（编码属实现 PR）

## 5. 主张天花板

- 本 scope PR：docs-only / **`code-present`**（文档事实）  
- 实现 PR（引用本开工令）：**`code-present`**（回归锁 ± 可选共享壳存在；行为与今日 default-off 一致）  
- 禁止抬升：`runtime-enabled` / `production-proven` / C10 pass

## 6. 成功标准

| 标准 | 判定 |
| --- | --- |
| 书面三件套 | scope + acceptance + start-order 入库；operate-path / product-confirmation / path-c residual 最小 xref |
| 清单锁定 | §1 六处与 #87 `reuse-observe` 六行一致；实现 PR 测试锁住契约 |
| 无越界 | OUT 未触碰；无新旗标；无新 soft-observe；无豁免接线；无 Path B；无 Meta-Schema 工程 |
| C10 | 明文 **C10 仍不能 pass** |
| NO-GO | Decision NO-GO / Independent COMPLETE / unique-benefit FAIL 站桩不变 |
| 合入 ≠ PASS/GO | 明文本合入与后续实现合入均 ≠ C10 pass / C GO / 整段 D GO |

## 7. 残差（须另文）

- Path B：CTR consult 抛光（显式 taskId / cancel / 持久化）— **后续（2026-09-26）已另立** ABC Knife3 书面范围：`phase-c-83-path-b-ctr-consult-polish-scope.md` + acceptance + start-order（本 Path A 残差 xref；编码另 PR；**禁** defer-close/enforce；cancel/持久化 OUT）  
- C10 pass：仍挡于 Doc01 / sparse_unknown / production-proven — **不**由本刀关闭  
- #80 合法推翻：仅当未来 ≥3 真 UNIQUE — 本刀不启动  
- 豁免入口破玻璃生产轨：未授权

## 8. 验收提示（独立验收 bot；本 PR 不呼叫）

**PASS（本 scope PR）：**

1. 三件套齐全；xref 最小；diff 仅 discovery。  
2. §1 盘点诚实：六处已接线；仅收敛/回归锁；非新 soft-observe；豁免入口 OUT。  
3. 未宣称 C10 pass / GO；未授权 Meta-Schema / Path B / Path/Gate/enforce。  
4. 主张天花板 `code-present`；接受宽度见 acceptance。

**FAIL：** 夹带代码；新 soft-observe；改豁免为 reuse-observe；开工 Path B；宣称 C10 pass；或续 D-scaffold 当 §8.3 交付。
