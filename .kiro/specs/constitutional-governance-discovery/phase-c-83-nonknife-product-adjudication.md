# Phase C §8.3 — 非刀产品裁决：stdio / AOR / Cron·subagent（docs-only）

> 书面范围：`phase_c_83_c10_c11`（见 `phase-c-83-c10-c11-scope.md`）。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-83-nonknife-product-adjudication.md`。  
> 日期：2026-09-26  
> Owner：用户（经由 **network-of-network** 授权代行产品裁决，2026-09-26）  
> 对照：`phase-c-83-allowed-entry-disposition.md` §4；`execution-entry-inventory.md` FC-08 / FC-08d；`fc-04-next-soft-observe.md`  
> 本页只改 discovery 文档。不新开 soft-observe。不宣称 C10 pass。

## 1. 一句话

对 FC-09 留下的三个 Owner 候选项给出**默认处置**，并记为 **Owner 确认**（network-of-network 2026-09-26）。优先 **exemption+break-glass**，语义与编排/Fabric 的 FC-09 豁免对齐：**登记豁免 ≠ 忽略旁路**。禁止再发明 soft-observe 刀。

## 2. 允许选项（每个入口三选一）

| 选项 | 含义 |
| --- | --- |
| **exemption+break-glass** | 预检三态**登记**豁免；破玻璃条件写死且默认未授权；**不是**忽略旁路 |
| **delete** | 产品删除该入口/能力（需另立工程拆除范围；本页不开工） |
| **另立非 soft-observe 范围** | 既非 reuse-observe 旗标、也非本页豁免；另开书面范围（例如专用治理协议） |

**禁止（所有入口）：** 再挂 soft-observe；把「回到热路径」写成 explicit reuse-observe；AOR core 内 import 预检；为观察打开 Fabric。

## 3. 裁决表（Owner 确认）

| 入口 | 推荐 / 确认处置 | 状态 |
| --- | --- | --- |
| ACP stdio 桥 | **exemption+break-glass** | **Owner 确认**（network-of-network 2026-09-26） |
| AOR（`packages/aor-core`） | **exemption+break-glass** | **Owner 确认**（network-of-network 2026-09-26） |
| Cron / subagent | **exemption+break-glass** | **Owner 确认**（network-of-network 2026-09-26；接受「无已证旁路」前提） |

### 3.1 ACP stdio 桥 → exemption+break-glass

- **事实（inventory / FC-08）：** `serveAcpGateway` + translator `prompt` → Gateway `chat.send`。桥自身不调用预检。目标普通会话已走热路径；目标若已是 ACP 会话，可能再进 FC-05。明确**非** soft-observe 刀。
- **为何不选 delete：** stdio 桥是 ACP 产品面；删除需另立拆除工程，不在 §8.3 文档序列。
- **为何不选另立范围：** 无需新治理协议；缺口是**登记语言**，不是新旁路证明。
- **为何 exemption：** 与 Fabric/编排相同——不要求为「客户端/休眠/默认关」形态另挂观察旗标；副作用若发生，落在已有热路径或 FC-05。
- **破玻璃（未授权）：** （a）证明存在绕开热路径/FC-05 仍执行工具的桥接旁路并要求单独登记；或（b）产品改为删除/另立范围。任一项需**新的** Owner 书面批准。
- **非忽略：** 豁免不授权静默扩大桥接副作用，也不授权 provenance 默认开启以外的新旁路。

### 3.2 AOR core → exemption+break-glass

- **事实：** `packages/aor-core` 不 import OpenBot，无 `buildExecutionPreflight`。热路径不 `new Orchestrator`。适配器侧 `/tools/invoke` 已是 FC-01；`agent` RPC 回热路径。Fabric 默认关。
- **为何不选 delete：** AOR 库与适配器是产品组成部分；删除超出本刀。
- **为何不选另立范围：** 适配器入口已有三态覆盖；core 本身无执行副作用直至注入 backend。
- **为何 exemption：** 避免「为登记而观察」；禁止把预检 import 进 core；禁止 Fabric-on-for-observe。
- **破玻璃（未授权）：** （a）批准在 `aor-core` 内 import OpenBot 预检（明确禁止，除非未来另立范围推翻）；或（b）为观察启用 Fabric（**禁止作为观察手段**）；或（c）产品改为 delete/另立。
- **非忽略：** 豁免不授权 live Fabric、不授权 core 预检接线、不把适配器 FC-01 回写成「AOR 图已 reuse-observe」。

### 3.3 Cron / subagent → exemption+break-glass

- **事实（FC-08 / FC-08d）：** 隔离 Cron → `runEmbeddedPiAgent` → 热路径预检；主会话 Cron 经心跳/回复路径；subagent spawn/announce 经网关 `agent` 再进热路径。**无已证**「绕开热路径/回复路径仍执行工具」的旁路。清单行此前在三态外；**回到热路径 ≠ reuse-observe**。
- **为何不选 delete：** Cron/subagent 为产品能力；删除需另立。
- **为何不选另立非 soft-observe 方案：** 在「无已证旁路」前提下，另立方案会制造平行登记语言，无增量闭合；Owner 接受豁免登记。
- **为何 exemption：** 产品接受「无已证旁路」→ 该**行**不要求自有 soft-observe 旗标；工具执行仍受热路径/回复路径预检约束。这是**登记豁免**，不是把该行升格为 reuse-observe。
- **破玻璃（未授权）：** （a）发现并证实独立旁路后，必须回到三态重裁（reuse-observe / delete / 另立范围）；或（b）产品改选 delete/另立。**禁止**用新 soft-observe 旗标作为破玻璃默认路径。
- **非忽略：** 不得把本豁免读成「Cron/subagent 已 reuse-observe」或「只审 attempt.ts 即整行收口」（FC-08 失败形态仍适用）。

## 4. 与 C10 的关系

本裁决使三个入口**进入三态语言**（均为 exemption+break-glass）。  
**C10 仍不能 pass**：登记迭代尚未闭合（见 `phase-c-83-c10-claim-gate-progress.md` §5）。

## 5. 明确非刀 / 非授权（重申）

- soft-observe 新旗标；stdio 软观察刀；AOR core 预检 import；Fabric-on-for-observe  
- enforce / live invoke / Gate 收紧；P8b/P8c/Tier H/§9.2；重开 #58–#66  
- 宣称 C10 pass；翻转 C NO-GO；C11 工程开工  

## 6. 验收提示

**PASS：** 三入口均有确认处置与破玻璃/非忽略语义；无新旗标；写明 C10 仍不能 pass。  
**FAIL：** 写成 reuse-observe、发明 soft-observe、省略破玻璃、或宣称 C10 pass。
