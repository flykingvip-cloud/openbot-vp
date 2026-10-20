# Phase C §8.3 — 旁路登记迭代证据记录（docs-only）

> 书面范围：`phase_c_83_registration_iteration`（见 `phase-c-83-registration-iteration-scope.md`）。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-83-registration-iteration-evidence.md`。  
> 日期：**2026-09-26（Asia/Shanghai）**  
> 前置：处置账本 #68；非刀裁决 #69；`execution-entry-inventory.md`；`phase-c-83-c10-claim-gate-progress.md`  
> 本页只改 discovery 文档。  
> **明确：本页是登记迭代过程证据；迭代证据 ≠ C10 pass。C10 仍不能 pass / 仍为 fail，直至 Doc01 与 `docs_phase_d_sparse_unknown.md` 中仍悬空的产品+工程准则全部满足（若仍有余项）。禁止发明 green C10。**

## 1. 一句话

对照 FC-09 + #69 处置账本，对允许登记入口跑完**一轮**旁路登记迭代（清单复核 + 三态处置确认），并留下本页证据。本轮完成的是**文档/治理过程**；**不**关闭 C10 主张门，**不**宣称 C10 pass。

## 2. 输入

| 输入 | 引用 |
| --- | --- |
| 允许入口三态处置账本 | `phase-c-83-allowed-entry-disposition.md`（PR **#68**） |
| 非刀产品裁决（stdio / AOR / Cron·subagent） | `phase-c-83-nonknife-product-adjudication.md`（PR **#69**） |
| C10 主张门进度 | `phase-c-83-c10-claim-gate-progress.md`（PR **#69**） |
| 执行入口 inventory | `execution-entry-inventory.md`（含 FC-08 / FC-09 / #69 后记） |
| 产品确认（C10 门条件） | `phase-c-83-product-confirmation.md` §5 |
| 稀疏 unknown | `docs_phase_d_sparse_unknown.md`（FC-08d） |
| Doc01 C10 立场 | `01-openbot-constitutional-gap-and-feasibility.md`（C10 = No Hidden Bypass，现态 **fail**） |

基线：`origin/main` @ `59ea97d8414d05a0c589b22ec98c2f26e6089734`（#69 merge）。

## 3. 允许登记入口复核清单（本轮）

对下列入口逐项核对：是否仍属「允许登记」范围；三态处置是否与账本/#69 一致；有无被误写成 soft-observe / reuse-observe / 忽略旁路。

### 3.1 explicit reuse-observe（已落地；默认关；本轮只确认、不接线）

| 入口 | 本轮处置确认 |
| --- | --- |
| FC-01 `/tools/invoke` | **reuse-observe**（既有；默认关） |
| FC-03a 企业 capability invoke | **reuse-observe**（既有；默认关） |
| FC-03b `node.invoke` | **reuse-observe**（既有；默认关） |
| FC-05 ACP 进程内 `tryDispatchAcpReply` | **reuse-observe**（既有；默认关） |
| FC-06 inter-agent bus | **reuse-observe**（既有；默认关） |
| FC-07 ACP CLI 回合 + steer | **reuse-observe**（既有；默认关） |

### 3.2 exemption+break-glass（FC-09 账本；本轮确认）

| 入口 | 本轮处置确认 |
| --- | --- |
| task-orchestration | **exemption+break-glass**（休眠 / live-invoke 未授权；登记豁免 ≠ 忽略旁路） |
| Fabric | **exemption+break-glass**（默认关；**不得为观察打开**） |
| `knowledge.capability.invoke` | **exemption+break-glass**（无 live connector；破玻璃 = 另立 live-connector 轨道） |

### 3.3 exemption+break-glass（#69 Owner 裁决；本轮确认——非 soft-observe）

| 入口 | 本轮处置确认 |
| --- | --- |
| ACP stdio 桥 | **exemption+break-glass**（按 #69；**不是** soft-observe） |
| AOR（`packages/aor-core`） | **exemption+break-glass**（按 #69；禁止 core 预检 import / Fabric-on-for-observe） |
| Cron / subagent | **exemption+break-glass**（按 #69；**回到热路径 ≠ reuse-observe**；禁止新 soft-observe 旗标） |

### 3.4 明确不适用 / 未收成整行（本轮不升格）

| 项 | 本轮确认 |
| --- | --- |
| ConversationTask **整行**预检三态 | 仍 **不适用 / 未收成**（FC-02 仅为关闭前 delivery-hold 咨询；FC-08b） |
| Profile B ↔ CTR / 插件 / Cron·subagent | 仍 **sparse unknown**（`docs_phase_d_sparse_unknown.md`） |
| production-proven（`openbot-gateway-rc`） | 仍 **unknown**（未探测） |

## 4. 本轮做了什么

1. 以 #68 处置账本 + #69 非刀裁决 + inventory 为唯一输入，不作新的产品裁决。  
2. 对 §3 允许登记入口做一致性复核：三态语言是否齐全；有无把候选项误读成 soft-observe / 忽略旁路。  
3. **确认** stdio / AOR / Cron·subagent 维持 #69 的 **exemption+break-glass**（登记豁免 ≠ 忽略旁路；破玻璃未授权）。  
4. 将本轮过程写成证据页，并在 C10 进度页 / inventory 后记做最小交叉引用。  
5. **拒绝**勾选 C10 pass：迭代证据只证明「跑过一轮」，不满足 Doc01 / sparse_unknown 仍悬空的产品+工程准则。

## 5. 结果

| 项 | 状态 |
| --- | --- |
| 旁路登记迭代（文档/治理过程） | **本轮已完成**（2026-09-26 Asia/Shanghai） |
| 允许登记入口三态语言（相对账本/#69） | **本轮已复核确认** |
| C10 主张门正式勾选 / pass | **未勾选；仍不能 pass** |
| Phase C Decision NO-GO | **未翻转** |
| 新 soft-observe 旗标 / `src/` 接线 | **无** |

**一句话结果：** 迭代完成于文档与治理过程；**C10 仍为 fail / 不能 pass**。禁止将本页读成 green C10。

## 6. 仍挡 C10 pass 的短清单

在「至少一轮登记迭代」已有过程证据之后，C10 **仍不能 pass**，直至下列产品+工程准则（Doc01 / sparse_unknown）若仍存在则全部满足：

1. **Doc01 C10（No Hidden Bypass）** 现态仍为 **fail**——结构旁路与显式 dangerous\* / break-glass 的产品+工程闭合准则未宣称已满足；旁路表「主旁路已显式化」≠ C10 pass。  
2. **Profile B**（`managed_enterprise` / Gate 0）相对 CTR / 插件 / Cron·subagent 的闭合关系仍为 **sparse unknown**（`docs_phase_d_sparse_unknown.md`）。  
3. **production-proven**（相对 `openbot-gateway-rc`）仍为 **unknown**（本序列未探测、不升格）。  
4. **ConversationTask 整行**按 FC-08b 仍不收成预检三态——不得用本轮迭代把它抹成已闭合旁路行。  
5. **主张门正式勾选**仍保留：本页只提供迭代过程证据；**不**代替 Owner/验收对 C10 的正式 pass 判定。

任一余项未闭合时，把本页或进度页读成 C10 pass 均 **FAIL**。

> **诚实跟踪（2026-09-26）：** §6 挡门项仍全部未闭；可勾选模板见 `phase-c-83-c10-claim-gate-checklist.md`（开工令 `phase_c_83_c10_claim_gate_residual_start_order`）。勾选 ≠ pass；**不**由本注发明任何闭合。

## 7. 明确非升格

- 不宣称 C10 / C11 pass；不发明 green C10  
- 不翻转 Phase C Decision **NO-GO**  
- 不打开整段 Phase D；不重开 #58–#66  
- 不新开 soft-observe 旗标；不 enforce / live invoke / Gate 收紧  
- 不启动 P8b / §9.2；不启动 C11 工程  

## 8. 验收提示

**PASS：** 写明日期与输入；清单复核 + 三态确认齐全；stdio/AOR/Cron 记为 exemption+break-glass（非 soft-observe）；写明迭代已跑且 **C10 仍不能 pass**；§6 短清单指向 Doc01 / sparse_unknown；无代码/旗标。  
**FAIL：** 写成 C10 pass、省略挡门清单、把 Cron「回到热路径」写成 reuse-observe、或夹带 soft-observe / 代码。
