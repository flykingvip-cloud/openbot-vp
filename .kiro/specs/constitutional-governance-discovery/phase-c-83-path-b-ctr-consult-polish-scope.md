# Phase C §8.3 ABC Knife3 — Path B CTR close-consult 抛光 / 回归锁（书面范围）

> 范围 id：`phase_c_83_path_b_ctr_consult_polish`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-83-path-b-ctr-consult-polish-scope.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 对照：Doc02 §8.3；`phase-c-83-operate-path-confirmation-scope.md`（#85）；`phase-c-83-path-c-bypass-table-lock-scope.md`（#86/#87）；`phase-c-83-path-a-observe-helper-lock-scope.md`（#88/#89）；`phase-c-83-allowed-entry-disposition.md`（#68）；`execution-entry-inventory.md`  
> 前置：`phase-c-83-path-b-ctr-consult-polish-acceptance.md` + `phase-c-83-path-b-ctr-consult-polish-start-order.md`  
> **本 PR = docs-only 书面范围 / 接受 / 开工令**。编码实现须引用本开工令另开实现 PR；**不**在本 PR 改 `src/`。  
> **基线 tip：** `5566bc3f77f8f033cb95324e95dbeb2ea650e6f4`（#89 merge；Path A Knife2 回归锁已落地）。

## 0. 为何开 Path B（在 Path C + Path A 之后）

| 现象 | 证据 |
| --- | --- |
| Path C 已闭合旁路表 | #86 接受+开工令；#87 落地 `allowed-entry-disposition.ts`；CTR 整行已标 `n/a-not-tri-state` |
| Path A 已闭合六处 reuse-observe | #88 接受+开工令；#89 落地 `reuse-observe-helper-lock.test.ts` |
| Path B 残余（#86 §1.2 / #88 §7） | 「CTR consult 抛光（显式 taskId / cancel / 持久化）」— FC-02 **已 code-present**；残余是对齐/回归锁，**非** defer-close / enforce |
| 漂移风险 | 旁路表 CTR 行与 FC-02 consult 形状可静默分叉（把整行改成 `reuse-observe` / 把 `closeDeferred` 改 true / 漏传 `taskId` 语义）；cancel / 持久化易滑向 defer-close |

本刀把 #86/#88 残差中的 **Path B** 收成 **ABC Knife3**：在旁路表 + Path A 已冻结前提下，把**已接线**的 FC-02 close-consult 与 CTR 整行 `n/a-not-tri-state` 对齐并加回归锁；**停止**用 defer-close / enforce / 新 soft-observe 冒充 §8.3 B 交付。

## 1. 主 tip FC-02 / CTR consult 盘点（IN 具体化）

### 1.1 已落地（code-present；本刀不重发明）

| 项 | 主 tip（`5566bc3f77`）事实 |
| --- | --- |
| 旗标 | `OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT`（`CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_ENV`）；**default-off**；truthy = `1`/`true`/`yes`/`on` |
| 关闭路径 | `observeConversationTaskReplyCompleted`（`src/conversation-task/reply-completion.ts`）在写本域 `closed` 前，旗标开时只读咨询 `consultDeliveryHoldForClose` |
| 咨询 API | `consultDeliveryHoldForClose({ sessionKey?, taskId?, text })`（`src/agents/execution-preflight/completion-hold.ts`）— 显式 `taskId` 只读该 hold；无 `taskId` 时按 session 枚举 retained holds（多 hold → `sessionHoldAmbiguous`） |
| 记录形状 | `ConversationTaskDeliveryCloseConsultRecord`：`mode: "observe"`；**`closeDeferred: false`（类型恒 false）**；不推迟 `closed`；咨询抛错吞掉后仍写本域 `closed` |
| CTR 调用现状 | reply 关闭路径传 `sessionKey: conversationId` + `text`；**未**传 `taskId`（尽管 API 已支持） |
| 旁路表行 | `ConversationTask whole-row` → disposition **`n/a-not-tri-state`**；note：`FC-02 is close-consult only; whole-row is not preflight tri-state.`（#87） |
| 既有测例 | `src/conversation-task/reply-completion.test.ts`（flag off 仍关；flag on 记 consult 且 `closeDeferred: false`）；`completion-send.test.ts`（显式 `taskId` / session 歧义 / 无 hold） |

### 1.2 工程可行动残余（本刀 IN 候选裁定）

| 候选 | 主 tip 是否已部分存在 | 本刀裁定 |
| --- | --- | --- |
| CTR 整行 `n/a-not-tri-state` ↔ FC-02 consult 形状回归锁 | 表行 + 测例分列存在；**无**跨模块「整行 ≠ 预检三态 / closeDeferred 恒 false / ENV 名稳定」联合锁 | **IN（优先）** |
| 显式 `taskId` 咨询路径文档 + 测试 | API + `completion-send.test.ts` 已覆盖；CTR reply 未传 `taskId` | **IN（次）**：锁 API 契约；实现 PR **可选**让 CTR 传 `task.id`（零 defer 语义变化） |
| cancel 路径 consult observe | **未**接线：cancel 生命周期无 `consultDeliveryHoldForClose` 调用 | **OUT / 残差**（非「已安全 default-off」；另文才可开，仍禁 defer） |
| 收据/咨询持久化（跨进程） | 仅进程内 ring（`DELIVERY_CLOSE_CONSULT_LIMIT=32`） | **OUT**（易滑向跨域写者 / defer 叙事） |

## 2. 目标（Goal）

在 Decision **NO-GO** / Independent **COMPLETE** / unique-benefit **FAIL** / Path C + Path A 已 **code-present** 前提下，授权一把 **Path B** 窄工程刀：

1. 把 CTR 整行 `n/a-not-tri-state` 与 FC-02 consult 形状收成可断言清单（ENV / observe→consult / `closeDeferred: false` / 非整行预检三态）。  
2. 用回归测试锁定：旗标 default-off；开时只记观察；**永不**推迟 `closed`；旁路表 CTR 行不得被改成 `reuse-observe` / `exemption+break-glass`；显式 `taskId` 咨询 API 契约稳定。  
3. **不** defer-close；**不** enforce；**不** live invoke；**不** Path/Gate；**不**新 soft-observe / 豁免接线；**不**宣称 C10 pass / GO。

## 3. 范围内（IN）

### 3.1 本 scope PR（docs-only）

| 项 | 说明 |
| --- | --- |
| 书面三件套 | 本 scope + acceptance + start-order |
| 最小 xref | `phase-c-83-operate-path-confirmation-scope.md` §10；`phase-c-83-product-confirmation.md` §1；`phase-c-83-path-a-observe-helper-lock-scope.md` §7 残差一行；`phase-c-83-path-c-bypass-table-lock-scope.md` §7 残差一行 |
| 盘点正文 | §1 FC-02 / CTR 行 / taskId API / cancel OUT |

### 3.2 实现 PR（引用开工令；建议落点；可微调并回写）

| 落点 | 路径（建议） | 约束 |
| --- | --- | --- |
| 回归锁（优先） | 新增或扩展 vitest：例如 `src/agents/execution-preflight/ctr-close-consult-lock.test.ts`（名可微调） | 断言：#87 表 `ConversationTask whole-row` 仍为 `n/a-not-tri-state`；ENV 名 `OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT` 稳定；`reply-completion.ts` 仍含 observe→consult 且记录类型 `closeDeferred: false`；flag default-off |
| 显式 taskId 契约锁 | 扩展 `completion-send.test.ts` 或上述 lock 测例 | 断言：传 `taskId` 只读该 hold；无 hold → empty；与 session-ambiguous 路径并存；**不**写 completion trace |
| 可选 CTR 传 taskId | `reply-completion.ts`：`consultDeliveryHoldForClose({ sessionKey, taskId: task.id, text })` | **仅当**零 defer / 零 enforce / 仍吞错 / 仍写 `closed`；禁止借此改 `closeDeferred` 类型或推迟 close |
| 既有 reply-completion 测例 | 可收紧 `closeDeferred: false` / ENV / 无 hold 仍关 的断言 | 不改为 defer；不改为 enforce |
| discovery 后记（可选） | inventory / disposition / path-a / path-c residual 各一行 xref | docs only |

### 3.3 行为约束（实现时）

- Claim ceiling：**`code-present`** only。  
- **不**新开 `OPENBOT_*` 旗标（FC-02 旗标已存在；不新增第二支 defer/enforce 旗标）。  
- **不**把 `closeDeferred` 改为可 true；**不**因 consult 结果跳过 / 延迟 `transitionTask(..., "closed")`。  
- **不**在 cancel / park / focus-switch 路径新挂 consult（属残差另文）。  
- **不**跨进程持久化 consult 记录或 validation receipt 作为本刀交付。  
- **不**改豁免行；**不**给豁免入口挂 observe；**不**把 CTR 整行改成预检三态。

## 4. 范围外 / 禁止（OUT）

- **defer-close**（任何推迟 / 条件化 `closed`；`closeDeferred: true`；hold 未清则不关）  
- **enforce** / Path / Gate / live invoke / Fabric-on  
- cancel 路径新 consult 接线（须另文；本刀 OUT）  
- 收据 / 咨询跨进程持久化；跨域写权威  
- 新 soft-observe（含豁免入口）；新 `OPENBOT_*` 旗标  
- Meta-Schema / `packages/constitutional-*` / 四产品工程里程碑  
- 宣称 C10 / C11 pass、unique-benefit PASS、Decision GO、C GO、整段 D GO  
- 改写 Phase C 五份冻结正文 / digests / 旧 `final-acceptance.md` 决策位  
- 本 scope PR 夹带 `src/` / `packages/` 编码（编码属实现 PR）  
- 重开 Path A / Path C 旁路表语义；把 CTR 行改成 `reuse-observe`

## 5. 主张天花板

- 本 scope PR：docs-only / **`code-present`**（文档事实）  
- 实现 PR（引用本开工令）：**`code-present`**（回归锁 ± 可选 CTR `taskId` 传参；行为与今日 default-off / 不推迟 close 一致）  
- 禁止抬升：`runtime-enabled` / `production-proven` / C10 pass

## 6. 成功标准

| 标准 | 判定 |
| --- | --- |
| 书面三件套 | scope + acceptance + start-order 入库；operate-path / product-confirmation / path-a residual / path-c residual 最小 xref |
| 清单锁定 | §1 与 #87 CTR 行 + FC-02 形状一致；实现 PR 测试锁住契约 |
| 无越界 | OUT 未触碰；无 defer-close；无 enforce；无 cancel 新接线；无新旗标；无 Meta-Schema 工程 |
| C10 | 明文 **C10 仍不能 pass** |
| NO-GO | Decision NO-GO / Independent COMPLETE / unique-benefit FAIL 站桩不变 |
| 合入 ≠ PASS/GO | 明文本合入与后续实现合入均 ≠ C10 pass / C GO / 整段 D GO |

## 7. 残差（须另文）

- cancel 路径 consult observe — **另文已立**：`phase-c-83-cancel-path-consult-observe-scope.md` + acceptance + start-order；**实现已合入** #96（merge `8b107a3d`；仍须 default-off、吞错、**不** defer `cancelled`/`closed`；本 Path B 刀仍 OUT / 不重开实现）  
- 咨询/收据跨进程持久化 — **另文已立**：`phase-c-83-cross-process-consult-persist-scope.md` + acceptance + start-order（窄 persist；禁跨域写 / defer-close / enforce；本 Path B 刀仍 OUT；实现须另 PR 引用该开工令）  
- C10 claim-gate residual（**非** pass）— **另文已立**：`phase-c-83-c10-claim-gate-residual-scope.md` + acceptance + start-order；**C10 仍不能 pass**；仍挡于 Doc01 / sparse_unknown / production-proven — **不**由本刀关闭  
- #80 合法推翻：仅当未来 ≥3 真 UNIQUE — 本刀不启动  
- 豁免入口破玻璃生产轨：未授权

## 8. 验收提示（独立验收 bot；本 PR 不呼叫）

**PASS（本 scope PR）：**

1. 三件套齐全；xref 最小；diff 仅 discovery。  
2. §1 盘点诚实：FC-02 已接线；仅抛光/回归锁；非整行预检三态；cancel / 持久化 / defer OUT。  
3. 未宣称 C10 pass / GO；未授权 Meta-Schema / defer-close / enforce / Path/Gate。  
4. 主张天花板 `code-present`；接受宽度见 acceptance。

**FAIL：** 夹带代码；defer-close；enforce；cancel 新接线当本刀交付；宣称 C10 pass；或续 D-scaffold 当 §8.3 交付。
