# Phase C §8.3 首刀工程 — 允许入口三态处置账本（书面范围；docs-first）

> 书面范围：`phase_c_83_allowed_entry_disposition`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-83-allowed-entry-disposition-scope.md`（本页）+ 正文 `phase-c-83-allowed-entry-disposition.md`。  
> 日期：2026-09-26  
> 前置：PR #67 / `5282a5d6`（§8.3 产品确认 + 收敛书面范围已合入 `origin/main`）  
> 对照：`execution-entry-inventory.md` FC-08 / FC-08d；`fc-04-next-soft-observe.md`；`phase-c-83-product-confirmation.md`  
> 本刀默认 **docs-only**。不改 `src/`、不新开观察旗标、不调用 `applyPreflightToTools` / `armCompletionHold`、不打开 enforce / live invoke / Fabric default-on。主张天花板：`code-present`。不宣称 C10 pass。

## 1. 目标

在 §8.3 产品确认之后，用**文档刀**推进「旁路文档化 / 三态收敛」，且**不**踩禁止区：

1. 为**允许登记、且尚未用三态语言收口**的入口写明处置：`reuse-observe` | `exemption+break-glass` | `delete`（或显式「本行不适用预检三态」）。
2. 汇总已落地的 explicit reuse-observe（FC-01 / 03a / 03b / 05 / 06 / 07）与 FC-02 CTR 关闭前咨询，避免重复接线。
3. 把 C10 仍挡门的入口标成 **Owner 产品裁决候选项**（豁免+破玻璃 / 删除 / 另立范围），**不是**本刀自行升格，也**不是**再挂 soft-observe。
4. 登记 inventory 缺口：`knowledge.capability.invoke`（企业/知识面；非 live-connector）——本刀只做九字段 + 建议处置；**默认不**新开 `OPENBOT_*_PREFLIGHT_OBSERVE`。

## 2. 候选刀标题（给编排方）

**Phase C §8.3 / FC-09：允许入口三态处置账本（docs-only）**

若编排方改选「代码首刀」，唯一仍贴合「HTTP · node · enterprise 允许模块路径」且未禁止的候选见 §6（知识 capability invoke 观察接线）——**本页默认不批准该代码刀**；需另立范围。

## 3. 范围内（IN）

| 项 | 说明 |
| --- | --- |
| 处置账本正文 | 新建 `phase-c-83-allowed-entry-disposition.md`：已 reuse-observe 表 + 本刀拟收口表 + Owner 候选项 + 明确非刀 |
| Inventory 最小补丁 | `execution-entry-inventory.md`：§5 task-orchestration / §4 Fabric 补「预检三态」句；§10 增 `knowledge.capability.invoke` 一行（或脚注）；文末 FC-09 后记交叉引用 |
| FC-04 排序页交叉引用 | `fc-04-next-soft-observe.md` 末加「§8.3 后下一刀 = 处置账本，不是第 4 软观察」一句 |
| §8.3 产品确认交叉引用 | `phase-c-83-product-confirmation.md` 或 convergence-scope 最小后记一行（可选；不改 NO-GO 立场） |

### 3.1 本刀拟写入的处置（docs；非代码）

| 入口 | 拟处置 | 破玻璃 / 备注 |
| --- | --- | --- |
| task-orchestration（§5） | **exemption+break-glass** | `ORCHESTRATION_LIVE_INVOKE` 恒 false；shadow 强制 `invoke=false`/`enqueue=false`；破玻璃 = 翻常量或打开 dispatch/node/browser（**仍未授权**） |
| Fabric（§4） | **exemption+break-glass** | 默认关；破玻璃 = `OPENBOT_FABRIC_ENABLED` / `gateway.fabric.enabled`（**不得为观察打开**） |
| `knowledge.capability.invoke`（新登记） | **exemption+break-glass**（建议） | 源码声明：只读已物化元数据 + seat/quota/audit；**不做** live connector；破玻璃 = 另立「boundary-opening live-connector invoke」轨道（需显式签字）。备选（另立范围）：FC-03a 模式 reuse-observe |
| ConversationTask 整行预检三态 | **不适用 / 保持未收成** | FC-02 关闭前 delivery-hold 咨询保持 observe-handshake；**不**把 §6 整行写成 reuse-observe 或豁免 |

### 3.2 仅记账、不改处置（已落地）

| 入口 | 当前态 | 旗标（默认关） |
| --- | --- | --- |
| `/tools/invoke` | explicit reuse-observe | `OPENBOT_HTTP_TOOLS_INVOKE_PREFLIGHT_OBSERVE` |
| 企业 capability invoke | explicit reuse-observe | `OPENBOT_ENTERPRISE_CAPABILITY_INVOKE_PREFLIGHT_OBSERVE` |
| `node.invoke` | explicit reuse-observe | `OPENBOT_NODE_INVOKE_PREFLIGHT_OBSERVE` |
| ACP 进程内 turn | explicit reuse-observe | `OPENBOT_ACP_TURN_PREFLIGHT_OBSERVE` |
| inter-agent bus | explicit reuse-observe | `OPENBOT_INTER_AGENT_BUS_PREFLIGHT_OBSERVE` |
| ACP CLI + steer | explicit reuse-observe | `OPENBOT_ACP_CLI_STEER_PREFLIGHT_OBSERVE` |
| CTR delivery-close consult | observe-handshake（非预检三态整行） | `OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT` |

## 4. 范围外 / 禁止（OUT）

- ACP **stdio** 桥软观察刀；把 stdio 预检关系从 `unknown` 静默写成 reuse-observe
- **AOR core** 预检 import；为观察打开 Fabric
- Cron / subagent **新**软观察旗标；把「回到热路径」写成 explicit reuse-observe（FC-08d 仍有效）
- 本刀**自行**把 stdio / AOR / Cron·subagent 升格为 exemption 或 delete（仅可列为 Owner 候选项；需产品确认后另刀）
- enforce / live invoke / Gate 收紧；P8b / P8c / Tier H / §9.2 开工
- 重开有界 D #58–#66；改写 Phase C 五份冻结正文 / digests
- 宣称 C10 / C11 pass；主张高于 `code-present`
- 默认夹带 `knowledge.capability.invoke` 的 observe 接线（见 §6，需另立范围）

## 5. 成功标准

| 标准 | 判定 |
| --- | --- |
| 文档齐全 | 本范围 + 处置账本正文入库；inventory / FC-04 交叉引用最小 |
| 无新旗标 | diff 不含新 `OPENBOT_*_PREFLIGHT_OBSERVE` 或其它环境旗标 |
| 无代码 | diff 仅 `.kiro/specs/constitutional-governance-discovery/`（除非编排方另批 §6） |
| NO-GO / C10 | 不改写 final-acceptance；明确 **C10 仍不能 pass**（stdio / AOR / Cron·subagent 仍待 Owner 裁决或仍在三态外） |
| 非刀清单 | OUT 与产品确认 §4 对齐 |

## 6. 备选代码刀（默认不批；供编排方二选一）

**仅当**编排方明确要求「工程接线」且坚持 HTTP/node/enterprise 路径时：

| 项 | 内容 |
| --- | --- |
| 标题 | FC-03c：`knowledge.capability.invoke` observe-only preflight（default-off） |
| 模式 | 复制 FC-03a：`buildExecutionPreflight` 在 seat/grant/quota 通过之后、返回 outcome 之前；吞错；丢弃 allow 集；不改 ok/reason |
| 旗标 | `OPENBOT_KNOWLEDGE_CAPABILITY_INVOKE_PREFLIGHT_OBSERVE` |
| 文件 | `src/gateway/knowledge/capability-invoke-runtime.ts`（+ test）；inventory §10 行改为 explicit reuse-observe |
| 风险 | 新旗标；入口今日**无** live connector，观察收益低于 FC-03a；可能被审为「为登记而观察」 |
| 与本页关系 | **互斥优先**：先落地 docs 处置账本；若选择 exemption，则**不要**再挂本观察旗标 |

## 7. 风险

| 风险 | 缓解 |
| --- | --- |
| 把休眠编排 / 默认关 Fabric 写成豁免，被误读成「可忽略旁路」 | 破玻璃项写死为未授权；强调豁免的是**预检三态登记**，不是生产启用 |
| 提前豁免 Cron/subagent / stdio / AOR | 本刀禁止自行升格；只列 Owner 候选项 |
| 登记 `knowledge.capability.invoke` 却不定处置 → 扩大 C10 缺口 | 同刀必须带建议处置（默认 exemption+break-glass） |
| 与 FC-08d「仍 unknown」冲突 | 账本区分「文档复核仍 unknown」与「本刀新写入的豁免」；Cron/subagent Profile B 等**不**借本刀改写 |
| git fetch 不畅导致无法从干净 worktree 开 PR | 本调查轮次可只落本地草稿；合入 PR 由后续轮次在干净 `origin/main` worktree 执行 |

## 8. Owner 候选项（本刀不裁决；挡住 C10）

| 入口 | 允许的产品裁决（非 soft-observe） | 禁止 |
| --- | --- | --- |
| ACP stdio 桥 | exemption+break-glass / delete / 另立范围 | 再挂软观察 |
| AOR（`packages/aor-core`） | exemption+break-glass / delete / 另立范围（适配器侧已有 FC-01 / 热路径） | core 内 import 预检；Fabric-on-for-observe |
| Cron / subagent | exemption+break-glass（若产品接受「无已证旁路」）/ delete / 另立范围 | 新 soft-observe 旗标；「回到热路径 = reuse-observe」 |

## 9. 主张等级与验收

主张：docs-only / `code-present` 交叉引用。  
**PASS：** IN 文档入库；OUT 未越界；C10 仍不能 pass 写明；无新旗标无 `src/`。  
**FAIL：** 任何 soft-observe 新旗标、stdio/AOR/Cron 自行升格、C10 pass、整段 D GO、或冻结正文改写。

## 10. 验收交接

独立验收 bot：按本页成功标准 + `phase-c-83-product-confirmation.md` 非授权清单审阅。  
Material Owner 不自合并。本调查轮次若仅有本地草稿、无 PR，则交接「推荐刀 + 风险」供编排方批准后再开 PR。
