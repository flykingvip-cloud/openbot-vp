# Phase C §8.3 / FC-09：允许入口三态处置账本（docs-only）

> 书面范围：`phase_c_83_allowed_entry_disposition`（见 `phase-c-83-allowed-entry-disposition-scope.md`）。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-83-allowed-entry-disposition.md`。  
> 日期：2026-09-26  
> 状态：docs-only 入库刀（相对 `origin/main` @ `5282a5d6`）。  
> 本页只改 discovery 文档。不改代码、旗标、Phase C 冻结正文。不宣称 C10 pass。

## 1. 一句话

在 §8.3 运营路径下，把**允许**写入预检三态语言的入口收成账本：已落地 reuse-observe 只汇总；休眠编排与默认关 Fabric、以及未入清单的 `knowledge.capability.invoke`，以 **exemption+break-glass** 文档收口；stdio / AOR / Cron·subagent 的 Owner 裁决见 `phase-c-83-nonknife-product-adjudication.md`（本页不重复升格叙事）。

## 2. 已落地 explicit reuse-observe（汇总；不接线）

| 刀 | 入口 | 旗标（默认 unset = 不调用） |
| --- | --- | --- |
| FC-01 | `/tools/invoke` | `OPENBOT_HTTP_TOOLS_INVOKE_PREFLIGHT_OBSERVE` |
| FC-03a | 企业 capability invoke | `OPENBOT_ENTERPRISE_CAPABILITY_INVOKE_PREFLIGHT_OBSERVE` |
| FC-03b | `node.invoke` | `OPENBOT_NODE_INVOKE_PREFLIGHT_OBSERVE` |
| FC-05 | ACP 进程内 `tryDispatchAcpReply` | `OPENBOT_ACP_TURN_PREFLIGHT_OBSERVE` |
| FC-06 | inter-agent bus | `OPENBOT_INTER_AGENT_BUS_PREFLIGHT_OBSERVE` |
| FC-07 | ACP CLI 回合 + steer | `OPENBOT_ACP_CLI_STEER_PREFLIGHT_OBSERVE` |

共同约束：只记 trace / decision；丢弃 allow 集；不 `applyPreflightToTools`；不 `armCompletionHold`；observe 失败不改写既有成功/错误语义。

FC-02：`OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT` 是关闭前 delivery-hold **观察咨询**，**不是** ConversationTask 整行预检三态。

## 3. 本账本写入的处置

### 3.1 task-orchestration → exemption+break-glass

- 事实：`ORCHESTRATION_LIVE_INVOKE === false`；即使常量被改，`considerDispatch` 仍 fail-closed；shadow 路径 `invoke=false` 且 `enqueue=false`；不调用工具、不创建 ConversationTask、不写 ledger。
- 处置：**exemption+break-glass**（预检三态登记意义上的豁免：休眠入口不要求挂 soft-observe）。**不是**「忽略旁路」或生产启用授权。
- 破玻璃：将 `ORCHESTRATION_LIVE_INVOKE` 置 true，或打开可使 `livePathWouldInvoke` 为真的 dispatch/node/browser 旗标——**当前未授权**。
- 非升格：不是 production-proven；不是 C10 pass。

### 3.2 Fabric → exemption+break-glass

- 事实：默认关（`OPENBOT_FABRIC_ENABLED` / `gateway.fabric.enabled`）；未启用则聊天不走 `decide()` DENY 路径。
- 处置：**exemption+break-glass**（默认关不要求挂 soft-observe）。**不是**「忽略旁路」或生产启用授权。
- 破玻璃：启用 Fabric——**不得为观察 AOR/旁路而打开**（FC-08 / 产品确认）。
- 非升格：启用后的预检关系不在本页重写。

### 3.3 `knowledge.capability.invoke` → 登记 + exemption+break-glass（建议）

- 位置：`src/gateway/server-methods/knowledge.ts` → `invokeKnowledgeCapability`（`src/gateway/knowledge/capability-invoke-runtime.ts`）。
- 事实（已读源码）：seat / access / quota / audit；返回**已物化** capability 元数据；注释写明 **NEVER** live connector call；live-connector 为另轨且需显式签字。
- 与 FC-03a 区别：FC-03a 企业 capability invoke 走 `invokeEnterpriseDataAction`；本入口不走该 live 数据动作。
- 处置建议：**exemption+break-glass**（避免为非 live 入口再挂观察旗标）。破玻璃 = 批准 boundary-opening live-connector 轨道（另立范围）。
- 备选（需另立书面范围，本账本默认不批）：FC-03a 模式 default-off reuse-observe。

### 3.4 ConversationTask 整行

- 保持：**不**收成预检三态整行（与 FC-08b 一致）。
- FC-02 咨询保持原样。

## 4. Owner 候选项 → 已移交产品裁决页

本账本 §4 原列 stdio / AOR / Cron·subagent 为候选项（本页不裁决）。  
**后续刀（2026-09-26）：** 默认处置与 Owner 确认见 `phase-c-83-nonknife-product-adjudication.md`（network-of-network 授权代行）。  
三入口默认均为 **exemption+break-glass**（登记豁免 ≠ 忽略旁路；破玻璃未授权）。  
C10 进度与登记迭代状态见 `phase-c-83-c10-claim-gate-progress.md`——**C10 仍不能 pass**（登记迭代未闭合）。

| 入口 | 本账本历史态 | 裁决后（见非刀裁决页） | 仍禁止 |
| --- | --- | --- | --- |
| ACP stdio 桥 | Owner 候选项 | exemption+break-glass（Owner 确认） | 再挂软观察 |
| AOR core | Owner 候选项 | exemption+break-glass（Owner 确认） | core 预检 import；Fabric-on-for-observe |
| Cron / subagent | Owner 候选项 | exemption+break-glass（Owner 确认） | 新 soft-observe 旗标；「回到热路径 = reuse-observe」 |

## 5. 明确非刀（重申）

- ACP stdio 软观察；AOR core 预检；Fabric-on-for-observe；Cron/subagent 新观察旗标
- enforce / live invoke / Gate 收紧；P8b/P8c/Tier H/§9.2；重开 #58–#66
- 跨域终态化（C11）另立

## 6. 验收提示

**PASS：** 仅 discovery 文档；§3 处置与 §4 候选项区分清楚；无新旗标；C10 仍不能 pass。  
**FAIL：** 把候选项写成已裁决豁免、把回到热路径写成 reuse-observe、或夹带代码/旗标。
