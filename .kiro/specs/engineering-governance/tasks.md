# Implementation Plan: OpenBot AI-Native Engineering Governance v2.1

## Overview

落地 `requirements.md` / `design.md`：把已建成的 Loom / Fabric / GitHub / CI / Release 子系统**接通成一条有强制力的交付链路**。

核心方法论：**通电优先，不新增抽象。** 每个任务都指向一个既有资产 + 一处最小改动。绝不新建调度器、权限系统或第二套状态机。

## 审批状态

> **2026-07-31 专家审核：附条件退回修订，暂不批准按原 tasks 直接执行。**
> 完整审批记录见 **`review-decision-2026-07-31.md`**。7 项发现逐条对代码核验**全部成立**，核验中另发现 2 处缺陷。
>
> **本文件已按审核意见修订的条目**：0.1（顺序）、0.3（Option A 作废）、0.4（auto-merge 定性）、新增 0.5.0（冻结）、0.5.3（备份→文件级归档 + 演练）、2.2（撤回，拆 2.2a/2.2b/2.2c）、2.4（作废，拆 2.4a/2.4b）。
>
> **批准的执行顺序**（每步有放行条件，见审批记录 §4）：
>
> 1. 冻结主工作树 + D4 增强版恢复协议（**人类维护者**执行）
> 2. 修复 D2，让真门禁跑在可用 runner 上
> 3. `strict=false` 上线 D3，用**故意失败的 PR** 验证服务端确实拒绝
> 4. 执行 D6、D5，消除归因基线噪声
> 5. 修正并上线真正的 Loom lint 门禁（2.4a）
> 6. GC 后执行 D7、D8
> 7. 最后再评估是否值得自建 Landing Queue
>
> **跨步骤前置**：专家本轮无法连接 `api.github.com`，全部 GitHub 侧事实未经第二方核验。步骤 2、3 执行前必须重跑 `gh api` 与 `gh run list`。

## 三件核心改造（~~修正后~~ 已再次修正）

> 第 3 件按审核撤回。原表称 Landing Queue「能力已存在（`loom task land`）」—— 该前提**不成立**，见 design §4.2。

| #   | 改造                                                                                                | 可行性                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 让 CI 成为真实门禁                                                                                  | **今天可做**（但 L1 不捕获行为回归，须显式声明）                                                                                                                          |
| 2   | 让 Issue 成为任务唯一入口                                                                           | **今天可做**（一个 registry 字段 + 一条 lint 规则）                                                                                                                       |
| 3   | ~~让 Loom Landing Queue 成为进入 main 的唯一路径~~ **→ 短期：required checks + 人工串行 `/landpr`** | **自建队列是新建高风险能力，非接线**。`loom task land` 有 4 处缺陷（per-task 锁 / 未注入 runGate / 未注入 prCreate / 过期本地 base）。GitHub Merge Queue 在本仓库亦不可用 |

## Agents

- kiro-governance · role: owner · scope: AI-native engineering governance wiring (branch policy, issue binding, CI gate tiers, landing queue, metrics) · paths: .kiro/specs/engineering-governance/\*\*, .github/CODEOWNERS · since: 2026-07-31

> **Sign-in 说明**：`.loom/registry.yaml` 当前带有 **263 行他人未提交 WIP**，按 AGENTS.md 规则 2（共享热文件由其 task-owner 落地）本 spec **未**执行 `loom register`。
> 待树干净后由维护者补跑：
> `pnpm loom register --task engineering-governance:kiro-governance --owner kiro-governance --session-id <uuid> --ide kiro --agent kiro-governance`
> 未补跑前，registry 是 source of truth 而本块是 derived view，因此本 sign-in 对 attribution **不可见**。

## 前置说明（重要）

- **当前分支不是 main**：本 spec 创建于 `deploy/user-modeling-v92`（落后 `origin/main` 1528 commit）。落地前需搬到基于 `main` 的分支。
- **GitHub 侧改动需 owner 确认**：Task 1.x / 2.x 会改变合并权限并影响 26 个 open PR，不得由 agent 自行执行。
- **锁定决策**：
  - **D1**：分支命名保持 `<owner>/<task>`，issue 号进 task id 前缀。不采纳 `task/*`。
  - **D2**：Registry 只新增 `issue?: number` 一个真实列。不加 `status`、不加 task 层 `branch`、不塞 `metadata`。
  - **D3（已按审核修订）**：不依赖 GitHub Merge Queue（User 账户 + private repo 不提供）。~~用 `loom task land` 实现同语义~~ → **短期用 required checks + 人工串行 `/landpr`**；自建队列另立安全设计并排到最后评估。
  - **D4**：CODEOWNERS 定位为**信号**，不计入代码进入规则。
  - **D5**：CalVer 不变；单一部署事实源不变；不建 `develop`。
  - **D6**：L1 门禁不捕获行为回归，此缺口须在 `AGENTS.md` 显式写出，直到 L2 落地。

## Tasks

### Phase 0 — Recovery（止血，目标 1 周）

> 目标：恢复控制权。本阶段**不写新系统**。

- [ ] 0.1 上线 L1 required status checks（**已按 2026-07-31 审核批准，含顺序修正**）
  - **顺序（审核修正，优于原写法）**：① 先建一个**故意失败**的测试 PR，确认两个 context 确实产生且能阻止合并；② **再**改 ruleset。原写法是先改配置后验证，那样无法区分"配置生效"与"context 名写错"。
  - 在 ruleset `require-pr-on-trunk`（id 19808307）追加 `required_status_checks`，context 用 job 名原文：`check (types, lint, format)`、`delivery guard`（后者是 `ci-gate.yml` 的 `delivery-guard` job，**不是** `delivery-sot-alignment.yml`）。
  - `strict_required_status_checks_policy` 先设 **`false`**。
  - **不等 dependabot 清仓**（审核批准）。预期副作用：卡住 11 个 dependabot PR + 3 个 `CONFLICTING` PR。处置方式必须是 rebase 或修复，**不得降低门禁**（R6.6）。
  - `required_approving_review_count` 保持 **0**，并在此记录为**单人维护限制**（单一人类 owner 无法自批，提到 1 等于无人可批）。
  - **前置**：执行前重跑 `gh api /repos/gmood2008/openbot/rulesets/19808307` 与 `gh run list` —— 专家本轮无法连接 `api.github.com`，GitHub 侧数据未经第二方核验。
  - _Requirements: 6.1, 6.2_

- [ ] 0.2 在 `AGENTS.md` 声明 L1 门禁缺口
  - 明确写出："L1 required checks 不包含行为测试；`pnpm test` 尚未成为门禁。bug-fix PR 的回归测试要求仍由 review 人工强制（`.pi/prompts/reviewpr.md` 步骤 0）。"
  - 理由：避免规范（要求回归测试证据）与门禁（不检查测试）之间的静默矛盾。
  - _Requirements: 6.2, 14.3_

- [ ] 0.3 Runner 处置（**已按 2026-07-31 审核定为修订版 A/C**）
  - 门禁 job 跑 `ubuntu-latest`（已由 `ci-gate.yml` 承担）。
  - 不可用的重型 job **从默认 CI 触发路径移除** —— 改 `workflow_dispatch` 或按成本拆成低频 `schedule` 矩阵；仅在 runner 能力确认后重新启用。
  - 🚫 **原 Option A 作废**：原方案是"保留 blacksmith 标签 + 加注释标注非门禁"。只要 job 仍挂在 `push`/`pull_request` 上就继续产生 queued/cancelled 噪声，**违反 R7.1 自身的原则** —— 原方案在此自相矛盾。注释不是治理手段。
  - 口径：`origin/main` 的 `ci.yml` 共 **16 个 job**，15 条 `runs-on:` 中 **13 条**指向 `blacksmith-*`。（原材料"34 个 job 中 30 个"系转引 `ci-gate.yml` 注释未独立核验，已更正。）
  - 验收：门禁完成率（0.6）达 100%，**无永久 queued 的 job**。
  - _Requirements: 7.1, 7.2, 7.3_

- [ ] 0.4 开启两个零成本 repo setting（**需 owner 确认**）
  - `delete_branch_on_merge: true` —— 149 个远端分支的直接成因。
  - `allow_auto_merge: true` —— 必需检查通过后自动合并。
  - **定性修正（2026-07-31 审核）**：原文称 auto-merge 是"最接近串行化的原生机制"，**表述错误**。auto-merge 只是"条件满足后自动合并"，**不是队列**，也不提供串行化或 rebase。GitHub 官方文档明确区分 auto-merge 与 merge queue。它的价值仅是减少人工等待。
  - _Requirements: 1.7, 8.8_

- [ ] 0.5 dependabot PR 库存清理
  - 12 个 PR 自 2026-06-01 挂起。先配置 grouping 规则减少后续噪声，再逐个 rebase 或关闭。
  - 必须在 0.1 生效前或紧随其后完成，否则队列首端被永久阻塞。
  - _Requirements: 6.6_

- [ ] 0.6 门禁完成率监控脚本
  - 新增脚本消费 `gh run list --json conclusion`，输出：门禁完成率（目标 100%）+ main 门禁绿率（目标 >95%）。
  - **SHALL NOT** 输出未区分来源的"CI 成功率"（R12.5）。
  - _Requirements: 7.4, 12.4, 12.5_

### Phase 0.5 — 主工作树恢复（独立 · 人工执行 · 带回滚）

> 全计划风险最高的单次操作。**不交 agent。** 沿用 2026-07-27 事故后确立的协议。

- [ ] 0.5.1 归因分派 205 个 dirty 文件
  - `bun scripts/agent-attribution.ts` → 映射到 owner；`UNATTRIBUTED` 的必须由责任 agent 补 sign-in。
  - _Requirements: 14.1_

- [ ] 0.5.2 各 owner 自行落地或归档
  - 不得代他人提交（AGENTS.md 规则 2）。使用 `scripts/committer "<msg>" <file...>`，禁止 `git add .`。
  - _Requirements: 14.1_

- [ ] 0.5.0 **冻结主工作树写入**（新增，按 2026-07-31 审核 —— 必须最先做）
  - 通知所有 agent 停止在主工作树继续开发；后续新任务一律用隔离 worktree。
  - 理由：脏文件数在 30 分钟内从 219 变到 210，归位操作会在移动的靶子上进行。不先冻结，归因与归档都是在流沙上做的。
  - _Requirements: 1.1, 4.4_

- [ ] 0.5.3 **文件级归档** + 切回 main + 记录（**原"备份分支"方案已作废**）
  - 🚫 **原写法作废**：原方案只建 `backup/<topic>-<YYYYMMDD>`。**分支 ref 只保存提交图，对约 209 个未提交的已修改/未跟踪文件零保护**，其中 141 个是 UNATTRIBUTED。这是把 2026-07-27 事故协议（保护的是**已提交但被 force-push 丢弃的 40 个 commit**）错误套用到"未提交工作树内容"上 —— 两类完全不同的东西。
  - 增强协议（缺一不可）：
    1. **写入冻结** —— 见 0.5.0，先做。
    2. **dirty manifest** —— `git status --porcelain=v1 -z` 全量落盘，含 XY 状态码。
    3. **校验和** —— 对每个已修改/未跟踪文件算哈希并入 manifest。
    4. **未跟踪文件清单**单列 —— `git status` 会折叠未跟踪目录，必须展开到文件粒度，否则整个目录会被漏掉。
    5. **可恢复的文件级归档** —— 归档实际文件内容（不是 ref），能按 manifest 精确还原到路径。
    6. **恢复演练** —— 在临时目录从归档还原并比对校验和。**演练通过是切分支的放行条件。**
    7. `git bundle` 或 `backup/*` ref 保存 **322 个领先提交**，并做**批次 triage**（不得丢弃）。
    8. 在 `deploy/production/RELEASE_RECORD.md` 记录 before/after SHA、归档位置、演练结果。
  - 验收：① 恢复演练校验和全部匹配；② 本地可见 `ci-gate.yml` / `ci-canary.yml`（注意 `delivery-sot-alignment.yml` 只监听 `release/baseline-recovery-20260725`，与 `ci-gate.yml` 的 `delivery guard` job 是**两个不同的东西**，不要混称）。
  - **执行主体：人类维护者。** 仓库规则禁止 agent 自行切分支、建/删 worktree、代他人提交。
  - _Requirements: 1.1_

- [x] 0.5.2a **归档工具 + 恢复演练**（放行条件，已完成 2026-07-31）
  - 新增 `scripts/governance/worktree-archive.ts`：`manifest` / `archive` / `verify` / `rehearse` 四条命令。**不切分支、不提交、不改跟踪文件** —— 只读工作树，只写 `--out`。
  - **实测结果**（归档位置 `.tmp/governance-archive/worktree-20260731T224208`，`.tmp/` 已被 `.gitignore:96` 忽略，不污染脏树）：

    | 阶段         | 结果                                                                                      |
    | ------------ | ----------------------------------------------------------------------------------------- |
    | manifest     | **265** 条（`git status --porcelain` 折叠视图只有 210 —— `-uall` 多展开出 **55** 个文件） |
    | archive      | 265 个文件，13M，**漂移检查 0**                                                           |
    | verify       | checked 265 / missing 0 / mismatched 0                                                    |
    | **rehearse** | **265/265 校验和全部匹配 — PASSED**                                                       |
    | git bundle   | 327 个领先提交，3.0M，`git bundle verify` 通过                                            |

  - **恢复演练在第一次运行就抓到了一个真实缺陷**：`cpSync(..., { dereference: false })` 会把**相对** symlink 目标重写成绝对路径（`tracked.txt` → `/var/folders/.../tracked.txt`）。归档的意义正是"在工作树移动后仍可恢复"，而绝对目标指回移动前的位置 —— 每个恢复出来的链接都会指错或悬空。已改为 `readlinkSync` + `symlinkSync` 逐字保留，并加了 4 条回归测试。**这就是把演练设为放行条件而非形式的理由。**
  - 测试：`scripts/__tests__/governance/worktree-archive.test.ts` **34 项全过**（含 `-uall` 展开、删除文件无校验和、相对/嵌套 symlink 逐字保留、悬空链接不误报 missing、归档损坏在 verify 与 rehearse 两处都能抓到、漂移检测）。
  - **bundle 依赖需注意**：`ahead-commits.bundle` 是 thin bundle，需要 merge-base `4f1d8d603c`（存在于 `origin/main`）。`protect-trunk-no-force-push` ruleset 保护该 ref，故可接受；若要完全自包含需 bundle 全量历史。
  - 复现命令：
    ```bash
    node --import tsx scripts/governance/worktree-archive.ts manifest
    node --import tsx scripts/governance/worktree-archive.ts archive  --out <dir>
    node --import tsx scripts/governance/worktree-archive.ts verify   --archive <dir>
    node --import tsx scripts/governance/worktree-archive.ts rehearse --archive <dir>
    ```
  - ⚠️ **剩余步骤仍需人类维护者执行**：0.5.0 冻结通告、0.5.1 归因分派、各 owner 落地/归档、**切回 `main`**。本 agent 按仓库规则不切分支、不代他人提交。归档已就位，演练已通过，放行条件满足。— kiro-governance

- [ ] 0.5.4 分支与 worktree 回收（首轮）
  - `loom task reconcile --mode report` 先只读；确认后 `--mode apply --yes`。
  - 目标：25 个 dead session 清零；40 个 worktree 降到活跃 task 数以内。
  - 不得删除含未提交改动的 worktree（R4.4）。
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

### Phase 1 — Traceability（目标 2 周）

- [x] 1.1 Registry 新增 `issue` 字段
  - `scripts/loom/registry.ts` 的 `TaskSchema` 新增 `issue: z.number().int().positive().optional()`（真实列，非 metadata）。
  - 单测：合法/非法值；缺省不破坏既有 registry 解析（向后兼容）。
  - ✅ 已完成：真实列插在 `owner` 之后（`saveRegistry` 用 `sortMapEntries: false`，故新写入保持该字段序）。`registry.test.ts` +5：round-trip、可选性（既有 126 条仍可解析）、非整数/非正值报出含 task id 的可定位错误、字符串 `"234"` 不被强制转换、`metadata.issue` 走私不算绑定。15 tests passed。— kiro-governance
  - _Requirements: 2.2, 2.3_

- [x] 1.2 `loom lint` 新增 `active-task-no-issue`
  - `scripts/loom/lint.ts`：`state === "active" && issue == null` → 初期 `warn`。
  - 单测：命中/不命中；terminal state 不报。
  - ✅ 已完成：作为 check 8 加入 per-task 循环，`severity: warn`，detail 直接给出修复命令。仅检查 `active`（与 check 5 一致；`claimed`/`paused`/`blocked` 可能合法地早于 triage）。`lint.test.ts` +5（含「`metadata.issue` 不满足该规则」）→ 21 tests passed。真实 registry 上命中 **35** 条 = 35 个 active task，`hasErrors=false`。`loom check --strict`（CI 门禁）仍 exit 0，未受影响。— kiro-governance
  - _Requirements: 2.4_

- [x] 1.3 `loom task start --issue <n>`
  - `scripts/loom/provision.ts` / `scripts/loom.ts`：接受 `--issue`，写入 task `issue` 字段，并据此派生 task id 前缀 → 分支 `<owner>/<issue>-<slug>`。
  - `branchTemplate` **保持** `{owner}/{task}` 不变（D1）。
  - 单测：分支名派生；缺 `--issue` 时的行为（warn 但不阻断，待 1.6 转 error）。
  - ✅ 已完成：`RegisterOptions.issue` + `applyIssueBinding`（同值幂等；已绑定后改绑**不同** issue → 抛错，理由：会重写该 task 下已有 commit 的可追溯性）。`StartArgs.issue` / `StartResult.issue` / `applyStart` 透传。`loom.ts` 新增 `readIssue`（`undefined`=未传 / `null`=非法）并接入 `task start` 与 `register`；非正整数 exit 1。
  - ⚠️ **口径修正**：task id 前缀**未**做成硬约束。registry 的 126 个 ownership id 形如 `<spec>:<agent>`，而 `:` 在 `provision.ts` 的 `UNSAFE_BRANCH_LITERAL` 里，**这类 id 无法作为分支名**；`task start` 用的是另一套短 slug id。故改为纯函数 `issueMatchesTaskId` + advisory warn（requirements R1.4 已同步修正）。
  - 测试：`register.test.ts` +5、`provision.test.ts` +9（含 `1234-plan` 不匹配 issue 234 的数字边界、`<spec>:<agent>` 无误报）。CLI 5 场景实测：匹配/不匹配/无 issue/`abc`/`0`。— kiro-governance
  - _Requirements: 1.4, 2.5_

- [x] 1.4 补齐 label 集
  - 新增 `type:feature` / `type:bug` / `type:improvement` / `type:tech-debt`，以及 `AGENTS.md` 已规定但缺失的全部 `r:*` 与 `dirty`。
  - 这是让 `auto-response.yml`（521 行、label 驱动）从空转变为生效的前置条件。
  - 验收：给一个测试 issue 打 `r: support`，确认自动 comment + close 生效。
  - ✅ 已完成（2026-07-31）：label 由 14 个增至 28 个。新增 10 个 `r:*`/`dirty`（`r: skill`/`support`/`no-ci-pr`/`too-many-prs`/`too-many-prs-override`/`testflight`/`third-party-extension`/`moltbook`/`spam`、`dirty`）+ 4 个 `type:*`。`auto-response.yml` 引用的 label 现已全部存在（`comm` 比对无缺项）。端到端 label 触发验收仍待人工在真实 issue 上确认。— kiro-governance
  - _Requirements: 14.1_

- [ ] 1.4a 补齐 `labeler.yml` 的 48 个缺失 label（**需 owner 确认：数量较大**）
  - 核查发现：`.github/labeler.yml` 引用 **49** 个 label，其中 **48 个不存在**（仅 `docker` 存在）。分布：`channel:*` 22、`extensions:*` 15、`app:*` 4，以及 `agents`/`cli`/`commands`/`docs`/`gateway`/`scripts`/`security` 各 1。
  - 后果：labeler 工作流与 `auto-response.yml` 之前一样属于「配置存在但不生效」——这是 R7「不存在的基础设施不参与治理」的同类问题，只是发生在 label 而非 runner 上。
  - 颜色约定：按 `AGENTS.md`「使用既有 channel/extension label 颜色」。
  - _Requirements: 7.3, 14.1_

- [ ] 1.5 回填 35 个 active task 的 `issue`
  - 由各 task owner 在干净树上回填自己的条目（AGENTS.md 规则 2）。
  - 验收：`loom status --json` 计算的 Issue Coverage = 100%。
  - _Requirements: 2.7, 12.7_

- [ ] 1.6 `active-task-no-issue` 提升为 `error`
  - 前置：1.5 完成（Coverage 100%）。
  - _Requirements: 2.4_

- [x] 1.7 `loom derive --codeowners` + drift 检查
  - 从 registry `tasks[].paths` 生成 `.github/CODEOWNERS`；CI 校验与 registry 无 drift。
  - **不设** `require_code_owner_review`——单人仓库下无强制力（R11.3）。
  - ✅ 已完成：`scripts/loom/derive.ts` 新增纯函数 `deriveCodeowners`（无 fs，保持 repo-agnostic）+ `toCodeownersPattern` + `loadCodeownersConfig` + `handleResolver`；`loom derive --codeowners [--write|--check]` 三态。生成头部显式声明「这是 SIGNAL 不是 merge gate」，并指向真正的门禁 `loom lint (ownership-overlap)`。
  - **关键约束（新发现）**：registry 的 `owner` 是 agent id（`kiro-loom`），不是 GitHub 账号。输出 `@kiro-loom` 会被 GitHub 判为 unknown owner 并**静默作废整个文件**。因此新增 `.loom/config.yaml` 的 `codeowners.handles` / `codeowners.defaultHandle` 映射，未映射时**拒绝生成并列出未映射 agent**。真实 registry 上实测报出 **27** 个未映射 agent 并 exit 1（正确的 fail-loud）。requirements R11 已补 2a/2b/2c。
  - 其他决策：终态 task 省略（对齐 `TERMINAL_TASK_STATES`）；含 `#` 的子符号声明与含空白的路径跳过并告警（`#` 在 CODEOWNERS 里是注释符）；路径统一加前导 `/` 锚定到仓库根；头部注明 CODEOWNERS 是 last-match-wins 而 Loom 是 exclusive，重叠属 `ownership-overlap` 的职责。
  - 测试：`derive.test.ts` 3 → **22** tests。临时仓库端到端实测：render / write / check-pass / check-drift / check-missing 五态全部正确。
  - ⚠️ 本仓库**尚未**生成 `.github/CODEOWNERS`，也未创建 `.loom/config.yaml`——前者需先决定 handle 映射，后者属 `kiro-loom` 的 `.loom/**`（见下方交接说明）。— kiro-governance
  - _Requirements: 11.1, 11.2, 11.3_

- [ ] 1.8 L2 门禁：`test (core slice)`
  - `ci-gate.yml` 新增 job，`ubuntu-latest` + `OPENBOT_TEST_PROFILE=low`，按变更域跑 vitest 子集。
  - **不得**把 `pnpm test` 全量设为必需（minutes 计费；沿用 `ci-gate.yml` 头注释的成本纪律）。
  - 上线后更新 0.2 里声明的门禁缺口。
  - _Requirements: 6.3_

- [ ] 1.9 `AGENTS.md` 写入分支与 WIP 规则 — **BLOCKED（ownership）**
  - `hotfix/*` 例外及其"绕过 Loom、事后补 task"的约束（R1.5）。
  - 禁止长期集成分支（R1.2）。
  - WIP 上限 ≤2 active task / ≤2 open PR（R3.2、R3.3）。
  - 🚧 **阻塞原因**：`AGENTS.md` 由 `public-web-entry-url:kiro-public-web-entry`（state=active）声明所有权，且**当前已带该 agent 1 行未提交 WIP**（`lastSignalAt` 2026-07-31T03:56，属活跃 session）。按 AGENTS.md 规则 2「共享热文件由其 task-owner 落地、不得提交他人 WIP」，本 agent 未编辑该文件。落地路径二选一：(a) 把条款文本交 `kiro-public-web-entry` 落地；(b) 走 takeover 仪式转移该 task 的 owner 后自行落地。
  - _Requirements: 1.2, 1.5, 3.2, 3.3, 14.3_

- [ ] 1.10 消除 `AGENTS.md` 悬空引用 — **BLOCKED（同 1.9）**
  - `.agents/skills/PR_WORKFLOW.md` 在本地与 `origin/main` 上均不存在。创建它，或把引用改指 `.pi/prompts/landpr.md` + `reviewpr.md`。
  - 🚧 同 1.9 的 ownership 阻塞。
  - _Requirements: 14.4_

## Phase 1 落地交接（ownership）

本轮 Phase 1 的代码改动全部落在 **`kiro-loom`** 的 ownership 内——`loom-workspace-orchestrator:kiro-loom`（state=active）声明
`scripts/loom/**`、`scripts/loom.ts`、`.loom/**`、`.kiro/specs/loom-workspace-orchestrator/**`。
`bun scripts/agent-attribution.ts` 对这 6 个文件的归属判定均为 `kiro-loom(loom-workspace-orchestrator)`：

| 文件                                       | 归属      | 说明                                              |
| ------------------------------------------ | --------- | ------------------------------------------------- |
| `scripts/loom/registry.ts`                 | kiro-loom | `issue` 真实列                                    |
| `scripts/loom/lint.ts`                     | kiro-loom | `active-task-no-issue`                            |
| `scripts/loom/register.ts`                 | kiro-loom | `applyIssueBinding`                               |
| `scripts/loom/provision.ts`                | kiro-loom | `StartArgs.issue` / `issueMatchesTaskId`          |
| `scripts/loom/derive.ts`                   | kiro-loom | `deriveCodeowners` 等                             |
| `scripts/loom.ts`                          | kiro-loom | `--issue` / `--codeowners` CLI                    |
| `scripts/__tests__/loom/*.test.ts`（4 个） | —         | landing stream `D`（parallel），无 ownership 冲突 |

按 AGENTS.md 规则 2，**这批改动应由 `kiro-loom` 落地**，或经 takeover 仪式把 `loom-workspace-orchestrator` 的 owner 转给本 agent 后自行落地。
`.loom/registry.yaml` 亦属该 task 且带 261 行他人 WIP，故本轮既未 `loom register`、也未创建 `.loom/config.yaml`。

### Phase 2 — Throughput（目标 3 周）

- [ ] 2.1 WIP 上限强制
  - `loom task start` 在超限时拒绝，并打印当前占用清单（active task + open PR，后者经 `gh pr list` 计数）。
  - `loom lint` 新增 `agent-wip-exceeded`（`warn`；`--strict` 下 `error`）。
  - _Requirements: 3.2, 3.3, 3.4, 3.5_

- [ ] 2.2 ~~Landing Queue：`loom task land --queue`~~ — **按 2026-07-31 审核撤回，改为两段**
  - 🚫 **原写法作废**：原任务称"复用 `loom task land` 两阶段落地，不新建调度器"。核验后该前提不成立（见 `review-decision-2026-07-31.md` §2.1、design §4.2）。
  - **2.2a（前置修复，必须先做）** 修 `loom task land` 的 4 处缺陷：
    - `provision.ts:490` per-task 锁 → 落地需要**全局**锁；
    - `loom.ts:554` 未注入 `runGate` → **CLI 落地不跑任何门禁**；
    - 同处未注入 `prCreate` → `--mode pr`（默认）推分支、置 `landed`、删 worktree 却**不开 PR**；
    - `provision.ts:632` base 为**本地** `main`（实测落后 `origin/main` 15 commit）+ fetch 失败被吞。
    - 这 4 处是当前 `loom task land` 的真实缺陷，**与是否建队列无关**，应独立修复并补测。
  - **2.2b（另立设计，非本 spec 范围）** 若决定自建队列，须另立安全设计，至少含全局锁、强制同步最新 `origin/main`、检查结果与 SHA 绑定、幂等恢复、审计事件。**排在批准顺序第 7 步**，前置条件是有实际合并吞吐数据。
  - 短期落地路径见 R8.2：required checks + 人工串行 `/landpr`。
  - _Requirements: 8.2, 8.3, 8.4_

- [ ] 2.2c 记录：`loom task land` 当前不可用于生产落地
  - 在 `.kiro/specs/loom-provisioning/tasks.md` 与 `loom-workspace-orchestrator/tasks.md` 标注上述 4 处缺陷，避免其他 agent 误用 `loom task land` 落地（特别是默认 `--mode pr` 不开 PR 这一条，会产出"已 landed 但 main 上没有"的错误状态）。
  - _Requirements: 8.3_

- [ ] 2.3 更正 Merge Queue 的过期建议
  - 在 `docs/design/worktree-multiagent-target-architecture-2026-06-16.md` §4 标注：GitHub Merge Queue 在本仓库（User 账户 + private repo）不可用，已由 Landing Queue（R8）替代。
  - 同时更正该文档 Layer 0 的 "not yet implemented" —— worktree provisioning 已由 `scripts/loom/provision.ts`（1026 行）实现。
  - _Requirements: 8.7_

- [ ] 2.4 ~~L3 门禁：`loom check --strict` 转必需~~ — **按 2026-07-31 审核作废，拆为 2.4a/2.4b**
  - 🚫 **原写法作废**：它把"移除 `ci.yml:237` 的 `continue-on-error`"等同于"`ownership-overlap` 成为真实门禁"。**不成立** —— `scripts/loom/check.ts` 完全不引用 `lintRegistry`；`loom check` 只做 legacy↔registry 归因 parity。实测 `loom check --strict` **exit 0** 而 `loom lint` **123 条 / 18 error**。改一个不含 lint 的命令，`ownership-overlap` 一条也不会被拦。
  - **2.4a（真正的结构门禁）** 在 `ci-gate.yml`（GitHub-hosted runner）**新增独立 job** 跑 `loom lint`，error 级别阻断。
    - **不要**改 `ci.yml` —— 它当前不可运行（16 job / 13 of 15 `runs-on` 指向未订阅的 runner），改它无治理效果。
    - 前置：D6（`impossible-glob` 18 条归零）与 D5（`sharedPaths` 填表后 `ownership-overlap` 降噪），否则门禁红着上线。
  - **2.4b（parity 门禁提升）** 移除 `ci.yml:237` 的 `continue-on-error`。该步骤只保证归因 parity 不回退，**与结构检查无关**，排在 2.4a 之后。
  - _Requirements: 6.4a, 6.4b, 11.4_

- [ ] 2.5 shadow 结构 lint 逐条转硬
  - `ci-gate.yml` 的 `Run structural lint guards (shadow)` 含 15 条 lint，逐条在基线清零后转为硬失败。
  - 逐条推进，避免"用一个永久红门禁替换另一个"（该 workflow 注释的原话意图）。
  - _Requirements: 6.4, 6.5_

- [ ] 2.6 周期性 GC 自动化
  - 定时触发 `loom task reconcile`，输出可归档摘要供指标消费。默认只读，写操作需 `--yes`。
  - _Requirements: 4.1, 4.5_

- [ ] 2.7 治理健康周报
  - 汇总：门禁完成率、main 绿率、Issue Coverage、Issue→Merge 前置时间、落地等待时间、active task / dead session / 孤儿 workspace 数。
  - _Requirements: 12.1, 12.4, 12.6, 12.7_

### Phase 3 — Optimization（长期）

- [ ] 3.1 staging 环境
  - 单个 Fly app；模型为「同一 digest 先部 staging 再部 production」。
  - **不**一次性建三环境（R10.5）。
  - _Requirements: 10.4_

- [ ] 3.2 Task 层可观测性
  - 前置：1.1 / 1.5（`issue` 作为 join key）。
  - 打通 intent → code → artifact → runtime 完整链路；Code/Runtime 两层复用 `scripts/delivery/*` 与 `RELEASE_RECORD.md`。
  - _Requirements: 12.1, 12.2, 12.3_

- [ ] 3.3 GitHub → Fabric feedback（**另立 spec**）
  - PR/CI/合并结果作为 Fabric feedback signal 输入。
  - 硬约束：human-gated `suggest → accept`（Fabric R19.2）；不得 auto-apply；不得引入 runtime Loom lookup（Fabric D10）；Fabric 不得反向决策 PR/branch/merge/release（Fabric Rule #4）。
  - `src/fabric/feedback.ts` 在 Fabric v1 中仅为接口与数据通道——这是新功能，不是配置项。
  - _Requirements: 13.1, 13.2, 13.4, 13.5, 13.6_

- [ ] 3.4 组织形态决策（可选）
  - 若迁 Organization + Enterprise Cloud，可用托管 Merge Queue 替换 Landing Queue（同语义）。
  - 本设计不依赖该迁移。
  - _Requirements: 8.6_

## 验收门禁

- [ ] A1 逐条核对 design.md §8「条款 → 机器落点」映射表；**任何无落点的条款必须删除，不得以愿望形式保留**（R14.2）。
- [ ] A2 确认无新增治理抽象：本 spec 未引入新状态机、新调度器、新权限系统、新审计存储。
- [ ] A3 确认边界未污染：Fabric 未参与 PR/branch/merge/release 决策；Loom 未参与运行时拦截（R13.2、R13.3）。
- [ ] A4 确认门禁只收紧未放宽（R6.5）。

## Notes

- **不新增治理概念**：仓库已有 51 个 spec、`AGENTS.md` 400+ 行、126 条 registry 记录。本 spec 的价值在于**减少**未通电的规范，而非增加。
- **规范落点只有三处**：`AGENTS.md`（agent 唯一会读的规则书）、`loom lint` 规则、GitHub ruleset/settings。落在别处的条款等于没落。
- **每条规范都要能指向一个会拒绝你的机器。** 指不出来的，删掉。
- **共享热文件**：`.loom/registry.yaml`、`scripts/loom/registry.ts`、`scripts/loom/lint.ts`、`.github/workflows/ci.yml`、`ci-gate.yml` 均为多 agent 共享；编辑遵循 AGENTS.md 多 agent 规范，scoped commit，避让他人 WIP。
- **假门禁的成本**不是它不工作，是它让人以为有保护。`ci.yml` 的 `cancelled` 失败模式隐藏了两个月——这是 R7 与 R12.4 存在的全部理由。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["0.1", "0.2", "0.3", "0.4", "0.5", "0.6"] },
    { "id": 1, "tasks": ["0.5.1", "0.5.2", "0.5.3", "0.5.4"] },
    { "id": 2, "tasks": ["1.1", "1.4", "1.9", "1.10"] },
    { "id": 3, "tasks": ["1.2", "1.3", "1.7", "1.8"] },
    { "id": 4, "tasks": ["1.5"] },
    { "id": 5, "tasks": ["1.6", "2.1", "2.2", "2.3"] },
    { "id": 6, "tasks": ["2.4", "2.5", "2.6"] },
    { "id": 7, "tasks": ["2.7", "3.1", "3.2"] },
    { "id": 8, "tasks": ["3.3", "3.4"] }
  ]
}
```
