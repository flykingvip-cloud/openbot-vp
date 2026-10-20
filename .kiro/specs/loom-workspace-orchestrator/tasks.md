# Implementation Plan: Loom 工作空间编排层 — MVP（Registry + Attribution + Audit）

## Overview

本实施计划落地 `requirements.md` / `design.md` 定义的 **MVP 地基**：把当前散在四处、深度绑定 OpenBot 的归属/landing 规则，收敛为单一真相源 `.loom/registry.yaml`，并让现有 `scripts/agent-attribution.ts`、`scripts/worktree-audit.ts` 改读 Registry，**行为零回归**。核心方法论是 **Parity-First / Shadow Mode**：旧系统 → Registry → 双跑 → diff → 切换。

## Agents

- kiro-loom · role: owner · scope: Loom MVP core, registry, attribution/audit migration · paths: .kiro/specs/loom-workspace-orchestrator/**, scripts/loom/**, scripts/loom.ts, .loom/\*\* · since: 2026-06-12

### 技术栈锁定（不引入新栈）

- TypeScript（ESM），以 `node --import tsx` 运行（对齐 `package.json` 既有 `worktree:audit*` 脚本）。
- 校验用 `zod@^4`（已依赖）；序列化用 `yaml@^2.8.2`（已依赖，决策 D1）。
- 不引入 DB/MQ/服务端；不创建/销毁 worktree、不切分支（Provisioning 属后续期）。
- 不放宽任何既有 pre-commit / CI 拒绝集合（R8.1）。

### 架构铁律

- **Architecture Rule #1**：Path = 确定性 / Intent = 概率性。归属/landing/拦截判定**只**用 path，intent 永不参与决策（R9）。
- **Parity-First**：在 `loom check --strict` 对同一脏树「旧结论 == 新结论」全绿之前，**不切换**生产路径、**不删除**旧硬编码 rules。

### 已锁定决策（来自 design 待审清单）

- **D1**：Registry 序列化用 YAML（`.loom/registry.yaml`）。
- **D2**：MVP 单文件 registry；规模膨胀后再分片。
- **D3**：`## Agents` 派生视图按需 `loom derive` 生成，不在本期强制写回各 `tasks.md`。
- **D4**：`worktree-audit.ts` 硬编码 rules 先冻结为 golden fixture，parity 全绿后再删。
- **D5**：`session.status=dead` 超时阈值默认 24h 无信号（可配置）。

### 实施分波（对齐 design §3、§C5）

- **Wave 1（基础设施，parity-first）**：core schema/loader/glob → attribution core → audit core + 映射 → `import` → `check --strict` 双跑门禁 → 薄包装切换 → `status` + 生命周期 → CI 接入。
- **Wave 2（次序靠后）**：`register` + 状态迁移 → `derive` → `suggest`/`accept`（带置信度）→ 仓库无关验证。

## Tasks

- [x] 1. Wave 1：Loom core 地基（schema / loader / glob）
  - [x] 1.1 定义 Registry zod schema 与类型（`scripts/loom/registry.ts`）
    - 按 design Data Models 实现 `LandingPolicy` / `TaskState` / `SessionStatus`（含 `error`）/ `Session`（含 `metadata`、`lastSignalAt`）/ `Task`（含 `canLandWith`、`metadata`、预留 `stream` 注释）/ `LoomRegistry`。
    - 校验失败抛出含「字段 + task id」的可定位错误。
    - _Requirements: 1.1, 1.3, 1.4, 8.2, 10.1_
  - [x] 1.2 实现版本演进加载器（Schema Evolution）
    - `loadRegistry(cwd)`：读文件 → 检测 `version` → 跑 `upgraders[]`（MVP 为空）→ 最新 schema 校验；未知更高 version 明确报错不静默降级。
    - `saveRegistry()`：原子写（供后续 accept/状态迁移）。
    - 单测：v1 正常加载、坏 schema 报错、未知 version 报错。
    - _Requirements: 1.1, 1.3_
  - [x] 1.3 抽取共享 glob/status 模块（`scripts/loom/glob.ts`）
    - 从 `scripts/agent-attribution.ts` 抽出 `globToRegExp` 与 `git status --porcelain=v1 -z` 解析为唯一实现。
    - 迁移既有 glob 用例（`dir/**`、`dir/*.ts`、`dir/foo*`、特殊字符转义）为单测。
    - _Requirements: 2.4_

- [x] 2. Wave 1：归属 core（读 Registry）
  - [x] 2.1 实现 `scripts/loom/attribution.ts`
    - `attribute(registry, dirtyEntries)`：复刻 owner 集合判定与 `UNATTRIBUTED`(0)/归属(1)/`CONFLICT`(>1) 语义，结构 `{ path, status, owners[] }`。
    - 归属只用 `task.paths`（硬信号），不读 intent。
    - _Requirements: 2.1, 9.2_

- [x] 3. Wave 1：审计 core（读 Registry）+ 等价映射
  - [x] 3.1 实现 `scripts/loom/audit.ts` 的 rule 派生与分类
    - `deriveRules(registry)`：task → rule（`task.id`=流身份，`landingPolicy` 决定行为）；实现等价映射表（MERGE→serial / ISOLATE→exclusive / CLEAN→manual / Guardrails→parallel）。
    - `classify()`（第一命中）与现状算法一致。
    - _Requirements: 4.1, 4.4_
  - [x] 3.2 实现风险混合判定（通用化 `findRiskyMix`）
    - 定义：任意多 `parallel` + 至多一个非 `parallel` 主流；`manual` 必须单独；互相 `canLandWith` 视为可联合（双向交集）。
    - _Requirements: 4.1, 4.2_
  - [x] 3.3 复刻所有输出模式与筛选/门禁 flag
    - `--json` / `--manifest` / `--stage-plan` / `--paths-only` / 人类文本；`--group` / `--cached` / `--overlap-with` / `--overlap-only` / `--current-only`；`--fail-on-unmatched` / `--fail-on-risky-mix`。
    - landing 判定仅用 path，不读 intent。
    - _Requirements: 4.2, 4.5, 9.2_

- [x] 4. Wave 1：一次性导入 `loom import`（Option A：两表）

  > 采纳 Option A：`landingStreams`（审计，来自 rules）与 `tasks`（归属，来自 `## Agents`）分离，消除审计组重叠污染归属的假 CONFLICT。schema/audit/attribution/import 与测试已据此落地。— kiro-loom
  - [x] 4.1 从现状生成初始 `.loom/registry.yaml`
    - `buildLandingStreams`（rules→streams，exact/prefix→glob，disposition→policy，linked→对称 canLandWith）+ `buildOwnershipTasks`（`## Agents`→ownership tasks）+ `importFromLegacy`。
    - 跨 agent 的 ownership glob 重叠产出 `import-conflicts`；忠实复刻 legacy `**` 剥离行为以保归属 parity。
    - 产出后供人 review。
    - _Requirements: 7.3_
  - [x] 4.2 冻结旧 rules 为 golden fixture
    - `worktree-audit.ts` 重构为导出 `rules` / `extractRulePatterns` / `allowedLinkedPrimaryGroups` + main 守卫（行为中性：已用 HEAD 对照验证同为 57 passed / 5 pre-existing failed）；供 import 与 parity 读取。
    - _Requirements: 4.3_

- [x] 5. Wave 1：零回归校验 `loom check`（**Milestone M1 — Parity Complete ✅**）
  - [x] 5.1 实现 Shadow-mode 双跑 diff
    - `scripts/loom/check.ts`：`computeDiffs`（纯函数）+ `runCheck`（子进程跑真实 `worktree-audit.ts --json` / `agent-attribution.ts --json` 作旧结论）逐文件 diff 归属/审计/riskyMix。
    - **共享树竞态加固**：只比对双方都评估到的文件交集，appear/disappear 文件视为竞态噪声跳过（真实规则分歧仍捕获）。
    - _Requirements: 2.3, 4.3, 8.3_
  - [x] 5.2 `loom check --strict` 作 CI Gate
    - `--strict` 下旧≠新直接 `exit 1`；`--json` 机器可读；main 守卫支持直接 `node --import tsx scripts/loom/check.ts --strict`。
    - _Requirements: 2.3, 4.3_
  - [x] 5.3 Parity 黄金对照测试
    - `check.test.ts`：6 个确定性 `computeDiffs` 单测（agree/audit 分歧/unmatched 分歧/attribution 分歧/riskyMix 分歧/竞态跳过）+ **真实仓库 M1 集成测试**（`runCheck(process.cwd()).ok === true`）。
    - **M1 实测达成**：实时脏树 48–62 文件、11 个 group、49 文件匹配，Registry 复现 legacy **0 diffs**，多次运行稳定。
    - _Requirements: 2.3, 4.3_

- [-] 6. Wave 1：切换现有脚本为薄包装（**Milestone M2 — Wrapper Cutover；前置 = M1 达成 ✅**）

  > 切换采用 **registry 文件门控 + legacy 回退**：未提交 `.loom/registry.yaml` 时逐字节等于今天（对其他 agent 零影响、可逆）；提交后自动走 Registry（M1 已证等价）。切换是一次显式、可逆的"加文件"提交。— kiro-loom
  - [x] 6.1 `agent-attribution.ts` 改读 Registry
    - 内部改调 `scripts/loom/attribution.ts`（registry 存在时），保留全部 CLI flag（`--json`/`--fail-on-unattributed`/`--check`/`--fail-on-conflict`）与退出码；legacy `## Agents` 路径作回退。已验证两种模式 + `loom check` 0 diffs。
    - _Requirements: 2.1, 2.2, 5.1, 5.2_
  - [x] 6.2 `worktree-audit.ts` 改读 Registry
    - registry 存在时 `rules` 由 `landingStreams` 派生、riskyMix 走 loom core 的 policy 化判定；输出/筛选/门禁 CLI 契约不变；`LEGACY_RULES` 作回退。已验证 legacy 模式 `test/worktree-audit.test.ts` 仍 57 passed / 5 pre-existing failed，registry 模式端到端可跑。
    - _Requirements: 4.1, 5.2, 5.3, 8.1_
  - [ ] 6.3 删除冻结的旧硬编码 rules（D4）
    > ⏸ **maintainer-gated**：删除 `LEGACY_RULES` 会移除回退、强制 registry 模式。需先：①团队提交 `.loom/registry.yaml`；②Wave 2 的 `register`/`derive` 同步工具就位（否则其他 agent 对旧规则表的编辑会被搁置）。不在共享热文件上单方面执行。
    - parity 与 pre-commit 回归全绿后，移除运行路径中的旧 `AuditRule[]`，仅保留 fixture 副本。
    - _Requirements: 4.3, 7.1_

- [x] 7. Wave 1：`loom status` + 生命周期状态机
  - [x] 7.1 实现状态机与 `loom status`
    - `scripts/loom/lifecycle.ts`：`TASK_TRANSITIONS` 状态机 + `canTransition`/`transitionTask`（非法迁移如 `landed→active` 抛 `IllegalTransitionError`）+ `isSessionDead`（默认 24h 阈值，D5）+ `touchSignal`。
    - `scripts/loom/status.ts`：`buildStatus`/`formatStatus` 展示每任务 state + 是否 blocked + 每 session status + dead 标记。
    - `lastSignalAt` 闭环：`transitionTask` 刷新；`register`/`accept` 的刷新随 Wave 2 落地。纯元数据，不触发 worktree 操作（R10.5）。
    - 测试：lifecycle 11 + status 3，全绿。
    - _Requirements: 10.2, 10.3, 10.4, 10.5_

- [x] 8. Wave 1：CLI 入口与 CI 接入
  - [x] 8.1 `scripts/loom.ts` CLI 入口（Wave 1 子命令）
    - 暴露 `import`（`--write`/`--json`）/ `status`（`--json`）/ `audit`（转发 worktree-audit 全部 flag）/ `check`（`--strict`/`--json`）；main 守卫；`package.json` 增 `loom` / `loom:status` / `loom:audit` / `loom:check` / `loom:check:strict`，与 `worktree:audit*` 并存。
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 8.2 CI 接入 `loom check --strict`（先 Warning 后 Required）
    - **阶段一 Warning Mode（已落地）**：`.github/workflows/ci.yml` 的 `check` job 增 `Loom parity (Shadow Mode, warn-only)` 步（`pnpm loom:check:strict` + `continue-on-error: true`），输出 parity 结果但不阻断。
    - **阶段二 Required**：观察 1–2 周 0 false positive 后，去掉 `continue-on-error` 即转强制门禁（维护者决定）。
    - _Requirements: 5.3, 8.1_

- [x] 9. Wave 2：`register` + 状态迁移命令
  - [x] 9.1 `loom register` 登记/更新 task/session
    - `scripts/loom/register.ts` `applyRegister`（纯函数）：建/更新 ownership task（建需 owner）、intent/paths 加性合并、`--state` 走 lifecycle 校验迁移、session upsert + `touchSignal` 刷新 `lastSignalAt`（闭环 dead）。CLI `loom register` 接线。
    - _Requirements: 1.1, 3.1, 6.1, 10.1_

- [x] 10. Wave 2：`derive` 派生视图
  - [x] 10.1 `loom derive` 生成 `## Agents` 块
    - `scripts/loom/derive.ts` `deriveAgentsBlock`/`deriveAgentsBySpec`：从 Registry 生成 `## Agents` 派生视图（按需 stdout，不写回，D3）；无 paths 的 task 跳过；不作归属输入。
    - _Requirements: 5.1_

- [x] 11. Wave 2：`suggest` / `accept`（带置信度，绝不自动写）
  - [x] 11.1 实现 `scripts/loom/learn.ts`
    - `suggestPaths`（纯函数）：按父目录归并候选文件为 `dir/**`，按密度给 confidence（1→45/2→70/3+→95），root 文件逐条低置信；CLI 侧排除他人任务命中路径（R3.4）。
    - _Requirements: 3.2, 3.4_
  - [x] 11.2 `loom suggest` / `loom accept`
    - `suggest --task <id>` 只读输出带置信度建议（绝不写）；`accept --task <id> --paths <globs>` 仅写入人工确认的 glob（经 `applyRegister` union + 刷新信号）。任何路径都不 auto-update（R3.3）。
    - _Requirements: 3.3_

- [x] 12. Wave 2：仓库无关验证
  - [x] 12.1 最小仓库闭环测试
    - `repo-agnostic.test.ts`：用虚构项目布局（无 OpenBot 路径）跑 attribution/audit/status，证明核心库（registry/glob/attribution/audit/status/lifecycle/register/derive/lint）不内嵌 OpenBot 路径、不读凭证。
    - _Requirements: 7.1, 7.2, 8.2_

- [x] 13. Wave 2：Registry Linter `loom lint`
  - [x] 13.1 实现业务一致性校验（design §3.9）
    - `scripts/loom/lint.ts`：重复 task.id（error）、空 owner（error）、重复 stream.id（error）、canLandWith 悬空引用（error）、跨 task path 重叠（warn）、active 但无 paths（warn）；CLI `loom lint [--strict] [--json]`，error 或 `--strict` 任一问题 → 非零退出。
    - _Requirements: 1.3, 7.1_

## Notes

- **运行基线已切换为 Registry 模式（验收 P1）**：`.loom/registry.yaml` 已 commit（`704fc43`），attribution/audit 入口运行态读 Registry，不再回退 legacy；`LOOM_FORCE_LEGACY=1` 可强制 legacy（`loom check` 用它取真 legacy 基线）。
- **Registry 是有状态 SoT，`import` 是一次性迁移工具而非同步工具（2026-07-28 更正）**：Registry 最初由 `pnpm loom import --write` 从 `LEGACY_RULES` + `## Agents` **一次性**生成，此后已累积 legacy 表无法表达的活状态——task `sessions` / `ownerHistory` 接管链 / 直接注册的 task / `landingPolicy: parallel` 流（如 HUB）。**规则变更请直接编辑 Registry，不要"重新生成"**：`import --write` 会全量覆盖并销毁上述状态，已加 guard 拒绝破坏性覆盖（需 `--force`）。详见 `.loom/README.md`。legacy 表保留为死 fallback 直至 6.3 删表（此前本条曾误写为"规则变更后需重生成"，与 guard 行为矛盾，已更正）。
- **验收修正（2026-06-12）**：P2a — `applyRegister` 在任何成功写（含 `accept` 的 paths-only 更新）后刷新该任务所有 session 的 `lastSignalAt`（闭环 dead）。P2b — import/lint 的 ownership 重叠检测改用共享 `globsOverlap`（前缀关系），可捕获 `src/**` vs `src/auth/**` 嵌套重叠。连带修复 `import.ts` 误用翻转的导出 `rules` 的循环依赖（改读冻结 `LEGACY_RULES`）；`.loom/**` + `scripts/loom/**` 纳入 group D 以过 pre-commit 审计。
- **里程碑**：任务 5 = **M1（Parity Complete，parity=100%）**；任务 6 = **M2（Wrapper Cutover）**。**M1 未达成，M2 不得开始**；任务 6.3（删旧 rules）在 M2 与 pre-commit 回归全绿后才执行。
- **Wave 1 是 MVP 全部交付**；Wave 2（9–13）为同期增强，可在 Wave 1 稳定后并行推进。
- 标 parity/回归相关的测试任务（1.2、1.3、5.3、6.2、12.1）不建议为加速跳过——它们是"零回归替换"的证据。
- 不改 `git-hooks/pre-commit` 与 `committer` 的调用契约；`worktree-audit.ts` / `agent-attribution.ts` 仅内部换源（任务 6）。
- `package.json`、`scripts/agent-attribution.ts`、`scripts/worktree-audit.ts` 为共享热文件：编辑时遵循 AGENTS.md 多 agent 规范，scoped commit，避让他人 WIP。
- Intent 在本期不参与任何判定（Architecture Rule #1）；违反即视为缺陷。
- `lastSignalAt` 由任何成功的 Loom CLI 写操作刷新（闭环 `dead` 判定）。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3"] },
    { "id": 4, "tasks": ["4.1", "4.2"] },
    { "id": 5, "tasks": ["5.1", "5.2", "5.3"] },
    { "id": 6, "tasks": ["6.1", "6.2"] },
    { "id": 7, "tasks": ["6.3"] },
    { "id": 8, "tasks": ["7.1", "8.1"] },
    { "id": 9, "tasks": ["8.2"] },
    { "id": 10, "tasks": ["9.1", "10.1", "11.1"] },
    { "id": 11, "tasks": ["11.2", "12.1", "13.1"] }
  ]
}
```

## P1 Backlog (post-MVP review follow-ups)

Deferred from the `register.ts` / `registry.ts` architecture review (commits `fb10f9d211`,
`1cdc65795c`). These are non-blocking; current implementation is APPROVED as the v1 baseline.
Owner: kiro-loom (loom core). Land each as its own scoped change with tests + `loom check` parity.

- [ ] **P1.1 — Split `applyRegister` into command handlers.** Extract `applyRegisterTask`,
      `applyRegisterSession`, `applyTaskTransition`, `applyOwnershipTransfer` (the last already exists),
      with `applyRegister` as a thin orchestrator. Prevents the "God Command" drift as Provisioning /
      Repair / Ownership keep adding responsibilities. Do this when the next responsibility lands, not
      preemptively (review: current ~100 LOC is acceptable).
- [ ] **P1.2 — Decision/audit `source` on mutations.** Tag registry writes with their origin
      (`source: register | provision | repair | import`) so "who/what changed the registry" is traceable
      (decision trace, Fabric-aligned). Candidate home: a `metadata.source` field on the touched
      record, or a top-level mutation log. Keep it inside the reserved structured-metadata contract
      (no free-form drift).
- [ ] **P1.3 — Explicit `priority` on `LandingStream` (replace hidden first-match).** Today overlapping
      streams (e.g. `src/**` vs `src/fabric/**`) resolve by array order — a Hidden Governance Rule. Add an
      explicit `priority: number` and resolve by it, making landing precedence declarative. Behavior change
      to landing classification: gate behind `loom check --strict` parity and a design note before flipping.

## P2 Backlog — 共享基建路径的假 CONFLICT（R11 / design §3.11）

来源：2026-07-26 落地 `delivery-alignment-guard` 的 registry 收尾时撞到——`.loom/registry.yaml` 被 5 个 active task 同时声明，`agent-attribution --fail-on-conflict` 在提交前必然红，只能靠人工判断"这个冲突是真的吗"。展开量化后确认是系统性问题，不是那一个任务的问题。Owner: kiro-loom。

### 实测基线（记录下来，别重新猜）

| Registry 快照                           | tasks | ownership-overlap | 涉及不同路径 |
| --------------------------------------- | ----- | ----------------- | ------------ |
| `release/baseline-recovery-20260725` 线 | 73    | **152**           | **146**      |
| `deploy/user-modeling-v92` 线           | 42    | 46                | 49           |

频次头部（两份快照一致地指向共享基建）：`src/gateway/server-methods/*.pack.ts` 13 · `src/gateway/server-methods.ts` 10 · `src/gateway/method-scopes.ts` 10 · `ui/src/ui/app.ts` 10 · `deploy/production/RELEASE_RECORD.md` 10 · `ui/src/ui/ports/employee/` 7 · `package.json` 6 · `.loom/registry.yaml` 6 · `src/gateway/server-methods-list.ts` 6 · `vitest.config.ts` 3 · `ui/src/i18n/locales/{en,zh-CN}.ts` 3。

复现命令（只读）：

```bash
pnpm loom lint            # ownership-overlap 全量
bun scripts/agent-attribution.ts   # 当前脏树的 CONFLICT 清单
```

### 前置：P2.0 — 目录型 `paths` 静默失效（R12 / design §3.12，先做）

排查 P2 时顺带发现的**correctness bug**，优先级高于共享表示：`globToRegExp` 只识别 `*`/`**`，所以「无通配 + 尾斜杠」的目录声明（`scripts/loom/`、`.kiro/specs/x/`、`src/fabric/`）生成 `^scripts\/loom\/$`，**永不命中任何 `git status` 路径，且不报错**。实测：316 条 `task.paths` 里 **33 条**如此，涉及 **18/42 个 task**——包括 `loom-workspace-orchestrator:kiro-loom` 自己（所以 registry owner 自己的 spec 文件在归属报告里显示 UNATTRIBUTED）。仅把这 33 条改成 `**`，脏树 UNATTRIBUTED 就从 **79 降到 62**。

这同时**修正了 design §3.10 的归因**：那里把高 UNATTRIBUTED 全归为"其他 agent 在途 WIP / 预期噪声"，实测至少 17 个是本缺陷造成的假未签到。

- [ ] **P2.0a — 选定修法并出 parity 差异清单。** A（`globToRegExp` 读时把 `dir/` 当 `dir/**`）或 B（迁移 registry 里那 33 条）。倾向 A + lint 兜底，但 `glob.ts` 注释明写"语义不得与 legacy 分叉"，故必须先在 shadow 模式跑 `loom check --strict`，差异方向只允许 `UNATTRIBUTED → ATTRIBUTED/CONFLICT`。
  - ✅ **差异清单已出（2026-07-31 实测）**，但结论是：**本项设定的前提不成立，需重新决策。**
  - 规模：`tasks` 里 **32** 条无通配且以 `/` 结尾的声明（active 18 / landed 7 / abandoned 7），涉及 17 个 task。`landingStreams` **0** 条 —— 审计分区干净，问题只在归属分区。
  - 修法 A 在当前脏树上的判定迁移：

    | 迁移                        | 条数  | 说明                                                                                                                                                                                       |
    | --------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
    | `UNATTRIBUTED → ATTRIBUTED` | 2     | `.kiro/specs/development-supervisor/tasks.md` → `development-supervisor:cursor-fable`；`ui/src/ui/employee-shell/employee-embed.css` → `tri-platform-unification:kiro`。均为本该有的归属。 |
    | **`ATTRIBUTED → CONFLICT`** | **5** | **越界**。全部单一成因：`agent-growth-lifecycle:cursor-p0b-growth` 声明失效的 `ui/src/ui/ports/employee/`，而 `ops-decommission:cursor-daniel` 声明生效的 `ui/src/ui/ports/employee/**`。  |

  - 也就是说 A 会**新造 5 个 CONFLICT**，违反本项写的"差异方向只允许 `UNATTRIBUTED → …`"。但这 5 个并非 A 引入的缺陷 —— 那个重叠**本就存在**，只是因为死 glob 从未被看见。A 只是让它显形。
  - 因此 A 的正确前置是 **P2.5**：把 `ui/src/ui/ports/employee/**` 登记为共享路径并指定 lander（P2.1–P2.4/P2.6 机制已就绪），或在这两个 task 间做一次 takeover。之后 A 的迁移方向才真正落在允许集合内。
  - 受影响文件清单（A 生效后 5 个新 CONFLICT）：`ui/src/ui/ports/employee/render-model-shell-actions.ts`、`views/workbench.ts`、`views/workbench-header.ts`、`views/workbench-header.node.test.ts`、`views/workbench-chrome.node.test.ts`。
  - ✅ **已决策（2026-07-31 专家审核）：选 B** —— 逐条把 18 条目录声明迁成 `/**`，保持既有 `globToRegExp` 语义不变，因此不存在与 legacy 分叉的风险。
  - 显现出的 5 个 `ATTRIBUTED → CONFLICT` **是真实缺陷**，可作为迁移报告结果记录，但**必须随后解决（takeover 或 P2.5 登记），不得永久加入允许集合**。
  - 排序：B 需写 `.loom/registry.yaml`，而该文件被 200+ 脏文件与多方 WIP 阻塞 → **排在主工作树归位（审批记录 §4 步骤 1）之后**。
  - 完整审批记录见 `.kiro/specs/engineering-governance/review-decision-2026-07-31.md`。— kiro-governance

- [x] **P2.0b — `loom lint` 新增「不可能命中的 glob」错误项。** 无通配且以 `/` 结尾即报错，列出 task id + path，把静默失效变成显式失败（R12.4）。
  - ✅ 已落地：新增 check 9 `impossible-glob`，`severity: error`，detail 含 task id、原声明与建议写法。**实测抓出 18 条，涉及 9 个 task**：`cross-session-user-modeling`(2)、`agent-growth-lifecycle`(1)、`builder-decommission`(3)、`daibai-super-steward`(1)、`development-supervisor`(4)、`operational-identity-governance`(1)、`tri-platform-unification`(4)、`delivery-baseline-governance`(2)。
  - 为何用 `error` 而非沿用本文件 check 6/7 的 `warn`：那两项需要人决定"谁该保留哪条路径"，而这一项无需判断 —— 声明就是坏的，修法是机械的（`dir/` → `dir/**`）。降级会把它埋进 46 条 overlap 警告里，那正是它一直隐形的原因。
  - 终态 task 跳过（landed/abandoned 本就释放路径，死 glob 在那儿无害，也没人会回去修已关闭的工作）。
  - 影响面确认：`loom lint` 现在退出 1（报真实缺陷）；**门禁不受影响** —— CI 只调 `loom check --strict`（`ci.yml:237`），实测仍 exit 0，且 `loom lint` 在 workflows / pre-commit / git-hooks / package.json 里均无门禁调用点。lint.test.ts +7。— kiro-governance
- [ ] **P2.0c — 修复后重测并更正 §3.10 表述。** 记录 UNATTRIBUTED 前后对比，把"全部是在途 WIP"改成实测归因（R12.5）。
- [x] **P2.0d — 修 `loom-workspace-orchestrator:kiro-loom` 自己的 paths。** `.kiro/specs/loom-workspace-orchestrator/` → `**`、`scripts/loom/` → `**`。修前本任务的 spec 与 loom 核心代码在归属报告里全是 UNATTRIBUTED；修后 `.kiro/specs/loom-workspace-orchestrator/tasks.md`、`scripts/loom/registry.ts`、`scripts/loom.ts` 均正确归到 `kiro-loom`。registry 往返仍与 `saveRegistry` 规范化输出逐字节一致，`loom lint` 0 error。**注意：这使 P2.0a 的 parity 基线从 33 条死路径降到 31 条**，其余 31 条仍待选定 A/B 修法（本改动对两种修法都前向兼容）。— kiro-loom

复现命令（只读）：

```bash
bun -e 'import {loadRegistry} from "./scripts/loom/registry.ts"; \
  const r=loadRegistry(); let n=0; \
  for (const t of r.tasks) for (const p of t.paths) if (!p.includes("*") && p.endsWith("/")) n++; \
  console.log("dead paths:", n)'
```

### 任务

- [x] **P2.1 — `sharedPaths` schema（设计候选 A）。** Registry 顶层新增 `sharedPaths: { glob, lander, reason? }[]`，与 `tasks`/`landingStreams` 并列。带 zod 校验 + 可定位错误；`lander` 必须非空。**默认空数组 ⇒ 行为与今天逐字节相同**，作为 parity 基线先落地。
  - ⚠️ **需按 2026-07-31 审核改造 schema（在 P2.5 填表之前）**：`lander` 当前存 agent id（`z.string().min(1)`），而 agent id **会因 takeover 过期** —— `loom-workspace-orchestrator` 的 owner 本日即由 `kiro-loom` 转为 `kiro-governance`。改为引用**稳定的 task/role**并在解析时取 current owner；另加 **`reviewAfter`**（定期复核提醒）而**不是** `expiresAt`（自动失效会让登记静默消失）。生产发布记录（`deploy/production/RELEASE_RECORD.md`）宜设**单一专属 owner**，不宜作普通共享路径。
  - **迁移成本为零**：`sharedPaths` 当前是空数组，改 schema 不影响任何既有数据 —— 但必须**先改完再填表**。
  - ✅ 已落地：`SharedPathSchema`（`glob`/`lander` 均 `min(1)`，`reason` 可选）+ `RegistrySchema.sharedPaths` 默认 `[]`；`emptyRegistry()` 与 `importFromLegacy()` 同步补齐该字段（后者刻意留空——它是 parity 基线，从观测到的重叠反推共享路径会正好抹掉 P2.5 的人工决策）。`describeIssue` 扩为通用 `refField`，错误信息按 `glob` 指名（`sharedPath "AGENTS.md" (...)`），glob 缺失时回落到 `sharedPaths[0]`。registry.test.ts +7（默认值、round-trip、声明序、空/缺 lander、空 glob）。— kiro-governance
- [x] **P2.2 — 归属判定扩到三值。** `scripts/loom/attribution.ts` 的 `verdictOf` 增加 `SHARED`：命中 >1 且路径已登记 → `SHARED`（携带 lander + 共同声明方），未登记 → 仍 `CONFLICT`。单测覆盖四种判定 + 边界（同一文件被共享登记与功能任务同时命中）。
  - ✅ 已落地：`buildSharedMatchers` / `sharedFor`（首个声明匹配胜出，与 `landingStreams` 同一约定）；`Attribution.shared` 无论命中几个 task 都附带（它是信息，不是判决）；`verdictOf` 仅在 `owners.length > 1` 时才因登记改判。两条边界按"登记不得稀释既有结论"处理：单 owner 命中登记路径 → 仍 `ATTRIBUTED`（归属本已明确）；零 owner → 仍 `UNATTRIBUTED`（**lander 不是 owner**，提拔它会掩盖"没人签到"）。`summarize` 新增 `shared` 计数。attribution.test.ts 10 → 19（含 glob 匹配、首个声明胜出、intent 不参与）。— kiro-governance
- [x] **P2.3 — 闸门语义。** `scripts/agent-attribution.ts`：`--fail-on-conflict` 只对 `CONFLICT` 失败；新增 `--fail-on-shared` 供严格审计；`SHARED` 报告行必须打印 lander，保住 AGENTS.md 规则 2 的可执行性。非回归测试锁定"UNATTRIBUTED/ATTRIBUTED/CONFLICT 的退出码不变"。
  - ✅ 已落地：`overlaps` 拆为 `conflicts`（未登记）与 `sharedFiles`（已登记）；新增 SHARED 报告段，lander 直接排在路径后（它是唯一可行动的信息），有 `reason` 时另起一行。CONFLICT 段补上"若重叠是设计使然，去登记 sharedPaths——这是人工决策，绝不推断"的指引。JSON 新增 `sharedCount`。legacy `## Agents` 模式无 `sharedPaths` 等价物，`shared` 恒为 undefined，故 legacy 基线逐字节不变。— kiro-governance
- [x] **P2.4 — parity 门禁。** `loom check --strict` 双跑同一脏树：非共享路径结论逐条一致，只允许 `CONFLICT → SHARED` 这一类差异；差异清单要可读输出（R8.3 / R11.6）。
  - ✅ 已落地：`computeDiffs` 返回 `{ diffs, sharedTransitions }`，新增 `verdict` 维度。`sharedPaths` 在构造上无法改变 owner **集合**（只改分类），所以门禁在 owner 集合一致后再比 verdict，且**只放行 `CONFLICT → SHARED` 且该路径确有登记**这一种迁移；其余 verdict 变化一律报 diff。放行的迁移不静默吞掉，而是进 `sharedTransitions` 并在报告里逐条列出 `CONFLICT -> SHARED  <path>  lander=<x> — <reason>`。check.test.ts 7 → 14。— kiro-governance
- [ ] **P2.5 — 首批共享路径登记（人工，绝不自动推断）。** 由维护者按上面频次表显式录入；每条带 `reason` 与 `lander`。`.loom/**` 的 lander = `kiro-loom`；`deploy/production/**` 的 lander 需与 `production-agent-runtime-safety:codex-runtime-safety` 确认；`package.json`/`vitest.config.ts`/`AGENTS.md`/i18n locales 需定 lander。**此项必须人工拍板，agent 不得自行填。**
  - P2.1–P2.4/P2.6 的机制已就绪，此项是唯一剩余阻塞。下表是**候选清单**（按当前脏树 12 条 CONFLICT 实测得出），`lander` 一栏空着等人工填 —— 按本项要求 agent 不代填：

    | 候选 glob                                                      | 当前共同声明方（实测）                                                                                                                                                                                      | lander |
    | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
    | `.loom/registry.yaml`                                          | loom-workspace-orchestrator + enterprise-ui-baseline + platform-pricing-gateway-instability + wecom-bundled-plugin-loading + main-recovery-routing（5 方）                                                  | ?      |
    | `deploy/production/RELEASE_RECORD.md`                          | enterprise-ui-baseline + platform-pricing-gateway-instability + wecom-bundled-plugin-loading + enterprise-data-capability-ia-redesign + enterprise-ai-model-governance + main-production-deployment（6 方） | ?      |
    | `AGENTS.md`                                                    | public-web-entry-url（ownership）+ landing stream `ME`；`engineering-governance` 亦需追加条款                                                                                                               | ?      |
    | `src/gateway/method-scopes.ts`                                 | development-supervisor + enterprise-ai-model-governance                                                                                                                                                     | ?      |
    | `ui/src/styles.css`                                            | daibai-super-steward + employee-ai-archive                                                                                                                                                                  | ?      |
    | `ui/src/styles/workbench.css`                                  | agent-growth-lifecycle + ops-decommission                                                                                                                                                                   | ?      |
    | `ui/src/ui/app-render.ts`                                      | builder-decommission + daibai-super-steward                                                                                                                                                                 | ?      |
    | `ui/src/ui/app-settings.ts`                                    | enterprise-ui-baseline + enterprise-ai-model-governance                                                                                                                                                     | ?      |
    | `ui/src/ui/app.ts` / `app-view-state-shell-slices.ts`          | agent-growth-lifecycle + ops-decommission                                                                                                                                                                   | ?      |
    | `ui/src/ui/ports/employee/collaboration-org-bot-directory*.ts` | ops-decommission + enterprise-startup-stability                                                                                                                                                             | ?      |
    | `.kiro/specs/platform-pricing-gateway-instability/tasks.md`    | 同 spec 两个 task                                                                                                                                                                                           | ?      |

  - 🚫 **暂不填表（2026-07-31 审核）**：须先按 P2.1 的 ⚠️ 条改造 schema（`lander` 改为引用稳定 task/role + 加 `reviewAfter`），否则填进去的 agent id 会随 takeover 过期。审核已确认这一点：`.loom/registry.yaml` 的 lander 若填 `kiro-loom`，当天就已因 owner 转移而失效。
  - 另：`deploy/production/RELEASE_RECORD.md` 六方共享且直接关联生产发布记录，审核建议**设单一专属 owner 而非普通共享**，并需与运行时安全侧确认。

- [x] **P2.6 — `loom lint` 降噪。** `ownership-overlap` 对已登记共享路径降级/静默，让它回到只报**未登记**重叠（真正的 takeover-pending 信号）。跑完 P2.5 后重测告警数，记录前后对比。
  - ✅ 机制已落地（告警数前后对比待 P2.5 填完后测）：重叠若被某条 `sharedPaths` 登记**同时覆盖两侧**则静默；只覆盖一侧不算解决，仍报。覆盖判定复用既有 `shadowProbe` + `globToRegExp`（而非 `globsOverlap` 的宽松前缀启发式，后者会让 `*.md` 之类的宽 glob 误静默真实冲突）。同一 task 对里未登记的重叠路径照常列出。保持 `warn`，`lint --strict` 行为不变。lint.test.ts +6。
  - **当前仓库实测（sharedPaths 仍为空）**：`ownership-overlap` 46 条、`agent-attribution` CONFLICT 12 条——与改动前一致，因为登记表为空即基线。P2.5 填完后重测这两个数并记录。— kiro-governance
- [ ] **P2.7 — 与 P1.3 合并设计说明。** `.loom/registry.yaml` 现在因 landingStream 数组顺序被 first-match 分到 `WPL`（WeCom Bundled Plugin Loading），与该文件毫无关系。P1.3 的显式 `priority` 与 R11 同属"隐藏治理规则显式化"，出一份合并设计说明后分别落地。

### P2.9 — 终态任务释放路径（R13 / design §3.13）✅ 已落地

先于 R11/R12 落地，因为它是"清理动作能不能生效"的前置：`attribution.ts` / `lint.ts` 原本不读 `task.state`，而 registry 里 42/42 个任务全是 `active`，所以关闭任务是空动作。

- [x] **P2.9a — 归属与 lint 排除终态任务。** `attribution.ts` 新增 `TERMINAL_TASK_STATES = {landed, abandoned}` 与 `AttributionOptions.includeTerminal`；`lint.ts` 的 `ownership-overlap` 复用同一常量。`paused`/`blocked`/`claimed`/`ready` 继续认领。新增 7 个单测（终态释放、非终态保留、CONFLICT 降为单 owner、`includeTerminal` 恢复旧视图、lint 两侧），loom 全套 183 测试通过；既有 `loom check` parity 测试证明当前 registry 无终态任务时判定逐条不变。— kiro-loom
- [x] **P2.9b — 首轮证据驱动清理。** 删 `chat-checkpoint-rollback`（0 paths）；5 条 → `abandoned`（从无提交带其 `Task:` trailer）；8 条 → `landed`（spec 全勾 + 提交已进 SoT + 路径在 SoT 存在）。守卫为**计算式**：有脏文件命中其 paths、或会话 <2d 仍有信号，一律不动（挡住 17 个在途任务）。`session.lastSignalAt` 原样保留，只推进 `session.status`——`applyRegister`/`transitionTask` 会 `touchSignal` 覆盖它，故治理路径刻意绕开这两个入口。结果：42→41 tasks、`ownership-overlap` 46→34、脏树判定 25/9/71 **完全不变**、lint 0 error。— kiro-loom
- [ ] **P2.9c — 同一套清理回放到生产 SoT 线。** `origin/release/baseline-recovery-20260725` 的 registry 有 72 tasks，与本线已分叉；另有 3 条 0-paths 条目（`chat-checkpoint-rollback`、`data-directory:cursor-data-directory`、`client-apps-pc-mobile:apple-shared`）与 1 条重复 id（`chat-checkpoint-rollback:kiro-daibai` ×2，即 `loom lint` 唯一那条 **error**）。需单独 PR，不要混进 spec-only 的 PR #93。
- [ ] **P2.9d — GHOST / PARTIAL / REVIEW 逐条拍板。** 决策表已产出（GHOST 2 / PARTIAL 26 / REVIEW 4），需维护者判断"功能还要不要"。同一 spec 拆成多 owner 的组（`ops-decommission` 4 条、`client-apps-pc-mobile` 6 条、`development-supervisor` 2 条）应整组处理，因为它们共享同一份 spec 进度。

### 明确不在 P2 范围（走 R10.3，需人工逐任务拍板）

过期任务造成的**真重叠**：下列 task 的 session 已死 6.5–10.4 天但 `state` 仍 `active`，其 paths 继续参与归属判定。处置走既有生命周期路径（`loom status` 标 dead → 重新归属 / `loom task reconcile --mode apply --yes` / `loom task abandon`），**不得**用 R11 的共享标记顺手掩盖。

| task                                                          | owner                         | 最后信号（相对 2026-07-27） |
| ------------------------------------------------------------- | ----------------------------- | --------------------------- |
| `openbot-conversation-lifecycle:codex-conversation-lifecycle` | codex-conversation-lifecycle  | 10.4d                       |
| `enterprise-commercial-billing-hardening`                     | grok-billing                  | 8.9d                        |
| `enterprise-pricing-ui-optimization`                          | grok-pricing                  | 7.9d（4 条会话同刻）        |
| `cogniweave-memory-engine-v2:codex-cogniweave-v2`             | cursor-conversation-lifecycle | 7.1–7.8d                    |
| `production-agent-runtime-safety:codex-runtime-safety`        | codex-runtime-safety          | 7.4d                        |
| `repository-wide-branch-convergence`                          | grok-evolution-closure        | 6.5d（5 条会话）            |

只读 `pnpm loom task reconcile --mode report` 另外报出 2 条 `ORPHANED`（`chat-checkpoint-rollback`、`tenant-context-propagation:kiro`）与 17 条 `UNTRACKED_WORKTREE`，同属该批治理。

### 已知缺口：registry owner 自己没有 session

- [x] **P2.8 — `loom-workspace-orchestrator:kiro-loom` 注册 owner session。** 该任务原本 `sessions: []`——registry owner 从未按 AGENTS.md 规则 5「开工/接管即注册 session」登记，而它恰恰是所有共享文件的落地方。已用 `pnpm loom register --task loom-workspace-orchestrator:kiro-loom --owner kiro-loom --session-id <uuid> --ide kiro --agent kiro-loom` 补登（owner 未变 ⇒ 不产生 `ownerHistory` 条目；该任务原无其他 session ⇒ 未刷任何他人的 `lastSignalAt`）。曾一度被阻塞：主树 `.loom/registry.yaml` 带着其他 agent 的在途 WIP（`8487f39ba5` 之前），按规则 2 不得连带提交；该 agent 落地后即补做。— kiro-loom
