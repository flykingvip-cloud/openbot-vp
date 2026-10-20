# 脏树回退清理申明（Dirty-Tree Regression Discard Policy）

> 生效：2026-08-01  
> 适用范围：一切相对 `origin/main` 做三路/比对审查的共享脏工作树（含 archive overlay 分支，例如 `deploy/user-modeling-v92`）  
> 权威基线：**生产代码事实源 = `origin/main`**（不是脏树当前分支 HEAD）  
> 相关工具：`scripts/governance/worktree-archive.ts`（冷归档 / rehearse）

## 1. 申明

**对分析比对后已确认「相对 main 为功能回退 / 陈旧覆写 / 已完成抽提」的组件、文件或 diff hunk，必须及时清理出工作树，不得继续滞留。**

滞留的代价已经被本轮 extract 工作反复验证：

- 同一路径在 `REVIEW_PORTABLE_HUNKS` 清单里反复出现，浪费审查轮次；
- Agent 容易把「删掉 main 已有能力」的 diff 误当成可移植改进整文件抽走；
- 已合入 main 的修复与脏树上的旧实现并存，造成「假进度 / 假冲突」。

本申明把「确认回退 → 立即清理」定为强制动作，与「确认可移植 → 抽到 main worktree → PR」对称。

## 2. 前置条件（清理前必须满足）

1. **冷归档已存在且 rehearse 通过**  
   使用 `worktree-archive` 留下可恢复快照后再 discard。无归档不得批量删除。
2. **比对基线是 `origin/main`（已 fetch）**  
   不得用脏树分支 HEAD、过期 tip、或另一条 WIP 分支当「正确版本」。
3. **有书面判定**  
   至少在当次报告 / discard log 中写明：路径、判定（回退 / 已抽提 / 陈旧 untracked）、动作（restore / delete）。

## 3. 什么叫「确认回退」（判定标准）

满足任一即可判定为应清理对象：

| 类型            | 含义                                    | 典型信号                                                                                |
| --------------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| **功能回退**    | 脏树相对 main **删除或削弱**已有能力    | 去掉 webhook / tenant data-root / mention / meeting 等已接线路径；大段 `-` 且无等价替代 |
| **陈旧覆写**    | main 已有更新实现，脏树是旧副本或简化版 | untracked 文件与 `origin/main:path` 内容不同；或 tracked diff 把新 API 换回旧 API       |
| **已抽提完成**  | 可移植 hunk 已以独立 PR 合入 main       | 脏树仍留着抽提前的整文件 diff（含已不需要的夹带回退）                                   |
| **假 portable** | 整文件看起来像改进，拆开后净效果是回退  | 例如混有「缓存增强 + 删除生产路径」——只抽前者后，后者必须清掉                           |

**不是回退、不得按本申明清理：**

- `MANUAL_OWNER_RESOLVE` / 多 owner 热文件（须 owner 认领）；
- 尚未完成三路审查的 `REVIEW_PORTABLE_HUNKS`；
- 明确的产品取舍待决项（须在 log 标 `LEAVE_FOR_*_REVIEW`）；
- 仅存在于脏树、main 尚无、且仍可能有独立价值的新文件（走 claim → extract，不走 discard）。

## 4. 强制动作（确认后的及时清理）

### 4.1 Tracked 且 main 有权威版本

```bash
git fetch origin main
git restore --source=origin/main --worktree -- <path>
# 保持「不在 overlay 分支上混提」：如被 stage，再 unstage
git restore --staged -- <path> 2>/dev/null || true
```

效果：工作区与 `origin/main` 对齐。相对 overlay 分支 HEAD 仍可能显示 `M`，这是预期现象；**后续审查只看 `git diff origin/main -- path`，为空即不再进入 portable 队列。**

### 4.2 Untracked 且 main 已拥有该路径

直接删除工作区文件（main 已是 SoT，脏树副本只是干扰）：

```bash
# 仅当 git status 为 ?? 且 origin/main 已有该 path
rm -f -- <path>
```

### 4.3 手术式抽提后的夹带回退

若只移植了文件中的部分 hunk，抽提 PR 开出后，**同一脏树文件仍须按 4.1 restore 到 main**（或等 PR 合入后再 restore 到新 tip），避免回退半边继续留在树上。

### 4.4 记录

每次清理追加 discard log（示例）：

- `reports/worktree-discard-regression-YYYY-MM-DD.txt`

推荐行格式：

```text
RESTORE_FROM_MAIN <path>
DELETE_UNTRACKED_STALE <path>
LEAVE_FOR_BRAND_REVIEW <path> (<reason>)
```

## 5. 与抽提流水线的顺序

推荐闭环（不得颠倒「先大删再归档」）：

```text
冷归档 + rehearse
    → 分类（DISCARD_* / EXTRACT_* / REVIEW_PORTABLE_HUNKS / MANUAL_OWNER_RESOLVE）
    → 可移植：main worktree + 手术式 hunk + landing stream + PR
    → 确认回退 / 已抽提：立即 restore 或删除（本申明）
    → 更新 extract/discard 进度指针
```

**禁止：**

- 在确认回退后把路径继续留在 `REVIEW_PORTABLE_HUNKS`「以后再说」；
- 在 overlay / 非 main 分支上把回退内容 commit「省得丢」——恢复靠冷归档，不靠脏 commit；
- 未审查整文件 `git add` 回退混提。

## 6. 本轮经验摘要（为何立此申明）

2026-07-31 → 2026-08-01 从 `deploy/user-modeling-v92` 向 `main` 抽提时确认：

- `employee-workbench-ui`、整文件 `agent-runner-execution` / `get-reply-run`、`brand-assets` favicon 回退、`platform-auth.test` 断言削弱等，相对 main 为净回退；
- `enterprise-model/**` 等 untracked 覆写与 main 已有实现重复且更旧；
- `control-ui.ts` 同时含可移植缓存增强与删除 WeChat webhook / tenant data-root 的回退——必须拆开，回退侧立即 restore；
- 已合入的 collab learning / session-domain / backflow env 等，脏树残留 diff 会继续污染清单。

清理后，比对噪声下降；后续审查应只面对真正未决的 portable / owner 路径。

## 7. 验收

一次清理动作完成后，对每个已确认回退路径：

1. `git diff origin/main -- <path>` 为空（tracked restore）或路径不再出现在 `git status`（untracked delete）；
2. discard log 有对应行；
3. 进度报告（如 `reports/extract-packs-*.md`）不再把它列为「待 portable 审查」的活跃项。
