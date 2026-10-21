# OpenBot 开发交付链路标准（本地 → Worktree → GitHub → 云端）

**状态：** ACTIVE（2026-07-20 起执行；2026-07-27 主干迁回 `main`，见第 5.1 节）  
**任务：** `repository-wide-branch-convergence` → `delivery-baseline-governance`  
**主干：** `main` 是唯一 SoT 与唯一 cutover 源。`release/baseline-recovery-20260725` 已冻结。  
**原则：** 只有 **GitHub 上的不可变 commit（已打 `provenance/sha-*` tag）** 经 **同源构建** 部署后，才算「生产已实现」。本地未推送、未 tag、未部署的代码一律视为 **候选 / WIP**。  
**判据来源：** LIVE 一律读运行制品 `/app/dist/build-info.json`，**不读任何账本或分支名**。

---

## 1. 四层 Source of Truth

| 层     | 名称                                   | 允许状态                         | 禁止                                        |
| ------ | -------------------------------------- | -------------------------------- | ------------------------------------------- |
| **L0** | 本地未提交文件                         | 实验、脏、多 agent 交叉          | 直接当发布 tip；整树 force 部署             |
| **L1** | 本地 Git tip（分支/worktree）          | 功能开发、收敛、验证             | 未推送就宣称「已合入 main」                 |
| **L2** | **GitHub**（`origin`）                 | 审计、CI、协作、**唯一发布输入** | 用本机-only SHA 让他人/云端构建             |
| **L3** | **云端运行**（staging/prod 镜像+容器） | 用户真实行为                     | 脏 tip 热修、未记 RELEASE_RECORD 的 cutover |

**一致性定义（最优实践）：**

```text
L3 镜像 OCI label / openbot.mjs --version 中的 SHA
  == L2 上 annotated tag（或 release/* tip）的 commit
  == 发布决策单中的 RECOMMENDED / CUTOVER SHA
```

L0/L1 可以超前或脏，**不得** 静默等于 L2/L3。

---

## 2. 角色与目录（Worktree 地图）

| 角色                        | 推荐路径                   | 分支规则                 | 谁可写                                              |
| --------------------------- | -------------------------- | ------------------------ | --------------------------------------------------- |
| **共享主树（证据/多任务）** | `…/openbot`                | 任意；**不得**当发布 tip | 多 agent；**禁止** 当唯一 release tip               |
| **收敛/发布候选**           | `…/openbot-convergence`    | `convergence/YYYY-MM-DD` | 收敛 owner；可叠证据；**发布前必须 pin 到干净 tip** |
| **不可变构建检出**          | `…/openbot-rc0-staging` 等 | **detached @ tag/SHA**   | 只构建/部署，不在此开发功能                         |
| **功能隔离**                | `…/openbot-<task>`         | `<owner>/<task>`         | 单任务 agent（AGENTS.md 已有约定）                  |

**Agent 默认：** 不创建/删除 worktree（除非维护者明确要求）。人类建树，agent 在树内干活。

---

## 3. 分支与 Tag 命名

| 类型               | 模式                                  | 用途                                            |
| ------------------ | ------------------------------------- | ----------------------------------------------- |
| **主干**           | `main`                                | **唯一 SoT 与唯一 cutover 源**；所有 PR 打向它  |
| 功能               | `<owner>/<feature>`，从 `main` 派生   | PR 汇入 `main`                                  |
| 部署来源           | `deploy/<topic>`，从 `main` 派生      | 构建用；**cutover 后必须 merge-back 回 `main`** |
| **不可变发布 tag** | `provenance/sha-<12hex>`              | **L2 权威**；标注生产实际部署的 commit          |
| 基线锚点           | `baseline/YYYY-MM-DD`                 | 退役判据基点：被它包含的对象随时可清            |
| 归档               | `archive/<原名>-YYYYMMDD`             | 退役前的不可变备份，使删除无损                  |
| 机器可读发布账本   | OHBE `deploy/production/releases.jsonl`（https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl） | 2026-10-21 起不在本仓库；本仓库只留 `deploy/production/LEDGER.md` |
| 人读发布记录       | `deploy/production/RELEASE_RECORD.md` | 渲染视图，**不是权威**                          |
| 已冻结             | `release/baseline-recovery-20260725`  | 保留但不得派生、不得改基、不得 cutover          |

**规则：**

1. **禁止** 用「当前脏主树 HEAD」打生产镜像。
2. 发布 tip 必须：干净、可 `pnpm build`、通过约定回归包、有决策/证据。
3. Tag **只前进、不改写**（禁止 force-move 已推送的 tag）。
4. **每次 cutover 必须给部署的 commit 打 `provenance/sha-*` tag，并 merge-back 回 `main`**。未并回即视为发布未关单——生产跑着主干没有的代码。
5. **禁止对 `main` / `release/*` / `backup/*` 非快进推送或删除**。`git-hooks/pre-push` 会拦截；逃生阀 `OPENBOT_ALLOW_FORCE_PUSH=1` 另需在 `RELEASE_RECORD.md` 的「Trunk restoration」段留前后 SHA 与原因。
6. **scoped-UI overlay 发的是两个 commit**（gateway dist 与 UI dist 不同源）。下一次发布必须同时包含两者；只查 gateway 半边会把倒退判成前进。
7. **归档优先找回。** 退役分支/工作树前打的 `archive/*` 标签是只读历史（含 `archive/local-*`、`archive/local-wip/*`、`archive/local-branch/*`、`archive/local/pr-*` 以及同前缀的其它归档标签）。删除分支或工作树 ≠ 删除内容。若发现此前已经处理过的改动在 `main` 上“回退了 / 找不到了”，**禁止假定丢失、禁止凭记忆重写**。必须先查归档标签：`git ls-remote --tags origin 'refs/tags/archive/*'`，按主题/原分支名/日期缩小范围，用 `git show <tag> -- <path>` 或 `git diff origin/main <tag> -- <path>` 抽出文件，再基于**当前** `origin/main` 开一条新 PR，一次一个主题。禁止整段 cherry-pick 旧 salvage / land-replay 切片回主干；禁止从归档标签直接 cutover；禁止 force-move 已推送的归档标签。

---

## 4. 标准开发流（最优）

```text
1. 人类: worktree add + 分支 <owner>/<task>
2. Agent: 仅在该 worktree 实现 + 测试 + commit（Task/Agent trailer + loom claim）
3. PR → 审查 → merge 到 convergence 或 canonical（按任务）
4. 收敛 owner: 在干净 tip 上跑回归 → 出 RC0-PREP 证据
5. 维护者: 确认 RECOMMENDED_*_TIP
6. Gate 1: verify-forward-only.sh 证明 candidate 包含运行制品 LIVE
7. 打 annotated tag + push tag + push release/* 分支
8. 从 tag 检出 → 同源构建镜像 → 部署 staging → smoke
9. 维护者 PRODUCTION_GO=YES → 备份 → 灰度 → 更新 RELEASE_RECORD
10. Gate 2: 立即创建 merge-back review branch/PR,使 SoT 包含 cutover SHA
```

**本地验证（L1）永远不能跳过第 7–9 步直接宣称生产完成。**

---

## 5. 当前基线钉扎（2026-07-27 更新：主干迁回 `main`）

| 角色           | SHA / 引用                                                                           | L2                             | L3              |
| -------------- | ------------------------------------------------------------------------------------ | ------------------------------ | --------------- |
| **生产运行**   | 运行制品 `/app/dist/build-info.json` 自报（本文不钉具体 SHA；该值每次 cutover 都变） | `origin/main`                  | **LIVE**        |
| **生产 SoT**   | `origin/main`                                                                        | Gate 2 必须包含 LIVE           | 唯一 cutover 源 |
| **已冻结**     | `origin/release/baseline-recovery-20260725`                                          | 不再是 SoT；不得派生、不得改基 | 不得 cutover    |
| **本地开发线** | 各 `<owner>/<task>` 隔离 worktree，从 `main` 派生                                    | 可超前但必须包含 LIVE 才可发布 | 不直接部署      |

**明确：** 主树「超前 300+ 本地提交」≠ 生产已有这些功能。只有 **被部署的 commit** 才算，且它必须已并回 `main`。

### 5.1 为什么主干从 `release/*` 迁回 `main`（2026-07-27）

`main` 曾连续 18 天不包含生产正在运行的提交：它是 2026-07-09 在 `4f1d8d603c`（PR #32）分出的侧枝，只走了 40 个提交，而生产从 recovery 血脉发布。后果是可量化的：

- `ci.yml` 与 `docker-release.yml` 只在 `main` 上触发，所以**质量门禁守着一条没人发布的分支**，而真正发布的血脉 CI 运行数为 **0**
- 生产主机 118 个镜像中 105 个是 `localhost/` 手搓构建，从未进过任何注册中心
- 一次 cutover 的源提交当时只存在于本地分支，**L3 跑着 L2 上不存在的代码**
- 同一天一次 scoped-UI overlay 丢掉了 30 分钟前还在线的提交，因为只校验了 gateway 半边

迁回 `main` 的判据不是名字或新旧，而是**包含关系**：`main` 包含生产运行的提交，且 `release/baseline-recovery-20260725` 不含任何 `main` 缺少的提交（SoT 独有提交 = 0）。

冻结而非删除：`git-hooks/pre-push` 按设计拒绝删除 `release/*`，且保留分支可让历史与在途引用不断链。

**代价已记录，不掩盖：** 那次 `origin/main` 的非快进推送把 40 个提交移出主干，其中 PR #90 / #91 在 GitHub 上仍显示 MERGED 而内容不在主干上。详见 `deploy/production/RELEASE_RECORD.md` 的「Trunk restoration」段与 `docs/design/convergence-evidence/2026-07-27/orphaned-merged-prs.md`。

---

## 6. 对齐检查（强制门禁）

唯一前进性不变量：`git merge-base --is-ancestor LIVE CANDIDATE` 必须成功。LIVE
来自运行制品，不来自 ledger；`RELEASE_RECORD.md` 只做漂移告警。

Gate 1，构建与 cutover 前：

```bash
./deploy/production/scripts/verify-forward-only.sh \
  --candidate <candidate-sha>
```

离线审计可注入 `--live-sha <sha>`。退出码：`0` 放行，`20` 候选落后或背离，`21`
无法解析 LIVE。合法紧急回滚必须显式提供 `--intentional-revert "<reason>"`；不得使用隐式豁免。

Gate 2，SoT 持续检查与 cutover 后 merge-back：

```bash
pnpm delivery:check-sot -- --use-release-record-live \
  --sot-ref origin/main
pnpm delivery:merge-back-plan -- --cutover-sha <live-sha>
```

`.github/workflows/delivery-sot-alignment.yml` 定时并在 SoT push 时执行 Gate 2。merge-back
工具只输出 review branch/PR 步骤，不执行 merge，不自动 push，禁止 force push。

Gate 3，提交期预警：`scripts/worktree-audit.ts` 在设置 `OPENBOT_DELIVERY_LIVE_SHA`
时检查 `HEAD`。默认仅告警；关键流程设置 `DELIVERY_GUARD_STRICT=1` 后阻断。LIVE 未知时
本地开发静默跳过，`--verbose` 才显示原因。

### 6.1 发布链检查（L1/L2/L3 publication，与前进性并列）

前进性只回答「候选是否包含线上历史」，不回答「候选是否已被正确发布」。后者由既有脚本
`verify-delivery-alignment.sh` 负责，两者是并列门禁，互不替代：

```bash
./deploy/production/scripts/verify-delivery-alignment.sh \
  --prod-sha <live-sha> \
  --candidate-tag <rc-tag> \
  --candidate-sha <candidate-sha> \
  --prod-image-hint <prod-image> \
  --candidate-image-hint <candidate-image>
```

脚本检查：

- candidate tag 是否指向预期 SHA
- tag 是否在 `origin`
- 本地/容器 version 是否含 short SHA
- RELEASE_RECORD 中 prod SHA 与声明一致
- 输出 **GAP 报告**（哪一层不一致）

其默认值仍指向 2026-07-20 那轮基线，调用时应显式传入当轮的 SHA/tag/镜像。
默认**不**探测运行容器（无需生产主机）。cutover 后的 R9 身份门见 6.1.1。

**CI 建议（后续）：** tag push 时跑 build + 回归包；禁止无 tag 的「神秘 SHA」进生产流水线。

---

### 6.1.1 R9 live identity (verify-live and live-image)

R9 禁止对运行中容器热覆盖 `/app/dist`。每次 cutover 必须从 `provenance/sha-*` 镜像
**recreate** 容器，使运行制品 `build-info.commit` 等于该镜像的 OCI `revision` 标签。
红线与破窗登记见 `deploy/production/README.md`（Overlay ban）。本小节只记录已落地的
机器门，不引入新的豁免。

发布链检查默认不跑这项（需要主机 / podman）。cutover 后在能读到运行容器的环境加上
`--live-image`：

```bash
./deploy/production/scripts/verify-delivery-alignment.sh \
  --prod-sha <live-sha> \
  --candidate-sha <candidate-sha> \
  --live-image
```

`--live-image` 调用 `deploy/production/scripts/verify-live-image-identity.sh`：运行容器的
`build-info.commit` 必须等于该容器镜像的 `org.opencontainers.image.revision`。脚本只读，
不改主机、镜像或 worktree。退出码：`0` 身份对齐，`20` 身份分裂（overlay 或错镜像），
`21` 读不到 LIVE 或 label（fail closed）。

swap 之后的容器观察是另一条命令，不是 alignment 的默认步骤：

```bash
./deploy/production/scripts/cutover-from-ghcr.sh \
  --verify-live --candidate <full-sha>
```

`--verify-live` 断言运行容器 `build-info.commit` 等于 candidate、healthz 200、readyz
`ready:true` 且 `failing:[]`。只有这个 mode 真正观察过容器，因此 `--record` 只在与
`--verify-live` 同时使用时才会写入账本。

账本写入（`pnpm delivery:cutover:record`）必须声明 LIVE 怎么确立，二者择一：

- `--live-verified`：作者已观察运行容器（verify-live PASS）
- `--unverified-backfill <reason>`：显式逃生阀，写入 `liveVerified: false`，原因进 `notes`

两旗同时给会失败。`pnpm delivery:ledger:audit` 对未容器验证的开放 LIVE v2 行发出
`unverified-live` 警告；没有该字段的历史行（seq 45 及更早）不报错。

操作员剩余主机步骤（独立 verify-live / 补记 seq 46 回滚 / 下次 GHCR 的 M2b）见
`deploy/production/M0B_M2B_OPERATOR_RUNBOOK.md`。那份文件只给命令，不授权 cutover。
V2.3 已合入 vs 剩余：`docs/design/openbot-aliyun-prod-v2-implementable-2026-08-28.md`。

---

### 6.2 服务端强制（GitHub Pro，2026-07-27 起）

此前本仓库为私有 + 免费计划，`branches/*/protection` 与 `rulesets` 两个 API 都返回 403，
只能靠客户端 `git-hooks/*`（只保护本 clone，换机器即失效）。升级 Pro 后已启用三条
repository ruleset，全部 `enforcement=active` 且 **`bypass_actors` 为空**：

| ruleset                       | 覆盖                              | 规则                           |
| ----------------------------- | --------------------------------- | ------------------------------ |
| `protect-trunk-no-force-push` | `main`、`release/**`、`backup/**` | `non_fast_forward`、`deletion` |
| `protect-deploy-no-deletion`  | `deploy/**`                       | `deletion`                     |
| `require-pr-on-trunk`         | `main`                            | `pull_request`                 |

`require-pr-on-trunk` 的参数：需要 0 个批准（单人仓库，要求批准会自锁死），
`required_review_thread_resolution=true`（未解决的评审对话阻断合并），不要求 code owner
评审，不因新推送作废已有评审。

**bypass 为空的后果，需要知情：** 连仓库 owner 也不能强推 `main`、不能删 `release/*`。
紧急情况下要么临时改 ruleset，要么把自己加进 `bypass_actors`。这是刻意选择，不是遗漏。

**实测验证（两条旁路都已封死）：**

| 尝试                                                        | 结果                                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------- |
| `git push origin <ff-commit>:refs/heads/main`（快进空提交） | `GH013` remote rejected — Changes must be made through a pull request |
| `POST /repos/:owner/:repo/merges`（base=main）              | `HTTP 409` Repository rule violations found                           |

两次尝试后 `origin/main` 均未变化。**注意：`POST /merges` 这条直接合并旁路从此不可用**，
所有向主干的收编必须走 PR。

**刻意还没做：required status checks。** 本仓库 32 个 job 定义里 27 个跑在第三方
`blacksmith-*` runner 上，注册的 self-hosted runner 数为 0，而 Actions 队列当前整体停滞
（连最轻量的 `Auto response` 都停在 queued）。此时把 CI 设为必需检查会锁死**所有**合并，
包括修 CI 的那个 PR。顺序必须是：先修 runner → 拿到一次完成的主干 CI → 再设必需检查。

同因，`trunk-follow.yml` 已退役：它是唯一直推 `main` 的 workflow，保留它就得为 Actions
开 bypass，而 bypass 正是 `pull_request` 规则要堵的洞。

---

## 7. 主树脏文件纪律

| 状态                               | 动作                                |
| ---------------------------------- | ----------------------------------- |
| 有 Task/owner                      | 进对应 feature 分支/worktree 提交   |
| 未认领                             | **freeze-evidence**（收敛证据策略） |
| 生成物 `node_modules/.bin`、bundle | 不提交                              |
| 热文件                             | 单 owner wiring commit              |

**禁止** 为了「和 GitHub 一致」把 48 个未审脏文件一次性 commit + push。

---

## 8. 云端环境

| 环境           | 输入                     | 容器/域名                                               | 记录                                |
| -------------- | ------------------------ | ------------------------------------------------------- | ----------------------------------- |
| **Staging**    | **仅** candidate tag SHA | 名 ≠ `openbot-gateway-rc`；域名 `*.staging.*` 或独立 IP | `convergence-evidence/.../staging*` |
| **Production** | 维护者签字的 tag         | `openbot-gateway-rc` 等                                 | `RELEASE_RECORD.md`                 |

生产默认：`PRODUCTION_GO=NO`，直到人类清单签字：  
`docs/design/convergence-evidence/2026-07-20/HUMAN-PRODUCTION-CUTOVER-CHECKLIST.md`

---

## 9. 本轮「重新整理」执行清单

1. [x] 固化本标准文档
2. [x] 增加 `verify-delivery-alignment.sh`
3. [x] 为 RC0 tip 建立 **annotated tag** + **release/** 分支（干净 pin）
4. [x] Push 到 GitHub（使 L1→L2 对齐候选）
5. [x] RELEASE_RECORD 增加 **Candidate（未 cutover）** 段，避免与 v69 混淆
6. [ ] Staging 真主机（需坐标）
7. [ ] 生产 cutover（需 PRODUCTION_GO）
8. [ ] 主树 394 未推送提交：拆 PR / 不整包强推（持续）

---

## 10. 一句话给所有 Agent

> **能 merge 的进 `main`；能发布的必须有 `provenance/sha-*` tag；能上生产的必须是 OHBE 账本（https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl）里的 tag + 镜像；上完必须并回 `main`。不要在 openbot-vp 重建 `deploy/production/releases.jsonl`。**  
> 本地 worktree 成功 ≠ 生产已实现。分支名不是基线，容器自报的 commit 才是。
> 找不到以前处理过的改动，先查 `archive/*` 标签，再基于当前 `main` 开新 PR。
