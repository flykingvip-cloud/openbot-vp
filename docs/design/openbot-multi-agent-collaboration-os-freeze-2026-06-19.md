# OpenBot 协作群 — 架构收敛与冗余清理计划

Date: 2026-06-19

Status: **Freeze candidate — 专家终审对齐版（待正式冻结）**

Revision: 2026-06-19 v3 — 并入外部架构终审：五层体系方向确认；根因 = 同一语义多真相源；半年路线 = Group Root → Context Assembly → Participation/Governance/Learning

Audience: 架构、Gateway/Runtime、Collaboration Learning、员工端 UI

Pilot group: `grp-daniel-hhd-gmail-com-upbeyond`（数字人战队）

---

## Related Docs

- 群聊调度与 Round UX（**运行时主线，已落地**）：[/design/openbot-collaboration-group-dialogue-optimization-2026-06-18](/design/openbot-collaboration-group-dialogue-optimization-2026-06-18)
- 协作学习治理：[/design/openbot-collaboration-learning-governance-implementation-plan-2026-04-03](/design/openbot-collaboration-learning-governance-implementation-plan-2026-04-03)
- 代码锚点（**现有主干，不另起炉灶**）：
  - 路径 / store：`src/gateway/collaboration-learning/shared.ts`、`src/gateway/collaboration-learning/space-store.ts`
  - 调度：`src/gateway/collaboration-dispatch/`
  - 群 turn 执行：`src/gateway/server-methods/chat.ts`
  - 解释性 UI：`ui/src/ui/ports/employee/views/workbench-stage-collaboration.ts`
  - continuity / backflow：`src/auto-reply/reply/session-continuity.ts`、`collaboration-learning-store.ts`、`collaboration-learning-backflow.ts`

---

## 0. 执行摘要

当前最大风险 **不是能力不够**，而是同一件事开始出现：

> **两套说法、两套路由、两份真相源。**

典型分裂点（已在代码中存在）：

| 分裂                | 位置                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------- |
| group 路径 / 根目录 | 分散在 `shared.ts` 与 `space-store.ts`                                                      |
| participation 读写  | store 抽象（`loadGroupParticipations`）与 legacy 直读（`readParticipations`）并存           |
| group memory        | Gateway 写 legacy 根；backflow 写 agent workspace 副本                                      |
| 调度 vs 解释        | `collaboration-dispatch/` + `chat.ts` 已成形；文档若再叠「Collaboration OS 层」会造成双主线 |

**本计划要做的事：**

```text
收窄 · 收直 · 收干净
```

**不是：** 再叠一个「大而全 Collaboration OS 层」，不是 Phase 里先加 Charter / 生命周期 / 新 orchestration 名词。

**是：** 把现有模块收成 **一条主干**，明确 **主路径 / 兼容层 / 迁移后必删**，清完冗余后再挂新能力。

### 0.1 体系定位（终审确认）

外部架构审阅结论：**方向正确**。OpenBot 已不是在设计「聊天群功能」，而是在构建具备长期记忆、协作治理、能力演化、组织行为学与运行时控制面的 **Multi-Agent Operating System**。当前阶段应进入：

> **统一真相源（Single Source of Truth）+ 运行时边界收敛**

而非继续加功能。否则将进入「概念正确、局部实现正确、全局行为不稳定」的复杂系统风险。

### 0.2 五层体系成熟度

| 层级               | 当前状态         | 审阅                         |
| ------------------ | ---------------- | ---------------------------- |
| Bot 个体层         | 较成熟           | ✅ 正确                      |
| 协作群层           | 治理模型已形成   | ✅ 正确；需 First-Class 收敛 |
| Learning 回流层    | 完整链路已有     | ✅ 非常关键                  |
| Runtime 调度层     | 已工程化（v0.4） | ✅ 正确；维护主干            |
| 企业治理层（机巢） | 雏形             | ✅ 有前景；MVP 见 §14        |

### 0.3 根因诊断：同一语义，多个真相源

当前各类异常 **同源**于「同一 group 在多个位置被重复定义」：

| 症状                             | 根因                                   |
| -------------------------------- | -------------------------------------- |
| Bot 记忆错乱 / continuity 不一致 | per-agent group memory 副本            |
| 群成员认知失明                   | transcript 与 private session 混用     |
| PPT / 文件有人见有人不见         | workspacePath dangling；FS 根分裂      |
| 群使命丢失                       | operating-state / charter 未从唯一根读 |
| promoted capability 不一致       | backflow 写 agent 根；composer 读错根  |
| 协作行为与绩效脱节               | Ledger 与 memory 不在同一真相链        |
| learning 回流异常                | capsule 双写                           |
| profile.workspacePath 无效       | 未 materialize；silent fallback        |

**收敛计划只解决这一根因**；不引入新语义层来「掩盖」分裂。

### 0.4 保留不变的核心设计（终审强调）

**Capsule → Projection → Asset → Capability Overlay** 是当前最有价值、应 **完整保留** 的学习链路：

```text
Group Memory (唯一根)
  → Projection
      → promotable asset
          → personal overlay (Recall，非 copy)
```

| 问题           | 错误做法 | 正确做法                |
| -------------- | -------- | ----------------------- |
| 群经验成长     | 不成长   | capsule + projection    |
| 群知识进入个体 | copy all | promotion + overlay     |
| 保密           | 无法控制 | policy gating           |
| 个体演化       | 弱       | promoted asset + recall |

**硬禁止：** `group memory → copy into bot memory`（爆炸冗余、divergence、secret leakage）。只允许 **Projection + Overlay + Recall**。

---

## 1. 收敛原则（冻结 — 与终审四原则对齐）

| 本计划 §1             | 终审原则                   | 合一表述                                                          |
| --------------------- | -------------------------- | ----------------------------------------------------------------- |
| §1.1 一个真相源       | 原则 2：群拥有唯一共享根   | `groupId → exactly one collaboration root`                        |
| §1.2 一个入口         | P0：Group Root Resolver    | 全系统 memory/workspace/capsule/ledger/continuity 经 resolver     |
| §1.3 一个运行时主线   | 调度已工程化               | 维护 `collaboration-dispatch` + `chat.ts`，不叠第二 orchestration |
| §1.4 先清冗余再加能力 | 不缺功能，缺收敛           | Phase 0 Done 前零扩建                                             |
| §2.3 Participation    | 原则 3：Bot 永不「属于」群 | `BotParticipation` 桥接，禁止 `GroupBot` fork                     |
| §0.4 学习链路         | 原则 4：桥接不复制         | Projection / Overlay / Recall                                     |
| §2.4 Group 实体       | 原则 1：Group 一级领域实体 | Organization Unit，非聊天容器                                     |

### 1.1 一个真相源

Group 的 **runtime 真相只能有一个根**：

```text
{collaborationRoot}/groups/{groupId}/     ← runtime 读写唯一决策点（终审：硬原则）
  governance/          charter, policy 快照
  memory/              task_ledger, continuity, checkpoints
  workspace/           共享文件与产出物
  learning/            capsules, reviews（或与 capsules/ 对齐现有 adapter）
  runtime/             operating-state, participations（或根级 json，与现网对齐）
  ledger/              行为真相 append-only（或与 collaboration-ledger 索引对齐）
```

**禁止：** `workspace-bot-1/.../group-x`、`workspace-bot-2/.../group-x` 等 per-agent group memory 副本。否则系统 **永远无法稳定**。

`{stateDir}/spaces/{groupId}/` **只能**做 UI / 治理索引 / 人类可编辑镜像（profile、members、ledger 索引、`SHARED_MEMORY.md`）。**不得**与 group runtime 根并列参与 memory、capsule、continuity、promoted asset 的读写决策。

**CollaborationGroup 语义（First-Class）：** 组织 + 治理 + 共享记忆 + 共享任务 + 共享资产 + 共享规则 + 共享运行态 — 不是 Session 扩展或 UI 分组。

Legacy `{agentWorkspace}/.openbot/collaboration/groups/{groupId}/` 在迁移期 **只读 fallback**，迁移完成后 **删除写入并退役**。

### 1.2 一个入口

下列能力 **各保留一个正式入口**；旧函数只允许迁移期兼容读，**禁止新代码调用**：

| 能力                                  | 正式入口（Phase 0 冻结）                                                               | 待收敛 / 废弃                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 路径解析                              | `resolveGroupCollaborationPaths(groupId)`（委托 `createWorkspaceCollaborationStores`） | 分散在 `shared.ts` / `space-store.ts` 的 ad-hoc 拼接；`resolveCollaborationStoreRoot` 直调 |
| Participation 读                      | `loadGroupParticipations`（经 fileStore + 双根 fallback）                              | `readParticipations` legacy 直读                                                           |
| Participation 写                      | `saveGroupParticipations`                                                              | —                                                                                          |
| Group store 工厂                      | `createWorkspaceCollaborationStores()`                                                 | `collaboration-learning-store.ts` 内 duplicate resolver                                    |
| Continuity / backflow 读写的 group 根 | 经 `resolveGroupCollaborationPaths`                                                    | agent workspace 下 `groups/{gid}/memory`                                                   |

### 1.3 一个运行时主线

调度与 round 解释 **继续以现有模块为主干**，收敛动作 **落到已有文件**，不平行创造新 orchestration 框架名词：

```text
collaboration-dispatch/decision-engine.ts    ← 调度决策（维护）
chat.ts                                      ← 群 turn 执行 + collaboration.round_plan 广播
collaboration-ledger/                        ← dispatch / execution 记录
workbench-stage-collaboration.ts             ← round chip、reason/rules drawer
group-inbound-history.ts                     ← 群 transcript → InboundHistory
```

**禁止：** 新建 `RoundOrchestrator` / `CollaborationOS` 等 parallel 包或第二调度层。文档中的「Assembler」名称为 **收敛目标别名**，实现 = 在 `session-continuity.ts` / `get-reply-run.ts` / `collaboration-capability-context.ts` 内收拢，非新顶层模块。

### 1.4 先清冗余，再加能力

在以下条件 **未达成前**，**禁止**继续加：

- 新调度策略 / 新人设 prompt 补丁
- 新治理对象（charter schema、lifecycle 状态机、Ledger 新 event 类型）
- 新 path 工具或第二套 group store

**冗余清完门槛（Phase 0 Done）：**

- 每个 `groupId` 仅一份 `task_ledger.json`（runtime 根）
- `readParticipations` 无 legacy 直读调用链
- backflow / promoted / session-continuity 不再写读 agent workspace 副本
- `grep` 无新代码调用 `resolveCollaborationStoreRoot`（resolver 内部除外）

---

## 2. 现有主干（保留 — 不替换）

以下 **已是系统**，本计划只收敛其下的路径与读写，不重构其对外契约。

### 2.1 存储与索引

| 角色              | 路径                                    | 模块                                             |
| ----------------- | --------------------------------------- | ------------------------------------------------ |
| Runtime 真相      | `{collaborationRoot}/groups/{groupId}/` | `createWorkspaceCollaborationStores` + fileStore |
| UI / 治理镜像     | `{stateDir}/spaces/{groupId}/`          | `createWorkspaceGroupStoreFunctions` 双写        |
| 群对话 transcript | `space-{groupId}.jsonl`                 | session store                                    |
| 个人主体          | `{agentWorkspace}/`                     | `resolveAgentWorkspaceDir`                       |

配置（已有，需在本机落地）：

```json
"collaboration": {
  "defaults": {
    "workspace": "{collaborationRoot}"
  }
}
```

### 2.2 调度与解释（v0.4 — 硬约束）

| 组件            | 锚点                                   | 状态    |
| --------------- | -------------------------------------- | ------- |
| Decision Engine | `decision-engine.ts`                   | ✅ 主干 |
| Round plan      | `chat.ts` → `collaboration.round_plan` | ✅ 主干 |
| 弹性可见回复    | `visible-reply-limit.ts`               | ✅ 主干 |
| InboundHistory  | `group-inbound-history.ts`             | ✅ 主干 |
| Ledger          | `collaboration-ledger/`                | ✅ 主干 |
| 协作头部 UX     | `workbench-stage-collaboration.ts`     | ✅ 主干 |

### 2.3 Participation（半收敛 — 不新建第二模型）

已有两套 **说法**，Phase 1 任务是 **合并说法**，不是 invent 第三套：

- Session 投影：`collaborationParticipationOverlay`（调度 / prompt 已消费）
- 持久化：`participations.json` via `loadGroupParticipations` / `saveGroupParticipations`

收敛后：**文件经唯一入口读写；session overlay 为 runtime 缓存，与文件双向同步。**

### 2.4 概念锚点（不变 — 不扩建）

Bot 独立主体、Group 任务空间、Participation 桥 — 见 v0.4 与 `collaboration-core` 既有模型。**本计划不新增第五层架构文档对象**，只在现有类型上收直读写路径。

---

## 3. 冗余清单（必须清掉）

### 3.1 路径冗余

| 冗余                     | 现状                                                                   | 收敛动作                                |
| ------------------------ | ---------------------------------------------------------------------- | --------------------------------------- |
| group 根逻辑分散         | `shared.ts:884-910` + `space-store.ts:46-112` 各自推导                 | 统一经 `resolveGroupCollaborationPaths` |
| duplicate resolver       | `collaboration-learning-store.ts` 本地 `resolveCollaborationStoreRoot` | 删除；import shared                     |
| workspacePath 不存在     | bootstrap 指向未创建目录                                               | P0 mkdir + 写回 profile                 |
| list 与 runtime 各算各的 | space list 推导 vs backflow 写 agent 根                                | runtime 只认 resolver 输出              |

### 3.2 读写冗余

| 冗余                    | 现状                                                                       | 收敛动作                              |
| ----------------------- | -------------------------------------------------------------------------- | ------------------------------------- |
| participation 双读      | `loadGroupParticipations` vs `readParticipations`（`shared.ts:2043-2057`） | 废弃直读；evaluation 等改走 store     |
| group memory 多副本     | per-agent `.../groups/{gid}/memory/task_ledger.json`                       | 迁移合并 + 禁止新写入                 |
| capsule / promoted 分裂 | Gateway → legacy 根；backflow → agent workspace                            | P0-6 / P0-7 改经 resolver             |
| profile 双写            | managed space + group root（`shared.ts:741-820`）                          | **保留**；runtime 决策只认 group root |

### 3.3 叙事冗余（组织层 — 禁止）

| 禁止                                       | 原因                               |
| ------------------------------------------ | ---------------------------------- |
| 新建「Collaboration OS 层」包              | 与 `collaboration-dispatch` 双主线 |
| 新建 parallel path 模块而不委托 store 工厂 | 第三套路由                         |
| Phase 0 未完成即加 charter / lifecycle     | 先清副本再加治理                   |
| 用更长 system prompt 替代 continuity 收敛  | 掩盖路径分裂                       |

---

## 4. 路径分类表（主路径 / 兼容层 / 迁移后删除）

| 符号 / 路径                                            | 分类                   | 新代码            | 迁移完成后                              |
| ------------------------------------------------------ | ---------------------- | ----------------- | --------------------------------------- |
| `resolveGroupCollaborationPaths(groupId)`              | **主路径**             | ✅ 必须使用       | 保留                                    |
| `createWorkspaceCollaborationStores()`                 | **主路径**（内部工厂） | ✅ 允许           | 保留                                    |
| `loadGroupParticipations` / `saveGroupParticipations`  | **主路径**             | ✅ 允许           | 保留                                    |
| `createWorkspaceGroupStoreFunctions` 双写              | **主路径**（镜像写）   | ✅ 允许           | 保留；runtime 不读 space 做 memory 决策 |
| `collaboration-dispatch/*` + `chat.ts` round 路径      | **主路径**             | ✅ 维护           | 保留                                    |
| `readParticipations`                                   | **兼容层**             | ❌ 禁止新调用     | **删除**                                |
| `resolveCollaborationStoreRoot` 外部直调               | **兼容层**             | ❌ 禁止新调用     | 仅 resolver 内部                        |
| `{agentWorkspace}/.openbot/collaboration/groups/` 写入 | **待删**               | ❌ 禁止           | 只读 fallback ≤30 天 → 退役             |
| per-agent `groups/{gid}/memory/` 副本                  | **待删**               | ❌ 禁止           | 合并后删除                              |
| `collaboration-learning-store.ts` duplicate resolver   | **待删**               | ❌ 禁止           | 删除                                    |
| `group-charter.json` / lifecycle 状态机                | **gated**              | ❌ Phase 0 前禁止 | Phase 3+，挂现有主干                    |
| Ledger 新 event 类型                                   | **gated**              | ❌ Phase 0 前禁止 | Phase 3+                                |

**spaces vs group root（写死）：**

| 路径                                    | 分类                                              |
| --------------------------------------- | ------------------------------------------------- |
| `{collaborationRoot}/groups/{groupId}/` | Runtime **主路径**                                |
| `{stateDir}/spaces/{groupId}/`          | UI / 索引 **镜像**（不可并列决策 runtime memory） |
| v0.4 members / presence                 | 调度输入 **主路径**（不引入第二 member registry） |

---

## 5. 现状三态（2026-06-19）

### 5.1 已收敛到主干 ✅

Decision Engine、`round_plan`、员工端 reason/rules drawer、InboundHistory、弹性回复上限、Ledger dispatch/execution、群 transcript 共享、`collaboration.defaults.workspace` 配置支持、双根 fileStore、`participations.json` store API、capability composer 框架。

### 5.2 半收敛 — Phase 0–1 必做 ⚠️

Group memory 多副本；backflow / promoted 读错根；`readParticipations` legacy 直读；workspacePath 未 materialize；participation overlay ↔ file 未完全同步；continuity 仍偏 `isNewSession` + agent 副本。

### 5.3 gated — 冗余清完后再做 🔒

`group-charter.json`、lifecycle ACTIVE/FROZEN/ARCHIVED、Ledger 扩展 event、Solo turn checkpoint recall、CogniWeave 统一索引。**不是不做，是 Phase 0 Done 之前不做。**

### 5.4 试点群实证

- Legacy 根已有 capsules / operating-state
- 多份 `task_ledger.json` 副本（**P0 阻断**）
- `profile.workspacePath` 曾指向不存在目录

---

## 6. 分阶段计划（收敛优先）

### Phase 0 — 清冗余（P0，约 1 周，**唯一当前优先级**）

**Done 定义：** 一条 runtime 根、一个 path 入口、一份 task_ledger；无 legacy 直读新调用。

| ID    | 任务                                                                    | 落点                                                  |
| ----- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| P0-1  | 配置 `collaboration.defaults.workspace`                                 | `openbot.json`                                        |
| P0-2  | `resolveGroupCollaborationPaths(groupId)`                               | 扩展 `shared.ts`（可薄封装 `collaboration-paths.ts`） |
| P0-3  | 迁移脚本 + 数字人战队合并                                               | `scripts/migrate-collaboration-group-storage.ts`      |
| P0-4  | 删除 per-agent memory 副本                                              | 迁移脚本                                              |
| P0-5  | `session-continuity` 只读 resolver 根                                   | `session-continuity.ts`                               |
| P0-6  | backflow 写 resolver 根                                                 | `collaboration-learning-store.ts`                     |
| P0-7  | promoted 读 resolver 根                                                 | 同上                                                  |
| P0-8  | **profile.workspacePath 自动修复**（迁移 + 校验 + mkdir + 修 dangling） | `space-store` bootstrap                               |
| P0-9  | `readParticipations` → `loadGroupParticipations`                        | `shared.ts`, `evaluation-aggregation.ts`              |
| P0-10 | 删 duplicate resolver                                                   | `collaboration-learning-store.ts`                     |
| P0-11 | `space-store` list 改经 resolver                                        | `space-store.ts`                                      |

### Phase 1 — 收直 Participation（约 1 周，**不增新对象**）

| ID   | 任务                                                                   |
| ---- | ---------------------------------------------------------------------- |
| P1-1 | 扩展现有 `participations.json` schema（非新格式）                      |
| P1-2 | session overlay ↔ file 同步；删除 `readParticipations`                 |
| P1-3 | share-to-group 更新 participation + group capabilities（挂现有 store） |

### Phase 2 — 统一 Runtime Context Assembly（P1 审阅优先级，**在现有文件内收敛**）

终审：**最缺「统一上下文装配」** — transcript / continuity / capsule / capability / charter 当前分散注入，行为将不可预测。

| ID   | 任务                                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------- |
| P2-1 | 在 `session-continuity.ts` + `get-reply-run.ts` + `collaboration-capability-context.ts` 内冻结 **装配块顺序**（见 §7） |
| P2-2 | 群 turn FS 默认 root = resolver 输出的 group workspace                                                                 |
| P2-3 | 保留 InboundHistory + 介绍 follow-up（已在主干，不重构）                                                               |
| P2-4 | 所有块读源经 `resolveGroupCollaborationPaths`；禁止 silent fallback 到 agent 副本                                      |

**实现名：** `RuntimeContextAssemblyPipeline` 为 **逻辑别名**；物理落点 = 现有 reply 路径，**不新建 parallel 包**（与 §1.3 一致）。

### Phase 3 — 组织行为与治理（🔒 Phase 0–2 Done 后）

挂现有主干；**不得**另起存储或调度线。

| ID   | 任务                                                                 | 审阅依据                                    |
| ---- | -------------------------------------------------------------------- | ------------------------------------------- |
| P3-1 | Participation Charter（成员为何在此、何时发言、低质量行为）          | 防抢答/迎合/社交噪音                        |
| P3-2 | Operating Phase 强化：`explore → debate → decide → deliver → review` | 已有 operating-state，需与调度/ prompt 接缝 |
| P3-3 | Coordinator 治理：组织/归纳/收口/分派，**不垄断发言**                | v0.4 已修正，写入 charter                   |
| P3-4 | `group-charter.json` + lifecycle ACTIVE/FROZEN/ARCHIVED              | governance/ 下，经 resolver                 |
| P3-5 | Ledger 扩展 event；归档只读 API                                      | append-only 真相链                          |

### Phase 4+ — 持续（gated）

- CogniWeave / QMD 与 `{collaborationRoot}` 索引统一
- Behavior Buffer → Growth（只读 Ledger 聚合）
- 跨群 promotion 审计
- **AI 社会学治理**（见 §13）：从众、过度协同、群污染、权限泄露 — 靠 promotion policy + dissent 机制，非新 memory 类型

---

## 7. Runtime Context Assembly Pipeline（Phase 2 冻结顺序）

群 turn 每轮经 **现有 reply 路径** 按下列顺序装配（终审 + 工程合一；实现收拢，不新建包）：

| #   | 块                       | 来源                                                                 | 阶段               |
| --- | ------------------------ | -------------------------------------------------------------------- | ------------------ |
| 1   | Personal Identity        | agent 主体（群内 turn 仅 overlay，不 fork）                          | 已有               |
| 2   | Group Charter            | `governance/` 摘要（Phase 3 前可用 collaborationPolicy + bootstrap） | P3 完整            |
| 3   | Group Mission            | operating-state / profile                                            | P0 经 resolver     |
| 4   | Current Phase            | explore / debate / decide / deliver / review                         | P3 强化            |
| 5   | Relevant Continuity      | resolver 根 `memory/`                                                | **P0**             |
| 6   | Capability Context       | `collaboration-capability-context.ts`                                | **P0** promoted 根 |
| 7   | Relevant Learning Assets | capsule projection @ group 根                                        | **P0** backflow 根 |
| 8   | Participation Policy     | `participations.json` 唯一入口                                       | P1                 |
| 9   | Current Tasks            | task ledger / assignments                                            | P0 单份 ledger     |
| 10  | Recent Transcript        | InboundHistory @ 群 transcript                                       | ✅ 已有            |

**禁止：** group turn 读 agent workspace 副本；用更长 prompt 补丁替代 P0 读根收敛；跳过顺序 ad-hoc 注入新块。

---

## 8. 迁移（数字人战队）

```bash
find ~/.openbot -path '*grp-daniel-hhd-gmail-com-upbeyond*' -name 'task_ledger.json'
```

1. 设 `collaboration.defaults.workspace`
2. 合并 legacy 根为 canonical
3. 合并 agent 副本增量（冲突以 transcript + Ledger 为准）
4. 更新 `spaces/.../profile.json` workspacePath
5. 删副本（backup 7 天）
6. 重启 Gateway；跑 §9 验收

回滚：tarball backup；legacy 只读 fallback ≤30 天。

---

## 9. 验收（收敛导向）

| #    | 场景                       | 通过标准                                                       |
| ---- | -------------------------- | -------------------------------------------------------------- |
| AC-1 | 介绍 follow-up             | 已介绍 bot 不重复；调度跳过（已有主干）                        |
| AC-2 | group workspace 写文件     | 多 bot 同一路径                                                |
| AC-3 | continuity commit          | **仅一份** task_ledger                                         |
| AC-4 | backflow                   | capsule @ resolver 根；promoted 进 prompt                      |
| AC-5 | grep 新代码                | 无 `readParticipations` / 外部 `resolveCollaborationStoreRoot` |
| AC-6 | round_plan + reason drawer | 仍工作（主干未破坏）                                           |

---

## 10. 实施期间禁止

1. 新 per-bot group memory / workspace 副本路径
2. Phase 0 完成前：新调度策略、新 prompt 补丁、charter/lifecycle/Ledger 新类型
3. parallel orchestration 框架或「Collaboration OS」新包
4. 新代码走 legacy 直读链
5. spaces 侧参与 runtime memory 决策

---

## 11. 模块映射（收敛 — 非扩建）

| 收敛目标            | 实现位置                                              | 动作              |
| ------------------- | ----------------------------------------------------- | ----------------- |
| 唯一 path 入口      | `shared.ts` → `resolveGroupCollaborationPaths`        | 抽取              |
| Participation 读写  | `loadGroupParticipations` / `saveGroupParticipations` | 保留；废弃直读    |
| 调度 + round UX     | `collaboration-dispatch/` + `chat.ts` + workbench     | **不动契约**      |
| Continuity 装配     | `session-continuity.ts` + `get-reply-run.ts`          | 收拢，不新建包    |
| Capabilities        | `collaboration-capability-context.ts`                 | P0 修 promoted 根 |
| UI 镜像双写         | `createWorkspaceGroupStoreFunctions`                  | 保留镜像写        |
| Charter / lifecycle | group 根 governance                                   | Phase 3+ gated    |

---

## 12. 立项

**Project:** `collaboration-convergence`（**非** `collaboration-os-expansion`）

**Owner paths:**

- `src/gateway/collaboration-learning/shared.ts`
- `src/gateway/collaboration-learning/space-store.ts`
- `src/auto-reply/reply/session-continuity.ts`
- `src/auto-reply/reply/collaboration-learning-store.ts`
- `src/gateway/server-methods/chat.ts`（仅 path/backflow 收敛，不改 round 契约）
- `scripts/migrate-collaboration-group-storage.ts`（新）

**优先级（终审「接下来半年只做三件事」对齐）：**

| 阶段         | 本计划                                                    | 时间盒           |
| ------------ | --------------------------------------------------------- | ---------------- |
| **第一阶段** | Phase 0 — 统一 Group Root                                 | 立即             |
| **第二阶段** | Phase 2 — 统一 Runtime Context Assembly                   | Phase 0 Done 后  |
| **第三阶段** | Phase 1 + Phase 3 — Participation + Governance + Learning | 前两阶段 Done 后 |

**半年内禁止扩建：** 新 prompt 策略、新路由器、新 memory 类型、新 overlay 类型、新 group variant。

---

## 13. 前瞻风险（非当前实施 — 写入治理 backlog）

未来最大挑战在 **AI 社会学**，非单点技术：

| 风险     | 缓解方向（Phase 3+ / policy）                                      |
| -------- | ------------------------------------------------------------------ |
| 群体从众 | dissent encouragement、contradiction reward、independent reasoning |
| 过度协同 | identity persistence；Participation 禁止人格融合                   |
| 群污染   | 严格 promotion policy；低质量群不 auto-promote                     |
| 权限泄露 | secret → promoted 硬 gate；审阅链                                  |

---

## 14. 机巢（企业治理层）MVP 边界

审阅：**AI Workforce Operating Console** 方向正确；与协作收敛 **并行但 MVP 收窄**。

MVP 只做三件事（不做复杂 KPI / AI 绩效评分 / 自动优化）：

1. **资产归属** — 谁拥有 Bot / Group / Runtime Cost
2. **运行状态** — 在线、高成本、异常、无贡献
3. **成本治理** — 谁花钱最多

详设不在本文；不得用机巢 KPI 替代 Phase 0 Group Root 收敛。

---

## 15. 终审一句话

OpenBot 要构建的不是「多个 AI 在聊天」，而是：

> **具备组织记忆、角色治理、能力演化和协作秩序的 AI 社会系统。**

系统能否稳定运行，核心不在模型，而在：

```text
统一真相源 + 运行时边界纪律 + 学习治理机制
```

本计划工程表述：

> **收窄、收直、收干净 — 不是把它再做大。**

---

## 16. 文档状态

| 项                           | 状态                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------- |
| 战略方向                     | ✅ 终审通过                                                                  |
| 减法式收敛原则               | ✅ 与终审一致                                                                |
| Phase 0 可开工               | ✅ resolver + 删副本 + workspacePath 自修复                                  |
| 主干验收（2026-06-19）       | ✅ Phase 0–3 功能主线通过；Phase 4 框架接入                                  |
| 架构收敛状态                 | ✅ **Legacy-free**（Phase 6 LC-1…LC-7 完成，2026-06-19）                     |
| runtime truth vs spaces 镜像 | `{stateDir}/spaces/{groupId}` 是 UI / 治理镜像，不是 runtime memory 决策真相 |
| 正式 freeze                  | ✅ 主干 + 清尾完成；持续治理见 Phase 4 promotion/charter                     |

---

_Document owner: architecture — pending loom register. Status: freeze candidate v3 — expert review aligned (2026-06-19)._
