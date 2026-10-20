# Phase C §8.3 — C10 主张门 checklist 模板（**非** C10 pass）

> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-83-c10-claim-gate-checklist.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 授权：开工令 id `phase_c_83_c10_claim_gate_residual_start_order`（见 `phase-c-83-c10-claim-gate-residual-start-order.md`；#97）  
> 对照：`phase-c-83-registration-iteration-evidence.md` §6；`phase-c-83-c10-claim-gate-progress.md`；`phase-c-83-c10-claim-gate-sheet.md`  
> 本页只改 discovery 文档。主张天花板：**`code-present`**。  
> **站桩（全文有效）：C10 仍不能 pass。** 合入本页所在 PR ≠ PASS/GO。引用本开工令 ≠ pass。把本页读成 C10 pass / green C10 / Decision GO = **FAIL**。

## 0. 使用规则（必读）

1. **勾选 ≠ pass。** 本模板仅把挡门项收成可勾选清单，便于诚实跟踪；任何单项或全表勾选 **都不** 构成 C10 pass。  
2. **正式 pass** 须 Owner+acceptance **另行**证明 `phase-c-83-registration-iteration-evidence.md` §6 **全部**挡门项已闭合；本 checklist、本开工令、本 PR merge **均不代替**该证明。  
3. **未闭合项必须保持未勾**（`- [ ]`）。禁止删改挡门事实、禁止把「过程证据」写成「已闭」。  
4. 本页 **不** 改写 Phase C 冻结正文；**不** 翻转 Decision NO-GO；**不** 打开 Phase D / Meta-Schema / Path-Gate。  
5. Residual A（#99，merge `d8273d2c`，跨进程 consult persist）与 C10 pass **无关**——不得借其合入勾选本表。

## 1. §6 挡门短清单（正式 pass 前提；本轮全部未勾）

来源：`phase-c-83-registration-iteration-evidence.md` §6。任一余项未闭合 → **C10 仍不能 pass**。

- [ ] **Doc01 C10（No Hidden Bypass）** 现态仍为 **fail**——结构旁路与显式 dangerous\* / break-glass 的产品+工程闭合准则未宣称已满足；旁路表「主旁路已显式化」≠ C10 pass。  
- [ ] **Profile B**（`managed_enterprise` / Gate 0）相对 CTR / 插件 / Cron·subagent 的闭合关系仍为 **sparse unknown**（`docs_phase_d_sparse_unknown.md`）。**禁止假闭合。**  
- [ ] **production-proven**（相对 `openbot-gateway-rc`）仍为 **unknown**（本序列未探测、不升格）。**禁止发明 proven。**  
- [ ] **ConversationTask 整行**按 FC-08b 仍不收成预检三态——不得用登记迭代把它抹成已闭合旁路行。  
- [ ] **主张门正式勾选**仍保留：迭代过程证据 **不** 代替 Owner/验收对 C10 的正式 pass 判定。

## 2. 进度页 OUTSIDE / 仍悬空项（跟踪用；未勾）

来源：`phase-c-83-c10-claim-gate-progress.md` §4 / §5。与 §1 重叠处保持一致；**勾选仍 ≠ pass**。

- [ ] ConversationTask **整行**预检三态：仍 **不适用 / 未收成**（FC-02 仅为关闭前 delivery-hold 咨询；FC-08b）  
- [ ] Profile B 是否被 CTR / 插件 / Cron·subagent 闭合：仍 **unknown（稀疏）**（FC-08d）  
- [ ] production-proven（`openbot-gateway-rc`）：仍 **unknown**（未探测）  
- [ ] FC-08 明确非刀约束仍有效：禁止再挂 soft-observe / AOR core 预检 / Fabric-on-for-observe  
- [ ] C10 主张门正式勾选 / pass：**未勾选；仍不能 pass**（迭代证据 ≠ pass）

## 3. 已有过程事实（非 pass；仅登记，非「挡门已闭」）

下列为既有 docs/治理过程事实，**不得**误读为 §1 已闭或 C10 pass：

| 事实 | 状态 | 说明 |
| --- | --- | --- |
| 允许登记入口落入预检三态（文档前提） | 已有进度记录 | 见 progress §3；**≠** C10 pass |
| 旁路登记迭代（至少一轮；文档/治理过程） | 已跑 | 见 `phase-c-83-registration-iteration-evidence.md`；**迭代证据 ≠ pass** |
| C10 claim-gate residual 三件套 | 已入库（#97） | 授权本进度 turn；**≠** pass |
| Residual A 跨进程 consult persist | 已合入（#99 / `d8273d2c`） | **与 C10 pass 无关** |

## 4. 明确禁止（勾选本表时亦禁止）

- 宣称 C10 pass / green C10 / Decision GO / unique-benefit PASS / Phase D / Meta-Schema / Path-Gate  
- 发明 production-proven；Profile B 假闭合；ConversationTask 整行改成预检三态  
- soft-observe / enforce / live invoke / Fabric-on  
- 改写 Phase C 冻结正文；夹带 `src/` / packages 编码  
- 把引用 `phase_c_83_c10_claim_gate_residual_start_order` 的 PR 读成「C10 已 pass」

## 5. 指针

| 文件 | 角色 |
| --- | --- |
| `phase-c-83-c10-claim-gate-residual-start-order.md` | 本进度 turn 开工令 |
| `phase-c-83-c10-claim-gate-residual-scope.md` / `-acceptance.md` | 书面范围 / 接受 |
| `phase-c-83-c10-claim-gate-progress.md` | 既有进度页 |
| `phase-c-83-registration-iteration-evidence.md` §6 | 挡门短清单权威源 |
| `phase-c-83-c10-claim-gate-sheet.md` | 可选 Owner-facing 只读汇总 |
| `final-acceptance.md` | 现行外部立场（NO-GO COMPLETE） |

## 6. 验收提示

**PASS（本 checklist 页）：** 页眉明文 **C10 仍不能 pass**；§1 / §2 未闭合项均为 `- [ ]`；写明勾选 ≠ pass、正式 pass 须 Owner+acceptance 对 §6 全闭另行认证；无 `src/`；无 pass / GO 宣称。  
**FAIL：** 把未闭合项标成已勾/已闭；省略「仍不能 pass」；写成 C10 pass / Decision GO；或夹带代码。
