# Phase C §8.3 残差刀 — cross-process consult/receipt persist（书面范围）

> 范围 id：`phase_c_83_cross_process_consult_persist`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-83-cross-process-consult-persist-scope.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 对照：Doc02 §8.3；`phase-c-83-path-b-ctr-consult-polish-scope.md`（#91/#92；`e371bc03`）；`phase-c-83-cancel-path-consult-observe-scope.md`（#95 docs + #96 impl；merge `8b107a3d`）；`phase-c-83-path-a-observe-helper-lock-scope.md`（#88/#89）；`phase-c-83-path-c-bypass-table-lock-scope.md`（#86/#87）；`phase-c-83-operate-path-confirmation-scope.md`（#85）；`execution-entry-inventory.md`  
> 前置：`phase-c-83-cross-process-consult-persist-acceptance.md` + `phase-c-83-cross-process-consult-persist-start-order.md`  
> **本 PR = docs-only 书面范围 / 接受 / 开工令**。编码实现须引用本开工令另开实现 PR；**不**在本 PR 改 `src/`。  
> **基线 tip：** `8b107a3d01dccdb78ba4404e6f80c4b25cf1514c`（#96 merge；cancel-path consult observe impl）。ABC 三刀 + cancel docs/impl 已合入。**合入 ≠ PASS/GO。**

## 0. 为何开本残差刀（在 Path B / cancel-path 之后）

| 现象 | 证据 |
| --- | --- |
| Path B CTR consult 抛光已锁定 | #91 接受+开工令；#92 落地 `ctr-close-consult-lock`；merge `e371bc03…` |
| Path B scope §7 / start-order §8 | 明文列出 **咨询/收据跨进程持久化** 为 **须另文 / 未授权**；易滑向跨域写者 |
| cancel-path consult observe | #95 docs + #96 impl（`8b107a3d`）；cancel scope §7 / start-order §8 同列跨进程持久化为残差 OUT |
| 今日形状 | delivery-close consult 记录仅 **进程内 ring**（`DELIVERY_CLOSE_CONSULT_LIMIT=32`）；进程重启即失 |
| 站桩 | C10 **仍不能 pass**；unique-benefit **FAIL**；Decision **NO-GO** / Independent **COMPLETE**；主张天花板 **`code-present`** |

本刀把 Path B / cancel-path 明示残差中的 **cross-process consult/receipt persist** 收成独立书面三件套：授权**日后**窄实现，使 delivery-close consult 记录 / validation receipts 可跨进程重启保留；**停止**用跨域写权威 / defer-close / enforce / live invoke / C10 pass / Meta-Schema 冒充本残差交付。**合入 Path B / cancel ≠ PASS/GO；合入本 docs PR 亦 ≠ PASS/GO。**

## 1. 主 tip 盘点（IN 具体化；诚实）

### 1.1 已落地（code-present；本刀不重发明 FC-02 / cancel wiring）

| 项 | 主 tip 事实 |
| --- | --- |
| FC-02 close-consult | **已存在**于 reply-completed 路径：`observeConversationTaskReplyCompleted` → `consultDeliveryHoldForClose` |
| cancel-path soft-observe | #96 已接线（default-off；吞错；不 defer cancel/closed） |
| 旗标 | `OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT`；**default-off** |
| 记录形状 | `ConversationTaskDeliveryCloseConsultRecord`：`mode: "observe"`；**`closeDeferred: false`（类型恒 false）** |
| 持久化今日 | **仅进程内 ring**；`DELIVERY_CLOSE_CONSULT_LIMIT=32`；**不**跨进程 / 不落盘 / 不跨账本 |

### 1.2 工程可行动残余（本刀 IN 候选裁定）

| 候选 | 主 tip 是否已部分存在 | 本刀裁定 |
| --- | --- | --- |
| delivery-close consult 记录跨进程重启保留 | 仅 in-process ring | **IN（本刀目标；实现另 PR）** |
| validation receipt 同窄持久化 | 随 consult 记录形状；不得扩成跨域写 | **IN（窄；同刀；须同 OUT 约束）** |
| 跨域写权威 / 跨账本单点写入 | 无 | **OUT** |
| defer-close / enforce / live invoke | 类型与叙事均禁 | **OUT** |
| C10 claim gate / pass | 仍挡；另文见 C10 claim-gate residual | **OUT（本刀）** |
| Meta-Schema / Phase D / Path-Gate | 未授权 | **OUT** |

## 2. 目标（Goal）

在 Decision **NO-GO** / Independent **COMPLETE** / unique-benefit **FAIL** / Path B + cancel-path 已 **code-present** 前提下，授权一把 **cross-process consult/receipt persist** 窄工程刀（书面先、实现后）：

1. 使 delivery-close consult 记录（及同形状 validation receipts）在进程重启后仍可读取——**窄**于本域 consult/receipt，**不**扩张为跨域写权威。  
2. **必须不**改变 `closeDeferred` 语义（仍恒 false）；**仍禁** defer-close；不推迟 `closed` / `cancelled`。  
3. 若引入任何 ENV：**default-off**；**不**发明 enforce 旗标；**不** live invoke；**不** Path/Gate。  
4. **不**宣称 C10 pass / GO；主张天花板：**`code-present`** only。

## 3. 范围内（IN）

### 3.1 本 scope PR（docs-only）

| 项 | 说明 |
| --- | --- |
| 书面三件套 | 本 scope + acceptance + start-order |
| 最小 xref | Path B scope §7 / start-order §8；cancel-path scope §7 / start-order §8 残差行指向本文为另文；可选 operate-path / C10 progress 一行指针 |
| 盘点正文 | §1：今日仅 in-process ring（LIMIT=32）；残余 = 跨进程保留 consult/receipt；非跨域写；非 defer |

### 3.2 实现 PR（引用开工令；建议落点；可微调并回写；**本 turn 不开**）

| 落点 | 路径（建议） | 约束 |
| --- | --- | --- |
| consult/receipt 持久化 | 本域 storage 旁路或既有 conversation-task / completion-hold 邻域（路径以实现 PR 为准） | **仅** delivery-close consult 记录 / validation receipts；进程重启可回读；**不**跨域写权威 |
| ENV（若有） | 新或复用 **default-off** ENV | 禁 enforce；禁 default-on；语义不对则停笔等 Owner |
| 回归测例 | 新增/扩展 vitest：重启（或等价 reload）后记录仍在；flag off 行为不变；**closeDeferred 仍恒 false**；不 defer close/cancel | 主张 `code-present`；不抬升 runtime-enabled |
| discovery 后记（可选） | Path B / cancel residual 各一行 xref | docs only |

### 3.3 行为约束（实现时）

- Claim ceiling：**`code-present`** only。  
- **不**把 `closeDeferred` 改为可 true；**不**因 persist 结果跳过 / 延迟 close 或 cancel。  
- **不**跨域写权威；**不**把本刀扩成 C11 单写账本 / Meta-Schema。  
- **不** enforce；**不** live invoke；**不** Path/Gate；**不** Fabric-on。  
- **不**改写 Path B / Path A / Path C / cancel-path 已锁契约；**不**重开 defer-close 叙事。

## 4. 范围外 / 禁止（OUT）

- **跨域写权威**；跨账本单点写入；C11 工程单写  
- **defer-close**（任何推迟 / 条件化 `cancelled`/`closed`；`closeDeferred: true`）  
- **enforce** / Path / Gate / live invoke / Fabric-on  
- **C10 claim gate / pass**（另文；本刀不关）  
- Meta-Schema / Phase D / Path-Gate 收紧  
- 改写 Phase C 五份冻结正文 / digests / 旧 `final-acceptance.md` 决策位  
- 宣称 C10 / C11 pass、unique-benefit PASS、Decision GO、C GO、整段 D GO  
- 本 scope PR 夹带 `src/` / `packages/` 编码（编码属实现 PR）  
- 发明 enforce 旗标；default-on ENV；借持久化偷渡 defer / Gate

## 5. 主张天花板

- 本 scope PR：docs-only / **`code-present`**（文档事实）  
- 实现 PR（引用本开工令）：**`code-present`**（跨进程保留 consult/receipt；default-off；不改 closeDeferred）  
- 禁止抬升：`runtime-enabled` / `production-proven` / C10 pass

## 6. 成功标准

| 标准 | 判定 |
| --- | --- |
| 书面三件套 | scope + acceptance + start-order 入库；Path B / cancel residual 最小 xref |
| 盘点诚实 | §1 明言：今日仅 in-process ring（LIMIT=32）；残余 = 窄跨进程 persist；非跨域写；非 defer |
| 无越界 | OUT 未触碰；无跨域写；无 defer-close；无 enforce；无 C10 pass；无 Meta-Schema 工程 |
| C10 | 明文 **C10 仍不能 pass** |
| NO-GO | Decision NO-GO / Independent COMPLETE / unique-benefit FAIL 站桩不变 |
| 合入 ≠ PASS/GO | 明文本合入与后续实现合入均 ≠ C10 pass / C GO / 整段 D GO |

## 6.5 实现后记（本残差刀）

- **实现 PR（本回合）：** `impl/phase-c-83-cross-process-consult-persist` — 窄 JSON 落盘 `delivery-close-consults.json`（`src/conversation-task/delivery-close-consult-persist.ts`）；ENV `OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_PERSIST` **default-off**；`closeDeferred` 仍恒 false；无跨域写；无 defer-close；主张 **code-present**；**C10 仍不能 pass**；合入 ≠ PASS/GO。

## 7. 残差（须另文）

- C10 claim-gate residual — **另文已立**：`phase-c-83-c10-claim-gate-residual-scope.md` + acceptance + start-order（**C10 仍不能 pass**）  
- C10 pass：仍挡于 Doc01 / sparse_unknown / production-proven — **不**由本刀关闭  
- Meta-Schema / Phase D / Path-Gate 收紧 — 未授权  
- defer-close / enforce — 仍禁；不由本刀偷渡  
- 跨域写权威 / C11 单写 — 未授权；本刀窄 persist **≠** 跨域写  
- #80 合法推翻：仅当未来 ≥3 真 UNIQUE — 本刀不启动

## 8. 验收提示（独立验收 bot；本 PR 不呼叫）

**PASS（本 scope PR）：**

1. 三件套齐全；xref 最小；diff 仅 discovery。  
2. §1 盘点诚实：今日 ring LIMIT=32；残余 = 窄跨进程 consult/receipt persist；非跨域写；非 defer。  
3. 未宣称 C10 pass / GO；未授权 Meta-Schema / defer-close / enforce / 跨域写 / Path/Gate。  
4. 主张天花板 `code-present`；接受宽度见 acceptance；Path B / cancel 合入 ≠ PASS/GO 站桩。

**FAIL：** 夹带代码；跨域写权威；defer-close；enforce；宣称 C10 pass；或把本刀读成 C10/C11 交付。
