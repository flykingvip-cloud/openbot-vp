# Requirements Document

> 中文名：Loom 多 Agent 工作空间编排层 —— **MVP：真相源 + 归属 + 审计（Registry + Attribution + Audit）**
> 产品规划依据：`docs/design/multi-agent-worktree-orchestrator-2026-06-12.md`
> 本期范围 = Roadmap 的 Phase 0（MVP）。Provisioning（隔离生命周期，v1.x）、Hot-file Lease（三层防线，v2）、IDE 插件 / SDK 均不在本期。

## Introduction

Loom 是一层位于 **Git 之上、Agent 之下**的多 Agent 工作空间编排层，解决的是「多个 IDE / 多个 agent 在同一仓库、同一工作树并发修改时**如何不互相破坏**」（Workspace Governance），而不是「agent 如何更聪明」（Agent Intelligence）。

本仓库已被这个问题逼出一批补丁式工具，它们是 Loom 的直接前身：

- `scripts/agent-attribution.ts` —— 解析各 spec `tasks.md` 的 `## Agents` 块，把脏文件映射到 owner，标记 `UNATTRIBUTED` / `CONFLICT`。
- `scripts/worktree-audit.ts` —— 一张**硬编码**的 path → landing group 规则表（`MERGE` / `ISOLATE` / `CLEAN`）。
- `docs/design/worktree-landing-groups-2026-04-09.md` —— landing group 设计与落地顺序。
- `scripts/committer` + `git-hooks/pre-commit` —— 限定提交范围、拒绝危险混合暂存。
- `AGENTS.md` "Multi-Agent Collaboration & Commit Governance" —— 签名/归属/landing 纪律。

### 本期定位（Scope Framing）

MVP **只做最高杠杆、价值最确定的三件事：Registry + Attribution + Audit**，命令只有 `loom register` / `loom status` / `loom audit`，回答**"谁改了什么、是否安全合并"**。明确排除：

- **不**做 worktree 隔离生命周期（Provisioning，留 v1.x）。
- **不**做热文件 Lease 三层防线（留 v2）。
- **不**做 IDE 插件 / SDK（留更后）。

MVP 内含两件地基工作：

- **真相源收敛（Registry）**：当前归属信息散在四处（分支名、commit trailer、`tasks.md` 的 `## Agents` 块、`worktree-audit.ts` 的硬编码 path 表），必然漂移。本期建立**单一真相源 Registry**，让 `agent-attribution` 从 Registry 读取，`## Agents` 块退化为由 Registry 生成的人类可读视图。
- **审计去耦合（Audit）**：把 `worktree-audit.ts` 的 OpenBot 专属硬编码规则表外部化为 Registry 派生配置，并把 OpenBot 特化的 `MERGE / ISOLATE / CLEAN` 抽象为通用 landing 策略 `parallel / serial / exclusive / manual`，使审计可迁移到任意仓库。

### 现状与证据（Current State）

- 归属唯一可靠来源是各 spec `tasks.md` 的 `## Agents` 块；`agent-attribution.ts` 遍历 `.kiro/specs/*/tasks.md` 解析该块构建 path-glob → agent 映射（`scripts/agent-attribution.ts` 的 `loadAllClaims` / `parseAgentsBlock`）。
- 该块由人手工维护，`paths:` 字段缺失即落为 `UNATTRIBUTED`（身份不可恢复）。
- `worktree-audit.ts` 用大段 `exact(...)` / `prefix(...)` 硬编码规则，深度绑定 OpenBot 文件布局，换仓库即失效，且文件移动后规则会腐烂。
- landing 分组语义 `MERGE / ISOLATE / CLEAN` 是 OpenBot 内部语汇，不具备通用表达力。
- `git-hooks/pre-commit` 调用 cached 审计拒绝危险混合暂存（landing 纪律的强制点）。

### 概念模型（Target Model）

Registry 为单一真相源，采 **Option A 两表模型**（归属与审计分离，详见 design）：

```
Task（归属 / 一条意图线，互斥所有权）
 ├─ id / owner / intent[] / paths[]（硬信号，归属依据）
 ├─ state（生命周期） / sessions[] / metadata
 └─ Session（同一 Task 下的并行执行体）
     ├─ id / taskId / ide / agent / status(active|idle|done|dead|error)
     └─ worktree?（本期可空，隔离生命周期在后续期）

LandingStream（审计 / 落地流，可重叠 first-match）
 ├─ id / landingPolicy(parallel|serial|exclusive|manual)
 ├─ paths[]（硬信号，landing 分类依据）
 └─ canLandWith[]（可联合落地的 stream id，双向取交集）
```

> **为何分两表**：legacy 审计组允许重叠（first-match），而归属互斥（>1 命中 = CONFLICT）。单表会让审计组在共享文件上产生假归属 CONFLICT。归属读 `tasks`、审计读 `landingStreams`，互不污染。

任务生命周期状态机：

```
claimed ──> active ──> ready ──> landed
              │  ↑
              ↓  │
           paused
   active ──> blocked ──> active        active/paused/blocked ──> abandoned
```

- `claimed` 已登记未开工 · `active` 进行中 · `paused` 暂停 · `blocked` 被阻塞 · `ready` 待落地 · `landed` 已合并 · `abandoned` 废弃。
- Session `dead` = 活跃信号超时，由 Loom 判定，提示重新归属或废弃。

### 设计原则（强约束 / 非功能性需求）

1. **单一真相源**：归属与 landing 规则只有一个权威来源（Registry）；`## Agents` 块、audit 规则表、commit trailer 皆为其派生或冗余校验，不得成为并行真相源。
2. **Path = 硬信号 / Intent = 软信号**：归属、landing 判定**只依据 paths**（确定的路径重叠）；Intent 在本期**只用于显示/搜索/统计**，**禁止**参与任何 attribution / landing / 拦截决策（语义定义不稳定，过早参与会误判）。
3. **零回归**：本期为重构地基，现有 `agent-attribution` / `worktree-audit` / pre-commit 的**对外行为与判定结果不得改变**（同样的脏树得到同样的归属/分组/拦截结论）。
4. **反人工负担且绝不自动改写**：`paths` 支持建议式学习（`suggest`→人工 `accept`），系统**绝不**自动写 Registry（避免黑盒、保住信任）。
5. **仓库无关**：核心逻辑不得内嵌 OpenBot 专属路径；所有仓库特化知识进 Registry / 配置。
6. **本地优先**：Registry 是仓库内版本化文件，无需服务端。
7. **CLI 优先**：本期一切能力以 CLI 暴露；不引入 IDE 插件或 SDK。

## Glossary

- **Registry**：Loom 的单一真相源文件，记录 Task / Session / paths / intent / landingPolicy / state。
- **Task**：一条意图线（一个工作主题），可含多个并行 Session。
- **Session**：同一 Task 下的一个执行体（某 IDE 的某会话），未来绑定一个 worktree。
- **owner**：任务负责 agent 的稳定、人类可辨识标识（如 `kiro-daibai`）。
- **intent**：任务的语义标签（ui/backend/migration/test/docs）；本期为**软信号**，仅显示/搜索/统计，不参与判定。
- **Path = 硬信号 / Intent = 软信号**：归属与 landing 只依据路径重叠（确定）；语义意图不参与决策（定义不稳定）。
- **landingPolicy**：通用落地策略 `parallel`（可并行）/ `serial`（需排队）/ `exclusive`（独占）/ `manual`（须人工批准）。
- **生命周期状态（state）**：`claimed / active / paused / blocked / ready / landed / abandoned`；Session 另有 `dead`（活跃信号超时）。
- **UNATTRIBUTED**：脏文件无任何任务的 paths 命中（身份不可恢复）。
- **CONFLICT**：脏文件被 >1 个任务的 paths 命中（共享热文件）。
- **派生视图**：由 Registry 生成、供人类阅读的产物（如 `tasks.md` 的 `## Agents` 块）。

## Requirements

### Requirement 1: 单一真相源 Registry

**User Story:** 作为多 agent 协作的维护者，我希望任务归属与 landing 规则有唯一权威来源，以便不再因四处手填而漂移。

#### Acceptance Criteria

1. 系统 SHALL 提供一个仓库内版本化的 Registry 文件，记录 **`tasks`（归属分区）**：Task（id / owner / intent[] / paths[] / state / sessions[] / metadata）与其下 Session（id / taskId / ide / agent / status / worktree?），以及 **`landingStreams`（审计分区）**：LandingStream（id / landingPolicy / paths[] / canLandWith[]）。
2. WHEN 读取归属或 landing 规则 THEN 系统 SHALL 以 Registry 为唯一权威来源，SHALL NOT 依赖 `tasks.md` 的 `## Agents` 块或 `worktree-audit.ts` 的硬编码表作为并行真相源。
3. Registry SHALL 有显式 schema 校验；WHEN Registry 文件不合 schema THEN 系统 SHALL 报出可定位的错误（字段 + 任务 id）而非静默放行。
4. Registry 的 `worktree` 字段在本期 SHALL 允许为空（隔离生命周期属后续期），其余字段语义 SHALL 完整可用。

### Requirement 2: 归属从 Registry 读取（agent-attribution 升级）

**User Story:** 作为维护者，我希望归属报告从 Registry 计算，且结论与现状一致，以便平滑替换旧的 `## Agents` 解析。

#### Acceptance Criteria

1. WHEN 运行归属检查 THEN 系统 SHALL 从 Registry 构建 path-glob → owner 映射，并对脏工作树文件产出归属结论，保留 `UNATTRIBUTED` / `CONFLICT` 语义。
2. 系统 SHALL 保留现有 `--json`、`--fail-on-unattributed`（含 `--check` 别名）、`--fail-on-conflict` 行为与退出码语义。
3. WHEN 同一脏树用旧 `## Agents` 数据与迁移后的 Registry 数据分别运行 THEN 两者产出的归属结论（每个文件的 owner / UNATTRIBUTED / CONFLICT）SHALL 一致（零回归门禁）。
4. glob 匹配语义（`dir/**`、`dir/*.ts`、`dir/foo*`、特殊字符转义）SHALL 与现有 `globToRegExp` 行为保持一致。

### Requirement 3: paths 声明式 + 建议式学习（反人工负担，绝不自动改写）

**User Story:** 作为任务 owner，我希望不必长期手工维护 paths，但任何变更都经我确认，以便 Registry 既不失效也不变黑盒。

#### Acceptance Criteria

1. 系统 SHALL 支持以最小信息登记任务（至少 id + owner + intent），`paths` 可后续补全。
2. WHEN 请求路径学习 THEN 系统 SHALL 观察该任务关联分支/提交与当前脏树修改，**推断**候选 paths globs（如把多个同目录文件归纳为 `dir/**`）。
3. 系统 SHALL 提供 `loom suggest`（输出建议）与 `loom accept`（人工确认后写入）两步流程；系统 SHALL NOT 自动改写 Registry 的 paths（绝不 auto-update）。
4. 自动学习/建议 SHALL NOT 跨任务越界（不得把他人任务命中的路径建议给本任务）。

### Requirement 4: Landing 策略通用化（去 OpenBot 耦合）

**User Story:** 作为产品化负责人，我希望 landing 分组用通用策略表达，以便适用于任意仓库。

#### Acceptance Criteria

1. 系统 SHALL 用通用策略 `parallel` / `serial` / `exclusive` / `manual` 表达 landing 行为，并支持按 path glob 配置策略；`manual` SHALL 表示该范围必须人工批准才可落地（用于 schema / infra / 不可逆迁移）。
2. 系统 SHALL 提供从现有 `MERGE / ISOLATE / CLEAN` 分组到通用策略的等价映射，使现有审计/暂存门禁行为不变。
3. WHEN 对同一脏树运行迁移前后审计 THEN 分组/拦截结论 SHALL 一致（零回归门禁）。
4. landing 策略表 SHALL 来自 Registry / 外部配置，SHALL NOT 以硬编码方式内嵌 OpenBot 专属路径于核心逻辑。
5. landing 策略判定 SHALL 仅依据 path（硬信号），SHALL NOT 依据 intent（软信号）。

### Requirement 5: 派生视图与向后兼容

**User Story:** 作为协作者，我希望仍能在 `tasks.md` 看到人类可读的 `## Agents` 信息，且现有命令不被破坏。

#### Acceptance Criteria

1. 系统 SHALL 能从 Registry 生成 `tasks.md` 的 `## Agents` 块作为**派生视图**（人类可读），且该视图 SHALL NOT 再作为归属计算的输入源。
2. 现有 `pnpm` 审计/归属脚本入口（如 `worktree:audit*` 系列与 attribution 命令）SHALL 继续可用，行为不变或为纯增量。
3. `git-hooks/pre-commit` 的危险混合暂存拦截 SHALL 在迁移后保持等价拦截能力。
4. 迁移 SHALL 可分步进行：在 Registry 与旧 `## Agents` 并存的过渡期内，系统 SHALL 提供一致性校验，标记两者不一致之处。

### Requirement 6: CLI 与本地优先

**User Story:** 作为开发者，我希望通过 CLI 完成登记、查询、审计与一致性校验，无需任何服务端。

#### Acceptance Criteria

1. 系统 SHALL 以 CLI 暴露本期能力：任务/会话登记与查询、归属检查、landing 审计、Registry 与派生视图的一致性校验、paths 学习/建议。
2. 所有状态 SHALL 持久化于仓库内版本化文件，SHALL NOT 依赖外部服务或网络。
3. CLI SHALL 提供机器可读输出（如 `--json`）以便接入 CI 与 pre-commit。
4. 本期 SHALL NOT 引入 IDE 插件或 SDK 接口（属 Phase 4 之后）。

### Requirement 7: 仓库无关与可迁移

**User Story:** 作为产品化负责人，我希望核心逻辑不绑定 OpenBot，以便沉淀为通用工具。

#### Acceptance Criteria

1. 核心归属/审计/学习逻辑 SHALL NOT 内嵌 OpenBot 专属文件路径；仓库特化知识 SHALL 仅存在于 Registry / 配置。
2. WHEN 在一个不含 OpenBot 路径约定的最小仓库中初始化 Registry THEN 系统的归属与审计能力 SHALL 可运行（不依赖 `.kiro/specs` 目录约定作为唯一入口）。
3. 系统 SHALL 提供初始化命令，从现有 `## Agents` 块与 `worktree-audit.ts` 规则**一次性导入**生成初始 Registry，作为迁移起点。

### Requirement 8: 安全与非回归

**User Story:** 作为维护者，我希望这次地基重构不削弱既有纪律，也不引入误判。

#### Acceptance Criteria

1. 本期改动 SHALL 为纯重构/增量：现有 pre-commit 拦截、CI 门禁的拒绝集合 SHALL NOT 被放宽。
2. 系统 SHALL NOT 读取或输出任何凭证/密钥；Registry SHALL 仅含路径、归属与策略元数据。
3. WHEN 迁移导致任一现有判定结论变化 THEN 系统 SHALL 在一致性校验中显式报告该差异，要求人工确认而非静默接受。

### Requirement 9: Intent 仅为软信号

**User Story:** 作为维护者，我希望 Intent 在本期只用于人看，不进入任何机器判定，以免语义定义不稳定导致误判。

#### Acceptance Criteria

1. 系统 SHALL 在本期将 intent 仅用于显示、搜索、统计/分组展示。
2. 系统 SHALL NOT 在 attribution（归属）、landing 策略判定、暂存/提交拦截中使用 intent 作为任何判定输入。
3. WHEN intent 缺失或不规范 THEN 系统的归属与审计结论 SHALL 完全不受影响（仅影响展示）。
4. 设计文档 SHALL 记录 "Path = 硬信号 / Intent = 软信号" 原则，作为后续阶段引入语义判定的演进边界。

### Requirement 10: Ownership 与 Session 生命周期状态机

**User Story:** 作为 Dashboard / 维护者，我希望知道每个任务和会话"是否还活着"，以便处理半途而废、Agent 崩溃、窗口关闭的僵尸任务。

#### Acceptance Criteria

1. Registry SHALL 为每个 Task 记录生命周期 `state ∈ {claimed, active, paused, blocked, ready, landed, abandoned}`，为每个 Session 记录 `status ∈ {active, idle, done, dead}`。
2. 系统 SHALL 允许通过 CLI 显式迁移状态，并 SHALL 校验非法迁移（如 `landed → active`）。
3. WHEN 某 Session 在可配置时限内无活跃信号（提交/修改/心跳） THEN 系统 SHALL 可将其标记为 `dead` 并在 `loom status` 中提示该任务可能需要重新归属或废弃。
4. `loom status` SHALL 按任务展示其 state、其下各 Session 的 status，以及该任务当前是否被阻塞（blocked）。
5. 状态机变更 SHALL 仅为元数据记录，本期 SHALL NOT 触发任何 worktree 创建/销毁（隔离生命周期属后续期）。

### Requirement 11: 共享基建路径的一等公民表示（消除假 CONFLICT）

**User Story:** 作为维护者，我希望 `package.json`、`AGENTS.md`、`.loom/registry.yaml`、`src/gateway/server-methods.ts` 这类**每个任务都必然要碰**的共享基建文件，在归属报告里显示为「共享 + 由谁落地」，而不是显示成 CONFLICT——否则 `--fail-on-conflict` 在任何真实脏树上都会红，闸门等于废掉。

#### 问题陈述（已量化，2026-07-26 实测）

归属分区语义是「>1 命中 = CONFLICT」（见 Glossary、R2、Architecture Rule #1）。这条对**功能路径**是对的，对**共享基建路径**是误报：共享文件被 N 个任务声明，是它们各自都要改这个文件的正常事实，不是抢占。两份独立快照：

| Registry 快照                           | tasks | ownership-overlap 告警 | 涉及不同路径 |
| --------------------------------------- | ----- | ---------------------- | ------------ |
| `release/baseline-recovery-20260725` 线 | 73    | **152**                | **146**      |
| `deploy/user-modeling-v92` 线           | 42    | 46                     | 49           |

出现频次最高的都是共享基建：`src/gateway/server-methods/*.pack.ts`(13)、`src/gateway/server-methods.ts`(10)、`src/gateway/method-scopes.ts`(10)、`ui/src/ui/app.ts`(10)、`deploy/production/RELEASE_RECORD.md`(10)、`package.json`(6)、`.loom/registry.yaml`(6)、`vitest.config.ts`(3)、`ui/src/i18n/locales/{en,zh-CN}.ts`(3)。

设计上已经意识到了一半：正因为「单表会让审计组在共享文件上产生假归属 CONFLICT」，才把 `tasks`（互斥）与 `landingStreams`（可重叠 first-match）拆成两表（见 Target Model 注）。但**归属侧没有对应的共享概念**，所以共享基建文件必然误报。

#### Acceptance Criteria

1. Registry SHALL 能把一条路径标记为**共享基建**并指定其**唯一 lander**（落地责任 agent/task），使「多任务声明」与「谁有权提交」分离。
2. WHEN 一个脏文件命中共享基建路径 THEN 归属 SHALL 输出独立判定 `SHARED`（含 lander 与共同声明方清单），SHALL NOT 输出 `CONFLICT`。
3. `--fail-on-conflict` SHALL 只对**非共享**路径的多owner命中失败；`SHARED` SHALL NOT 使闸门失败。SHALL 另有开关可把 `SHARED` 升级为失败（供严格审计）。
4. WHEN 一个共享文件的脏改动同时含 lander 之外的 agent 的 WIP THEN 系统 SHALL 仍能提示"该文件由 lander 落地"（保留 AGENTS.md 规则 2 的语义），SHALL NOT 因为标了共享就放过跨 agent 混提交。
5. 共享标记 SHALL 是**显式声明**、人工录入，SHALL NOT 由系统自动推断或自动写入（延续原则 4「绝不自动改写」）。
6. 变更 SHALL 通过 `loom check --strict` parity：对同一脏树，非共享路径的归属结论 SHALL 与变更前逐条一致（零回归，R8.3）；只有共享路径的判定从 `CONFLICT` 变为 `SHARED`。
7. `loom lint` 的 `ownership-overlap` SHALL 对已声明共享的路径降级或静默，使其只报**未登记**的重叠（真正需要 takeover 的信号）。
8. 该表示 SHALL 仓库无关：共享路径清单只存在于 Registry/配置，SHALL NOT 硬编码进核心逻辑（R7）。

#### 与既有条目的关系

- 与 **P1.3（LandingStream 显式 `priority` 取代隐式 first-match）**同属「隐藏治理规则显式化」。现状实例：`.loom/registry.yaml` 因 first-match 被分类到 `WPL`（WeCom Bundled Plugin Loading）这个毫不相干的落地流；两项宜合并设计、分别落地。
- 与 **R10.3（Session `dead` → 重新归属或废弃）**互补：R11 处理「共享文件的假冲突」，R10.3 处理「过期任务的真重叠」。二者不可互相替代，必须分开处置。

### Requirement 12: 目录型 `paths` 不得静默失效（correctness bug）

**User Story:** 作为登记了 `paths: src/foo/` 的 agent，我希望这条声明真的能认领 `src/foo/bar.ts`；如果它匹配不到任何东西，系统必须告诉我，而不是让我以为已经签到。

#### 问题陈述（已量化，2026-07-27 实测于 `deploy/user-modeling-v92` 线 registry）

`globToRegExp`（`scripts/loom/glob.ts`，从 `agent-attribution.ts` 逐字提取）只把 `*`/`**` 视为通配符，其余字符原样转义并两端锚定。因此**无通配符、以 `/` 结尾**的目录写法生成 `^src\/foo\/$`——`git status` 永远不会输出这样的路径，于是该声明**匹配不到任何文件，且不报错**。

| 指标                                    | 值                                                             |
| --------------------------------------- | -------------------------------------------------------------- |
| `task.paths` 总数                       | 316                                                            |
| 其中静默失效（无通配 + 尾斜杠）         | **33**                                                         |
| 受影响 task                             | **18 / 42**（含 `loom-workspace-orchestrator:kiro-loom` 自己） |
| 当前脏树 UNATTRIBUTED                   | 79 / 110                                                       |
| 若仅把这 33 条改成 `**` 后 UNATTRIBUTED | **62**（即 17 个文件仅因写法而丢失归属）                       |

这同时说明 design §3.10 把高 UNATTRIBUTED 全部归因为「其他 agent 的在途 WIP」是**不完整的**：其中一部分是本缺陷造成的假未签到。目录写法（`.kiro/specs/x/`、`scripts/loom/`、`src/fabric/`）在 registry 里是**主流写法**，也是 `loom import` 之外人工录入时最自然的写法，所以这不是个别笔误。

#### Acceptance Criteria

1. 系统 SHALL 使目录型 path 声明具备与 `dir/**` 等价的匹配语义，或 SHALL 在 lint 中把它报为**错误**——二者择一，SHALL NOT 维持"看起来已声明、实际匹配不到"的静默状态。
2. IF 选择读时归一化（`globToRegExp` 把 `dir/` 视作 `dir/**`）THEN 该变更 SHALL 视为判定行为变更，SHALL 通过 `loom check --strict` parity 并附差异清单（预期差异只有"UNATTRIBUTED → ATTRIBUTED/CONFLICT"方向）。
3. IF 选择数据迁移（把 registry 里 33 条改写为 `**`）THEN 迁移 SHALL 由维护者确认，SHALL NOT 由系统自动改写 Registry（原则 4）。
4. `loom lint` SHALL 新增检查：`paths` 中存在**不可能命中任何文件**的 glob（无通配且以 `/` 结尾）时报错并列出 task id 与该 path。
5. 修复后 SHALL 重测并记录 UNATTRIBUTED 前后对比，SHALL 更新 design §3.10 中关于 UNATTRIBUTED 归因的表述。
6. 该缺陷 SHALL 与 R11 分开评估：修复 R12 会**增加**真实命中数，从而可能让共享基建路径的 CONFLICT 变多（实测 9 → 10）；两者的 parity 差异清单不得混在一次变更里。

### Requirement 13: 终态任务必须释放路径（否则 Registry 只增不减）

**User Story:** 作为维护者，我希望把一个做完的任务标成 `landed` 之后，它就不再认领任何路径——否则"关闭任务"是个没有任何效果的动作，Registry 只会越积越脏。

#### 问题陈述（2026-07-27 实测于 `deploy/user-modeling-v92` 线）

`scripts/loom/attribution.ts` 与 `scripts/loom/lint.ts` 读 `registry.tasks` 时**完全不看 `task.state`**。配合另一个事实——registry 里 **42/42 个任务全是 `active`，从来没有任何任务被转过终态**——结果是：

- 已完成的工作永久占着它当初碰过的共享文件，持续抬高 CONFLICT；
- R10 的生命周期状态机（`claimed→active→ready→landed` / `→abandoned`）在归属侧**没有任何可观测效果**，所以没人用它；
- Registry 单调增长，`ownership-overlap` 只会涨不会跌。

这解释了为什么 R11/R12 之外还需要这一条：即便修好共享表示与死 glob，只要终态任务仍在认领路径，噪音就仍会随时间累积。

#### Acceptance Criteria

1. 归属判定 SHALL 跳过处于终态（`landed` / `abandoned`）的任务；`claimed` / `active` / `paused` / `blocked` / `ready` SHALL 继续认领（后者都是未完工的活）。
2. `loom lint` 的 `ownership-overlap` SHALL 同样排除终态任务：终态任务已不认领路径，不可能造成 CONFLICT，继续报会让噪音永远降不下来。
3. SHALL 提供显式开关（如 `attribute(..., { includeTerminal: true })`）恢复过滤前视图，供 parity 对比与历史审计使用。
4. WHEN 当前 registry 无任何终态任务 THEN 判定结果 SHALL 与变更前逐条一致（零回归；由既有 `loom check` parity 测试锁定）。
5. 关闭任务 SHALL NOT 覆盖 `session.lastSignalAt`——该时间戳是「这个 agent 何时失联」的证据；SHALL 只推进 `task.state` 与 `session.status`（`landed→done` / `abandoned→dead`）。注意 `applyRegister` 与 `transitionTask` 都会刷新 `lastSignalAt`，因此治理型批量关闭 SHALL NOT 走这两个入口。
6. 批量关闭 SHALL 有**计算式**守卫（而非手工名单）：任务若有当前脏文件命中其 paths、或其会话在可配置时限内仍有信号，则 SHALL NOT 被自动关闭。
7. 判定「任务是否可关」的依据 SHALL 可核验：spec `tasks.md` 勾选完成度、带 `Task: <spec>` trailer 的提交是否已进生产 SoT、声明路径在 SoT 上是否存在。SHALL NOT 仅凭静默时长关闭任务。
