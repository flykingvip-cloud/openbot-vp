# Phase C — C11 终结协议倡议章程（chartered；工程未启动）

> 章程 id：`phase_c_c11_finalization_charter`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-c11-finalization-charter.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 基线：`main` @ `8babbd4c90618d6502033f51dace6f32709f812b`  
> 前置：`phase-c-c11-written-scope-acceptance.md` + `phase-c-c11-start-order.md`  
> 权威措辞来源：Doc01 §7.1；Doc02 §4 原则 6 / §8.3；`authority-evidence-baselines.md` §1；`phase-c-83-product-confirmation.md` §6  
> **状态：initiative chartered；engineering implementation not started。**  
> 本页只改 discovery 文档。**不**实现协议于 `src/`。**不**授权跨域单写。**不**宣称 C11 pass。

## 1. 一句话

C11 = **域内单一终态写权威 + 显式跨域终态化协议**。本章程把 #69 stub 升格为可引用的倡议包：写清域边界、协议 doc-level 要求、禁跨域单写、与既有模块关系、以及明确非目标。整体 C11 **仍非 pass**；达标路径是补齐各域权威清晰度与跨域协议，**不是**建设全局完成机。

## 2. 最终目标措辞（核定；不得回退）

> **`Domain-local single authority + explicit cross-domain finalization protocol`**  
> （域内单一权威 + 显式跨域终态化协议）

| 旧谬误（已废弃） | 正确需要 |
| --- | --- |
| 「跨域单一写权威」/ 单一全局完成状态机 | 每域**一个**终态写权威；跨域组合经**显式终态化协议**；上层可有**只读聚合判断**，**永不**成为通用写者 |

技能交付、普通聊天、协作任务、演进、发布是**不同域**。强行统一写权威会造成假性对齐与跨域误写。

## 3. 域内权威（Domain-local authority）

| 原则 | 要求 |
| --- | --- |
| 一域一写 | 终态 / 权威写入只在**本域**账本与协议内定义 |
| 域外只读 | 域外读者只读投影或显式订阅；不得回写他域终态 |
| 局部权威不合成 | ConversationTask / collaboration / subagent / publish 各有局部权威时，**不得**假装已合成单一写权威 |
| 完成权按域 | 「完成 / 关闭 / 作废」的权威落点必须可指认到域；禁止隐式跨域副作用完成 |

域级现状（继承 Doc01 §7.1 / authority-evidence；本章程**不**改判定）：

| 域 | 判定 | 说明 |
| --- | --- | --- |
| 技能交付完成 | `near-conforming` | 契约 + 校验回执约束完成宣称 |
| 演进完成 | `near-conforming` | 共享判断 + server-ledger replay；回执≠证明 |
| 普通聊天回合 | `partial` | Pi 包络存在，完成权仍分散 |
| ConversationTask / collaboration / subagent / publish | 各有局部权威 | 不得追求跨域统一写者 |
| **跨域终态化协议** | **缺失（协议层 fail）** | 缺协议，不是「尚未建成的全局写者」 |
| **跨域单一写权威** | **非目标** | 不得作为 C11 成功判据 |

## 4. 显式终态化协议 — doc-level 要求（handshake / consult 形状）

本条是**章程要求**，不是实现规格，也不是开工令去写 `src/`。

跨域可见的「完成 / 关闭 / 作废」必须经**公布的终结协议**，至少在文档层满足：

| 要求 | 说明 |
| --- | --- |
| 显式身份 | 谁（主体 / 租户 / 会话 / 任务 id）在主张终态 |
| 显式因果 | 终态相对哪条前置证据 / 回执 / 域内状态转移 |
| 可审计证据 | 可回放、可指认；回执 ≠ 证明（继承 Doc02 ADR 候选） |
| Handshake 形状（doc） | 域 A 提出终态主张 → 相关域 **确认 / 拒绝 / 延后**；无静默默认同意 |
| Consult 形状（doc） | 只读咨询他域状态（例：关闭前 delivery-hold 咨询）**不得**升级为对他域的写；咨询记录 ≠ 跨域写权威 |
| 禁止隐式副作用 | 不得靠「写了别的账本所以这边也算完成」完成跨域终态 |

**既有 consult 先例（复用，不新造第五套故事）：**

- FC-02 / ConversationTask：`consultDeliveryHoldForClose`（旗标 `OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT`）— 打开时**记录咨询**，不推迟 CTR `closed`，**不**产生跨域写者（见 `authority-evidence-baselines.md`）。
- 本章程**不**授权把该 consult 扩成通用跨域 writer，也**不**要求本刀改旗标默认值。

## 5. 禁止：跨域单一写权威

| 禁止项 | 说明 |
| --- | --- |
| 跨域单点写 | **禁止**任一组件对多个域的权威状态拥有单点写权限 |
| 「一个 writer 关所有账本」 | **禁止** |
| 全局 completion writer | **禁止**作为 C11 成功形态或实现目标 |
| 跨账本事务伪装 | 跨账本事务 / 分布式锁 / 统一 write leader **不**因本章程获批 |
| 上层聚合变写者 | 只读聚合判断若开始回写多域终态 = **越权**；须另立书面范围且默认拒绝 |

## 6. 与 CTR / ConversationTask / 既有模块的关系（reuse；无新包）

| 模块 / 面 | 关系 | 本章程要求 |
| --- | --- | --- |
| ConversationTask / CTR | 域内局部权威；关闭路径已有 consult 先例 | **复用**既有存储与关闭语义；不新建 conversation-task 包 |
| execution-preflight | 执行链门面之一 | 继续作域内/入口治理；不变成跨域写者 |
| task-orchestration | 编排旁路 / 休眠语义 | 不借 C11 打开 live invoke；不设跨域写 |
| Fabric | 可选执行面；默认关 | 不为观察 / 不为终态化打开 Fabric |
| evolution / server-ledger | 演进域 near-conforming | 保持域内权威；不并入全局完成机 |
| AOR / collaboration-core | 局部状态机 | 不得合成跨域写者 |
| constitutional-contracts / Registry / Conformance / Runtime | 有界 D 脚手架 | **不**新开包；**不**把 C11 绑到 Meta-Schema GO |

**原则：** 优先复用既有模块与 consult/handshake **文档形状**；**禁止**为 C11 新建独立协议工程包。

## 7. 非目标（本倡议明确不做）

| 非目标 | 说明 |
| --- | --- |
| Meta-Schema GO | Doc02 §8.3：NO-GO 后停止 Meta-Schema / 四产品 / contracts 工程里程碑 |
| P8b enforce | 不批准；不借章程打开 Gate 收紧 / Path enforce |
| soft-observe 新刀 | 不新开观察旗标；不把「回到热路径」写成 reuse-observe |
| C11 pass 宣称 | 章程 ≠ pass；协议层仍缺失 |
| C10 捷径 | C11 **不**作为 C10 pass 捷径；C10 仍按其主张门判定 |
| 整段 Phase D | Doc02 整段 D 当前不批准；有界 D 不重开为 C11 载体 |
| `src/` 协议实现 | 本刀 docs-only；工程实现须未来独立接受 + 开工令 |

## 8. 状态与主张

| 项 | 状态 |
| --- | --- |
| 倡议 stub（#69） | 已由本章程**取代为正式章程指针** |
| 倡议章程（本页） | **chartered**（2026-09-26 Asia/Shanghai） |
| 书面工程实施范围 / 任务拆解 | **未开**（残差见 start-order §8） |
| 代码 / 旗标 / 迁移 / 新包 | **未启动** |
| Owner 工程开工授权 | **无**（需未来独立批准） |
| 主张天花板 | **`code-present`**（文档事实） |
| C11 pass | **否** |
| Phase C Decision | **NO-GO**（不变） |
| C10 | **仍不能 pass** |

## 9. 与 §8.3 / C10 的边界

- 运营路径仍为 Doc02 **§8.3**：继续 preflight / ConversationTask / orchestration + 旁路文档化。
- C10 主张门进度见 `phase-c-83-c10-claim-gate-progress.md`；登记迭代证据 ≠ C10 pass。
- 本章程入库 **不**翻转 NO-GO，**不**闭合 C10，**不**打开整段 D。

## 10. 验收提示（给后续独立审阅；本 PR 不呼叫）

**PASS（章程形态）：**

1. acceptance + start-order 与章程同 PR 入库。  
2. 措辞锁定域内权威 + 显式终态化；明确禁跨域单写；复用既有模块、无新包。  
3. 状态写明 **chartered / engineering not started**；未宣称 C11 pass。  
4. 非目标含 Meta-Schema GO / P8b enforce / soft-observe；无 `src/` 协议实现。  
5. C NO-GO / C10 不能 pass / 整段 D 不批准 站桩仍在。

**FAIL：** 夹带协议实现；授权跨域单写；把章程写成 C11 pass / 已开工；或打开上列非目标。
