# Phase C §8.3 — C10 主张门进度记录（docs-only）

> 书面范围：`phase_c_83_c10_c11`（见 `phase-c-83-c10-c11-scope.md`）。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-83-c10-claim-gate-progress.md`。  
> 日期：2026-09-26  
> 前置：`phase-c-83-product-confirmation.md` §5；`phase-c-83-allowed-entry-disposition.md`；`execution-entry-inventory.md` FC-08 / FC-09  
> 本页只改 discovery 文档。**明确：C10 仍不能 pass。**

## 1. 一句话

记录允许登记入口相对预检三态（`reuse-observe` | `exemption+break-glass` | `delete`）的进度；**一轮**旁路登记迭代已有过程证据（见 `phase-c-83-registration-iteration-evidence.md`）；**迭代证据 ≠ C10 pass**——因此 **C10 仍不能 pass**（Doc01 / sparse_unknown 产品+工程准则仍挡门）。

## 2. C10 通过条件（重申；未满足）

摘自产品确认 §5：

1. 允许登记的入口均落入预检三态之一；**且**  
2. 登记已跑过至少一轮**迭代**（一致性复核 + 主张门清单勾选）。

本页不改写上述条件，不宣称任一条件已闭合。

## 3. 已落入三态（IN）

### 3.1 explicit reuse-observe（已落地；默认关；本页不接线）

| 刀 | 入口 |
| --- | --- |
| FC-01 | `/tools/invoke` |
| FC-03a | 企业 capability invoke |
| FC-03b | `node.invoke` |
| FC-05 | ACP 进程内 `tryDispatchAcpReply` |
| FC-06 | inter-agent bus |
| FC-07 | ACP CLI 回合 + steer |

### 3.2 exemption+break-glass（FC-09 文档收口）

| 入口 | 备注 |
| --- | --- |
| task-orchestration | 休眠 / `ORCHESTRATION_LIVE_INVOKE=false`；破玻璃未授权 |
| Fabric | 默认关；**不得为观察打开** |
| `knowledge.capability.invoke` | 无 live connector；破玻璃 = 另立 live-connector 轨道 |

### 3.3 exemption+break-glass（本批 Owner 裁决；见非刀裁决页）

| 入口 | 备注 |
| --- | --- |
| ACP stdio 桥 | 登记豁免；非 soft-observe；破玻璃见裁决页 |
| AOR（`packages/aor-core`） | 登记豁免；禁止 core 预检 import / Fabric-on-for-observe |
| Cron / subagent | 登记豁免（产品接受「无已证旁路」）；**回到热路径 ≠ reuse-observe** |

语义一律对齐 FC-09：**豁免的是预检三态登记，不是忽略旁路或生产启用。**

## 4. 仍在三态语言之外 / 不适用（OUTSIDE）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| ConversationTask **整行**预检三态 | 不适用 / 未收成 | FC-02 仅为关闭前 delivery-hold 咨询；FC-08b 保持整行不收成三态 |
| Profile B 是否被 CTR / 插件 / Cron·subagent 闭合 | 仍 unknown（稀疏） | FC-08d；**不是**本页用豁免抹掉的「允许登记入口」缺口 |
| production-proven（`openbot-gateway-rc`） | 仍 unknown | 未探测；不升格 |
| FC-08 明确非刀约束 | 仍有效 | 禁止再挂 soft-observe / AOR core 预检 / Fabric-on-for-observe——裁决页不解除这些禁止 |

## 5. 登记迭代状态

| 检查项 | 状态 |
| --- | --- |
| FC-09 子集处置写入 inventory | 已做（#68） |
| stdio / AOR / Cron·subagent Owner 裁决成文 | 已做（#69；见 `phase-c-83-nonknife-product-adjudication.md`） |
| inventory 最小交叉引用指向 #69 | 已做（#69 后记） |
| **旁路登记迭代（至少一轮；文档/治理过程）** | **已跑**（2026-09-26 Asia/Shanghai；见 `phase-c-83-registration-iteration-evidence.md`） |
| C10 主张门正式勾选 / pass | **未勾选；仍不能 pass**（迭代证据 ≠ pass） |

说明：#69 把候选项写入三态语言，满足「落入三态」的文档前提之一；本批补上「至少一轮登记迭代」的**过程证据**。二者合起来**仍不等于** C10 pass——Doc01 C10 现态 fail、以及 `docs_phase_d_sparse_unknown.md` 中 Profile B / production-proven 等产品+工程准则若仍悬空，则主张门不得勾选。任何把本页读成 C10 pass / green C10 的解读均 **FAIL**。

> **后续交叉引用（2026-09-26）：** 书面范围 `phase-c-83-registration-iteration-scope.md`；证据 `phase-c-83-registration-iteration-evidence.md`（§6 仍挡门短清单）。  
> **残差刀（2026-09-26）：** C10 claim-gate residual 另文已立 — `phase-c-83-c10-claim-gate-residual-scope.md` + acceptance + start-order（开工令 id `phase_c_83_c10_claim_gate_residual_start_order`；#97）。授权日后进度（checklist / blocker 跟踪 / 可选 gate sheet）边界；**C10 仍不能 pass**；merge ≠ PASS/GO；读成 pass = FAIL。
> **后续进度 turn（Residual B；本批）：** checklist 形式化 → `phase-c-83-c10-claim-gate-checklist.md`；可选 Owner-facing gate sheet → `phase-c-83-c10-claim-gate-sheet.md`。§6 挡门项仍全部未勾；勾选 ≠ pass；正式 pass 须 Owner+acceptance 对 §6 全闭另行认证。引用开工令 ≠ pass。
> **Residual A 说明：** #99（merge `d8273d2c`，跨进程 consult persist）与 C10 pass **无关**——不得借其合入宣称主张门闭合。

## 6. 明确非升格

- 不宣称 C10 / C11 pass  
- 不翻转 Phase C Decision **NO-GO**  
- 不打开整段 Phase D；不重开 #58–#66  
- 不新开 soft-observe 旗标；不 enforce / live invoke / Gate 收紧  
- 不启动 P8b / §9.2  

> **C11 xref（2026-09-26）：** 倡议已 **chartered**（`phase-c-c11-finalization-charter.md`；acceptance + start-order 同包）。**工程未启动**。C11 章程 **≠** C10 pass，也 **≠** C11 pass。

## 7. 验收提示

**PASS：** 进度表区分 IN / OUTSIDE；写明登记迭代已有过程证据且 **C10 仍不能 pass**（迭代证据 ≠ pass）；无代码/旗标。  
**FAIL：** 把本页写成 C10 pass / green C10、把迭代证据当成主张门正式勾选、或夹带 soft-observe / 代码。
