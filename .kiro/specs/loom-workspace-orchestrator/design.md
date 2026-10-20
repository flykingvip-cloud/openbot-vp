# Design Document

> 中文名：Loom 多 Agent 工作空间编排层 —— **MVP：真相源 + 归属 + 审计（Registry + Attribution + Audit）**
> 需求：`.kiro/specs/loom-workspace-orchestrator/requirements.md`
> 产品规划：`docs/design/multi-agent-worktree-orchestrator-2026-06-12.md`
> 关联现状资产：`scripts/agent-attribution.ts`、`scripts/worktree-audit.ts`、`git-hooks/pre-commit`、`scripts/committer`、`docs/design/worktree-landing-groups-2026-04-09.md`

## Overview

> 本节即「背景与目标」。

### 1.0 定位（Scope Framing）

本期**不**做 worktree 隔离生命周期（Provisioning）、热文件 Lease、IDE 插件 / SDK。本期是**地基重构**：把当前散在四处、且深度绑定 OpenBot 的归属/landing 规则，收敛为一个**单一真相源 Registry**，并让现有两个脚本从 Registry 取数，行为**零回归**。

交付物 = 一个 Loom 核心库 + 一个 CLI（`loom register` / `loom status` / `loom audit` 及配套 `derive` / `check` / `import` / `suggest` / `accept`），现有 `agent-attribution.ts`、`worktree-audit.ts`、`pnpm worktree:audit*`、`pre-commit` 全部继续可用且结论不变。

### 1.1 两个目标

- **目标 A（收敛真相源）**：归属从 `tasks.md` 的 `## Agents` 块、landing 规则从 `worktree-audit.ts` 的硬编码表，统一迁到 Registry。旧来源退化为派生视图（`## Agents`）或一次性导入起点（audit 规则表）。
- **目标 B（通用化）**：把 OpenBot 特化的 `group` / `MERGE|ISOLATE|CLEAN` 抽象为 `task` 身份 + 通用 `landingPolicy（parallel|serial|exclusive|manual）`，核心逻辑不再内嵌任何 OpenBot 路径。

### 1.2 非目标（本期不做）

- 不创建/销毁 worktree、不切分支、不配 per-worktree 身份（Provisioning，后续期）。
- 不做热文件 Lease 三层防线（L1/L2/L3，后续期）。
- 不让 Intent 参与任何判定（仅显示/搜索/统计，R9）。
- 不引入 IDE 插件 / SDK。
- 不放宽任何既有 pre-commit / CI 拒绝集合（R8.1）。

## 2. 现状（As-Is，带证据）

### 2.1 归属：来自 `## Agents` 块

- `scripts/agent-attribution.ts` 遍历 `.kiro/specs/*/tasks.md`（`SPECS_DIR=".kiro/specs"`），用 `parseAgentsBlock` 抓 `## Agents` 段、`parseAgentRow` 解析 `- <agent-id> · role: … · paths: <glob,…> · since: …`，无 `paths:` 的行被丢弃 → 该路径落 `UNATTRIBUTED`。
- 路径匹配：`globToRegExp` 支持 `dir/**`、`dir/*.ts`、`dir/foo*`，并转义正则特殊字符；`attribute()` 对 `git status --porcelain=v1 -z` 的每个脏文件求 owner 集合：0 个 = `UNATTRIBUTED`，1 个 = 归属，>1 个 = `CONFLICT`。
- CLI：`--json`、`--fail-on-unattributed`（别名 `--check`）、`--fail-on-conflict`；失败 `process.exit(1)`。

### 2.2 审计：来自硬编码规则表

- `scripts/worktree-audit.ts` 定义 `AuditRule[]`：每条 `{ id, disposition: "MERGE"|"ISOLATE"|"CLEAN", group, title, matches }`，`matches` 由 `exact(...)` / `prefix(...)` / `oneOf(...)` 组合，**深度绑定 OpenBot 具体文件路径**。
- `classify()`：每个脏文件取**第一条命中**的 rule。
- `findRiskyMix()`：按 `rule.group` 去重出活跃组；`group==="D"`（Pure Guardrails）可伴随一个主组；主组 >1 即「风险混合」并拒绝；`allowedLinkedPrimaryGroups` 是少数允许的联合主组例外集合。
- 输出模式：`--paths-only` / `--manifest` / `--stage-plan` / `--json` / 人类文本；筛选：`--group`、`--cached`、`--overlap-with` + `--overlap-only|--current-only`；门禁：`--fail-on-unmatched`、`--fail-on-risky-mix`。
- `git-hooks/pre-commit` 调用 `worktree-audit.ts --cached --fail-on-unmatched --fail-on-risky-mix` 作为强制点；`pnpm worktree:audit*`（`package.json:345-350`）是人工入口。

### 2.3 提交纪律

- `scripts/committer "<msg>" <file...>`：先全量 unstage 再仅 `git add --force` 指定文件，禁止 `.` 与 `node_modules`，作用是把提交范围锁到本任务文件。

### 2.4 现状问题（本期要消除的）

- **四个并行真相源**：`## Agents` 块、`worktree-audit.ts` 规则表、分支名、commit trailer，彼此可漂移。
- **OpenBot 强耦合**：audit 规则表是上千行专属路径，换仓库即废、文件移动即腐烂。
- **归属靠手填 `paths:`**：漏填即 `UNATTRIBUTED`，身份不可恢复。

## Architecture

> **Architecture Rule #1（不可违反）**：**Path = Deterministic（确定）/ Intent = Probabilistic（概率）**。
> 一切归属、landing、拦截判定**只**建立在 path（确定性）之上；intent 永不参与决策（仅显示/搜索/统计）。
> MVP 必须建立在确定性规则上，这是基础设施可信的前提。

> 方案（To-Be）。核心：**一个 Registry 真相源 + 一个 Loom 核心库 + 薄 CLP/适配层**。现有两脚本改为 Registry 的消费者。

```
                       .loom/registry.yaml   ← 单一真相源（版本化）
                                │  (zod 校验)
                                ▼
                    ┌──────────────────────────┐
                    │   Loom Core (scripts/loom)│
                    │  registry / glob / attrib │
                    │  audit / derive / learn   │
                    └───────────┬──────────────┘
            ┌───────────────────┼───────────────────────┐
            ▼                   ▼                         ▼
   agent-attribution.ts   worktree-audit.ts        loom CLI (loom.ts)
   (改为读 Registry)       (改为读 Registry)         register/status/audit
            ▲                   ▲                    derive/check/import
            │                   │                    suggest/accept
       CI / 人工            pre-commit (--cached
                            --fail-on-unmatched
                            --fail-on-risky-mix)
```

### 3.1 接缝一：Registry 真相源（R1）

- 位置：`.loom/registry.yaml`（YAML，仓库已依赖 `yaml@^2.8.2`；人类可读 + 可注释）。可选 `.loom/config.yaml` 放仓库级开关（如 `specsViewDir` 默认 `.kiro/specs`）。
- 校验：`zod@^4`（仓库已依赖）定义 schema，加载即校验，不合规报「字段 + 任务 id」可定位错误（R1.3）。
- 内容（Option A 两表）：`tasks[]`（归属：`id / owner / intent[] / paths[] / state / sessions[]`）与 `landingStreams[]`（审计：`id / landingPolicy / paths[] / canLandWith[]`）。
- `worktree` 字段允许为空（R1.4）。

### 3.2 接缝二：归属读 Registry（R2）

- 新增 `scripts/loom/attribution.ts`：`buildOwnerMatchers(registry)` → `attributeDirtyTree()`，复刻现有 `globToRegExp` / status 解析 / `UNATTRIBUTED`·`CONFLICT` 语义**逐字节对齐**（R2.1/R2.4）。
- `scripts/agent-attribution.ts` 改为薄包装：数据源从 `loadAllClaims()`（解析 `## Agents`）切到 `loadRegistry()`，保留全部 CLI flag 与退出码（R2.2）。
- 过渡期保留 `loadAllClaims()` 仅供一致性校验（见 3.6），不再作为归属输入。

### 3.3 接缝三：审计读 Registry + landing 策略通用化（R4）

- 新增 `scripts/loom/audit.ts`：rule 来源从硬编码 `AuditRule[]` 改为「由 Registry 的 `task.paths` + `task.landingPolicy` 派生的 rule 列表」。
- `classify()`（第一命中）、`findRiskyMix()`、所有输出模式（manifest/stage-plan/json/paths-only）与筛选 flag **保持算法不变**，仅把数据源换成 Registry 派生。
- **等价映射**（迁移用，保证零回归）：

  | 现状                         | Registry                         | 说明                                  |
  | ---------------------------- | -------------------------------- | ------------------------------------- |
  | `rule.group`                 | `landingStream.id`               | 风险混合判定单位 = stream             |
  | `disposition: MERGE`         | `landingPolicy: serial`          | 作为一条连贯流顺序落地                |
  | `disposition: ISOLATE`       | `landingPolicy: exclusive`       | 独占落地、禁止与他流混                |
  | `disposition: CLEAN`         | `landingPolicy: manual`          | 生成物/基线，仅在显式基线提交落地     |
  | `group: "D"`（Guardrails）   | `landingPolicy: parallel`        | 可伴随一个主流（pre-commit 既有行为） |
  | `allowedLinkedPrimaryGroups` | LandingStream 的 `canLandWith[]` | 局部声明（非全局表），见下方          |

- **风险混合判定的通用化定义**（与现状行为等价）：暂存可包含「任意多个 `parallel` 流 + 至多一个非 `parallel` 主流」；`manual` 流必须单独落地；互相 `canLandWith` 的流集合视为可联合。该定义在 OpenBot 数据下 SHALL 复现 `findRiskyMix` 的逐例结论（R4.2/R4.3）。
- **`canLandWith` 局部声明（评审采纳）**：联合落地关系**挂到对象上**而非全局白名单（全局表规模膨胀会失控）。`landingStream.canLandWith: [<otherStreamId>…]`，判定取双向交集（A 列 B 且 B 列 A 才算可联合）。迁移时把 `allowedLinkedPrimaryGroups` 的每个集合展开为相关 stream 的对称 `canLandWith`。
- **归属与审计分属两表（Option A）**：归属 = `tasks`（互斥所有权），审计 = `landingStreams`（可重叠 first-match）。两套 legacy 路径图互不污染，详见 Data Models。
- landing 判定**仅用 path**（硬信号），不读 intent（R4.5/R9.2）。

### 3.4 接缝四：派生视图与向后兼容（R5）

- 新增 `loom derive`：从 Registry 生成各 `tasks.md` 的 `## Agents` 块（人类可读派生视图）。生成内容**不再**作为归属输入（R5.1）。本期 `derive` 仅按需运行/校验，不强制自动写入（避免噪声）。
- `pnpm worktree:audit*` 入口与 `git-hooks/pre-commit` 的调用**保持不变**：因 `worktree-audit.ts` 内部换源但 CLI 契约不变，pre-commit 的 `--cached --fail-on-unmatched --fail-on-risky-mix` 拦截等价（R5.2/R5.3）。

### 3.5 接缝五：一次性导入（R7.3）

- 新增 `loom import`：读现有 `worktree-audit.ts` 的 `AuditRule[]` 与各 `## Agents` 块，生成初始 `.loom/registry.yaml`。导入是**迁移起点**，产出后由人 review。
- **两表来源（Option A）**：
  - `landingStreams` ← 审计 rules：每个 `group` 一条 stream，paths = exact globs + prefix（`prefix**`），policy 由 disposition 映射，`canLandWith` 由 `allowedLinkedPrimaryGroups` 对称展开。
  - `tasks` ← `## Agents`：每个 `(spec, agentId)` 一条 ownership task，owner = agentId，paths = 该行 globs。
- **冲突报告（不自动猜）**：两表独立，审计组重叠不再污染归属。仍需人裁决的冲突 = **跨 agent 的 ownership glob 重叠**（潜在归属 CONFLICT），产出 `import-conflicts` 报告。
- **legacy `## Agents` sanitize 行为忠实复刻**：legacy 解析会从整行剥离 `**`（markdown 粗体），路径 glob 亦受影响。为保证归属 parity，`loom import` 与 parity 读取器**同样剥离**；产出的退化 glob 由人在 review/`accept` 时修正。
- 导入后 `worktree-audit.ts` 的硬编码 `rules` 数组将被**冻结为 golden fixture**（仅供 3.6 一致性测试），核心运行路径不再使用，最终在 parity 验证通过后删除。

### 3.6 零回归校验 — Shadow Mode（迁移核心命令，R2.3/R4.3/R8.3）

> 这是整个迁移的**核心命令**，不是辅助命令。迁移采用 Shadow Mode：旧系统 → Registry 双跑 → diff → 切换，而非"重写→上线→祈祷"。

- 新增 `loom check`：对**当前脏树**同时用「旧路径（`## Agents` + 硬编码 rules）」与「新路径（Registry）」计算归属与审计结论，逐文件 diff：
  - 归属：每文件 owner / UNATTRIBUTED / CONFLICT 必须一致。
  - 审计：每文件命中的流、`unmatched` 集合、`riskyMix` 结论必须一致。
  - 任一差异 → 退出码非 0 并列出差异（要求人工确认，R8.3），不静默接受。
- `loom check --strict` 作为 **CI Gate**：只要「旧结论 ≠ 新结论」直接失败，这是实现"零回归切换"的强制闸门。
- 作为 CI 门禁与迁移验收的硬性 gate。

### 3.7 学习与建议（R3，绝不自动写）

- 新增 `scripts/loom/learn.ts`：`loom suggest [task]` 观察该任务关联分支/提交（`git log`）与当前脏树修改，归纳候选 globs（同目录多文件 → `dir/**`），输出**带置信度的建议**，不越界到他人任务命中路径（R3.4）。
- **置信度输出（评审采纳）**：每条建议附 `confidence`（如 `src/auth/** 93%`、`src/session/** 48%`），区分高质量建议与噪声，也为后续自动化留接口。
- `loom accept <task>` 才把确认后的建议写入 Registry；系统**绝不** auto-update（R3.3）。

### 3.8 生命周期状态机（R10）

- Registry 记录 `task.state ∈ {claimed,active,paused,blocked,ready,landed,abandoned}`、`session.status ∈ {active,idle,done,dead,error}`。
- 状态迁移经 CLI 显式触发，非法迁移（如 `landed→active`）被 schema/守卫拒绝（R10.2）。
- `loom status` 展示每任务 state + 其下 session status + 是否 blocked（R10.4）。
- `session.status=dead`：session 在可配置时限内无活跃信号（提交/修改/心跳）→ 由 `loom status` 提示（R10.3）。
- **`lastSignalAt` 更新来源（评审采纳，闭环）**：MVP 阶段，**任何成功的 Loom CLI 写操作**（`register` / `accept` / 状态迁移）都刷新对应 session 的 `lastSignalAt`。无此闭环 `dead` 永远不会正确触发。
- `session.status=error`（评审采纳）：**执行失败**（区别于 `dead`=窗口消失/无信号）。两者语义不同，Dashboard 需分别呈现。
- 本期纯元数据，**不触发**任何 worktree 操作（R10.5）。

### 3.10 未签到（UNATTRIBUTED）治理:commit 边界签到（评审采纳）

**问题**:`## Agents` 手工签到是自愿/带外的,实际工作树里绝大多数脏文件长期 UNATTRIBUTED(实测 307 脏 / 294 未签到)。

**根因与正确边界**:未提交的编辑在 Git 里没有 author,**无法对整棵脏树集中归属**——你无法知道某个未提交文件是哪个 agent 在改。因此对整树"把所有文件都归属掉"是错误方向;**唯一确定的归属边界是 commit**——提交那一刻确知「哪些文件 + 谁在提交」。整树的 UNATTRIBUTED 主要是其他 agent 的在途 WIP,属预期噪声,应在各自 commit 时被认领。

**解法(落在 commit 边界,低摩擦)**:

- `loom claim --owner <id> [--staged | --paths a,b]`(或 `LOOM_AGENT` 环境变量):**一步签到**——把本 agent 正在提交的文件认领到其 catch-all 任务 `agent:<id>`。绝不抢占他人已拥有的路径(命中他人 task 的文件自动跳过)。消除"忘记手工编辑 `## Agents`"的摩擦。
- `loom unattributed [--staged] [--json]`:**盲点排查**——列出(整树或暂存集)未签到文件,按目录归并,并直接给出 `loom claim --staged --owner <you>` 建议。
- **推荐的 pre-commit 软门禁(留待维护者接线)**:提交时若暂存文件存在未签到,提示 `loom claim --staged --owner <me>`(先 warn 不阻断,稳定后转 required)。把"软规范"变成"提交时不可忽视的提醒"。

**为何不自动归属**:`claim` 需要 owner(agent 身份),而身份无法从未提交编辑推断(Git 限制)。因此签到必须由 agent 显式声明身份(`--owner`/`LOOM_AGENT`),只是把声明动作压缩为一条命令、并发生在确定的 commit 边界。

### 3.9 Registry Linter `loom lint`（评审采纳，Wave 2）

zod 只能校验**结构**，业务一致性需专门 linter。`loom lint` 检查：

- 重复 `task.id`；
- 空 `owner`；
- `canLandWith` 指向不存在的 stream；
- 跨 task 的 `paths` glob 重叠（潜在归属 CONFLICT 预警）；
- `paths` 为空但 `state=active` 的任务（疑似未补全归属）。

输出可读报告 + `--json`；`--strict` 时任一问题非零退出，可挂 CI。属 Wave 2（基础设施稳定后），未来价值高。

### 3.11 共享基建路径：`SHARED` 判定（R11，Wave 3）

**问题**（实测 2026-07-26）：归属分区的「>1 命中 = CONFLICT」对功能路径正确，对共享基建路径是**误报**。SoT 线 registry 上 `loom lint` 报 **152 条 `ownership-overlap`、涉及 146 条路径**，头部全是每个任务都必然要碰的文件（`src/gateway/server-methods.ts` 10 次、`ui/src/ui/app.ts` 10 次、`package.json` 6 次、`.loom/registry.yaml` 6 次…）。后果：`agent-attribution --fail-on-conflict` 在任何真实脏树上都会红，闸门实际不可用——只能靠人工逐条判断"这条冲突是真的吗"，而这正是 Registry 想消灭的黑盒。

**根因**：§3.1 把 `tasks`（互斥）与 `landingStreams`（可重叠 first-match）拆表，已经承认"共享文件上不该产生假归属冲突"，但**只在 landing 侧解决了**。归属侧缺一个「共享 + 指定 lander」的表示，于是共享文件只能以 CONFLICT 形式出现。

**解法（表示层，不改判定语义）**：把「谁声明了这个文件」与「谁有权落地这个文件」拆开。

```ts
// 候选 A（推荐）：Registry 顶层新增共享分区，与 tasks / landingStreams 并列
export const SharedPathSchema = z.object({
  glob: z.string().min(1),
  lander: z.string().min(1), // 唯一落地责任方（agent id 或 taskId）
  reason: z.string().optional(), // 为何共享（供人读，不参与判定）
});
// RegistrySchema: { version, tasks, landingStreams, sharedPaths: SharedPath[] }

// 候选 B：在 task.paths 上加 per-path 修饰（如 "shared:package.json"）
//   —— 否决：污染 HARD 信号的 glob 语法，且共享事实会散落在 N 个 task 里，无单一真相。
```

归属判定改为三值，`attribution.ts` 的 `verdictOf` 从 2 值扩到 3 值：

```
命中 0 个 task                     -> UNATTRIBUTED（不变）
命中 1 个 task                     -> ATTRIBUTED  （不变）
命中 >1 且路径已登记 sharedPaths    -> SHARED      （新；带 lander + 共同声明方清单）
命中 >1 且路径未登记                -> CONFLICT    （不变；这才是 takeover-pending 信号）
```

闸门语义（R11.3）：`--fail-on-conflict` 只对 `CONFLICT` 失败；`SHARED` 不失败，另加 `--fail-on-shared` 供严格审计。`SHARED` 的报告行必须打印 lander，保留 AGENTS.md 规则 2 的可执行性（"该文件由其 lander 落地，别提交他人 WIP"）。

**零回归与迁移**（R11.6）：

1. 先只加 schema + 判定，`sharedPaths` 为空 → 行为与今天逐字节相同（parity 基线）。
2. `loom check --strict` 双跑：非共享路径的结论必须逐条一致；只允许"CONFLICT → SHARED"这一类差异。
3. 再由维护者**显式**登记共享路径（R11.5 绝不自动推断）。首批候选就是上面那张频次表。
4. `loom lint` 的 `ownership-overlap` 对已登记路径降级/静默（R11.7），使它回到只报未登记重叠的有效告警。

**与 P1.3 的关系**：同属"隐藏治理规则显式化"。现状实例：`.loom/registry.yaml` 因 landingStream 数组顺序被 first-match 分到 `WPL`（WeCom Bundled Plugin Loading），与该文件毫无关系；`priority` 落地后这类错分类会消失。两项宜合并设计、分别落地，都要 parity 门禁。

**边界**：R11 只处理"共享文件的假冲突"。**过期任务造成的真重叠**（session 死了 6–10 天但 `state` 仍 `active`）走 R10.3 既有路径（`loom status` 标 dead → 重新归属或 `loom task abandon`），需人工逐任务判定，不得由 R11 顺手掩盖。

### 3.12 目录型 `paths` 静默失效（R12，correctness bug，优先于 §3.11）

**证据**（2026-07-27 实测）：`globToRegExp` 只识别 `*`/`**`，其余字符转义后两端锚定：

```ts
globToRegExp("scripts/loom/"); // => /^scripts\/loom\/$/      永不命中任何 git status 路径
globToRegExp("scripts/loom/**"); // => /^scripts\/loom\/.*$/     命中目录内文件
```

于是「无通配 + 尾斜杠」的目录声明**匹配不到任何文件且不报错**：

| 指标                                       | 值                                                             |
| ------------------------------------------ | -------------------------------------------------------------- |
| `task.paths` 总数                          | 316                                                            |
| 静默失效条数                               | **33**                                                         |
| 受影响 task                                | **18 / 42**（含 `loom-workspace-orchestrator:kiro-loom` 本身） |
| 脏树 UNATTRIBUTED（现状 → 仅修 glob 形态） | **79 → 62**                                                    |

**这修正了 §3.10 的归因**：那里把高 UNATTRIBUTED 全部解释为"其他 agent 在途 WIP，属预期噪声"。实测至少 17 个文件是**本缺陷造成的假未签到**——声明已经写了，只是永远不命中。在修完 R12 之前，用 UNATTRIBUTED 数量评估签到覆盖率会系统性偏悲观。

**两条修法，二者择一（R12.1）**：

|      | A. 读时归一化                                                                                                                      | B. 数据迁移                                               |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 做法 | `globToRegExp` 把 `dir/` 当作 `dir/**`                                                                                             | 把 registry 里 33 条改写为 `dir/**`                       |
| 优点 | 一次修完，未来新写法也不会踩                                                                                                       | 不改判定语义，parity 风险最低                             |
| 缺点 | **判定行为变更**，必须过 `loom check --strict` parity（R12.2）；`glob.ts` 注释明写"语义不得与 legacy 分叉"，改它等于改 legacy 契约 | 治不了未来新录入；须维护者确认，系统不得自动改写（R12.3） |
| 倾向 | A + `loom lint` 新检查兜底；先在 shadow 模式下出差异清单再切                                                                       | —                                                         |

无论选哪条，`loom lint` 都要新增「不可能命中的 glob」错误项（R12.4），把静默失效变成显式失败。

**与 §3.11 的顺序**：R12 先做。修 R12 会**增加**真实命中，从而可能把共享基建路径的 CONFLICT 推高（实测 9 → 10），所以先修 R12、拿到稳定的冲突基线，再做 R11 的共享表示；两者的 parity 差异清单不得混在一次变更里（R12.6）。

### 3.13 终态任务释放路径（R13，已落地）

**证据**：`attribution.ts` / `lint.ts` 原本对 `registry.tasks` 一视同仁，不读 `state`；而 registry 里 42/42 个任务全是 `active`（从没有人转过终态）。两者叠加 ⇒ 「关闭任务」是个空动作，`ownership-overlap` 只增不减，R10 的状态机在归属侧没有可观测效果。

**实现**（`scripts/loom/attribution.ts`）：

```ts
export const TERMINAL_TASK_STATES = new Set<Task["state"]>(["landed", "abandoned"]);

export function buildTaskMatchers(registry: Registry, options: AttributionOptions = {}) {
  const tasks = options.includeTerminal
    ? registry.tasks
    : registry.tasks.filter((task) => !TERMINAL_TASK_STATES.has(task.state));
  return tasks.map((task) => ({ task, regexps: task.paths.map(globToRegExp) }));
}
```

`lint.ts` 的 `ownership-overlap` 用同一常量排除终态任务（R13.2）。`includeTerminal: true` 保留过滤前视图供 parity/历史审计（R13.3）。当前 registry 若无终态任务，判定逐条不变——由既有 `loom check` parity 测试锁定（R13.4）。

**批量关闭的两条铁律**（都在实践中踩过）：

1. **不许覆盖 `lastSignalAt`**。`applyRegister` 与 `transitionTask` 都会 `touchSignal` 全部会话，把"这个 agent 10 天前失联"刷成"刚刚活跃"，正好抹掉判断依据。治理型关闭只改 `task.state` 与 `session.status`（`landed→done` / `abandoned→dead`），时间戳原样保留（R13.5）。
2. **守卫必须是计算式**，不能是手写名单：任务若有当前脏文件命中其 paths、或会话在阈值内仍有信号，就不动它（R13.6）。首次执行时这条守卫挡住了 17 个仍在被改的任务，并使归属判定前后**完全不变**——这正是"清理没有误伤任何在途工作"的证明。

**首次执行结果**（`deploy/user-modeling-v92` 线）：删 1 条空 paths 条目、5 条 → `abandoned`（从无提交带其 trailer）、8 条 → `landed`（spec 全勾 + 提交在 SoT + 路径在 SoT）；42 → 41 tasks（28 active / 8 landed / 5 abandoned），`ownership-overlap` 46 → 34，脏树判定 25/9/71 不变，`loom lint` 0 error。

## Components and Interfaces

> 新代码集中在 `scripts/loom/`（核心库）+ `scripts/loom.ts`（CLI 入口）；现有两脚本改为薄包装。

### C1. Registry schema 与加载（`scripts/loom/registry.ts`）

- `LoomRegistry` zod schema（见 Data Models）；`loadRegistry(cwd): LoomRegistry`（读 + 校验 + 友好报错）；`saveRegistry()`（供 accept/状态迁移，原子写）。

### C2. Glob 匹配（`scripts/loom/glob.ts`）

- 从 `agent-attribution.ts` 抽出 `globToRegExp` 与 status 解析，作为唯一实现，供 attribution / audit / learn 共用，保证语义一致（R2.4）。

### C3. 归属（`scripts/loom/attribution.ts`）

- `attribute(registry, dirtyEntries): Attribution[]`，读 `registry.tasks`（归属分区），沿用 `{ path, status, owners[] }` 结构与 UNATTRIBUTED/CONFLICT 判定。

### C4. 审计（`scripts/loom/audit.ts`）

- `deriveRules(registry): Rule[]`（`registry.landingStreams` → rule，policy → 行为）；`classify` / `findRiskyMix` / 输出模式与现状算法一致，仅换源。

### C5. CLI（`scripts/loom.ts`）

分两波交付，先稳基础设施再开放智能能力：

- **Wave 1（基础设施，本期核心）**：`import`（生成初始 Registry）、`status`（C3 + 生命周期视图，`--json`）、`audit`（C4，转发既有 flag）、`check` / `check --strict`（Shadow-mode 零回归 CI gate）。
- **Wave 2（同期但次序靠后）**：`register`（登记/更新 task/session；过渡期亦可直接手编 YAML）、`derive`（生成 `## Agents` 派生视图）、`suggest` / `accept`（带置信度的路径学习，绝不自动写）、`lint`（Registry 业务一致性校验，见 §3.9）。
- 全部子命令支持机器可读输出（`--json`），供 CI/pre-commit 接入（R6.3）。

### C6. 现有脚本薄包装（兼容层）

- `scripts/agent-attribution.ts`、`scripts/worktree-audit.ts` 内部改调 C3/C4，保留各自 CLI 契约与退出码；`pnpm worktree:audit*`、`pre-commit` 不改调用方式（R5.2）。

## Data Models

> 新增 `.loom/registry.yaml`，由以下 zod schema 校验（TypeScript 表达）。
>
> **Option A 两表模型（评审采纳）**：legacy 有两套独立路径图——审计组（overlap-OK，first-match）与 `## Agents` 归属（互斥，>1 命中 = CONFLICT）。单一 task 集的 `paths` 同时驱动两者会让审计组在共享文件（如 `package.json` ∈ 多组）上产生**假归属 CONFLICT**。故拆为两表：**`tasks`（归属分区）** 与 **`landingStreams`（审计分区）**。归属读 `tasks`，审计读 `landingStreams`，互不污染。

```ts
const LandingPolicy = z.enum(["parallel", "serial", "exclusive", "manual"]);
const TaskState = z.enum([
  "claimed",
  "active",
  "paused",
  "blocked",
  "ready",
  "landed",
  "abandoned",
]);
const SessionStatus = z.enum(["active", "idle", "done", "dead", "error"]);

const Session = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  ide: z.string().min(1), // cursor | kiro | codex | windsurf | claude-code | …
  agent: z.string().min(1),
  status: SessionStatus.default("active"),
  worktree: z.string().optional(), // 本期允许为空（Provisioning 在后续期）
  lastSignalAt: z.string().optional(), // ISO；任何成功 Loom 写操作刷新，用于 dead 判定
  metadata: z.record(z.string(), z.unknown()).default({}), // 扩展槽
});

// 归属分区（attribution + lifecycle）。互斥：>1 命中 = CONFLICT。
const Task = z.object({
  id: z.string().min(1),
  owner: z.string().min(1), // 稳定、人类可辨识，如 kiro-daibai
  intent: z.array(z.string()).default([]), // 软信号：仅显示/搜索/统计
  paths: z.array(z.string()).default([]), // 硬信号：归属依据（互斥所有权）
  state: TaskState.default("active"),
  sessions: z.array(Session).default([]),
  since: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}), // 扩展槽，如 { jira, spec, … }
});

// 审计分区（landing）。可重叠、first-match。
const LandingStream = z.object({
  id: z.string().min(1),
  landingPolicy: LandingPolicy.default("serial"),
  paths: z.array(z.string()).default([]), // 硬信号：landing 分类依据
  canLandWith: z.array(z.string()).default([]), // 可联合落地的 stream.id（双向取交集）
  metadata: z.record(z.string(), z.unknown()).default({}),
});

const LoomRegistry = z.object({
  version: z.literal(1),
  tasks: z.array(Task), // 归属分区
  landingStreams: z.array(LandingStream).default([]), // 审计分区
});
```

- **`metadata` 扩展槽（评审采纳）**：Task/Session 各带 `metadata: {}`，承接未来"还想挂点东西"（jira、spec 链接等），避免每次都改 schema。
- **联合落地改为 Task 局部 `canLandWith`**，移除全局 `linkedStreams`（避免全局白名单膨胀失控）。
- **不含任何凭证/密钥**，仅路径、归属、策略、状态元数据（R8.2）。
- 内部对象（Attribution、Rule、StatusEntry）沿用现有脚本的结构，不新增持久化模型。

### Schema Evolution（版本演进策略，评审采纳）

为避免将来 `version: 2` 成为灾难，加载流程内置升级链：

```
读文件 → 检测 version → upgrade 链（v1→v2→…→latest）→ 校验 latest schema → 使用
```

- `loadRegistry` 先读 `version`，按需逐级跑 `upgraders[]`（每个 `(old) => next`），最后用最新 schema 校验。
- 升级是**纯函数、可测试**；未知的更高 version → 明确报错并提示升级 Loom（不静默降级）。
- MVP 仅 `version: 1` 且 `upgraders` 为空，但加载器结构先就位。

## Correctness Properties

### Property 1: 单一真相源

归属与 landing 判定的唯一输入是 Registry；`## Agents` 块与硬编码 rules 不再进入运行路径（仅派生/导入/校验用）。
**Validates: Requirements 1.2, 2.1, 5.1**

### Property 2: 归属零回归

同一脏树，旧路径（`## Agents`）与新路径（Registry）产出的每文件 owner / UNATTRIBUTED / CONFLICT 结论逐例一致。
**Validates: Requirements 2.3**

### Property 3: glob 语义一致

`dir/**`、`dir/*.ts`、`dir/foo*` 与正则特殊字符转义行为与现有 `globToRegExp` 完全一致。
**Validates: Requirements 2.4**

### Property 4: 审计零回归

同一脏树，迁移前后每文件命中流、`unmatched` 集合、`riskyMix` 结论逐例一致。
**Validates: Requirements 4.2, 4.3**

### Property 5: 绝不自动改写

`paths` 仅经 `loom suggest`→人工 `loom accept` 变更；任何代码路径都不 auto-update Registry。
**Validates: Requirements 3.3**

### Property 6: Intent 不参与判定

移除/打乱 intent 不改变任何归属、landing、拦截结论（仅影响展示）。
**Validates: Requirements 9.2, 9.3**

### Property 7: 生命周期合法性

非法状态迁移被拒；`loom status` 准确反映 state/status/blocked。
**Validates: Requirements 10.2, 10.4**

### Property 8: 仓库无关 + 无密钥

核心库不含 OpenBot 专属路径；在最小仓库可运行；Registry 不含任何凭证。
**Validates: Requirements 7.1, 7.2, 8.2**

### Property 9: pre-commit 等价拦截

`pre-commit` 在迁移后对同一暂存集的 unmatched/risky-mix 拒绝行为不变、不放宽。
**Validates: Requirements 5.3, 8.1**

## Error Handling

- Registry 不存在：`audit`/`status` 给出引导（运行 `loom import` 生成），不崩溃。
- Registry 不合 schema：报「字段 + task id」可定位错误并非零退出（R1.3）。
- `check` 发现旧/新差异：列出差异、非零退出，要求人工确认（不静默）（R8.3）。
- `suggest` 无可学习信号：输出空建议，不报错；`accept` 无待接受建议：明确提示。
- 非法状态迁移：拒绝并提示合法迁移集合。

## Testing Strategy

> 框架 Vitest（仓库标准）；核心是 **parity（黄金对照）测试**。

1. **Parity 单测**：固定一组 mock 脏树（含 modified/added/deleted/renamed/untracked），分别跑「冻结的旧 rules + `## Agents`」与「Registry」，断言归属与审计结论逐例相等（覆盖 Property 2/4/9）。
2. **Glob 单测**：迁移 `globToRegExp` 既有用例（覆盖 Property 3）。
3. **导入往返**：`loom import` 产出的 Registry 再喂回 audit，结论 = 原硬编码结论（迁移正确性）。
4. **Intent 不变性**：随机化/清空 intent，断言判定不变（Property 6）。
5. **生命周期**：合法/非法迁移、dead 判定（Property 7）。
6. **仓库无关**：在临时最小仓库初始化 Registry 跑 attribution/audit（Property 8）。
7. **回归保护**：复用 `test/worktree-audit.test.ts` 既有断言，确保兼容层 CLI 契约不变。

## 待审决策清单

- **D1（建议：YAML）**：Registry 序列化用 YAML（已依赖、可注释、人类友好）vs JSONC。倾向 YAML。
- **D2（建议：单文件）**：MVP 用单一 `.loom/registry.yaml`；任务规模膨胀后再分片（`.loom/tasks/*.yaml`）。
- **D3（建议：按需 derive）**：`## Agents` 派生视图按需 `loom derive` 生成/校验，不在本期强制自动写回各 `tasks.md`，避免大面积 diff 噪声。
- **D4（建议：先冻结后删）**：`worktree-audit.ts` 硬编码 rules 先冻结为 golden fixture 供 parity 测试，parity 全绿后再删除，降低迁移风险。
- **D5**：`session.status=dead` 的超时阈值默认值（如 24h 无信号）需与维护者确认。
