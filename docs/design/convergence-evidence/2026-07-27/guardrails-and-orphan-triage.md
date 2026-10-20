# 护栏落地 + 强推遗孤 triage（2026-07-27）

**依据：** 对 D1 / D7 / D10 三项决策给出的专业建议，按优先级执行
**优先级：** 分支保护 > pre-commit 检查 > 40 提交 triage > 其余
**执行原则：** 先装护栏止血，再清存量。此前一直在清存量而护栏一个没装，
所以 worktree 从 6 涨到 16、`origin/main` 被静默强推、混合提交继续产生。

## 1. 主干保护（最高优先级）—— 已完成

### 服务端：已启用（GitHub Pro 升级后）

升级前 branch protection 与 rulesets 均返回 `403 Upgrade to GitHub Pro or make
this repository public`。升级后已创建两个 ruleset：

| id       | 名称                          | 覆盖                                                               | 规则                            | bypass                          |
| -------- | ----------------------------- | ------------------------------------------------------------------ | ------------------------------- | ------------------------------- |
| 19803181 | `protect-trunk-no-force-push` | `refs/heads/main`、`refs/heads/release/**`、`refs/heads/backup/**` | `non_fast_forward` + `deletion` | **空 —— 对仓库 owner 同样生效** |
| 19803182 | `protect-deploy-no-deletion`  | `refs/heads/deploy/**`                                             | `deletion`                      | 空                              |

`deploy/**` 只禁删除、不禁非快进：那批分支是活跃工作分支，禁非快进会打断
其他 agent；但它承载着强推遗孤的 40 个提交，误删代价过高。

### 验证：真实拒绝，不是只读配置

配置读回来不算验证。用一个匹配保护模式的自测分支
`backup/ruleset-selftest-20260727` 做了真实负向测试：

| 操作           | 结果                                                                           |
| -------------- | ------------------------------------------------------------------------------ |
| 新建该分支     | 放行（新建不受 `non_fast_forward` 约束）                                       |
| 对它非快进强推 | `remote: error: GH013: Repository rule violations found` → **remote rejected** |
| 删除它         | `GH013` → **remote rejected**                                                  |

两项都是服务端 GH013 拒绝。删除测试需先用 `OPENBOT_ALLOW_FORCE_PUSH=1` 绕过客户端
hook 才能打到服务端 —— 说明两层护栏都在工作。

清理自测分支的过程本身也验证了「绕过是可审计的」：必须
`PUT /rulesets/19803181 -f enforcement=disabled` → 删除 → 立刻 `enforcement=active`。
终态已复核：两个 ruleset 均 `active`、`bypass_actors` 均为 0，
`main` / `release/baseline-recovery-20260725` / 两个 `backup/*` /
`deploy/user-modeling-v92` 全部完好，自测分支残留 0。

### 客户端：`git-hooks/pre-push`（保留为第二层）

`core.hooksPath = git-hooks`，对本 clone 内所有 agent 生效。它比服务端**更早**报错并
给出本地可读提示（会丢弃多少个远端提交），因此在服务端护栏就位后仍保留。

客户端 hook 的行为矩阵（12 项用例已逐条验证，见 §4）：

| 行为                                            | 结果                                            |
| ----------------------------------------------- | ----------------------------------------------- |
| 对 `main` / `release/*` / `backup/*` 非快进推送 | **拒绝**，并报出会丢弃多少个远端提交            |
| 删除上述受保护分支                              | **拒绝**                                        |
| 上述分支的快进推送                              | 放行                                            |
| 远端尚不存在该分支（新建）                      | 放行                                            |
| 其他分支（`feature/*` 等）                      | 放行                                            |
| `OPENBOT_ALLOW_FORCE_PUSH=1`                    | 放行，并要求在 `RELEASE_RECORD.md` 记录前后 SHA |

**分工：** 客户端 hook 只保护本 clone，别的机器/CI 绕得过去 —— 所以它不是护栏本体，
而是「更早、更可读」的第一道提示。真正的护栏是服务端 ruleset（对所有来源生效，
含 owner 自己）。

## 2. 禁止混合记录提交（D7 第二层）

### `git-hooks/commit-msg`

标题以 `Deploy: record` / `Docs: record` / `Spec: record` 开头时，暂存区不得含
可执行文件（mode 755）或 `scripts/**`、`deploy/*/scripts/**` 下的脚本。

**为什么需要：** 第三方验收发现 `codex/openbot-enterprise-channels-release` 上
有 **9 条**标题为 `Deploy: record vNN` 的提交同时修改了可执行门禁脚本
`deploy/production/scripts/verify-delivery-alignment.sh`。按标题当记录类排除，
门禁脚本的变更会被静默丢弃。分类之所以难，是因为提交本身脏 —— 这个 hook 是修根。

逃生阀：`OPENBOT_ALLOW_MIXED_RECORD_COMMIT=1`。

### D7 第一层（分类口径）

已在 `phase2-replay-audit.py` v2 实现并写入 `phase2-replay-sheet.md`：
记录类 = **全部**改动文件都是 `*.md`/`*.mdx` 且位于 `docs/`、`.kiro/`、
`deploy/production/`，或就是 `CHANGELOG.md`。提交标题不作为依据。

## 3. 根因修复：`.tmp/` 未被忽略

`.gitignore` 里只有 `tmp/`，**不匹配 `.tmp/`**（实测 `git check-ignore` 确认）。
正因如此，`a038f5c113` 才会把 300 个 `.tmp/workspace-audit-20260723/` 审计 dump
提交进分支历史。已加 `.tmp/`；已跟踪的 2 个 `.tmp/openbot-live-acceptance*.mjs`
不受影响（gitignore 不作用于已跟踪文件，实测确认）。

## 4. 落地前的行为验证（这一步救了一次）

两个 hook 在临时仓库里跑了 12 个用例。**首轮 6 项"通过"是假通过** ——
`pre-push` 实际是崩溃退出 1，不是拦截：

```
git-hooks/pre-push: line 51: remote_ref?: unbound variable
```

根因：macOS 自带 bash 3.2 会把紧跟变量名的多字节字符首字节吃进变量名
（`$remote_ref（` → 变量名变成 `remote_ref\xef`）。若不测就提交，这个 hook 会
**拦住所有 agent 的所有 push**。修法：变量一律加花括号 `${remote_ref}`，
并加了一条全文扫描确认无同类写法。

最终 12 项全部行为正确（含两个逃生阀、两个不保护分支的放行路径）。

## 5. 强推遗孤 triage（第三优先级）

工具：`orphaned-main-triage.py`（只读可复现，自带 T1–T3 断言，判定 PASS）。

`origin/main` 强推前的 tip `0536504b9e` 独有 40 个提交。逐提交按「文件 blob 是否
已等于 SoT / SoT 是否缺该文件 / SoT 侧是否更晚改动」判定：

| 判定       |   数量 | 含义                                                    |
| ---------- | -----: | ------------------------------------------------------- |
| **REPLAY** | **16** | SoT 侧未再改动这些文件，内容确实缺失 → 需重放           |
| SUPERSEDED |     18 | SoT 侧全部更晚改动过，已被后续实现覆盖 → 人工确认后弃置 |
| PRESENT    |      2 | blob 已等于 SoT → 可直接弃置                            |
| MERGE      |      4 | 合并提交，不 cherry-pick                                |

我上一轮报的"34 个需重放"是上界（判据只看 blob 全等）。细化后真实待办是 **16 个**。

### REPLAY 16 个清单

| SHA          | 主题                                                                 | SoT 缺口                                  |
| ------------ | -------------------------------------------------------------------- | ----------------------------------------- |
| `e06998b28c` | Data directory: Phase 1+2 Data Space, migration, export, privacy     | 5 文件                                    |
| `0e7e2fc7ee` | Context lifecycle: P1 retention, memory governance, export           | 25 文件                                   |
| `43a03037d1` | Security P1.1: actor scope, RPC isolation, DLP audit, queryAtoms ACL | 14 文件                                   |
| `a038f5c113` | Rescue: main ahead-6 + collaboration/evolution WIP                   | 383 文件（**含 300 个 `.tmp/`，见 D10**） |
| `c0abc7cb96` | Gateway: restore main dangling modules L1-L9                         | 42 文件                                   |
| `a216e82ac9` | Gateway: close main-recovery dependency cascade + capsule X.4        | 46 文件                                   |
| `0267b6ef59` | Types: clear post-recovery main type drift (tsgo clean)              | 59 文件                                   |
| `7ba978c4ed` | Knowledge: group deliverable manifest and save-and-archive backend   | 4 文件                                    |
| `f15ee5de34` | Gateway: group workspace file and manifest read RPC                  | 2 文件                                    |
| `1b339687bc` | UI: deliverable preview flow wiring and tests                        | 5 文件                                    |
| `3783290178` | Gateway: restore tenant-context + tenant-store-paths on main         | 2 文件                                    |
| `0536504b9e` | Gateway: prevent ghost bot ownership revival on mesh backfill        | 5 文件                                    |
| `832e0cfb55` | UI: add employee system authorization helpers                        | 2 文件                                    |
| `838cda84b1` | UI: refresh system authorization security panel                      | 1 文件                                    |
| `929bc01cd6` | CFG: restore isSharedTenantAddressingEnabled for tenant recovery     | 1 文件                                    |
| `0cec8a3d53` | Types: type data.memory.list via request generic                     | 1 文件                                    |

**注意重叠：** `e06998b28c`、`0e7e2fc7ee`、`43a03037d1`、`a038f5c113`、
`7ba978c4ed`、`f15ee5de34`、`1b339687bc` 同时出现在 Phase 2 的 B7
（`cursor-composer/collaboration-deliverable-v95`）待重放清单里 ——
**不要重放两次**。建议以 B7 为唯一重放路径，本清单只作为"强推后是否有遗漏"的对照。

来源仍可达：`origin/backup/main-pre-forcepush-20260727`（断言 T1 校验）。

## 6. D10 处置（已定，无需单独立项）

不改写 `a038f5c113` —— 它被 8 条以上 ref 承载（含本次备份 ref、
`origin/ci/dispatch-docker-release`、多条 cursor-composer 分支）。改写历史要重建
这些 ref，代价远大于收益，还会破坏刚做的备份。

改为**重放子集**，B7 执行者一步操作：

```bash
git cherry-pick -n a038f5c113
git rm -r --cached .tmp/
# 新提交落地，message 保留 (cherry picked from a038f5c113, .tmp/ excluded)
```

`.gitignore` 已加 `.tmp/`，此后不会再有同类夹带。

## 7. 决策收口状态

| #         | 事项                                                   | 状态                                                                              |
| --------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| **P0**    | 服务端主干保护                                         | **已完成** —— GitHub Pro 已升级；两个 ruleset 激活并通过真实 GH013 拒绝测试（§1） |
| D1        | 追认 T1（唯一主干 = `release/baseline-recovery-*` 族） | **已追认** —— 写入 `deploy/production/RELEASE_RECORD.md` §Single trunk            |
| D1 补救 1 | 主干声明 + 强推事件写进 `RELEASE_RECORD.md`            | **已完成** —— 该文件此时已无他人 WIP，故直接落地（此前带 WIP 时只起草不落地）     |
| D1 补救 2 | 40 提交 triage                                         | **已完成** —— 16 REPLAY / 18 SUPERSEDED / 2 PRESENT / 4 MERGE（§5）               |
| D1 补救 3 | 禁 force-push                                          | **已完成** —— 服务端 ruleset + 客户端 hook 双层                                   |
| D7        | 分类改内容判据                                         | **已完成** —— 第一层脚本口径 + 第二层 `commit-msg` hook                           |
| D10       | `a038f5c113` 的 `.tmp/` 处置                           | **已定** —— 不改写历史，B7 执行者重放子集；`.gitignore` 已修根因                  |

### 仍开放的唯一阻塞

**P7：B7 在 `a038f5c113` 的 `.tmp/` 被剔除前不得重放。** 这是执行前的前置条件而非
分析缺陷；`phase2-replay-audit.py` 会持续把它报为 FAIL，直到 B7 按 §6 方式落地。

### Phase 2 已解除阻塞

D1 已追认、护栏已就位。除 B7 外的批次（B1→B2→B3→B4→B6→B5→B8）可以开始。
