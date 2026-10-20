# Phase C §8.3 残差刀 — cancel-path consult observe（书面范围）

> 范围 id：`phase_c_83_cancel_path_consult_observe`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-83-cancel-path-consult-observe-scope.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 对照：Doc02 §8.3；`phase-c-83-path-b-ctr-consult-polish-scope.md`（#91/#92；`e371bc03`）；`phase-c-83-path-a-observe-helper-lock-scope.md`（#88/#89）；`phase-c-83-path-c-bypass-table-lock-scope.md`（#86/#87）；`phase-c-83-operate-path-confirmation-scope.md`（#85）；`execution-entry-inventory.md`  
> 前置：`phase-c-83-cancel-path-consult-observe-acceptance.md` + `phase-c-83-cancel-path-consult-observe-start-order.md`  
> **本 PR = docs-only 书面范围 / 接受 / 开工令**。编码实现须引用本开工令另开实现 PR；**不**在本 PR 改 `src/`。  
> **基线 tip：** `e74ffb34c1e4ee53a1ea46391beea11db2ed2f04`（#93 merge）；ABC 三刀已合入 — Path C #86+#87；Path A #88+#89；Path B #91+#92（`e371bc03f05116929d3c3aa80d3e6892db9bc6ac`）。**合入 ≠ PASS/GO。**

## 0. 为何开本残差刀（在 A/B/C 三刀之后）

| 现象 | 证据 |
| --- | --- |
| Path C 旁路表已锁定 | #86 接受+开工令；#87 落地 `allowed-entry-disposition.ts`；CTR 整行 `n/a-not-tri-state` |
| Path A 六处 reuse-observe 已锁定 | #88 接受+开工令；#89 落地 `reuse-observe-helper-lock.test.ts` |
| Path B CTR consult 抛光已锁定 | #91 接受+开工令；#92 落地 `ctr-close-consult-lock`；merge `e371bc03…` |
| Path B scope §7 / start-order §8 | 明文列出 **cancel 路径 consult observe** 为 **须另文**；Path B 开工令 **不授权** cancel 路径新 consult |
| 站桩 | C10 **仍不能 pass**；unique-benefit **FAIL**；Decision **NO-GO** / Independent **COMPLETE**；主张天花板 **`code-present`** |

本刀把 Path B 明示残差中的 **cancel-path consult observe** 收成独立书面三件套：在 A/B/C 已合入前提下，授权**日后**在 cancel 生命周期上挂 soft-observe consult（复用或另定 default-off ENV）；**停止**用 defer-close / enforce / 跨进程持久化 / C10 pass 冒充本残差交付。**合入 A/B/C ≠ PASS/GO；合入本 docs PR 亦 ≠ PASS/GO。**

## 1. 主 tip 盘点（IN 具体化；诚实）

### 1.1 已落地（code-present；本刀不重发明 FC-02）

| 项 | 主 tip 事实 |
| --- | --- |
| FC-02 close-consult | **已存在**于 reply-completed 路径：`observeConversationTaskReplyCompleted` → `consultDeliveryHoldForClose` |
| 旗标 | `OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT`（`CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_ENV`）；**default-off**；truthy = `1`/`true`/`yes`/`on` |
| 记录形状 | `ConversationTaskDeliveryCloseConsultRecord`：`mode: "observe"`；**`closeDeferred: false`（类型恒 false）**；咨询抛错吞掉后仍写本域 `closed` |
| 咨询 API | `consultDeliveryHoldForClose({ sessionKey?, taskId?, text })`（`completion-hold.ts`）— 只读 hold；不推迟 close |
| Cancel / focus-switch fence | `focus-switch.ts` 等 cancel fence **已存在**（cancel 生命周期有围栏） |
| Cancel × consult | cancel 路径 **今日不**调用 `consultDeliveryHoldForClose` — 残余是 **在 cancel 生命周期上接线 observe consult**，**不是**发明 FC-02 |

### 1.2 工程可行动残余（本刀 IN 候选裁定）

| 候选 | 主 tip 是否已部分存在 | 本刀裁定 |
| --- | --- | --- |
| cancel 路径 soft-observe consult 接线 | cancel fence 在；`consultDeliveryHoldForClose` 在 reply 路径；**未**在 cancel 路径调用 | **IN（本刀目标；实现另 PR）** |
| 复用 FC-02 ENV | 同名 ENV 语义 = delivery close-consult observe | **优先复用**；若语义不对齐则 OUT 直至 Owner 另选 default-off ENV — **禁止**发明 enforce 旗标 |
| 跨进程 consult/receipt 持久化 | 仅进程内 ring | **OUT** |
| C10 claim gate / pass | 仍挡 | **OUT** |
| defer-close / enforce | 类型与叙事均禁 | **OUT** |

## 2. 目标（Goal）

在 Decision **NO-GO** / Independent **COMPLETE** / unique-benefit **FAIL** / A/B/C 三刀已 **code-present** 前提下，授权一把 **cancel-path consult observe** 窄工程刀（书面先、实现后）：

1. 在 cancel / focus-switch cancel 生命周期上，旗标开时只读咨询 `consultDeliveryHoldForClose`（或等价 soft-observe），记 observe 记录。  
2. **必须不**推迟 `cancelled` / `closed` 过渡；**仍禁** defer-close；吞错；default-off。  
3. **不** enforce；**不** live invoke；**不** Path/Gate；**不**宣称 C10 pass / GO。  
4. 主张天花板：**`code-present`** only。

## 3. 范围内（IN）

### 3.1 本 scope PR（docs-only）

| 项 | 说明 |
| --- | --- |
| 书面三件套 | 本 scope + acceptance + start-order |
| 最小 xref | Path B scope §7 / start-order §8 残差行指向本文为另文；可选 operate-path §10 一行指针（Path B 模式） |
| 盘点正文 | §1：FC-02 已在 reply 路径；cancel fence 在但未挂 consult；残余 = wiring |

### 3.2 实现 PR（引用开工令；建议落点；可微调并回写；**本 turn 不开**）

| 落点 | 路径（建议） | 约束 |
| --- | --- | --- |
| cancel 路径 soft-observe | `focus-switch.ts` cancel fence 附近（或 cancel 生命周期权威调用点）调用 `consultDeliveryHoldForClose` | **default-off**；吞错；**必须不** defer cancel/closed；仍禁 defer-close；无 enforce；无 live invoke |
| ENV | 优先复用 `OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT` | 若复用语义不对：OUT 直至 Owner 另选 **default-off** ENV；**不**发明 enforce 旗标 |
| 回归测例 | 新增/扩展 vitest：flag off 仍 cancel；flag on 记 observe 且不推迟 transition；咨询失败仍完成 cancel | 主张 `code-present`；不抬升 runtime-enabled |
| discovery 后记（可选） | Path B residual / inventory 各一行 xref | docs only |

### 3.3 行为约束（实现时）

- Claim ceiling：**`code-present`** only。  
- **优先**复用 FC-02 ENV；语义不对则停笔等 Owner — **不**自创 enforce / 第二支 defer 旗标。  
- **不**把 `closeDeferred` 改为可 true；**不**因 consult 结果跳过 / 延迟 cancel 或 `closed`。  
- **不**跨进程持久化 consult 记录或 validation receipt 作为本刀交付。  
- **不**改豁免行；**不**给豁免入口挂 observe；**不**改写 Path B / Path A / Path C 已锁契约。

## 4. 范围外 / 禁止（OUT）

- **defer-close**（任何推迟 / 条件化 `cancelled`/`closed`；`closeDeferred: true`）  
- **enforce** / Path / Gate / live invoke / Fabric-on  
- 跨进程咨询 / 收据持久化；跨域写权威  
- C10 claim gate / pass；Meta-Schema / Phase D / Path-Gate 收紧  
- 改写 Phase C 五份冻结正文 / digests / 旧 `final-acceptance.md` 决策位  
- 宣称 C10 / C11 pass、unique-benefit PASS、Decision GO、C GO、整段 D GO  
- 本 scope PR 夹带 `src/` / `packages/` 编码（编码属实现 PR）  
- 重开 Path A / Path B / Path C 旁路表或 CTR 行语义  
- 发明 enforce 旗标；在 Owner 未裁定前擅自新开第二支 ENV 当「交付」

## 5. 主张天花板

- 本 scope PR：docs-only / **`code-present`**（文档事实）  
- 实现 PR（引用本开工令）：**`code-present`**（cancel 路径 soft-observe consult；行为 default-off / 不推迟 cancel/closed）  
- 禁止抬升：`runtime-enabled` / `production-proven` / C10 pass

## 6. 成功标准

| 标准 | 判定 |
| --- | --- |
| 书面三件套 | scope + acceptance + start-order 入库；Path B residual 最小 xref（± operate-path 一行） |
| 盘点诚实 | §1 明言：FC-02 在 reply 路径已存在；cancel 残余 = wiring observe consult，非发明 FC-02 |
| 无越界 | OUT 未触碰；无 defer-close；无 enforce；无跨进程持久化；无 C10 pass；无 Meta-Schema 工程 |
| C10 | 明文 **C10 仍不能 pass** |
| NO-GO | Decision NO-GO / Independent COMPLETE / unique-benefit FAIL 站桩不变 |
| 合入 ≠ PASS/GO | 明文本合入与后续实现合入均 ≠ C10 pass / C GO / 整段 D GO；A/B/C 合入亦 ≠ PASS/GO |

## 7. 残差（须另文）

- 跨进程咨询/收据持久化 — **另文已立**：`phase-c-83-cross-process-consult-persist-scope.md` + acceptance + start-order（窄 persist；禁跨域写 / defer-close / enforce；本 cancel 刀仍 OUT；实现须另 PR）  
- C10 claim-gate residual（**非** pass）— **另文已立**：`phase-c-83-c10-claim-gate-residual-scope.md` + acceptance + start-order；**C10 仍不能 pass**；仍挡于 Doc01 / sparse_unknown / production-proven — **不**由本刀关闭  
- Meta-Schema / Phase D / Path-Gate 收紧 — 未授权  
- defer-close / enforce — 仍禁；不由本刀偷渡  
- 若 FC-02 ENV 复用语义经 Owner 裁定为不对：另文选定 default-off ENV（仍禁 enforce）  
- #80 合法推翻：仅当未来 ≥3 真 UNIQUE — 本刀不启动  
- **实现后记：** cancel-path consult observe **实现已合入** #96（merge `8b107a3d`）；合入 ≠ PASS/GO；本残差节仍指向跨进程 persist / C10 claim-gate residual 另文

## 8. 验收提示（独立验收 bot；本 PR 不呼叫）

**PASS（本 scope PR）：**

1. 三件套齐全；xref 最小；diff 仅 discovery。  
2. §1 盘点诚实：FC-02 已在 reply；cancel fence 在但未挂 consult；残余 = wiring；非发明 FC-02。  
3. 未宣称 C10 pass / GO；未授权 Meta-Schema / defer-close / enforce / 跨进程持久化 / Path/Gate。  
4. 主张天花板 `code-present`；接受宽度见 acceptance；A/B/C 合入 ≠ PASS/GO 站桩。

**FAIL：** 夹带代码；defer-close；enforce；跨进程持久化当本刀交付；宣称 C10 pass；或续 D-scaffold 当 §8.3 交付。
