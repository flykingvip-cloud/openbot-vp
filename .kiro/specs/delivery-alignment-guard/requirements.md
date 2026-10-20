# Requirements Document

> 中文名：交付前进性守卫（Delivery Alignment / Forward-Only Guard）— **杜绝"提交了比生产还旧的文件 → cutover 把云端推回旧版"这类倒退**
> 状态：立项 · 交付执行 owner：Codex
> 关联：`docs/design/openbot-dev-delivery-pipeline-standard-2026-07-20.md`(**已存在**,`f3bf00da7b` 2026-07-20 加入,158 行;立项时误记为缺失,本规格改为在其中增补前进性一节)、`deploy/production/RELEASE_RECORD.md`、`scripts/write-build-info.ts`、`scripts/committer`、`scripts/worktree-audit.ts`、`loom-workspace-orchestrator` / `loom-provisioning`。

## Introduction

多 agent 共享工作树下,一次提交的内容**可能比生产正在运行的还旧**(不同 agent 交错编辑 + 生产 hotfix 从隔离克隆 cutover 后未并回 SoT)。当这样的提交被 cutover,云端会**静默倒退**。本规格建立一套**前进性守卫**:让"生产只能沿 git 历史前进"成为被机器强制的不变量,并在提交期、cutover 期、CI 期三处设闸。

### 真实案例（已验证，作为验收基准 fixture）

- 线上 v115 源 = `e860bba1b0`(`OpenBot 1.0.1 (e860bba)`),含 `src/gateway/user-modeling/tenant-membership.ts`。
- 某会话从共享树提交 `0b47c51b`(user-modeling 的**较旧变体**,缺 `tenant-membership.ts`)。
- 判据实测:`git merge-base --is-ancestor e860bba1b0 0b47c51bfe` → **false**;`git diff --diff-filter=D e860bba1b0 0b47c51bfe -- src/gateway/user-modeling` → **删除 `tenant-membership.ts`**。
- 结论:守卫必须对该对 SHA **判定 BLOCK**。这是本规格的头号验收用例。

### 根因（两层漂移 + 一个放大器）

1. **工作树 ↔ SoT 漂移**:磁盘文件可能比 SoT 分支旧。
2. **SoT ↔ 生产漂移(放大器)**:`RELEASE_RECORD.md` 明载 v115 由隔离克隆 `refs/v115-pending-admin` 构建,"land v115 commits onto shared SoT branch" 仍在 backlog;本地 `dist/build-info.json` 记 `05f57a5`(v114 源)而线上是 `e860bba`(v115)——**agent 依据的 SoT 长期落后生产**,使"提交旧文件"成为必然。

### 设计原则（强约束）

1. **唯一判据 = 相对 LIVE 的祖先关系**,绝不用"最新提交/提交时间/磁盘内容"当新旧依据。
2. **LIVE 取自运行中的制品,不取自文档**。机制已存在:`scripts/write-build-info.ts` 把 commit 打进 `dist/build-info.json`,容器自带身份(优先 HTTP 版本/健康端点,退化到 `podman exec ... cat /app/dist/build-info.json`)。`RELEASE_RECORD.md` 仅作交叉校验,冲突时以容器为准并告警。
3. **只读、fail-closed、非破坏**:守卫绝不修改生产状态;判据无法取得(拿不到 LIVE)时**默认阻断**(可显式豁免)。
4. **单一真相实现**:核心判定为可单测的 TS 纯函数,shell/CI/committer 三处**共用同一实现**,不复制逻辑。
5. **保留合法回滚**:必须提供显式 `--intentional-revert`(带原因)逃生阀,否则紧急回滚会被误伤。
6. **不误伤正常前进**:合法的向前 cutover 必须放行(有测试锁定 false-positive)。
7. **本规格自身在隔离 worktree 完成**(见本案例教训),不得从共享脏树 land。

## Glossary

- **LIVE SHA**:生产容器当前实际运行的源 commit(从运行制品自报读取)。唯一的"新旧基准"。
- **候选 SHA(CANDIDATE)**:准备构建/cutover 的源 commit。
- **前进性(Forward-Only)**:`is-ancestor(LIVE, CANDIDATE) == true`,即候选包含线上全部历史。
- **回退路径(Regressed Path)**:候选相对 LIVE 删除或回退了内容的文件(尤其受保护路径,如整文件消失)。
- **SoT 分支**:生产唯一 cutover 源分支(当前 `deploy/user-modeling-v92`)。
- **合并回环(Merge-Back)**:每次 cutover 的 SHA 必须立即并回 SoT,使 SoT 永不落后生产。

## Requirements

### Requirement 1: LIVE SHA 解析（以运行制品为准）

**User Story:** 作为发布者,我要可靠拿到"生产此刻真正在跑哪个 commit",以此作为一切新旧判断的基准。

#### Acceptance Criteria

1. THE 系统 SHALL 提供 `resolveLiveSha`,优先从生产网关的版本/健康端点读取 `build-info.commit`;不可得时退化为容器 `podman exec <container> cat <in-container build-info path>`。
2. THE 系统 SHALL 支持离线/测试注入 LIVE(`--live-sha` 或注入的 reader),使核心逻辑不依赖真实 SSH 即可单测。
3. WHEN 容器自报 SHA 与 `RELEASE_RECORD.md` "Latest cutover" 记录不一致 THEN 系统 SHALL 以容器为准并输出告警(记录漂移)。
4. IF 无法取得 LIVE SHA THEN 守卫 SHALL fail-closed(默认阻断 cutover),除非显式 `--allow-unknown-live`。

### Requirement 2: 前进性核心判定（可单测纯函数，单一实现）

**User Story:** 作为系统,我要一份被 shell/CI/committer 共用、可单测的前进性判定,避免逻辑分叉。

#### Acceptance Criteria

1. THE 系统 SHALL 提供纯函数 `isForwardOnly(liveSha, candidateSha, gitRunner)`,语义等价 `git merge-base --is-ancestor live candidate`。
2. THE 系统 SHALL 提供 `detectRegressedPaths(liveSha, candidateSha, { protectedGlobs })`,返回候选相对 LIVE **被删除/回退**的文件清单(至少覆盖整文件删除 `--diff-filter=D`)。
3. THE 判定实现 SHALL 位于单一 TS 模块,由 shell 守卫、CI、committer 复用(不复制到多处)。
4. WHEN 输入为真实案例 `LIVE=e860bba1b0` / `CANDIDATE=0b47c51bfe` THEN `isForwardOnly` SHALL 返回 false 且 `detectRegressedPaths` SHALL 含 `src/gateway/user-modeling/tenant-membership.ts`(**验收 fixture**)。

### Requirement 3: Gate 1 — Cutover 前前进性守卫脚本（verify-forward-only.sh）

**User Story:** 作为发布者,cutover 前要有一道自动闸拦下会导致倒退的候选。

#### Acceptance Criteria

1. THE 系统 SHALL 新建 `deploy/production/scripts/verify-forward-only.sh`,内部调用 R2 判定。**更正（2026-07-26 核实）**：立项时记为「`verify-delivery-alignment.sh` 缺失、需补齐」,实际该路径自 `bf776639ec`(2026-07-20)起就存在(177 行,维护至 `2664b3633f` 2026-07-24),内容是 **L1/L2/L3 发布链检查器**(tag→SHA、tag 是否在 `origin`、镜像是否钉短 SHA、RELEASE_RECORD 是否提到 prod SHA),与祖先关系是不同关注点且**不含**任何 `merge-base`/`is-ancestor`。因此前进性守卫 SHALL 落在**新路径** `verify-forward-only.sh`,既有脚本 SHALL 原样保留,两者并列为独立门禁。
2. WHEN `isForwardOnly(LIVE, CANDIDATE)` 为 false THEN 脚本 SHALL 以非零码退出并打印明确原因(落后/背离 + 回退文件清单)。
3. THE 脚本 SHALL 提供 `--intentional-revert "<原因>"`,用于**显式**批准的回滚(记录原因,放行),其余情况一律阻断。
4. THE 脚本 SHALL 为**只读**:不修改生产容器/镜像/分支/stash;仅读 LIVE 与运行 git 查询。
5. THE 脚本 SHALL 支持 `--candidate <sha>` 与 `--live-sha <sha>`(测试/离线),默认 candidate=当前构建源、live=R1 解析。

### Requirement 4: Gate 2 — 合并回环 + CI「SoT 不落后生产」

**User Story:** 作为维护者,我要保证 agent 工作依据的 SoT 分支永不落后生产,从根上消除"提交旧文件"的土壤。

#### Acceptance Criteria

1. THE 系统 SHALL 提供检查:`is-ancestor(LIVE, origin/<SoT 分支>)` 必须为真,否则失败并提示"SoT 落后生产,需把 cutover SHA 并回"。
2. THE 检查 SHALL 以 `pnpm` 脚本 + CI workflow(`.github/workflows/`)形式存在,可定时/按 SoT 分支推送触发。
3. THE 系统 SHALL 提供把某 cutover SHA 并回 SoT 的辅助步骤/脚本(不自动强推;产出可评审的合并)。
4. WHEN cutover 从隔离克隆完成 THEN 流程文档 SHALL 要求把该 SHA 并回 SoT 作为**强制收尾**(不再留 backlog)。

### Requirement 5: Gate 3 — 提交期落后告警（committer / worktree-audit）

**User Story:** 作为 agent,我希望在**提交那一刻**就被提醒"你在提交旧文件",而不是等到 cutover。

#### Acceptance Criteria

1. WHEN 当前分支不包含 LIVE(`!is-ancestor(LIVE, HEAD)`) THEN 提交路径 SHALL 输出醒目告警(含 LIVE SHA 与"先 rebase/merge 生产再提交"的指引)。
2. THE 告警 SHALL 默认**非阻断**(避免打断正常提交),并提供严格模式(`--strict` / 环境变量)在关键分支上阻断。
3. THE 集成 SHALL 复用 R2 判定,接入 `scripts/committer` 或 `scripts/worktree-audit.ts`,narrow diff,不改既有正常提交行为(有非回归测试)。
4. IF 无法解析 LIVE THEN 告警 SHALL 静默跳过(不阻断本地开发),仅在 verbose 下提示。

### Requirement 6: 非破坏、非回归与可测

#### Acceptance Criteria

1. THE 全部守卫 SHALL 只读,不 SSH 改动生产、不切分支、不建/弃 stash、不动 worktree。
2. THE 核心判定 SHALL 有 vitest 单测:前进(放行)/落后(阻断)/背离(阻断)/回退文件识别/LIVE 缺失 fail-closed/`--intentional-revert` 放行;含真实案例 fixture(R2.4)。
3. THE 新增 TS SHALL 通过 `pnpm tsgo`(零 `any`)、`pnpm check`;shell 通过 shellcheck(若 CI 有)。
4. WHEN 守卫接入后跑正常向前 cutover / 正常提交 THEN 行为 SHALL 与接入前一致(无误伤,测试锁定)。

### Requirement 7: 文档对齐

#### Acceptance Criteria

1. THE 系统 SHALL 在**既有**的 `docs/design/openbot-dev-delivery-pipeline-standard-2026-07-20.md` 中记录该守卫。该文档立项时被误记为缺失,实际已存在;因此变更 SHALL 为**增补**(三闸 + forward-only 不变量 + 基线快照刷新),不得删除其既有 L0–L3 分层、worktree 角色、分支/tag 约定与发布链检查描述。
2. THE `deploy/production/RELEASE_RECORD.md` 顶部 SHALL 增加"cutover 前必过 verify-forward-only.sh + 完成 merge-back"的说明,并说明既有 `verify-delivery-alignment.sh` 仍然适用、未被取代。
3. THE 变更 SHALL 更新 AGENTS.md 交付链一节,使"承诺存在的脚本"与实际一致。

### Requirement 8: 文件级前进性（提交祖先正确 ≠ 文件内容没倒退）

**User Story:** 作为审核者，我要能在提交前知道"这个文件会不会删掉云上已经在跑的导出或测试"，因为 Gate 1 的提交级祖先判据看不见这一层。

#### 问题陈述（2026-07-27 实测）

Gate 1 判的是 `is-ancestor(LIVE, CANDIDATE)`。这条对**整棵树的历史**有效，但对**单个文件的内容**无效：一个候选可以祖先关系完全正确，同时把某个文件替换成缺少已部署导出的旧变体。实测一棵共享工作树的 109 个脏文件：

| 判定       | 数量 | 含义                             |
| ---------- | ---- | -------------------------------- |
| REGRESSION | 20   | 删掉了 LIVE 上已部署的导出或测试 |
| DIVERGED   | 45   | 有增有删，其中 17 个删除量压倒性 |
| AHEAD      | 9    | 只增不删                         |
| NEW        | 17   | 云端没有此文件                   |
| IDENTICAL  | 13   | 与云端逐字节相同                 |

REGRESSION 里丢失的 **55 个导出 + 数十条测试，逐个核对后 100% 已部署在 LIVE 上**。单文件最严重的一例删掉 22 个已部署导出（整套演化治理前端 API）。另有两个 RPC 注册表分别删掉 67 / 85 条已部署方法名。这些都不会被提交级祖先判据拦下。

#### Acceptance Criteria

1. THE 系统 SHALL 提供文件级判定：对每个候选文件，比对其与 LIVE 版本的**导出符号集**与**测试用例名集**，输出丢失清单。
2. THE 判定 SHALL 区分 **MOVED**（符号在候选侧的其它文件里仍作为导出存在 → 属重构）与 **GONE**（整棵候选树里都没有 → 属回退）；SHALL NOT 把符号迁移报成回退。
3. THE 导出解析 SHALL 覆盖 `export { A as B }`、`export { A as B } from "…"`、`export type { … }`、`export * as NS from "…"`，并以**对外名**（`as` 之后）为准。仅解析声明式 `export function/const/...` 会把"改成别名再导出"误报为删除——本规格实测踩过一次（`redactSecrets` → `export { redactSecretText as redactSecrets }`）。
4. WHEN 候选文件存在 `export * from "…"` THEN 系统 SHALL 提示该文件的导出集不可静态枚举，SHALL NOT 据此给出"无丢失"的结论。
5. THE 丢失判定 SHALL 以 **LIVE（运行制品对应的 commit）** 为基准，而非仅以 SoT tip 为基准；两者可能分叉（实测出现过 LIVE 与 SoT 各领先 1 个提交）。
6. THE 输出 SHALL 对每个文件给出可操作分类（AHEAD / NEW / IDENTICAL / DIVERGED / REGRESSION）与丢失明细，供人工决策"清除 / 正向合并 / 需人判断"。
7. IF 一个文件被判为 REGRESSION THEN 推荐动作 SHALL 是**以 LIVE/SoT 版本为基底的正向合并**（保留云端全部导出与测试，只取候选侧的真实新增），SHALL NOT 是"整包提交"或"整包丢弃"二选一。
8. THE 检查 SHALL 只读，SHALL NOT 修改工作树、分支或生产状态。

### Requirement 9: 正向合并的依赖可解析性前置判据

**User Story:** 作为执行正向合并的人，我要在动手前知道"把云端版写回本线"会不会因为云端独有的依赖链而当场断掉，而不是写完跑测试才发现。

#### 问题陈述（2026-07-27 实测，3 次尝试 1 成 2 败）

"以云端版为基底"这个动作，在一条落后于生产的分支上会被**云端版自身的相对 import** 挡住：

| 文件                                                              | 云端版的额外依赖                                                                     | 结果                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------- |
| `src/gateway/enterprise-data/connector-credential-vault-key.ts`   | 依赖（`config`/`secrets`）在本线齐全                                                 | ✅ 合并成功，8 → 12 导出，零丢失              |
| `ui/src/ui/views/auth-home.browser.test.ts`                       | `public-legal-pages.ts` → 再带 10 个依赖                                             | ❌ 级联，放弃                                 |
| `src/gateway/platform-auth/{auth-helpers,http-handler}.ts` + 门面 | `./seat-store-loader.js` → `tenant-context.ts` + `tenant-store-paths.ts`（本线均无） | ❌ 级联到「租户上下文隔离」整个能力缺口，放弃 |

第三例的根因不是文件差异，而是**该分支整体落后一个能力**（`RELEASE_RECORD.md` 已记载 archive 线缺租户上下文隔离）。这类文件的正向合并只能在生产 SoT 线上做。

#### Acceptance Criteria

1. WHEN 计划把某文件的 LIVE/SoT 版本写回目标分支 THEN 系统 SHALL 先递归检查该版本的相对 import 在目标分支上是否全部可解析（含 `.js` → `.ts`、`.tsx`、`index.ts` 的解析规则）。
2. IF 存在不可解析的 import THEN 该文件 SHALL 被标记为**不可在本分支正向合并**，并 SHALL 给出缺失依赖链；推荐动作 SHALL 改为「在 SoT 线上做该合并」或「仅丢弃本地改动、不引入云端版」。
3. THE 检查 SHALL 递归展开（缺失依赖自身的依赖也要报），因为一次 backport 常常带出整个子树。
4. THE 检查 SHALL 在写入之前执行；SHALL NOT 依赖"写完跑测试"来发现断链。
5. WHEN 一组文件互为 re-export 关系（如门面 / helpers / handler 三件套）THEN 它们 SHALL 作为**一个单元**评估与合并；单个文件恢复云端版会造成 re-export 悬空（本规格实测踩过：门面恢复后 `auth-helpers` 缺 `purgeOrphanedUserAccount` 导致模块加载即抛错）。
6. WHEN 某文件与云端版逐字节相同但被本线在途代码 import THEN 它 SHALL 被判为「构建依赖，随依赖方原样提交」，SHALL NOT 判为「冗余可删除」——删除会当场打断本线编译（实测 `enterprise-model/errors.ts` 被 7 个在途文件引用）。
