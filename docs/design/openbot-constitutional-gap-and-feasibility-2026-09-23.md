# 《OpenBot 对照 Constitutional Meta-Schema v1.0：全栈盘点与可行性分析》

> **第二轮专家评审修订（2026-09-23）**  
> 第二轮裁决：修订已实质到位；计划现为**可控的治理发现项目**。正确下一步是**两周事实收敛 + 冻结 web_read 只读切片的可度量合同**——**不是**创建 schema 或新包。  
> 第一轮保留项（别名禁令、旁路显式化、权威/证据分级、双 Profile、只读影子切片）继续有效。  
> 配套执行方案：`02-openbot-transformation-execution-plan.md` · 修订说明：`REVISION-NOTES-2026-09-23.md`。

| 字段                                     | 值                                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档性质                                 | 架构评审用：目标态说明 + 现状盘点 + 可行性与风险规避                                                                                          |
| 读者                                     | OpenBot 领导层 / 架构专家（可不依赖先前 PR 正文即可开会）                                                                                     |
| 评估日期                                 | 2026-09-23                                                                                                                                    |
| 修订                                     | 2026-09-23 第二轮（C11 目标重写 · BaselineManifest · 授权边界对齐）                                                                           |
| 评估快照（示例初始冻结，非六周恒定常量） | 见 §3 BaselineManifest；本次评审快照：`main` @ `f1c7efece…` · 生产 seq **96**                                                                 |
| 盘点源                                   | PR [#1249](https://github.com/gmood2008/openbot/pull/1249) 文档 `docs/design/openbot-constitutional-meta-schema-gap-assessment-2026-09-23.md` |
| 授权边界                                 | **只盘点与可行性分析；不授权大重构；不预设四个独立工程产品；不授权 schema/新包创建于 Phase A**                                                |

## 授权状态（与 Doc 02 对齐）

| Phase                                                    | Status                                        |
| -------------------------------------------------------- | --------------------------------------------- |
| **A**                                                    | **正式批准启动**                              |
| **B 设计**                                               | **批准**                                      |
| **B 编码**                                               | 补齐目标面 / 标注语料 / 阈值 / 报告落点后批准 |
| **C**                                                    | **保留独立评审权**（不预提交 GO）             |
| **D / constitutional-contracts / 真实 Path / Gate 收紧** | **当前均不批准**                              |

---

## 1. 文档目的

本文为专家团队提供一份**自洽**的共享上下文，回答三件事：

1. **要去哪里**：企业 Agent OS 的治理目标是什么；Meta-Schema 作为手段应扮演什么角色。
2. **现在在哪**：对照十个核心对象与 C1–C12，当前代码 / 生产真实存在什么、成熟度如何（须标清动态三基线 / BaselineManifest）。
3. **能不能改、怎么改才不炸**：哪些方向可行，哪些一次性动作不可行，十大盲目改造风险如何规避；工程化须先通过「失败场景 + 量化收益」决策门。

本文**不发明**新的代码事实；对象落点、成熟度、符合性判定均摘自上述基线评估与专家复核。架构建议是在这些事实之上的综合判断。

**一句话论旨（专家要求保留）：** 继续「防止错误统一」；纠正「再建设一套更高层统一系统」的冲动。需要的是把既有治理**收敛为一条可证明的执行链**，而不是再加一个完整新世界。

---

## 2. 目标架构：要去哪里

### 2.1 正式产品定位与治理手段

| 层级                | 表述                                                                 | 说明                                                                                       |
| ------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **正式产品定位**    | **企业 Agent OS**                                                    | Gateway 控制面 + 多执行面 + 安全/演进/编排等治理包络；复杂度应长在网络规模与可证明执行链上 |
| **治理目标 / 透镜** | Constitutional Meta-Schema v1.0 所描述的 Governed AI Dynamic Network | Node + Bridge + Path 等对象与 C1–C12 不变量，用作**对照与收敛手段**                        |
| **非自动终态**      | Meta-Schema / Conformance / Registry / Runtime「四个工程产品」       | **不是**已证明的产品命运；须用失败场景与相对既有机制的边际收益**挣得**席位                 |

OpenBot 不必先建成「宪法产品套件」才算企业 Agent OS。优先路径是：收敛执行预检 / ConversationTask / orchestration / Fabric（及既有账本）为**可证明的执行链**；仅当证明「仅收敛不够」时，才引入机器可读 Meta-Schema 与只读契约包。

### 2.2 治理透镜浓缩（十六句量级，开会可口述）

| 维度                             | 浓缩句                                                                                                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identity**                     | 每个可治理对象有可追溯身份；Profile A（Personal Local）与 Profile B（Managed Enterprise）是两套互斥信任合同，不得折成一种身份。                                                              |
| **Contract**                     | 每个核心对象有合法契约；契约互引用，而非各子系统各写一套互不认识的 zod/协议常量。                                                                                                            |
| **Ownership**                    | 完成权、状态终态、资源归属有显式所有者；Agent / 模型不得自行宣布「已完成」。                                                                                                                 |
| **Authorization**                | 授权是一次可审计的决定（可多层合成），不是「碰巧过了某一扇门」。                                                                                                                             |
| **Valid Path**                   | 执行必须落在被选中的合法轨迹（Path）上；**Workflow ≠ Path**——Workflow 是合法空间，Path 是一次合法轨迹。（ADR 候选）                                                                          |
| **Evidence**                     | 证明与回执分级；**回执 ≠ 证明**。（ADR 候选）                                                                                                                                                |
| **Provenance**                   | 血缘可追溯，且 schema 与执行环消费一致，而非三套互不覆盖的 provenance。                                                                                                                      |
| **Version**                      | 对象有用户可见的版本语义，而非仅子系统常量（如 `PROTOCOL_VERSION = 3`）。                                                                                                                    |
| **Fail Closed**                  | 未建模 / 未决 / 权威缺失 → 关闭；但**必须分 Profile 设计**，不可用 Managed 的关闭语义直接覆盖 Personal Local。                                                                               |
| **No Hidden Bypass**             | 所有有副作用入口纳入同一治理可见面；结构旁路与显式 break-glass 都必须登记。                                                                                                                  |
| **Single Authority（C11 目标）** | **域内单一终态写权威 + 显式跨域终态化协议**；上层可有**只读聚合判断**，**绝无**通用全局写者。技能交付、聊天、协作任务、演进、发布是**不同域**。（见 §7.1；旧「跨域单一写权威」为已纠正谬误） |
| **Explicit Transition**          | 状态转移表显式、禁止捷径；模型完成语气 ≠ 状态转移。                                                                                                                                          |
| **Capability ≠ Implementation**  | 「已安装 / 已配对 / 已注册」≠「已授权可执行」；**插件安装 ≠ 能力授权**。（ADR 候选）                                                                                                         |
| **运行时环**                     | Observe → Evaluate → Select Path → Gate → Execute → Verify → Update State → Observe。                                                                                                        |
| **契约包装（可选，当前不批准）** | 若 Phase C 独立裁决 GO：优先单一 `constitutional-contracts` 包；Runtime 门面应复用 orchestration / preflight。**当前不批准**创建 schema/新包。                                               |
| **Network of Networks**          | Component 自身可为 Node（递归）；个人网关与托管企业不得被收成「一个共享总线」。                                                                                                              |

### 2.3 十个核心对象（速查）

Node、Bridge、Path、Dataset、Decision、State、Component、Network、Protocol、Governance。  
基础对象：Model、Function、Resource、Event、Evidence、Identity、Capability。

---

## 3. 三基线模型与 BaselineManifest（必须动态再生）

符合性与成熟度主张必须标明所属基线；**三者不是同一状态**。

| 基线         | 标识方式                                                                             | 用途                                     |
| ------------ | ------------------------------------------------------------------------------------ | ---------------------------------------- |
| **产品合同** | README / VISION / SECURITY.md（及明示的产品承诺）；以 `productContractRevision` 记录 | 「应当如何」                             |
| **当前代码** | `origin/main` @ **当时** `mainSha`（见 Manifest）                                    | 「仓库里有什么」                         |
| **当前生产** | release ledger **当时** `productionSeq` + gateway/UI SHA                             | 「线上跑什么」：与 main 前沿**不必一致** |

### 3.1 BaselineManifest（阶段验收时再生，禁止手抄旧 SHA 当六周常量）

`main @ f1c7efece…` 与生产 `seq96` 是**本轮评审的快照**，**不是**六周计划的固定常量。main 与生产会前进。

**Phase A 必须产出 BaselineManifest**，并在**每次阶段验收时再生**（非手抄旧 SHA）。进入 Phase B 前、进入 Phase C 前须**再次冻结**。

最低字段：

```yaml
assessedAt:
productContractRevision:
mainSha:
productionSeq:
productionGatewaySha:
productionUiSha:
evidenceSource:
```

主张分级标签：

| 标签                | 含义                                 |
| ------------------- | ------------------------------------ |
| `code-present`      | 代码基线上存在类型/模块/契约         |
| `runtime-enabled`   | 默认或常见配置下可被执行路径触达     |
| `production-proven` | 已在**当时**生产基线上被验证或可观测 |

**禁止**把 `code-present` 说成 `production-proven`，也禁止用产品合同叙事覆盖默认部署事实（例如「Agent OS / Fabric = 治理内核」≠ Fabric 默认 OFF）。

### 3.2 本轮评审的示例初始冻结（仅作快照标签）

| 字段                   | 本轮评审快照（示例）                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `mainSha`              | `f1c7efece96d68375bf4b7fb57e77908fedfdd6c`（`Evolution: add server ledger completion replay (#1246)`） |
| `productionSeq`        | **96**                                                                                                 |
| `productionGatewaySha` | `1617926868…`（截断；完整值写入 Manifest）                                                             |
| 说明                   | **仅本轮评估快照**；后续验收以再生 Manifest 为准                                                       |

---

## 4. 现状一句话

今天的 OpenBot 是 **「Gateway 控制面 + Pi 嵌入式 Agent 回合 + 多套可选/休眠治理平面」** 形态下的**企业 Agent OS 雏形**，**不是**已经按 Node / Bridge / Path 组网、并由单一宪法约束的 Governed AI Dynamic Network Runtime。

依据（评估原文 + 专家复核修正）：

- 十个核心对象**没有一个**以宪法名字与不变量存在于代码；最近对应物均为松散映射，且常一词多义。
- **默认聊天不经过 Fabric**：`src/fabric/feature.ts` 默认关闭；`src/agents/` 不调用 `policy-runtime.decide()`。
- **默认 Pi 热路径已有多层治理包络**，但**缺少**跨执行面统一的对象模型、合法轨迹标识和**域内权威 + 跨域终态化协议**（详见 §5、§7.1）。
- 至少四套执行故事并行：嵌入式 Pi、可选 Fabric 图、AOR Orchestrator、默认关闭的 `task-orchestration`（`ORCHESTRATION_LIVE_INVOKE = false`）；另有 evolution v1（`src/diagnosis/`）与 v2（`packages/evolution-core`）双演进状态。
- C1–C12 **无一**可标全局 `pass`；C5 / C10 为 `fail`；**C11 须按域拆分**（见 §7），且目标态已重写为「域内单一权威 + 显式跨域终态化」。
- Meta-Schema / Registry / Runtime / Conformance Engine **均不存在**为统一产品。是否包装为独立工程产品，属 Phase C 之后的可选路径，**非当前默认终态**；**当前不批准**启动 schema/新包。

---

## 5. As-is 架构图（热路径 vs 旁路）

```text
Channel / CLI / Gateway RPC "agent"
        │
        ▼
resolveAgentRoute + sessionKey          src/routing/
        │
        ▼
getReplyFromConfig / agentCommandFromIngress
        │
        ▼
runEmbeddedPiAgent                      src/agents/pi-embedded-runner/run.ts
        │
        ├─ 治理包络（已有，非「裸执行」）— 集中于
        │     src/agents/pi-embedded-runner/run/attempt.ts
        │     src/agents/execution-preflight/
        │     · tools / policy filter
        │     · execution preflight
        │     · skill contract + validator
        │     · delivery evidence gate
        │     · completion-claim rewrite
        │     · user-visible output gate
        │     · exec approval / allowlist / sandbox
        ├─ createOpenClawCodingTools    src/agents/pi-tools.ts
        ├─ buildEmbeddedSystemPrompt    src/agents/system-prompt.ts
        └─ createAgentSession + prompt  @earendil-works/pi-coding-agent
                │
                └─ 工具循环在 Pi agent core 内；跨执行面对象模型 / Path / 域间终态化协议仍缺失

旁路（默认不包住上面这条热路径；聊天不经 Fabric）：
  Fabric 图执行          src/fabric/                 默认 OFF
  AOR Orchestrator       packages/aor-core           外部任务图，经 HTTP/RPC
  task-orchestration     src/task-orchestration      dormant，live invoke = false
  /tools/invoke          src/gateway/tools-invoke-http.ts
  ACP runtime            src/acp/                    配置可选
  Cron / Subagent        仍回到 runEmbeddedPiAgent
  node.invoke            NodeRegistry 已配对设备     不是 Agent
  企业 capability invoke src/gateway/enterprise-data/
  inter-agent bus        src/organization/inter-agent-bus.ts
```

热路径可收成：

```text
Observe(inbound) → Route(session) → Preflight/policy filter(tools)
  → Pi prompt/tool loop → optional delivery gate → session transcript
```

这**不是**完整宪法环。最大空洞是跨执行面的 **Select Path** 与作为统一对象的 **Verify**；Gate 与 Execute 在 Pi 包络内最实，但权威按域分裂、且不覆盖全部旁路——正确目标是**域内单一写权威 + 显式跨域终态化**，而非假想的全局完成状态机。

**正确表述（专家核定）：**

> 默认 Pi 热路径已有多层治理包络，但缺少跨执行面统一的对象模型、合法轨迹标识，以及域内权威与跨域终态化协议。

**禁止表述：**「默认 Pi 热路径不受治理 / 裸执行」。

`src/runtime.ts` 仅为 CLI 的 log/exit 包装，**不是** Agent OS / 宪法 Runtime。

---

## 6. 十个核心对象成熟度盘点

成熟度用语（与评估一致）：

| 级别                 | 含义                                                                    |
| -------------------- | ----------------------------------------------------------------------- |
| `none`               | 仓库里没有对应类型、模块或可执行契约                                    |
| `partial`            | 有相近机制，但对象边界、字段或权威不完整                                |
| `present-ungoverned` | 能力在热路径上真实存在，但缺跨对象身份/契约/证据/单一权威               |
| `near-conforming`    | 在**自己的子系统**内已有显式契约/转移/失败关闭/证据区分；仍不是宪法对象 |

| 对象           | Exists?              | Maturity                                           | 最接近落点（摘要）                                                                                                                   | 关键错位                                                                 |
| -------------- | -------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **Node**       | 多个同名不同物       | `partial`                                          | 设备 `NodeRegistry`；Fabric `RuntimeNode`；`agents.list`；subagent/cron；企业 `AgentAsset`；AOR `PlannedStep`；CogniWeave `NodeType` | Agent 只是实现之一（与元模式一致），但无上位类型；**禁止**一次重命名收编 |
| **Bridge**     | 无统一 Bridge 运行时 | `partial`                                          | `bridge-mvp.md`（B1/B2 **未批准编码**）；channels；routing bindings；inter-agent bus；enterprise invoke；Fabric wiring               | 连接性有，契约/映射/失败语义分裂                                         |
| **Path**       | 无合法执行轨迹对象   | `none`（宪法 Path）/ 路由身份 `present-ungoverned` | sessionKey；休眠 `PathKind`；Fabric/AOR 图；execution-chain-provenance                                                               | **Workflow ≠ Path** 已反向成立；sessionKey 是路由不是授权边界            |
| **Dataset**    | 有知识/记忆/导入     | `partial`                                          | knowledge source-descriptor、lineage store、`KnowledgeEvidence`、memory trustScore                                                   | 字段分散，执行环不强制消费统一 Dataset                                   |
| **Decision**   | 多个互不兼容         | `partial`                                          | Fabric `PolicyDecision`；evolution `evaluateExperiment`；collaboration decision；选模；AOR selector                                  | 无一同时绑定 Model+Function+Data+Policy+Evidence                         |
| **State**      | 多台显式 FSM         | `partial`                                          | evolution-core 状态机；diagnosis v1；ConversationTask；collaboration；session；subagent                                              | 聊天仍由模型文本结束；v1/v2 并存；**各域 FSM 不得假装为全局完成机**      |
| **Component**  | 可加载单元           | `present-ungoverned`                               | plugins、skills、channels、AOR Skill、evolution surfaces                                                                             | 插件 = 受信计算基座，不是可递归治理 Node                                 |
| **Network**    | 单 Gateway 多通道    | `partial`                                          | gateway server、NodeRegistry、channels、inter-agent bus、routing                                                                     | 无网络状态对象 / 跨 Gateway 网格；Profile A 反对共享总线误用             |
| **Protocol**   | 多套线协议与 TS 契约 | `partial`                                          | `PROTOCOL_VERSION = 3`；method-scopes；协作策略 1.1；Bridge envelope 仅文档                                                          | 无 P0–P6 优先级阶梯；非「合法边界优先于工作流」                          |
| **Governance** | 面很宽，权威分裂     | `present-ungoverned`                               | SECURITY.md、security-profile、tool-policy、exec-approvals、enterprise policy、capability-governance、Fabric（可选）、evolution      | 身份/授权/风险/人工/审计均有落点，但未盖住十对象；两 Profile 互斥        |

基础对象摘要：Model / Function / Capability / Event / Resource 多为 `present-ungoverned` 或 `partial`；Evidence 局部强（evolution proof vs receipt）；Identity 在 Profile A 设备侧接近 `near-conforming`，但未贯穿十对象。

---

## 7. C1–C12 符合性矩阵摘要

判定：`pass` = 默认热路径对主要对象成立；`partial` = 仅指名子系统；`fail` = 与不变量相反或无可执行落点。  
**所有判定默认相对「当前代码」基线（Manifest 中的 `mainSha`）；若声称生产，须另标 `production-proven` 并对应当时 `productionSeq`。**

| ID      | 不变量                        | 判定                 | 一句话差距                                                                                              |
| ------- | ----------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------- |
| C1      | Identity                      | `partial`            | 设备/Gateway/席位真；Agent/会话/工具/知识/Fabric 节点无同一种身份                                       |
| C2      | Contract                      | `partial`            | 多套契约互不引用                                                                                        |
| C3      | Ownership                     | `partial`            | 聊天「谁拥有完成」无单一所有者                                                                          |
| C4      | Authorization                 | `partial`            | 多层门并联；嵌入式不走 Fabric；`/tools/invoke`、`node.invoke` 另面                                      |
| **C5**  | **Valid Path**                | **`fail`**           | **不存在必须被选中才能执行的合法 Path**                                                                 |
| C6      | Evidence                      | `partial`            | evolution 区分证明/回执；普通聊天无对等证据                                                             |
| C7      | Provenance                    | `partial`            | 执行链 / 知识 / 发布三套 schema，不覆盖每次工具调用                                                     |
| C8      | Version                       | `partial`            | 仅子系统版本常量，无全局对象版本                                                                        |
| C9      | Fail Closed                   | `partial`            | 局部成立（Gate 0、Fabric 未决 DENY、evolution、发布门）；聊天默认不走 Fabric DENY；Profile A 沙箱默认关 |
| **C10** | **No Hidden Bypass**          | **`fail`**           | **结构旁路（热路径绕过 Fabric）+ 显式 dangerous\***                                                     |
| **C11** | **域内单一权威 + 跨域终态化** | **按域拆分（见下）** | **禁止再用「跨域单一写权威 / 全局完成状态机」叙事**                                                     |
| C12     | Explicit Transition           | `partial`            | evolution/协作有转移表；Agent 回合无宪法环状态枚举                                                      |

### 7.1 C11 目标重写与域级拆分（第二轮核定）

#### 最终 C11 目标措辞

> **`Domain-local single authority + explicit cross-domain finalization protocol`**  
> （域内单一权威 + 显式跨域终态化协议）

#### 已纠正的谬误

| 旧谬误（已废弃）                       | 为何错                                                                                       | 正确需要                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 「跨域单一写权威」/ 单一全局完成状态机 | 技能交付、普通聊天、协作任务、演进、发布是**不同域**；强行统一写权威会制造假性对齐与跨域误写 | 每域**一个**终态写权威；跨域组合经**显式终态化协议**；上层可有**只读聚合判断**，**永不**成为通用写者 |

#### 域级现状

| 域                                                    | 判定                        | 说明                                                               |
| ----------------------------------------------------- | --------------------------- | ------------------------------------------------------------------ |
| 技能交付完成（skill delivery completion）             | `near-conforming`           | 子系统内契约 + 校验回执约束完成宣称 → 域内权威较清晰               |
| 演进完成（evolution completion）                      | `near-conforming`           | 共享判断 + server-ledger replay；回执≠证明已显式                   |
| 普通聊天回合（ordinary chat turn）                    | `partial`                   | Pi 包络 + 预检/输出门存在，完成权仍分散                            |
| ConversationTask / collaboration / subagent / publish | 各有**局部权威**            | 不得假装已合成单一写权威，也不得追求跨域统一写者                   |
| **跨域终态化协议**                                    | **缺失（`fail` 于协议层）** | 缺的是显式 finalization protocol，**不是**「尚未建成的全局写权威」 |
| **跨域单一写权威**                                    | **非目标（已纠正谬误）**    | 不得作为 C11 成功判据                                              |

近期收敛（仍不足以整体 `pass`）：契约化技能完成受 validation receipt 约束；演进完成共享判断 + server-ledger 可回放。整体 C11 **仍非 pass**——达标路径是补齐各域权威清晰度与跨域终态化协议，而非建设全局完成机。

**矩阵结论：** 无一全局 `pass`。最接近的是 C9 / C6 的局部实现，以及 C11 在技能交付 / 演进域的 `near-conforming`。**C5、C10、以及 C11 的「终态化协议缺失」是现在若盲改最容易被假性「对齐」破坏的三条。**

---

## 8. 改造可行性分析（核心）

### 8.1 为什么方向可行（战略正确）

| 论点                                             | 评估支撑                                                                                                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 复杂度应长在网络规模与可证明执行链，而非规则堆叠 | 现状已是「多套门 + 多本账 + 多旗标」；继续堆策略无法收敛到 Valid Path / 域内权威 + 跨域终态化                                                                                     |
| Capability ≠ Implementation                      | `SECURITY.md` 已区分插件受信基座与操作者护栏；企业能力治理另账——要求显式化这一区分，而非抹平                                                                                      |
| Workflow ≠ Path                                  | 现状已有五套「流程」词（Lobster / Fabric / AOR / 休眠编排 / 知识 kind）；禁止把它们收成 Path，正好纠正错误收敛                                                                    |
| 局部已有「准宪法」碎片可复用                     | evolution：显式转移、回执≠证明、authority recheck；交付预检；发布 forward-only；Gate 0 双 Profile；task-orchestration 影子观察面——适合作为**对照样板 / 切片复用面**，不是整仓模板 |
| 企业 Agent OS 与现产品契合                       | 单 Gateway 多通道 + 可选远程 Gateway + 配对设备，天然可演进为受治理网络；前提是先词典与执行链收敛，后（有条件）契约包                                                             |

因此：**强化企业 Agent OS、用 Meta-Schema 透镜收敛既有治理在战略上可行**；与仓库已投资的演进账本、预检、安全 Profile、orchestration 影子路径同向。Meta-Schema 本身须**挣得**工程席位，而非默认开工。正确下一步是 **Phase A 两周事实收敛 + 冻结 web_read 只读切片合同**，不是建 schema。

### 8.2 为什么下列动作不可行（战术禁止）

| 不可行动作                                         | 原因（评估事实）                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **一次性按元模式重写**                             | 会同时撞击 `src/agents/`、`src/gateway/`、`src/fabric/`、`packages/evolution-core` 等热点；C5/C10/C11 终态化协议尚未有可执行落点可「对齐」 |
| **把 Agent 重命名为 Node**                         | 设备 Node、Fabric RuntimeNode、AOR SDK「node」、CogniWeave NodeType、编排 `nodeId` 已占名                                                  |
| **默认打开 Fabric 包住一切**                       | Fabric 默认 OFF 是产品合同                                                                                                                 |
| **Registry 大合并**                                | 十余本登记簿职责不同；合并会使「已安装插件」看起来像「已授权能力」                                                                         |
| **把 sessionKey 涂装成 Path**                      | `SECURITY.md` 明确定义 sessionKey 为路由控制，非授权边界 / 合法轨迹                                                                        |
| **把 Workflow 收成 Path 空间**                     | 会把非法或未治理轨迹固化为看似合法的图                                                                                                     |
| **一套 Fail Closed 打穿两 Profile**                | Managed vs Personal Local 是两份合同                                                                                                       |
| **实现未批准的 Bridge MVP**                        | 设计文档写明 B1/B2 未批准编码                                                                                                              |
| **把 Pi 循环重命名为宪法 Runtime**                 | 掩盖跨执行面 Select Path / Verify 空洞；也否认已有治理包络                                                                                 |
| **追求「跨域单一写权威」/ 全局完成状态机**         | **已纠正谬误**；会抹平技能/聊天/协作/演进/发布的域边界                                                                                     |
| **预设四个独立工程产品并先建长周期再拿运行时反馈** | 专家**不批准**；工程化须先过 Phase C 独立裁决                                                                                              |
| **Phase A 创建 schema 或新包**                     | 第二轮明确：A 只产 ≤4 份事实文档；不授权 schema/package                                                                                    |
| **以 path=unset 单独作为进入热路径收紧的成功门**   | 报告缺口 ≠ 已有合法 Path；真实 Path / Gate 收紧**当前不批准**                                                                              |

### 8.3 可行路径：先收敛，后有条件工程化

推荐策略组合（对应配套方案 Phase A–D；**仅 A 正式批准启动，D 当前不批准**）：

1. **事实收敛（≤2 周，已批准启动）**：术语 ADR、执行入口清单、权威/证据 + BaselineManifest、web_read 影子切片设计——**仅四份文档**，停止并行架构叙事；**不**建 schema/新包。
2. **只读垂直切片（设计已批准；编码待合同齐备）**：首切面冻结为 **`web_read`**；复用 `task-orchestration` shadow（invoke=false / enqueue=false）；v1 **不写生产账本**。
3. **硬决策门（C 保留独立评审权）**：输出仅 **GO / NO-GO / REVISE**；**不预提交 GO**。
4. **有界工程化（当前不批准）**：`constitutional-contracts`、真实 Path、Gate 收紧均待 C 独立 GO 之后另立授权。
5. **Strangler + 旁路显式化**：新观察/门面可挂；默认聊天仍 Pi；旧旁路逐条显式化后才谈收紧（收紧本身当前不批准）。
6. **双 Profile 保留**：任何 Fail Closed / Identity 设计必须出具 A/B 冲击表。

---

## 9. 风险规避专章

| #   | 风险                                             | 触发条件                                                             | 规避原则                                                                      | 检测信号                                                            |
| --- | ------------------------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | **热路径误判**                                   | 按「裸 Pi / Fabric 已包住一切」重构                                  | 以 `feature.ts` +「agents 是否调用 decide()」+ attempt/preflight 包络清单为源 | PR 称「治理内核已覆盖聊天」但未改 feature 默认值；或称「Pi 无治理」 |
| 2   | **Node 重名灾难**                                | 统一表/一次重命名收编设备 Node 与 Agent                              | 禁用别名表先行；新类型用新名且长期双写映射                                    | 类型/表同时服务 `NodeRegistry` 配对权限与 LLM 回合                  |
| 3   | **Workflow→Path 伪对齐**                         | 把 Lobster/AOR/Fabric/编排/知识 workflow 收成「合法轨迹空间」        | 坚持 Workflow ≠ Path；Path 设计从「缺失」出发                                 | 设计文档把 `ExecutionPlan` / Lobster 流程直接标为 Path              |
| 4   | **双演进权威被拆**                               | 盲改 State 或强行并 v1/v2                                            | 先出双权威清单；保持 v1 外部行为不变                                          | evolution 完成语义与 diagnosis 存储分叉                             |
| 5   | **证据升格过头**                                 | 预检 trace / 工具回执 / evolution receipt / 发布 provenance 混用     | 沿用 `ledgerEventIsReceiptNotProof` 精神；禁用升格                            | Conformance 把 receipt 字段标为 proof                               |
| 6   | **Fail Closed 打穿 Profile A**                   | 一套 DENY 覆盖 Personal Local 默认                                   | Fail Closed 设计必须分 Profile；A/B 冲击表为门禁                              | Personal Local 默认沙箱被强制开启且无迁移                           |
| 7   | **Registry 大合并**                              | 「唯一 Registry」并插件/设备/技能/企业资产/Loom                      | 分账视图；插件信任 ≠ 能力授权                                                 | 安装插件自动出现在能力授权目录                                      |
| 8   | **设计文档漂移当代码 / 基线手抄僵化**            | 按 Bridge MVP / 过时 SHA / 不完整 README 开工；或把 seq96 当六周常量 | 以 **BaselineManifest 再生**为准；未批准编码不得实现                          | 验收文档仍粘贴本轮评审 SHA 且未标 `assessedAt`                      |
| 9   | **旁路执行面漏治**                               | 只治理 `runEmbeddedPiAgent`                                          | 旁路表闭合前不宣称 C10                                                        | 安全评审只贴 attempt.ts，忽略 tools-invoke-http                     |
| 10  | **与在途工作冲突 / 过早产品化 / 假性跨域写权威** | 未过决策门就建四产品；或追求全局完成状态机                           | 阶段门未过禁止热路径收紧与独立产品；C11 按域 + 终态化协议                     | 「宪法对齐」PR 引入全局 completion writer；或 A 阶段出现 schema 包  |

---

## 10. 目标态可持续架构（非大爆炸）

```text
L0  治理透镜     词典 / 禁用别名 / C1–C12 操作化 / BaselineManifest
                   ↑ 约束
L1  执行链收敛   既有 preflight / ConversationTask / orchestration / Fabric（可选）
                   ↑ 域内权威清晰 + 跨域终态化协议草案（非全局写者）
L2  执行面保留   Gateway + Pi 作为默认执行面（保留包络；聊天不经 Fabric）
                   ↑ 被观察、被门控，而非被一夜替换
L3  有界契约包   （仅 Phase C 独立 GO 后；**当前不批准**）
                   constitutional-contracts：schemas / adapters / read-model / evaluator
                   独立 Registry/Conformance/Runtime 产品 = 推迟证明
```

### 10.1 L0 治理透镜

- 产出：对象词典、禁用别名、C1–C12 操作化检查项、Fail Closed × Profile 对照表、BaselineManifest 约定。
- 不产出：运行时拦截器、默认 DENY 全局开关、schema/新包、未证明的「四产品」开工令。

### 10.2 L1 执行链收敛（优先于新引擎）

- 优先回答：若不建 Meta-Schema，仅收敛现有执行契约，哪些可复现问题无法解决？
- 复用：`src/agents/execution-preflight/`、`src/task-orchestration/`（shadow）、既有 ledger。
- **禁止**从 Node/Network 开刀做第一次类型迁移；**禁止**建设跨域通用写权威。

### 10.3 L2 保留 Gateway + Pi

- Gateway 继续作为控制面与通道汇聚。
- Pi 嵌入式回合继续作为默认聊天 / cron / subagent 执行面（**已有治理包络**）。
- Fabric、AOR、task-orchestration 保持「旁路/可选/休眠」语义，直至旁路清单与实验旗标治理完备。

### 10.4 L3 契约包装（有条件；**当前不批准**）

| 顺序 | 组件                      | 引入姿态                       | 明确不做                          |
| ---- | ------------------------- | ------------------------------ | --------------------------------- |
| 1    | **schemas**               | 仅 C 独立 GO 后                | 不改热路径；不在 A/B 创建包       |
| 2    | **evaluator**             | 只读符合性；B 阶段可用离线报告 | 不默认阻断生产                    |
| 3    | **adapters / read-model** | 多本源账只读视图               | 禁止物理大合并                    |
| 4    | **Runtime 门面**          | 复用 orchestration / preflight | 不替换 Pi；不新造第五套执行状态机 |

### 10.5 Personal Local vs Managed Enterprise

| Profile                  | 合同要点（评估）                                                                 | 宪法/治理层要求                                 |
| ------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------- |
| **A Personal Local**     | 受信操作者；沙箱默认关；显式 `dangerous*`；插件即信任基座；sessionKey ≠ 授权边界 | Fail Closed / Identity 不得默默升级为多租户语义 |
| **B Managed Enterprise** | Gate 0 启动失败关闭；缺上下文关闭；共享进程隔离证明前要独立租户边界              | 不得为「统一体验」削弱启动级不变量              |

**双 Profile 必须保留，不得折成一种身份。**

---

## 11. 明确结论

1. **可以**把 OpenBot 作为**企业 Agent OS** 强化：用 Meta-Schema 透镜收敛既有治理为可证明执行链；战略方向与局部已有的演进账本、预检、双 Profile、orchestration 影子同向。
2. **必须**先完成事实收敛（名词冻结、旁路显式化、权威/证据 + **BaselineManifest**、**web_read** 垂直切片合同），再经 Phase C **独立**裁决（GO / NO-GO / REVISE），才谈契约包与后续工程化。
3. **C11 目标已重写**：`Domain-local single authority + explicit cross-domain finalization protocol`；旧「跨域单一写权威」为已纠正谬误。
4. **当前授权**：Phase A **正式批准启动**；B 设计批准、B 编码待合同齐备；C 保留独立评审权；**D / contracts / 真实 Path / Gate 收紧当前均不批准**。
5. **当前阶段不授权**：按元模式大重构、默认打开 Fabric、Agent→Node 重命名、Registry 大合并、未批准 Bridge MVP、合并 Profile A/B、把 Pi 重命名为宪法 Runtime、预设四个独立工程产品、Phase A 创建 schema/新包、以 path=unset 单独作为热路径收紧成功门、建设全局完成写权威。

---

## 附录 A：禁用别名表

| 禁止等同                                                                     | 说明                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Agent ≠ 唯一 Node                                                            | Agent 是 Node 的一种实现候选，不是上位类型本身               |
| 设备 Node ≠ Fabric `RuntimeNode`                                             | 配对设备执行器 vs 图内节点类型                               |
| AOR SDK「node」≠ 宪法 Node                                                   | 包名/客户端，非治理执行单元                                  |
| CogniWeave `NodeType` ≠ 执行 Node                                            | 记忆图本体                                                   |
| sessionKey ≠ Path                                                            | 路由身份，非合法执行轨迹                                     |
| Lobster / AOR 图 / Fabric 图 / 休眠编排 / 知识 kind `"workflow"` ≠ Path 空间 | Workflow ≠ Path                                              |
| evolution Decision ≠ Fabric `PolicyDecision` ≠ 协作 Decision                 | 互不兼容                                                     |
| 发布门 ≠ 交付门                                                              | forward-only deploy vs 技能交付校验                          |
| `src/runtime.ts` ≠ 宪法 Runtime                                              | CLI 包装而已                                                 |
| 插件已安装 ≠ 能力已授权                                                      | Trusted Plugin 基座 ≠ Capability grant                       |
| 回执 ≠ 证明                                                                  | evolution 已写明；不得外推抹平                               |
| Agent OS「Fabric = 治理内核」≠ 默认部署事实                                  | 文档叙事 vs feature 默认 OFF                                 |
| Pi 热路径「无治理 / 裸执行」≠ 事实                                           | 已有多层包络                                                 |
| 「跨域单一写权威」≠ C11 目标                                                 | **已纠正谬误**；正确目标 = 域内单一权威 + 显式跨域终态化协议 |
| 产品合同 / main 代码 / 生产 seq ≠ 同一状态                                   | 三基线必须分标；SHA/seq 以 BaselineManifest 再生为准         |
| 本轮评审 SHA / seq96 ≠ 六周计划常量                                          | 仅为评估快照                                                 |

## 附录 B：复核锚点（相对本轮评审快照；验收时对照 Manifest）

| 主张                                  | 锚点                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Fabric 默认关                         | `src/fabric/feature.ts`                                                                                                  |
| 未决审批 DENY 仅在 Fabric decide 内   | `src/fabric/policy-runtime.ts`                                                                                           |
| 嵌入式回合建预检与包络                | `src/agents/pi-embedded-runner/run/attempt.ts` → `buildExecutionPreflight`；`src/agents/execution-preflight/`            |
| 编排 live invoke 关闭 / 影子观察      | `src/task-orchestration/types.ts` `ORCHESTRATION_LIVE_INVOKE = false`；`dispatch.ts`                                     |
| web_read 面与只读绑定（Phase B 首切） | `types.ts`（~L36 surface；~L66 ladder）；`surface-binding.ts`（~L77）；`dispatch.ts`（~L165 invoke=false/enqueue=false） |
| 演进禁止捷径                          | `packages/evolution-core/src/state-machine.ts`                                                                           |
| 回执不是证明                          | `packages/evolution-core/src/lineage.ts`                                                                                 |
| 协议版本子系统常量                    | `PROTOCOL_VERSION = 3`                                                                                                   |
| 两套互斥信任模型                      | `SECURITY.md` Profile A / B + Gate 0                                                                                     |
| Bridge 未批准编码                     | `docs/design/bridge-mvp.md`                                                                                              |
| 无宪法元模式产品名                    | 检索 `constitutional` / `meta-schema` / `Conformance Engine` 为空                                                        |
| 生产基线 ≠ main 前沿                  | 以 BaselineManifest 为准；本轮快照示例：seq 96 vs main @ `f1c7efece…`                                                    |

## 附录 C：相关文档

- 全量差距评估：PR #1249 / `docs/design/openbot-constitutional-meta-schema-gap-assessment-2026-09-23.md`
- 透镜摘要：`constitutional-meta-schema-brief.md`
- 配套执行方案（A–D）：`02-openbot-transformation-execution-plan.md`
- 修订说明（含第二轮）：`REVISION-NOTES-2026-09-23.md`
