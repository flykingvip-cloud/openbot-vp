# Phase C §8.3 ABC Knife1 — Path C 旁路表 code-present 锁定（书面范围）

> 范围 id：`phase_c_83_path_c_bypass_table_lock`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-83-path-c-bypass-table-lock-scope.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 对照：Doc02 §8.3；`phase-c-83-operate-path-confirmation-scope.md`（#85；停 Meta-Schema；A/B/C 残差）；`phase-c-83-allowed-entry-disposition.md`（#68）；`phase-c-83-nonknife-product-adjudication.md`（#69）；`phase-c-83-registration-iteration-evidence.md`（#70）；`phase-c-83-c10-claim-gate-progress.md`；`execution-entry-inventory.md`  
> 前置：`phase-c-83-path-c-bypass-table-lock-acceptance.md` + `phase-c-83-path-c-bypass-table-lock-start-order.md`  
> **本 PR = docs-only 书面范围 / 接受 / 开工令**。编码实现须引用本开工令另开实现 PR；**不**在本 PR 改 `src/`。

## 0. 漂移诊断（为何开 ABC 工程刀）

| 现象 | 证据 |
| --- | --- |
| docs-heavy | #67–#70 / #80–#85 连续 discovery 文档刀；旁路处置与登记迭代已成文，但 §8.3 **A/B/C 交付**缺工程落点 |
| D-scaffold 漂移 | `packages/constitutional-contracts` / Registry / Conformance / Runtime façade / P8b Knife1 等有界 D 脚手架（#58–#66 / #74）相对 Doc02 §8.3「停 Meta-Schema 工程化、继续预检/CTR/旁路」的运营路径是**旁路叙事** |
| #85 锁定 | Owner 接受 §8.3；停 Meta-Schema / constitutional-contracts / 四产品工程化；残差显式要求 A/B/C **另文**接受 + 开工令 |

本刀把残差中的 **C = per-entry bypass table closure** 收成**第一把**可编码窄刀，并停止用新的 Meta-Schema / D 脚手架冒充 §8.3 交付。

## 1. A/B/C 缺口盘点（工程可行动；无 Meta-Schema）

### 1.1 Path A — wire existing preflight

| 项 | 主 tip（`f6c6a923`）事实 |
| --- | --- |
| 已接线（explicit reuse-observe；默认关） | FC-01 `/tools/invoke`；FC-03a 企业 capability invoke；FC-03b `node.invoke`；FC-05 ACP 进程内；FC-06 inter-agent bus；FC-07 ACP CLI + steer |
| 热路径 | `attempt.ts` 已 `buildExecutionPreflight` + `applyPreflightToTools` + `armCompletionHold`（非 observe-only） |
| 余下曾候选接线 | `knowledge.capability.invoke` / ACP stdio / AOR / Cron·subagent / Fabric / task-orchestration → **均已 Owner 裁决 exemption+break-glass**（#68/#69）；**禁止**再挂 soft-observe |
| 工程可行动残余 | 至多：六处 observe 助手收敛 / 回归锁（较大 blast radius；**非**本刀） |
| 本刀结论 | **不选 A 为第一刀**：无「清晰、未豁免、可接线」入口清单；再接线 = 违反 #69 / 站桩「无新 soft-observe」 |

### 1.2 Path B — CTR close consults delivery

| 项 | 主 tip 事实 |
| --- | --- |
| 已落地 | FC-02：`OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT`；`observeConversationTaskReplyCompleted` → `consultDeliveryHoldForClose`；测例在 `reply-completion.test.ts` |
| 形状 | observe-handshake；`closeDeferred` 恒 false；不推迟 `closed`；非整行预检三态 |
| 工程可行动残余 | 可选：显式 `taskId` 咨询、cancel 路径咨询、收据持久化（均须另刀；易滑向 defer/enforce） |
| 本刀结论 | **B 已有 code-present 交付**；残余清晰度低于 C；不作第一刀 |

### 1.3 Path C — per-entry bypass table closure

| 项 | 主 tip 事实 |
| --- | --- |
| 文档已闭合 | #68 处置账本 + #69 非刀裁决 + #70 登记迭代证据；允许登记入口三态语言已复核 |
| C10 | **仍不能 pass**（Doc01 / sparse_unknown / production-proven / CTR 整行不适用） |
| 工程缺口 | 处置表仍是 **docs-only**：无 code-present 冻结表 + 测试锁 → 后续 PR 可静默改叙事或重开 soft-observe 而无人门禁 |
| 主可复现入口清单 | 见 §3.1（与 #70 §3 对齐） |
| blast radius | 新模块 + 单测；**不**改热路径；**不**新旗标；**不**接线 |
| 本刀结论 | **选 C 为第一刀**：清单最清晰、blast radius 最小；把 C 从 docs-heavy 推进到 **code-present 锁定** |

### 1.4 为何选 C 而非 A（歧义裁定）

按站桩「歧义时选主 tip 可复现入口清单最清晰、blast radius 最小」：

1. A 无未豁免可接线入口；强行接线 = 新 soft-observe（禁止）。  
2. C 入口清单 = #70 已复核允许登记集；工程落点 = 冻结表 + 测试；零运行时行为变化。  
3. 修复漂移：§8.3 C 交付从「只写 markdown」变为「代码可断言的旁路表」；明确 **不**续 D-scaffold / Meta-Schema。

## 2. 目标（Goal）

在 Decision **NO-GO** / Independent **COMPLETE** / unique-benefit **FAIL** 前提下，授权一把 **Path C** 窄工程刀：

1. 把允许登记入口的预检三态处置收成 **code-present** 冻结表（与 #68/#69/#70 一致）。  
2. 用测试锁定：表覆盖清单；处置仅 ∈ `reuse-observe` | `exemption+break-glass` | `delete` | `n/a-not-tri-state`；**禁止**把豁免项写成 reuse-observe。  
3. **不**宣称 C10 pass；**不**新 soft-observe；**不** Path/Gate/enforce/live invoke/Fabric-on；**不**触碰 `packages/constitutional-*` 工程里程碑。

## 3. 范围内（IN）

### 3.1 冻结入口清单（main-reproducible；与 #70 §3 对齐）

| 入口 | 处置 | 备注 |
| --- | --- | --- |
| FC-01 `/tools/invoke` | `reuse-observe` | 旗标默认关；已接线 |
| FC-03a 企业 capability invoke | `reuse-observe` | 同上 |
| FC-03b `node.invoke` | `reuse-observe` | 同上 |
| FC-05 ACP 进程内 `tryDispatchAcpReply` | `reuse-observe` | 同上 |
| FC-06 inter-agent bus | `reuse-observe` | 同上 |
| FC-07 ACP CLI + steer | `reuse-observe` | 同上 |
| task-orchestration | `exemption+break-glass` | live-invoke 未授权 |
| Fabric | `exemption+break-glass` | 默认关；不得为观察打开 |
| `knowledge.capability.invoke` | `exemption+break-glass` | 无 live connector |
| ACP stdio 桥 | `exemption+break-glass` | #69；非 soft-observe |
| AOR（`packages/aor-core`） | `exemption+break-glass` | #69；禁 core 预检 import |
| Cron / subagent | `exemption+break-glass` | #69；回到热路径 ≠ reuse-observe |
| ConversationTask **整行** | `n/a-not-tri-state` | FC-02 仅为关闭前 consult；整行不收成三态 |

### 3.2 实现落点（另开实现 PR；本 scope PR 不改代码）

| 落点 | 路径（建议；实现 PR 可微调并回写开工令） |
| --- | --- |
| 冻结表 | `src/agents/execution-preflight/allowed-entry-disposition.ts` |
| 单测 | `src/agents/execution-preflight/allowed-entry-disposition.test.ts` |
| 导出（可选） | `src/agents/execution-preflight/index.ts`（若已有 barrel；不得被热路径强制 import） |
| discovery xref | 本范围三件套；`phase-c-83-operate-path-confirmation-scope.md` §10；`phase-c-83-product-confirmation.md` §1 一短注；可选 inventory / disposition 后记一行 |

### 3.3 行为约束（实现时）

- 表为 **只读数据 + 断言**；默认 **不**被 gateway chat / tool invoke / ACP 热路径 import。  
- **不**新开 `OPENBOT_*_PREFLIGHT_OBSERVE`；**不**调用 `applyPreflightToTools` / `armCompletionHold` 于新点。  
- 豁免语义对齐 FC-09：**豁免的是预检三态登记，不是忽略旁路或生产启用**。  
- 破玻璃项保持「未授权」注释；不实现破玻璃开关。

## 4. 范围外 / 禁止（OUT）

- Meta-Schema / constitutional-contracts / 四产品 / Registry / Conformance / Runtime façade **工程**续作或新里程碑  
- 新 soft-observe（含 stdio / AOR / Cron·subagent / knowledge.capability.invoke）  
- Path / Gate / enforce / live invoke / Fabric-on / 新 soft-observe 旗标  
- 宣称 C10 / C11 pass、unique-benefit PASS、Decision GO、整段 D GO、C GO  
- 改写 Phase C 五份冻结正文 / digests / 旧 `final-acceptance.md` 决策位  
- 重开 #58–#85 / P8b Knife1 / C11 charter 为实现清单  
- 把 ConversationTask 整行收成 reuse-observe；把「回到热路径」写成 reuse-observe  
- 本 scope PR 夹带 `src/` / `packages/` 编码（编码属实现 PR）

## 5. 主张天花板

- 本 scope PR：docs-only / **`code-present`**（文档事实）  
- 实现 PR（引用本开工令）：**`code-present`**（冻结表 + 测试存在）  
- 禁止抬升：`runtime-enabled` / `production-proven` / C10 pass

## 6. 成功标准

| 标准 | 判定 |
| --- | --- |
| 书面三件套 | scope + acceptance + start-order 入库；operate-path / product-confirmation 最小 xref |
| 清单锁定 | §3.1 入口与处置写入范围；实现 PR 表与之一致 |
| 无越界 | OUT 未触碰；无新旗标；无 soft-observe；无 Meta-Schema 工程 |
| C10 | 明文 **C10 仍不能 pass** |
| NO-GO | Decision NO-GO / Independent COMPLETE / unique-benefit FAIL 站桩不变 |
| 合入 ≠ PASS/GO | 明文本合入与后续实现合入均 ≠ C10 pass / C GO / 整段 D GO |

## 7. 残差（须另文）

- Path A：六处 observe 助手收敛 / 回归锁（更大 blast radius）— **后续（2026-09-26）已另立** ABC Knife2 书面范围：`phase-c-83-path-a-observe-helper-lock-scope.md` + acceptance + start-order（本 Path C 残差 xref；编码另 PR；**非**新 soft-observe）  
- Path B：CTR consult 抛光（显式 taskId / cancel / 持久化）— **后续（2026-09-26）已另立** ABC Knife3 书面范围：`phase-c-83-path-b-ctr-consult-polish-scope.md` + acceptance + start-order（本 Path C 残差 xref；编码另 PR；**禁** defer-close/enforce；cancel/持久化 OUT）  
- C10 pass：仍挡于 Doc01 / sparse_unknown / production-proven / 主张门正式勾选 — **不**由本刀关闭  
- #80 合法推翻：仅当未来 ≥3 真 UNIQUE — 本刀不启动

## 8. 验收提示（独立验收 bot；本 PR 不呼叫）

**PASS（本 scope PR）：**

1. 三件套齐全；xref 最小；diff 仅 discovery。  
2. §1 盘点诚实：A 无安全接线余口；B 已有 FC-02；选 C 理由写明。  
3. 未宣称 C10 pass / GO；未授权 Meta-Schema / 新 soft-observe / Path/Gate/enforce。  
4. 主张天花板 `code-present`；接受宽度见 acceptance。

**FAIL：** 夹带代码；把豁免改写成 reuse-observe；重开 soft-observe；宣称 C10 pass；或续 D-scaffold 当 §8.3 交付。