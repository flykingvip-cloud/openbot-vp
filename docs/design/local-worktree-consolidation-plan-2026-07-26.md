# 本地 OpenBot 工作区收敛方案（2026-07-26）

**状态：** Phase 1（L0 抢救）已执行；其余阶段待人类决策（§8）
**决策已定：** D1 = **T1（SoT 分支族为唯一主干）**、D2 = 是（抢救优先）
**范围：** 工作区根目录下全部 `openbot*` 检出 + Git worktree 注册表 + 分支/stash 资产
**关联标准：**

- [OpenBot 开发交付链路标准（2026-07-20）](./openbot-dev-delivery-pipeline-standard-2026-07-20.md)
- [本地工作区整理专家审核（2026-07-23）](./local-openbot-workspace-consolidation-expert-review-2026-07-23.md)
- [Multi-Agent Worktree 目标架构（2026-06-16）](./worktree-multiagent-target-architecture-2026-06-16.md)
- `deploy/production/RELEASE_RECORD.md`、`deploy/production/BASELINE_RECOVERY_20260725.md`

> 本文中 `$WS` 表示工作区根目录（各 `openbot*` 检出的父目录）。所有 `git` 命令一律使用
> `/usr/bin/git`（2.50.1）；PATH 默认的 2.15 缺 `worktree repair/move/remove`。

---

## 0. 结论先行

**方向需要纠正。** 原始诉求是「把这些散出来的目录合并进 `openbot` 这个大文件夹」，但实测证据显示：

`openbot` 主树是当前 12 棵活跃检出里**最落后**的一棵。它停在 `deploy/user-modeling-v92`，
而该分支已被 `deploy/production/RELEASE_RECORD.md` 明令 **“DO NOT cut over from”**（低于能力底线）。
相对生产 SoT `release/baseline-recovery-20260725`，它 **落后 1276 提交**，工作树内容 **少约 234k 行**。

因此「合并到 openbot」的正确技术含义是三件事，而不是一件：

| #   | 动作                                                       | 说明                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **抢救主树 L0 资产**                                       | 主树 134 项未提交改动里，**40 个文件在任何分支都不存在**（含 `ui/src/ui/shells/*` 新 shell 层、agent-growth 反馈信号、learning 召回测试）。这是全工作区唯一不可再生的资产。另有 22 个 stash 未清点。 |
| 2   | **把各 worktree 的独有提交前向重放到 SoT**                 | 8 棵功能树的未提交工作量实质为 **0**，价值全在分支提交里。相对 SoT 的缺口只有 **0～48 提交/棵**，总量约 100 余提交（不含 `openbot-rc` 的 315）。                                                     |
| 3   | **让 `openbot` 目录成为 SoT 主干的工作树，再回收其余目录** | 目录数收到「1 主树 + 1 归档」是结果，不是手段。                                                                                                                                                      |

**反向做法（把 SoT 合进 `deploy/user-modeling-v92`，或以主树内容覆盖）会造成生产回退**，
且违反 `BASELINE_RECOVERY_20260725.md` 的 “Forward cherry-pick / replay only” 约束。

**根因（必须一起修，否则 4 天后同样复发）：** 当前存在**两个同时活跃的主干** ——
`origin/main`（PR 汇入，2026-07-26 仍在合 PR #90）与 `release/baseline-recovery-20260725`
（生产 SoT，同日推进到 `83dded041d`）。二者互不为祖先（merge-base 停在 `4f1d8d603c`，2026-07-09）。
2026-07-23 的整理把 worktree 从 38 棵压到 6 棵，3 天后回升到 17 棵，就是双主干的直接后果。

---

## 1. 盘点（实测证据，2026-07-26 15:12，remote refs 15:08 已 fetch）

### 1.1 物理目录 vs Git 注册表

物理顶层目录 **10 个**：

```text
$WS/
├── openbot/                                  # 主树（L0，dirty）
├── openbot-archives/                         # 冷归档容器（含 README.md manifest）
│   ├── openbot-convergence/
│   ├── openbot-nginx-ops/
│   └── openbot-rc/
├── openbot-collab-deliverable-v95/
├── openbot-delivery-alignment-guard/
├── openbot-enterprise-ai-model-governance/
├── openbot-enterprise-channels-release/
├── openbot-fix-scoped-package-templates/
├── openbot-knowledge-workbench-import-ia/
├── openbot-v116-salvage/
└── openbot-web-favicon-branding/
```

`git worktree list` 注册 **17 棵**：1 主树 + 3 归档 + 8 功能 + 2 supervisor + 3 codex
（codex 3 棵中 **2 棵物理目录已消失** → `[MISSING]`，是 `worktree prune` 的误触发面）。

分支/stash 资产：本地分支 **93**、远端分支 **100**、其中 **73 个本地分支相对 SoT 超前**；
**22 个 git stash** 未清点（`stash@{0..4}` 挂在 `deploy/user-modeling-v92` 上）。

### 1.2 两条谱系（本次收敛的核心事实）

| 谱系                           | 代表 ref                                     | tip                        | 提交数（快照） | 相对 SoT                    |
| ------------------------------ | -------------------------------------------- | -------------------------- | -------------: | --------------------------- |
| **A. 生产 SoT（长谱系）**      | `origin/release/baseline-recovery-20260725`  | `83dded041d`（2026-07-26） |           2535 | —                           |
| A. 派生                        | 8 棵功能树全部在此谱系上                     | —                          |              — | ahead 0～48                 |
| **B. main / deploy（短谱系）** | `origin/main`                                | `f3379fd056`（2026-07-26） |           1297 | ahead 22 / **behind 1277**  |
| B. 派生                        | `deploy/user-modeling-v92`（= 主树当前分支） | `8f2109c6d0`               |           1388 | ahead 127 / **behind 1276** |

> 提交数与 ahead/behind 为 2026-07-26 15:12 快照；多 agent 并发提交中，复核时以附录 A 命令实测为准。

两条谱系 **互不为祖先**，`merge-base` = `4f1d8d603c`（2026-07-09）。

树内容差（`git diff --shortstat`）：

- `SoT → deploy/user-modeling-v92`：2077 文件，+40,478 / **-234,162**
- `SoT → origin/main`：2094 文件，+26,983 / **-260,311**

即：主树目录里能看到的代码，比生产实际运行的少 23 万行。`RELEASE_RECORD.md` 已记载
该分支「lacks tenant-context isolation、enterprise-data semantic catalog / event bus / data planner、
agent-growth working-style、collaboration-learning capsules、tenant-import + migration-readiness、
chat error sanitize、doctor-supervisor」。

**已有的正确机制**：SoT 通过 **PR + 前向重放** 吸收短谱系成果（PR #87 `replay/asset-suggestion-dismiss`
已并入 SoT 并打 `provenance/sha-225de96b270f`；runtime-health 4 提交已从 `main` 重放为
`7582df01d3/b4a4ae2fe8/99d232005b/edf58231df`）。本方案沿用该机制，不新造流程。

### 1.3 各检出相对 SoT 的缺口

| 检出目录                                 | 分支                                               | ahead(SoT) |      脏 | 远端状态                 |
| ---------------------------------------- | -------------------------------------------------- | ---------: | ------: | ------------------------ |
| `openbot`（主树）                        | `deploy/user-modeling-v92`                         |        127 | **134** | 本地 ahead 20 / behind 8 |
| `openbot-delivery-alignment-guard`       | `codex-delivery-guard/delivery-alignment-guard`    |         13 |       1 | **无远端（本地独有）**   |
| `openbot-enterprise-channels-release`    | `codex/openbot-enterprise-channels-release`        |         48 |       6 | 本地 ahead 3             |
| `openbot-collab-deliverable-v95`         | `cursor-composer/collaboration-deliverable-v95`    |         21 |      10 | in-sync                  |
| `openbot-knowledge-workbench-import-ia`  | `kiro-web-ui/knowledge-workbench-import-ia`        |         10 |       6 | 本地 ahead 4             |
| `openbot-v116-salvage`                   | `kiro/v116-salvage-subscription-contract-reminder` |          1 |       0 | in-sync                  |
| `openbot-enterprise-ai-model-governance` | `kiro/enterprise-ai-model-governance`              |          1 |       0 | in-sync                  |
| `openbot-web-favicon-branding`           | `codex-favicon/web-favicon-branding`               |          1 |       0 | in-sync                  |
| `openbot-fix-scoped-package-templates`   | `fix-scoped-package-templates`                     |      **0** |       5 | in-sync                  |
| `openbot-archives/openbot-rc`            | `release/candidate-20260712`                       |    **315** |       0 | in-sync                  |
| `openbot-archives/openbot-nginx-ops`     | `wip/ops-nginx-hsts-https-redirect`                |         13 |       0 | in-sync                  |
| `openbot-archives/openbot-convergence`   | `convergence/2026-07-20`                           |          3 |       0 | in-sync                  |

**关键读数：**

1. 8 棵功能树的「脏」全部是噪声：`extensions/*/node_modules/.bin/*` 符号链接漂移、
   `.loom/registry.yaml`、`pnpm-lock.yaml`。**没有一棵功能树困着未提交的产品代码。**
2. `openbot-fix-scoped-package-templates` 的 tip `2664b3633f` 正是 `BASELINE_RECOVERY_20260725.md`
   记录的 recovery candidate 起点 → **已被 SoT 完全包含，零缺口，可直接回收。**
3. `openbot-delivery-alignment-guard` 的 13 提交**只存在于本地**（无远端备份），且内容正是
   `scripts/delivery/forward-guard.ts` + `.github/workflows/delivery-sot-alignment.yml`
   —— 防止本次这类漂移的守卫工具本身还没落地。**风险最高、优先级最高。**

### 1.4 主树 L0 资产三分类（唯一不可再生的部分）

134 条 `git status` 条目（展开未跟踪目录后 170 个文件），逐文件与 SoT 内容比对：

| 分类                          | 文件数 | 处置                                              |
| ----------------------------- | -----: | ------------------------------------------------- |
| 与 SoT 内容**完全相同**       |     11 | 丢弃（只是主树停在旧分支的假差异）                |
| 与 SoT **不同**（已跟踪修改） |    103 | 逐文件三分类：重放 / 冻结为证据 / 丢弃            |
| SoT 中**不存在**该路径        |     56 | 其中 16 个可在其他分支找到；**40 个全工作区唯一** |

**40 个「任何分支都没有」的文件**（丢失即永久丢失）：

| 簇                                     | 文件数 | 内容                                                                                                                               |
| -------------------------------------- | -----: | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ui/src/ui/shells/*.ts`                |      6 | `chat/employee/enterprise/frontstage/platform/lazy` shell 层（架构性新增）                                                         |
| `skills/cursor-canvas/**`              |     18 | skill + SDK d.ts 引用包                                                                                                            |
| `src/gateway/agent-growth/*`           |      4 | `feedback-signal(.test)`、`record-feedback`、`skill-draft-curation.test`                                                           |
| `src/auto-reply/reply/learning-*`      |      4 | e2e/单测 + `__fixtures__/learning-reuse-worker.mjs`                                                                                |
| `src/gateway/server-methods/*.test.ts` |      2 | working-style RPC、capsule governance                                                                                              |
| `ui/public/*`                          |      3 | `cosmic-bg.jpg/.webp`、`openbot-logo.webp`                                                                                         |
| 其他                                   |      3 | `pi-embedded-runner/model.provider-normalization.test.ts`、`infra/canvas-host-url.test.ts`、`ports/platform/advanced/constants.ts` |

另有 16 个文件虽不在 SoT，但已在其他分支留档（`cursor-main-recovery/main-recovery-routing`
持有 agent-growth/learning 的 8 个、`delivery-alignment-guard` 持有 3 个 spec、
`employee-ai-archive-ui-delete` 持有 2 个、`v116-salvage` 持有 2 个）→ 走重放而非抢救。

### 1.5 结论：风险不在那 9 个文件夹

| 资产池                         | 不可再生风险                                    |
| ------------------------------ | ----------------------------------------------- |
| 8 棵功能 worktree 的未提交内容 | **无**（噪声）                                  |
| 8 棵功能 worktree 的分支提交   | 低（7/8 已在 origin；仅 delivery-guard 无远端） |
| **主树 40 个仅存本地的文件**   | **高**                                          |
| **22 个 stash**                | **未知（必须清点）**                            |
| 2 棵 `[MISSING]` codex 注册项  | 低（触发 prune 的噪声）                         |

---

## 2. 为什么不能「直接合并进 openbot 当前分支」

| #   | 硬约束                                                                            | 出处                                                            |
| --- | --------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | `deploy/user-modeling-v92` 低于能力底线，切换即生产回退                           | `deploy/production/RELEASE_RECORD.md`（“DO NOT cut over from”） |
| 2   | 只允许**前向 cherry-pick / replay**，禁止整分支合并与反向目录覆盖                 | `BASELINE_RECOVERY_20260725.md` § Method constraints            |
| 3   | L0（未提交）与 L1（本地 tip）都不是发布输入；只有 L2 tag/release tip 算「已实现」 | 交付链路标准 §1                                                 |
| 4   | agent 不得自建/自删 worktree、不得切分支、不得动 stash                            | `AGENTS.md` § Multi-agent safety                                |

因此本方案的所有物理回收动作（`worktree remove` / `prune` / 删目录 / 切分支 / 动 stash）
**全部标记为「人类执行」**，agent 只做只读盘点、重放提交与文档。

---

## 3. 目标态

### 3.1 唯一主干（先决条件，见 §8-D1）

必须先在两个候选里选一个，并写进 `RELEASE_RECORD.md`：

- **T1（推荐）：** SoT 分支族（`release/baseline-recovery-*` + `rc-*` tag）为唯一主干；
  `main` 由 SoT 定期回灌（交付标准 §3 规则 4 已预留「release 最终应回灌 main」）。
- **T2：** 把 SoT 回灌 `main` 后以 `main` 为唯一主干，release 分支退化为发布快照。

**不可接受：** 维持现状的双主干。这是复发根因。

### 3.2 文件系统目标

```text
$WS/
├── openbot/            # 唯一活跃主树；检出唯一主干；agent 在此提交
├── openbot-<task>/     # 活跃功能隔离树 ≤3 棵，分支 <owner>/<task>，由人类 provisioning
└── openbot-archives/   # 冷归档，README.md 为 manifest（含处置与 push SHA）
```

验收：`git worktree list` 无 `[MISSING]`；`git worktree prune -n` 无输出。

### 3.3 最终开发文档结构（本次要形成的「最终开发文档」）

不再新增平行文档，收敛到既有落点：

| 层            | 文档                                                               | 职责                                                      |
| ------------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| 流程标准      | `docs/design/openbot-dev-delivery-pipeline-standard-2026-07-20.md` | L0–L3 四层 SoT、分支/tag 命名、标准开发流（**唯一权威**） |
| 主干与发布    | `deploy/production/RELEASE_RECORD.md`                              | 当前主干、生产 tip、cutover 记录                          |
| 重放台账      | `deploy/production/BASELINE_RECOVERY_20260725.md`                  | feature ledger + provenance SHA                           |
| 工作区治理    | 本文（`local-worktree-consolidation-plan-2026-07-26.md`）          | 本轮收敛的盘点、处置矩阵、门禁                            |
| worktree 归档 | `openbot-archives/README.md`                                       | 归档 manifest                                             |
| 任务归属      | `.loom/registry.yaml`（+ `pnpm loom derive`）                      | owner/paths/session                                       |

**规则：** 主干、生产 tip 只在 `RELEASE_RECORD.md` 声明一处；其他文档一律引用，不复述。

---

## 4. 逐棵处置矩阵

处置口径：`REPLAY` = 前向 cherry-pick 到主干后回收；`DISPOSE` = 零缺口，直接回收；
`ARCHIVE` = 保留冷归档；`HOLD` = 本轮不动，另立台账；`HOST` = 改造为主树。

| 检出                                     |         缺口 | 处置                    | 依据 / 备注                                                                                    |
| ---------------------------------------- | -----------: | ----------------------- | ---------------------------------------------------------------------------------------------- |
| `openbot-delivery-alignment-guard`       |           13 | **REPLAY（P0）**        | 唯一无远端备份；内容是 forward-only guard 与 SoT 对齐 CI，落地后可机械阻止复发                 |
| `openbot-fix-scoped-package-templates`   |            0 | **DISPOSE**             | tip `2664b3633f` = SoT 起点，已完全包含                                                        |
| `openbot-web-favicon-branding`           |            1 | REPLAY → DISPOSE        | 单提交（品牌 favicon + 浏览器测试）                                                            |
| `openbot-enterprise-ai-model-governance` |            1 | REPLAY → DISPOSE        | 单提交（spec 文档）                                                                            |
| `openbot-v116-salvage`                   |            1 | REPLAY → DISPOSE        | 单提交（subscription-contract-reminder helpers + tests）                                       |
| `openbot-knowledge-workbench-import-ia`  |           10 | REPLAY → DISPOSE        | Import IA + employee system authorization；先 push 本地超前的 4 提交                           |
| `openbot-collab-deliverable-v95`         |           21 | REPLAY（分批）          | 含 Security P1.1、context lifecycle P1；**其中 runtime-health 4 提交 SoT 已重放，须去重**      |
| `openbot-enterprise-channels-release`    |           48 | REPLAY（分批）          | v92–v104 cutover 链；须区分 runtime 改动与 `Deploy: record …` 纯记录（记录类不重放，转写台账） |
| `openbot-archives/openbot-convergence`   |            3 | REPLAY → ARCHIVE        | 收敛证据补丁                                                                                   |
| `openbot-archives/openbot-nginx-ops`     |           13 | REPLAY（2 条）→ ARCHIVE | 仅 `ops(nginx) HSTS/redirect` + 变更窗清单为真实增量，余为历史合并                             |
| `openbot-archives/openbot-rc`            |      **315** | **HOLD**                | 独立特性池（capability-proposal、pricing-v3 等），需专门 ledger，不并入本轮                    |
| `openbot`（主树）                        | 127 + 134 L0 | **抢救 → HOST**         | 先抢救 L0（§5 Phase 1），再由人类把主树切到主干；127 提交转为 PR/重放来源                      |
| `~/.codex/worktrees/*`（3，2 缺失）      |            — | PRUNE（人类）           | 清除 `[MISSING]` 注册项                                                                        |
| supervisor workspaces（2）               |            — | **不动**                | 运行中监管 workspace                                                                           |

无本地目录但需登记的远端缺口（本轮只登记不处理）：
`origin/cursor-composer/employee-ai-archive-ui-delete`（112）、`…/employee-ai-archive-attribution`（112）、
`cursor-main-recovery/main-recovery-routing`（35）、`origin/main`（22）。

---

## 5. 执行计划与门禁

> Phase 0 / 1 / 2 可由 agent 执行（只读盘点、抢救提交、重放）；
> 标注「人类」的步骤必须由维护者执行。

### Phase 0 — 冻结与只读快照（0.5h，无破坏）

1. 输出 worktree 分类、`prune -n` 预演、各树 ahead/behind、主树 `status`/`diff` 到审计目录。
2. `git stash list` + 逐条 `git stash show -p` 落盘为 patch（**只读导出，不 drop**）。
3. `bun scripts/agent-attribution.ts` + `pnpm loom status`：确认主树 134 项的归属 owner。

**门禁 G0：** 审计产物齐备；主树 L0 的 owner 归属表已产出（`UNATTRIBUTED` 需补签或明确弃权）。

### Phase 1 — 抢救主树 L0（**已执行**，2026-07-26）

执行方式与原计划的偏差（并已修正原计划）：

- **不新建抢救分支、不切分支。** 主树带着 100+ 项他人 WIP，切分支风险高于收益；抢救提交直接落在
  当前分支 `deploy/user-modeling-v92`，再把该 tip 推到新的远端 ref 作为异地备份。
- **批次按 `worktree-audit` 的 landing stream 划分**，而不是按内容主题划分 ——
  `git-hooks/pre-commit` 会跑 `--fail-on-unmatched --fail-on-risky-mix`，一次提交只能落一个 primary stream。
- 复核时唯一文件数由 40 降为 22：`skills/cursor-canvas/**`（18 个）已被另一 agent 提交到
  `deploy/user-modeling-v92`，自动脱险。

已落地的抢救提交（每批均通过 audit + oxlint）：

| 提交         | stream | 文件数 | 内容                                                                                                    |
| ------------ | ------ | -----: | ------------------------------------------------------------------------------------------------------- |
| `1e87c9d9f6` | A      |      7 | `ui/src/ui/shells/*.ts` ×6 + `ports/platform/advanced/constants.ts`（`app-render.ts` 已在 import 它们） |
| `b7669660d5` | AGS    |      4 | `agent-growth/feedback-signal(.test)`、`record-feedback`、`skill-draft-curation.test`                   |
| `13f19d42c8` | GWSV   |      2 | working-style RPC、capsule governance server-method 测试                                                |
| `12ad2433d4` | EUI    |      3 | `ui/public/cosmic-bg.jpg/.webp`、`openbot-logo.webp`                                                    |
| `4623f6dfe9` | AGT    |      1 | `pi-embedded-runner/model.provider-normalization.test.ts`                                               |

**冻结（不提交源文件）：** 4 个 `src/auto-reply/reply/learning-*` 测试/fixture 被审计判为
UNMATCHED（registry 的 `landingStreams` 无覆盖）。补 stream 需改 `scripts/worktree-audit.ts`
并跑 `loom import` 重建 registry，会覆盖他人 353 行未提交改动，因此按
`convergence-base-decision-2026-07-20.md` 的 `freeze-evidence` 默认处置冻结为补丁：
`docs/design/convergence-evidence/2026-07-26/frozen-learning-recall-tests.{md,patch}`。

#### 批 2（已执行）— 内容级判定 + 逐 stream 处置

判定口径升级：批 1 用「路径是否在某 ref 存在」，会漏判「路径别处有、内容不同」的文件。
批 2 改为内容级 —— 遍历 293 个 ref 建 `path → blob` 索引（76,707 条），
逐文件比对 `git hash-object`。结果：

| 分类                | 条目 | 处置                                             |
| ------------------- | ---: | ------------------------------------------------ |
| 内容已在某 ref 留存 |   45 | 丢弃安全，仅记账（**不回滚**，避免破坏在途工作） |
| 工作区唯一          |   78 | 保全                                             |
| 本地删除项          |    2 | 记账（本体在 ref 中，删除意图属重构决策）        |

内容级判定比路径级多捞出 3 个真实风险项：`agent-growth/operational-metrics-store.test.ts`、
`collaboration-learning/capsule-governance.ts`、`enterprise-data/connector-credential-vault-key.test.ts`。

78 个唯一项的落地：

| 提交         | stream       | 文件 | 内容                                                         |
| ------------ | ------------ | ---: | ------------------------------------------------------------ |
| `d32e6e477b` | F            |    4 | delivery-guard / enterprise-model-governance spec 草稿       |
| `5402703717` | C            |    1 | `collaboration-learning/capsule-governance.ts`               |
| `b29e37a2c3` | EDGSC        |    1 | `connector-credential-vault-key.test.ts`                     |
| `175f4c05ad` | AGS          |    1 | `agent-growth/operational-metrics-store.test.ts`             |
| `0025fa27c8` | EUI          |    3 | `ui/public` 品牌资源整体替换（二进制，补丁不划算）           |
| 冻结         | 16 个 stream |   64 | `convergence-evidence/2026-07-26/frozen-l0-modified/*.patch` |
| 批 1 已冻结  | —            |    4 | `frozen-learning-recall-tests.patch`                         |

**已跟踪修改为何冻结而非提交：** 它们是其他 agent 在途的 WIP，提交会把半成品落进历史并让文件
从 owner 的 `git status` 消失（`AGENTS.md` § Multi-Agent 禁止代提交带他人 WIP 的共享文件）；
且本批含 `.loom/registry.yaml`、`CHANGELOG.md`、`method-scopes.ts`、`server-methods-list.ts`、
`protocol/index.ts`、`i18n/lib/*`、`app.ts` 等热文件，按
`convergence-base-decision-2026-07-20.md` 只能由 hotfile owner 接线提交。
冻结对保全效果等价（补丁已进 git 并推远端），且这些 diff 基于
`deploy/user-modeling-v92`，本来也无法直接 cherry-pick 到 SoT。
16 个补丁均通过 `git apply --check --reverse` 逐字校验。

台账：`docs/design/convergence-evidence/2026-07-26/frozen-l0-modified/README.md`

#### 批 3（已执行）— 22 个 stash 清点、固定与定向抢救

**事实修正：** 先前把 stash 列为「高风险资产池」不准确。stash 提交经 `refs/stash` reflog
是可达对象，`git gc` 不回收；真实风险只有误 `stash drop` / `stash clear`。
因此处置重点是钉死可达性，而不是导出内容。

- **全部 22 个 stash 已固定** 到 `refs/stash-archive/2026-07-26/00..21`
  （零字节成本，只是 ref；用非 `refs/heads/` 命名空间，`git branch` 列表不受影响）。
  即使 `stash clear` 也仍可达；可逆（`git update-ref -d`）。
- **未 drop、未 clear、未 apply 任何 stash。**

清点口径同批 2（内容级 + 路径级），发现真正只存在于 stash 的孤儿路径集中在 5 个条目。
已抢救无编译风险且有长期价值的部分：

| 提交         | stream | 文件 | 内容                                                                                                                                   |
| ------------ | ------ | ---: | -------------------------------------------------------------------------------------------------------------------------------------- |
| `366551748a` | DDOC   |   10 | 只存在于 `stash@{18}` 的设计记录（capability installation governance、asset intake/binding、platform auth 流、port gap、UI parity 等） |
| `de0d990a8a` | SKL    |   13 | 孤儿 skill：`skills/pptx/**`、`skills/wechat-article/**`（落地前已做凭据扫描，仅占位符）                                               |

**最重要的发现：** `openbot-web/`（一个完整 Next.js 应用，40 个非构建文件，含
`(auth)` 页面与 nginx/SSL 部署脚本）**只存在于 `stash@{18}`/`{19}`**，294 个 ref
里没有，本机也没有 `AGENTS.md` 所述的 `openbot.love` 兄弟仓库目录。
它属于本仓库边界之外的独立应用，不应直接并入 → 新增决策项 **D9**。
其 `.env.local` / `.env.production` 在该 stash 内，**不得**进入任何仓库或补丁。

未抢救的其他孤儿簇（style-contract 强制子系统、治理脚本、2026-05 测试套件、
enterprise usage UI、44 个 `Dockerfile.rc-v*-layer`、构建产物、一次性本机材料）
均已在台账登记并保留在固定 ref 中，按需提取。

台账：`docs/design/convergence-evidence/2026-07-26/stash-inventory.md`

剩余待办：45 个丢弃安全项的实际清理，留到 Phase 3 主树切换前由各 owner 处理。

**门禁 G1：** 已达成 —— 工作区唯一内容 0 遗留（全部已提交或已冻结并推送到
`origin/rescue/l0-unique-20260726`）；`pnpm tsgo` 基线在共享脏树上不可判定，
改为按 stream 在重放阶段逐批验证。

### 门禁 G-ACC — 独立验收（贯穿所有 Phase）

**规则：每批任务在声明完成前，必须先通过一次独立验收，判定必须为 PASS。
被验收方自报的「完成」不构成门禁通过条件。**

- 工具：`docs/design/convergence-evidence/2026-07-26/verify-rescue.py`（只读、可复现）
- 验收方要求：不读被验收方结论，只从 git 事实重新推导；每条声明给出 PASS/FAIL 与实测证据
- 首轮验收结果必须一并记录，包括被推翻的 FAIL 项及其真伪判断
- 记录：`docs/design/convergence-evidence/<date>/acceptance-<date>.md`

Phase 1 的执行结果：首轮 `VERDICT: FAIL`（4 项），查证后 3 项是验收方自身逻辑缺陷
（反向校验误当补丁失真、排除 ref 漏了抢救提交所在分支、空操作 reset 误判为破坏），
1 项是真实缺口（2 个 UNMATCHED 文件未保全，已冻结）。修正验收逻辑并处置缺口后
复验 `VERDICT: PASS`（27/27）。详见
`docs/design/convergence-evidence/2026-07-26/acceptance-2026-07-27.md`。

### Phase 2 — 前向重放到主干

**可行性已实测（2026-07-27），执行清单见
`docs/design/convergence-evidence/2026-07-27/phase2-replay-sheet.md`；
实测脚本 `phase2-replay-audit.py` 只读可复现，自带验收断言，判定 PASS(6/6)。**

实测结论修正了本节原有的批次假设：8 个待重放分支共 120 个独有提交，
`git merge-tree` 逐提交模拟 cherry-pick 得出 60 干净 / 60 冲突；但冲突里
**记录类 34 + 合并提交 4 = 38** 本来就不该重放，真正需要人工对账的代码提交只有 **22 个**。
即 Phase 2 的真实工作量是「44 个干净代码重放 + 22 个对账 + 50 条台账」。

建议顺序（按难度升序，取代原顺序）：
`enterprise-ai-model-governance(1)` → `web-favicon-branding(1)` →
`convergence(3，全记录类→只入台账)` → `knowledge-import-ia(10)` →
`nginx-ops(13)` → `delivery-alignment-guard(23)` → `enterprise-channels(48)` →
`collaboration-deliverable-v95(21，最难)`。

原 P0「delivery-guard 无远端备份」已由其 owner 于 07-27 10:28 自行关闭（本地与 origin 同 sha）。

每批规则（沿用 `BASELINE_RECOVERY_20260725.md`）：

- 只 cherry-pick / replay，禁止整分支 merge；提交信息保留来源 SHA
- 每批一个 PR，并在 `BASELINE_RECOVERY_20260725.md` ledger 追加 `REPLAY → PRESENT` 行 + provenance
- `Deploy: record …` 类纯记录提交不重放，改为台账合并
- 与 SoT 已有内容重复的（如 runtime-health 4 提交）标 `SUPERSEDED`，不重放
- 每批过 `pnpm tsgo` + 受影响测试；绿灯才进下一批

**门禁 G2：** 每棵树 `ahead(SoT) = 0` 或剩余项已标 `SUPERSEDED/DEFERRED`。

### Phase 3 — 主树改造（人类）

1. 主树 `git status` 干净（Phase 1 完成）后，由人类把 `openbot` 切到主干分支。
2. `deploy/user-modeling-v92` 的 127 提交转为「PR/重放来源」，分支保留但标记 archive-only。
3. `pnpm install && pnpm build` 验证主树可构建。

**门禁 G3：** 主树 = 主干检出且可构建；`RELEASE_RECORD.md` 记录主干切换。

### Phase 4 — 回收 worktree（人类）

对 `ahead = 0` 的树按 §4 执行 `worktree remove --force`，`prune` 掉 2 个 `[MISSING]` codex 项；
`openbot-archives/README.md` 追加处置行（分支、push SHA、批准人、日期）。

**门禁 G4：** `git worktree list` = 1 主树 + ≤3 活跃功能树 + 归档 + 2 supervisor，无 `[MISSING]`；
`prune -n` 无输出。

### Phase 5 — 主干统一（人类，见 §8-D1）

按 T1 或 T2 收敛 `main` 与 SoT，写入 `RELEASE_RECORD.md`；清理 73 个超前本地分支与
100 个远端分支中的历史项（`docs/ops-v7x-cutover`、`codex/deploy-v9x-*` 等已被 tag 覆盖的）。

### Phase 6 — 防复发（落地守卫）

1. `delivery-guard` 的 forward-only 检查 + `delivery-sot-alignment.yml` 设为必需检查。
2. `openbot-rc` 的 315 提交另立 ledger（独立任务）。
3. `AGENTS.md` 补一条：**新建 worktree 必须先 `loom register`，且必须基于当前主干**。

---

## 6. 风险与回滚

| 动作              | 风险               | 缓解                                  | 回滚                          |
| ----------------- | ------------------ | ------------------------------------- | ----------------------------- |
| 抢救主树 L0       | 误丢 40 个唯一文件 | Phase 0 快照 + 先 push 再动主树       | 从 `rescue/*` 分支恢复        |
| stash 清点        | 误 `drop`          | **只 `show -p` 导出，禁止 drop**      | patch 文件                    |
| 重放 48 提交批次  | 引入回退/冲突      | 分批 + 每批 tsgo/测试 + ledger        | revert 单批 PR                |
| `worktree remove` | 丢未 push 提交     | 门禁 G2 要求 `ahead=0`                | 从 origin 重新 `worktree add` |
| 主树切分支        | 覆盖未提交改动     | 门禁 G1 要求 `status` 干净            | —                             |
| `worktree prune`  | 归档树脱钩         | 已 repair 过；仅 prune `[MISSING]` 项 | 重新 `worktree add`           |

---

## 7. 与 2026-07-23 整理的关系

2026-07-23 的方案解决的是**文件系统 + Git 元数据**（38 → 6 棵），已 EXECUTED。
本方案解决的是**内容收敛**（分支缺口 + L0 抢救 + 双主干）。前者是卫生，后者是根因；
只做前者会 3 天复发一次（实测：6 → 17 棵）。

---

## 8. 需要人类决策

| #   | 决策项                                                  | 建议                                                                                                                               | 勾选 |
| --- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---- |
| D1  | 唯一主干：T1（SoT 族）/ T2（回灌 main）                 | **T1**，并在 `RELEASE_RECORD.md` 声明                                                                                              | ☐    |
| D2  | Phase 1 抢救优先级是否高于一切在途任务                  | 是（40 个文件仅存本地）                                                                                                            | ☐    |
| D3  | 主树 127 提交是否只作 PR 来源、不作发布来源             | 是（沿用 RELEASE_RECORD 现有判定）                                                                                                 | ☐    |
| D4  | `openbot-rc` 315 提交本轮 HOLD                          | 是，另立 ledger                                                                                                                    | ☐    |
| D5  | 22 个 stash 是否本轮清点并导出 patch                    | 是（只导出不 drop）                                                                                                                | ☐    |
| D6  | 目标活跃功能树上限                                      | ≤3 棵，超出需维护者批准                                                                                                            | ☐    |
| D7  | `channels(48)` 中 `Deploy: record` 类是否只入台账不重放 | 是                                                                                                                                 | ☐    |
| D8  | 是否把 forward-guard CI 设为必需检查                    | 是（Phase 6）                                                                                                                      | ☐    |
| D9  | `openbot-web/`（只存在于 stash 的 Next.js 应用）归属    | 确认 `openbot.love` 兄弟仓库是否另存；若无则从 `refs/stash-archive/2026-07-26/18` 提取到独立仓库，**不并入本仓库**，且排除 `.env*` | ☐    |

---

## 附录 A — 复核用只读命令

```bash
G=/usr/bin/git; SOT=origin/release/baseline-recovery-20260725
cd "$WS/openbot"

# 分类清单（含 MISSING 标记）
bash "$WS/list-openbot-worktrees.sh"

# 各分支相对主干缺口
for b in $($G worktree list --porcelain | awk '/^branch /{sub("refs/heads/","",$2); print $2}'); do
  printf "%-52s ahead=%-4s behind=%s\n" "$b" \
    "$($G rev-list --count "$SOT..$b")" "$($G rev-list --count "$b..$SOT")"
done

# 主树 L0 逐文件与主干比对（identical / differs / absent）
$G status --porcelain | sed 's/^...//' | while read -r f; do
  $G cat-file -e "$SOT:$f" 2>/dev/null \
    && { $G cat-file blob "$SOT:$f" | cmp -s - "$f" && echo "SAME $f" || echo "DIFF $f"; } \
    || echo "NEW  $f"
done

# 某文件是否在任何分支存在（判断是否仅存本地）
for r in $($G for-each-ref --format='%(refname:short)' refs/heads refs/remotes/origin); do
  $G cat-file -e "$r:ui/src/ui/shells/employee-shell.ts" 2>/dev/null && echo "$r" && break
done
```

## 附录 B — 关键 SHA（2026-07-26 快照）

| 角色          | 引用                                        | SHA                                              |
| ------------- | ------------------------------------------- | ------------------------------------------------ |
| 生产 SoT tip  | `origin/release/baseline-recovery-20260725` | `83dded041d`                                     |
| 生产 SoT 起点 | `fix-scoped-package-templates` tip          | `2664b3633f`                                     |
| 短谱系主干    | `origin/main`                               | `f3379fd056`                                     |
| 主树当前 tip  | `deploy/user-modeling-v92`                  | `8f2109c6d0`                                     |
| 两谱系分叉点  | merge-base                                  | `4f1d8d603c`（2026-07-09）                       |
| 已重放示例    | PR #87 replay                               | `225de96b27` / tag `provenance/sha-225de96b270f` |

---

**审核人：** **\*\***\_\_\_**\*\*** **日期：** **\*\***\_\_\_**\*\***
