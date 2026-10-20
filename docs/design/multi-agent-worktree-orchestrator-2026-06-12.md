# Loom — 多 Agent / 多 IDE 工作树编排器（产品规划）

> 工作代号 **Loom**（暂定）。日期：2026-06-12。
> 状态：产品规划草案（Product Plan）。本文是后续 spec 的依据，不含实现代码。

---

## 1. 背景（Why now）

### 1.1 场景的真实形态

同一个开发者（或同一个小团队）在**同一个仓库、同一个工作树**上，同时开多个 AI 编码 IDE / 多个会话窗口推进多条任务：

- IDE 异构：Kiro、Cursor、Codex、Windsurf 等并存。
- 每个 IDE 里的 agent 都是一个独立"执行体"，但它们读写的是**同一个 checkout、同一条分支**。
- 任务是高频生灭的：一个会话窗口 = 一个话题 = 一条任务线。

这已经不是"未来可能"，而是 OpenBot 仓库**当下正在发生**的工作方式。

### 1.2 根本病因（Git 模型层面）

Git 只在 **commit 时**记录 author，**编辑态（working tree + index）没有任何 actor 维度**。
因此在"多执行体 + 单一可变工作树"下必然出现三个结构性后果：

1. **编辑态不可归属**：未提交改动在 Git 里没有作者，"谁动了这个文件"在工作树层面无法回答。
2. **热文件交织**：多个 agent 改同一文件（典型如 `ui/src/ui/ports/employee/render-model.ts`），脏树互相污染。
3. **无隔离边界**：任何一个 agent 的半成品都会进入其他 agent 的上下文与提交范围。

### 1.3 仓库已有的"半成品解法"

OpenBot 已经被这个问题逼出了一批补丁式工具，它们是 Loom 的直接前身与可复用资产：

- `scripts/agent-attribution.ts` — 解析各 spec `tasks.md` 的 `## Agents` 块，把脏文件映射到 owner，标记 `UNATTRIBUTED` / `CONFLICT`。
- `scripts/worktree-audit.ts` — 一张**硬编码**的 path → landing group 规则表（MERGE / ISOLATE / CLEAN）。
- `docs/design/worktree-landing-groups-2026-04-09.md` — landing group 设计与落地顺序。
- `scripts/committer` + `git-hooks/pre-commit` — 限定提交范围、拒绝危险混合暂存。
- `AGENTS.md` 的 "Multi-Agent Collaboration & Commit Governance" — 签名/归属/landing 的纪律规则。

**关键判断**：方案不是从零造，而是把这些"OpenBot 专用脚本 + 文档纪律"沉淀为**通用、可配置、有生命周期的产品**。这决定了可行性高、起点扎实。

---

## 2. 目的与目标

### 2.0 产品定位（一句话）

**Loom = Agent Workspace Operating System** —— 一层位于 **Git 之上、Agent 之下**的多 Agent 工作空间编排层。

```
        IDE / Agent Runtime: Cursor · Kiro · Codex · Windsurf · Claude Code · OpenHands
                                   ↑  复用同一层治理能力
        ┌──────────────────────────────────────────────────────────┐
        │   Loom — Multi-Agent Workspace Orchestration Layer         │
        │   (Workspace Governance, NOT Agent Intelligence)           │
        └──────────────────────────────────────────────────────────┘
                                   ↑  以原生能力为底座
        Git: worktree · branch · commit · landing
```

关键定位区分：

- Loom 解决的是 **"多 Agent 如何不互相破坏"**（Workspace Governance），不是 "多 Agent 如何更聪明地协作"（Agent Intelligence）。
- 因此它**不依赖模型、不依赖 IDE、不依赖 Agent Framework**，属于基础设施层。
- 赛道是 **Multi-Agent Workspace Orchestrator**，不是 AI Agent Framework。

### 2.1 目的

让"多 IDE / 多 agent 同仓并行开发"从**靠纪律维持的脆弱状态**，变成**靠工具保证的可控状态**：任何时刻都能回答"谁在做什么、改了哪些文件、是否安全、如何安全合并"。

### 2.2 产品目标（可度量）

- **G1 归属可达**：任意脏文件可在 1 条命令内追溯到唯一 owner（agent + task），`UNATTRIBUTED` 率趋近 0。
- **G2 编辑期零交织**：并行任务默认在物理隔离的工作树中编辑，互不污染。
- **G3 冲突显式化**：剩余的共享热文件冲突从"隐性脏树"变为"显式、可预警、可串行化"的事件。
- **G4 集成可编排**：合并/landing 有确定顺序与门禁，不依赖人脑记忆。
- **G5 低人工开销**：任务的隔离环境可由授权后的编排器自动开/关，人不再是瓶颈。

### 2.3 非目标（Non-goals）

- 不替代 Git / IDE / CI；Loom 是它们之上的**编排与治理层**。
- 不做实时多人协同编辑（CRDT/OT 那类），那是另一个问题域。
- 首期不做云端 SaaS 控制面，先做**本地优先（local-first）CLI + 注册表**。
- 不强制改变任何 agent 的内部行为，只约束其"在哪个目录、改哪些文件、如何提交"。

---

## 3. 要解决的问题与商业价值

### 3.1 谁有这个痛

- **AI 优先的开发者/小团队**：一人多 agent、多窗口并行，是 AI 编码的新常态。
- **多 IDE 混用团队**：不同成员/不同任务偏好不同 IDE，却共享一个仓库。
- **agent 平台 / IDE 厂商**：需要给"多 agent 同仓"提供安全护栏，否则脏树会劝退用户。

### 3.2 商业价值

1. **可信度（最大价值）**：没有归属和隔离，多 agent 并行就是"不可审计、不可问责"的黑箱。Loom 把它变成可问责、可暂停、可逐个评审单个 agent 贡献的工程实践——这是把 AI 多 agent 开发推向严肃生产的前提。
2. **吞吐**：物理隔离让真正的并行成为可能，而不是被脏树串行化。
3. **可维护性**：landing 顺序、热文件治理把"大泥球合并"成本前置、显式化。
4. **可迁移的方法论资产**：本仓库已验证过这套纪律有效，产品化后可输出给任意仓库/团队，具备独立工具的市场面（CLI 工具 / IDE 扩展 / SDK 三种载体）。

### 3.2.1 商业路线：先开发者，再团队，最后基础设施

终局客户是 **Agent Runtime / IDE 厂商**（Cursor、Windsurf、Kiro、Claude Code、OpenHands），它们都会撞上"多 Agent 同仓并发修改"，Loom 提供的正是缺失的 **Agent-safe Git Workspace Layer**。

但**第一阶段不要直接卖给这些厂商**——它们不会采购一个尚未验证的基础设施层。落地顺序必须是：

```
Developer Tool（个人：一人多 Agent，最确定的痛）
      ↓
Team Tool（5–50 人 AI Native 团队 / 开源项目 / Agent 团队）
      ↓
Runtime Infrastructure（被 Runtime 厂商复用，形成壁垒）
```

真正的第一批客户是**已经在用一人多 Agent 的 AI Native 小团队**（创业公司、开源项目、Agent 团队），它们今天就有这个痛。直接跳到"基础设施层"会离市场太远。

### 3.2.2 一句话定位（Pitch）

> **Loom is the workspace operating system for multi-agent software development.**

### 3.3 为什么现在做（时机）

多 agent 编码正在爆发，但配套的"工作树治理"基本空白。先有真实仓库（OpenBot）验证过的纪律，再产品化，比纯设想的工具更有说服力。

---

## 4. 核心概念模型

Loom 的一切围绕**单一真相源（Single Source of Truth）**：一个工作空间注册表（Registry）。
对象层级为 **Task → Session → Worktree**（一个任务可有多个并行 Session）。

```
Task（任务 / 一条意图线）
 ├─ id            稳定任务标识（如 auth-refactor）
 ├─ owner         负责 agent 身份（如 kiro-daibai，人类可辨识、稳定）
 ├─ intent[]      意图标签：ui | backend | migration | test | docs …（软信号：仅显示/搜索/统计）
 ├─ paths[]       机器可匹配的 path globs（硬信号；声明式 + 建议式学习，见 C1）
 ├─ landingPolicy parallel | serial | exclusive | manual（通用 landing 策略，见 C5）
 └─ state         任务生命周期状态（见下方状态机）
     │
     └─ Session（同一任务下的并行执行体）
         ├─ id        会话标识
         ├─ taskId    所属任务
         ├─ ide       cursor | kiro | codex | windsurf | claude-code …
         ├─ agent     执行体身份
         ├─ status    active | idle | done
         └─ worktree  物理工作树路径 + 隔离分支 <owner>/<task>[/<session>]
```

为什么需要 Session：现实中同一个 Task（如 "Refactor Auth"）常被拆成
`Cursor Session A（后端）/ Cursor Session B（测试）/ Codex Session C（文档）`并行推进。
只有 Task 粒度无法表达，`loom session list` 必须能看到任务下的每个会话。

### 4.1 Ownership / Session 生命周期状态机（专家评审采纳）

现实中大量任务会"开到一半就死"：Agent 崩了、窗口关了、没人接手。此时 `owner = cursor-auth` 已无意义。
Loom 必须能回答"**这个任务还活着吗**"——这是未来 Dashboard 的核心。

Task 状态：

```
claimed ──> active ──> ready ──> landed
   │           │  ↑
   │           ↓  │
   │        paused│
   │           │  │
   └──> abandoned <┘     blocked（被热文件/landing gate 阻塞，可回到 active）
```

- `claimed` 已登记未开工 · `active` 进行中 · `paused` 暂停 · `blocked` 被阻塞 · `ready` 待落地 · `landed` 已合并 · `abandoned` 废弃。
- Session 状态：`active | idle | done | dead`（`dead` = 心跳/活跃信号超时，由 Loom 判定，触发 Task 重新归属或 abandon 提示）。
- 状态迁移可由 CLI 显式驱动，也可由活跃信号（提交、修改、心跳）自动推断。

为什么需要 Intent：Loom 不仅要知道"改了什么"，还要知道"为什么改"。

> **信号定级原则（专家评审采纳，强约束）**：**Path = Hard Signal（硬信号）/ Intent = Soft Signal（软信号）**。
> Phase 0–2 内 Intent **只用于显示 / 搜索 / 统计**，**不得**参与 attribution、lease、landing gate 的任何决策。
> 原因：路径重叠是确定的，而"什么算 backend / migration"定义不稳定，过早让 Intent 参与判定会引入误判。
> "Intent 驱动语义化风险评分（Risk Score）"是 v2+ 的平台演进方向，不进入早期决策路径。

设计铁律：

- **四个旧真相源（分支名、commit trailer、`## Agents` 块、audit 硬编码表）收敛为一个 Registry**；其余皆由 Registry 派生或校验，杜绝漂移。
- **身份用 Git 原生 per-worktree identity**（`git config --worktree user.name "<owner>"`）作为主依据，commit trailer 退化为冗余校验而非唯一手段。
- **paths 机器可匹配且尽量自动维护**（见 C1），避免 Registry 沦为又一份手维护的 YAML。

---

## 5. 产品功能（Capabilities）

按能力域划分，标注与现有资产的关系。

### C1 工作空间注册表（Registry）— 新建，单一真相源 + 自动学习

- 声明/查询/更新 Task / Session 的 owner、intent、paths、landingPolicy、status。
- 作为 `agent-attribution`、`worktree-audit`、committer、pre-commit 的统一数据源。
- 取代 `tasks.md` 中 `## Agents` 块的"四处手填"（可保留 `## Agents` 作为人类可读视图，由 Registry 生成）。
- **声明式 + 建议式学习（关键反负担设计，绝不自动改写）**：`paths` 不要求手工长期维护。
  - 首次 `loom register <task>` 登记意图；
  - Loom 观察该任务分支/会话的最近提交与修改，**推断**候选 paths；
  - `loom suggest` 输出边界更新建议（如"+ src/login/\*\*"）；
  - `loom accept` 由人确认后才写入 Registry。
  - **铁律：系统绝不 auto-update Registry**——自动改写会让 Registry 变黑盒、工程团队不敢信任。建议→确认两步，缺一不可。
  - 目的：杜绝"又一个三周后失效、最终被放弃的 YAML"。

### C2 隔离生命周期（Provisioning）— 新建，补最大空白

- `loom task start <id> --owner <agent>`：建 worktree + 分支 `<owner>/<task>` + 配 per-worktree 身份 + 写 Registry。
- `loom task land <id>`：跑审计 → 按 landing 顺序 merge/PR → 回收 worktree。
- `loom task abandon <id>`：安全回收。
- **安全策略**：遵守 OpenBot "人授权隔离"原则——provisioning 由**人显式授权后**经编排器执行，agent 不自行 `git worktree add` / 切分支。

### C3 归属与审计（Attribution）— 复用并升级

- 升级 `scripts/agent-attribution.ts`：数据源从 `## Agents` 块改为 Registry。
- 保留 `UNATTRIBUTED` / `CONFLICT` 判定与 `--fail-on-*` 门禁。

### C4 热文件治理（Hot-file Lease）— 新建，三层防线，产品真正的护城河

热文件（如 `render-model.ts`、共享类型文件）是隔离也消不掉的难点。Loom 用**三层递进**防护：

- **L1 Inform（告知）**：`auth.ts 正在被 cursor-auth-agent 编辑`——纯提示，不阻断。
- **L2 Soft Block（软阻断）**：他人继续编辑同一占用文件时提示`该文件已被占用，继续？[y/N]`。
- **L3 Landing Gate（落地闸门，最重要）**：真正危险的不是同时**编辑**，而是同时**landing**。
  - 两个任务都改了 `auth.ts` → **禁止同时 landing**；
  - 强制串行：`Auth → main 完成` 后 `Profile → rebase`，再 land。
- 跨任务热文件检测结合 **Intent 语义**（见概念模型），对长期热文件给出**架构拆分建议**。

### C5 集成编排（Landing Orchestrator）— 复用并通用化

- 复用 `worktree-audit.ts` 的分组与 `worktree-landing-groups` 的落地顺序。
- **把 OpenBot 特化的 `MERGE / ISOLATE / CLEAN` 抽象为通用 landing 策略**：
  - `parallel`：可与他流并行落地（如 `docs/**`）。
  - `serial`：需排队顺序落地（如 `src/ui/**`）。
  - `exclusive`：独占落地、期间禁止他流（如 `migration/**`）。
  - `manual`：必须人工批准才可落地（如 `schema` / `infra` / 不可逆迁移）。
- 策略按 path 配置，适用于任意仓库，不再绑定 OpenBot 文件布局。
- 提供"一次一可落地流"的暂存计划与门禁（沿用 pre-commit 思路）。

### C6 状态视图（Status / Dashboard）— 新建

- `loom status`：谁拥有什么、什么脏了、什么被阻塞、热文件冲突预警。
- 首期 CLI 文本表；后续可做 IDE 扩展面板。

---

## 6. 架构

```
            ┌─────────────────────────────────────────────┐
            │                  Loom Core                   │
            │  ┌───────────────┐   ┌────────────────────┐  │
            │  │   Registry    │←──│  Provisioning(C2)  │  │
            │  │ (单一真相源)   │   └────────────────────┘  │
            │  └──────┬────────┘                            │
            │         │  派生 / 校验                          │
            │  ┌──────┴───────┬──────────────┬───────────┐  │
            │  │ Attribution  │ Hot-file     │ Landing   │  │
            │  │   (C3)       │ Lease (C4)   │ Orch (C5) │  │
            │  └──────────────┴──────────────┴───────────┘  │
            └───────────┬─────────────────────┬─────────────┘
                        │ 调用                  │ 守卫
              ┌─────────┴────────┐    ┌─────────┴──────────┐
              │   Git (worktree, │    │  pre-commit hook / │
              │  per-worktree id)│    │   committer        │
              └──────────────────┘    └────────────────────┘
                        ▲                       ▲
            ┌───────────┴───────────────────────┴───────────┐
            │  IDE Agents: Kiro / Cursor / Codex / Windsurf  │
            │       （各自在自己的 worktree 目录内工作）        │
            └────────────────────────────────────────────────┘
```

要点：

- **本地优先**：Registry 是仓库内的版本化文件（如 `.loom/registry.*`），无需服务端。
- **Git 为执行底座**：worktree 提供物理隔离，per-worktree identity 提供原生归属。
- **守卫在边界**：pre-commit / committer 作为强制点，确保"只提交自己任务的文件"。
- **可配置、去耦合**：所有 OpenBot 专属路径知识进配置，核心保持仓库无关。

---

## 7. 实现路径（Roadmap）

### 7.0 产品形态顺序：CLI → IDE Extension → SDK（不可颠倒）

Loom 解决的是 **Git worktree / branch / commit / landing** —— 这些是**仓库级能力**，不是 IDE 能力。所以：

- **第一阶段 = CLI（核心逻辑全部在此）**：`loom task start / status / audit / land`。
- **第二阶段 = IDE 扩展（仅 View 层）**：在 Cursor/Kiro 等显示"当前 Session / Owner / Lease / Landing 状态"，**不承担核心逻辑**。
- **第三阶段 = SDK（`@loom/core`）**：最后出现，让 Cursor/Kiro/OpenHands/Claude Code 编程接入。

顺序反过来（先做 SDK 或插件）会把仓库级逻辑错放到 IDE 层，是反模式。

### 7.1 能力分阶段

分阶段、每阶段独立可用、向后兼容现有脚本。

> **MVP 边界（专家评审采纳，强约束）**：MVP = **Registry + Attribution + Audit**，命令只有 `loom register` / `loom status` / `loom audit`，解决最确定的价值——**"谁改了什么、是否安全合并"**。
> **Provisioning（隔离生命周期）是 v1.x，Hot-file Lease（三层防线）是真正的 v2**，均不进 MVP。不要让 MVP 背上 Registry/Session/Intent/Lease/Provisioning/Dashboard/SDK 全集。

**Phase 0（= MVP）— 真相源 + 归属 + 审计**

- 定义 Registry schema（Task → Session → Worktree + intent + landingPolicy + 生命周期 state）与文件格式。
- `loom register`：登记/更新任务与会话；`loom status`：谁拥有什么、什么脏了、任务存活状态；`loom audit`：归属 + landing 分组检查。
- 让 `agent-attribution` 读 Registry（兼容现有 `## Agents` 一段时间）。
- 把 `worktree-audit.ts` 规则外部化为 Registry 派生配置，`MERGE/ISOLATE/CLEAN` 映射为 `parallel/serial/exclusive/manual`。
- Intent 仅作软信号（显示/搜索/统计），**不参与**任何判定。
- 验收：同一脏树，迁移前后归属/分组/拦截结论一致（零回归）。

**Phase 1 — Provisioning（隔离生命周期，v1.x）**

- 实现 `task start / land / abandon` + Session 模型落地 + per-worktree 身份 + 生命周期状态机驱动。
- 验收：能在授权下自动开/合/收一个任务工作树，并列出任务下多 Session 与其存活状态。

**Phase 2 — Hot-file Lease（三层防线，v2）**

- 跨任务热文件检测（Path 硬信号为准）+ L1/L2/L3 防线（最关键 L3 Landing Gate 强制串行）。
- 验收：编辑期可预警占用，落地期能强制串行化。

**Phase 3 — 语义化与平台演进（v2+）**

- Intent 升级为 Risk Score 等语义信号，开始参与风险提示（仍以 Path 为硬判定底线）。

**Phase 4 — IDE Extension（仅 View）→ SDK 产品化打包**

- 抽离为独立可安装工具；在一个非 OpenBot 仓库跑通最小闭环。

---

## 8. 风险与权衡

| 风险           | 说明                                                                                | 缓解                                           |
| -------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------- |
| 磁盘/构建成本  | N 个 worktree = N 份工作副本 + N 份构建产物（`.build`、`ui/node_modules` 等不共享） | 共享 pnpm store；worktree 数量上限；按需 build |
| 隔离 ≠ 无冲突  | 热文件冲突只是从脏树推迟到 merge                                                    | C4 热文件治理 + landing 编排显式化             |
| 真相源漂移     | 旧四源若不退役会继续漂                                                              | Phase 0 强制收敛，旧块改为派生视图             |
| 与安全规则冲突 | "agent 不自行 provision"                                                            | provisioning 走人授权 + 编排器执行             |
| 通用化耦合     | 现有脚本深度绑定 OpenBot 路径                                                       | Phase 1 外部化配置，核心仓库无关               |

---

## 9. 成功指标

- 脏树 `UNATTRIBUTED` 率：→ 0。
- 并行任务编辑期交织事件：→ 0（隔离后）。
- landing 阶段"混合分组被拒"可在 pre-commit 自动拦截：100% 覆盖。
- 在 1 个外部仓库跑通最小闭环（产品化验证）。

---

## 10. 下一步

产品规划评审结论：**Approve with Changes（已采纳三项硬性修改：MVP 收敛到 Registry+Attribution+Audit；Intent 仅软信号；新增 Ownership/Session 生命周期状态机）**。

首个 spec 已创建于 `.kiro/specs/loom-workspace-orchestrator/`，范围锁定 **Phase 0（MVP）= Registry + Attribution + Audit**，命令 `loom register / status / audit`。Provisioning 留 v1.x，Lease 留 v2。

下一步：基于 `requirements.md` 推进 `design.md` 与 `tasks.md`。
