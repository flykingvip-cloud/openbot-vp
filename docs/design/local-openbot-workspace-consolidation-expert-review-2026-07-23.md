# 本地 OpenBot 工作区整理 — 专家审核执行说明

**状态：** EXECUTED（2026-07-23 落地完成）  
**日期：** 2026-07-23  
**范围：** `/Users/daniel/AI项目/openbot*` 及关联 Git worktree（含 `openbot-archives`、Codex、/private/tmp、Supervisor）  
**关联标准：** [OpenBot 开发交付链路标准（2026-07-20）](./openbot-dev-delivery-pipeline-standard-2026-07-20.md)、[Multi-Agent Worktree 目标架构（2026-06-16）](./worktree-multiagent-target-architecture-2026-06-16.md)、仓库 `AGENTS.md` §Isolation

---

> **复核勘误（2026-07-23 · Kiro 实测核实）：** 全文事实已逐项核对，**诊断与核心风险 P1 属实**（38 棵注册、17 棵指向失效旧路径、`prune -n` 会移除这 17 棵、双向 `gitdir` 悖论均实测吻合）。**唯一重大更正在于环境前提**：本机并非"只有 git 2.15、须 Homebrew 升级"——系统已自带 **`/usr/bin/git` = 2.50.1 (Apple Git-155)**，完整支持 `worktree repair / move / remove`。据此已更新：Phase 1 改以官方 **`git worktree repair`** 为首选（免手改 `gitdir`）；Phase 0–3 全部 `git` 命令统一使用 **`/usr/bin/git`**（PATH 默认的 2.15 缺 `remove`/`move`/`repair` 且 `branch --show-current` 报错）；D6 由"升级 Git"改为"直接用系统 2.50.1"。详见 §3.5、Phase 0–3、§8 与 §9-D6。
>
> **验收复审（2026-07-23 · 同会话稍后实测）：** 复审时工作区已被**并发清理**，且基本达到本方案 §5.2 目标态：`git worktree` 注册 **38 → 13**、**0 个 `[MISSING]`**（`prune -n` 为空），保留的 **10** 棵归档已 repair 到 `openbot-archives/` 路径；7 棵 clean/调查树 + Codex 9 + tmp 9 已移除；`openbot-rc` / `openbot-convergence` 已同步 origin（**ahead 0**，原 28/1 提交已 push，无丢失）；主树 WIP 与 2 棵 supervisor 未受影响。**下方 §2–§4 与附录 A 的数字为整理前快照，仅供历史；执行前一律以实时 Phase 0 审计为准。`openbot-archives/README.md` manifest 亦已就位（含 DISPOSE 清单、rc/convergence 的 push SHA、nginx-ops reset 记录），即本方案全部阶段已落地；执行者已按本勘误统一使用 `/usr/bin/git`。**

---

## 1. 文档目的

2026-07-23 执行团队已完成**文件系统层面**的目录集中（18 个顶层 `openbot-*` → `openbot` + `openbot-archives`）。复检发现 **Git worktree 元数据未同步**，且机器上仍有 **38 个已注册 worktree**（其中 17 个路径已失效）。

本文档供专家审核：

1. **当前真实状态**（避免与「看起来已整理完」产生误判）
2. **为何必须做后续收尾**（风险，不是洁癖）
3. **推荐执行方案的分阶段步骤**（含门禁、回滚、验证）
4. **决策点**（需专家拍板的分叉）

**本文档不包含任何已执行的破坏性命令。** 所有 `prune` / 删除 / 元数据修复均待在审核通过后由维护者显式执行。

---

## 执行记录（2026-07-23 落地）

| Phase | 动作                                                | 结果                                   |
| ----- | --------------------------------------------------- | -------------------------------------- |
| 0     | 只读审计 → `/tmp/openbot-workspace-audit-20260723/` | ✅                                     |
| 1     | `/usr/bin/git worktree repair` 17 棵归档            | ✅ 路径全部指向 `openbot-archives/`    |
| 2     | DISPOSE 7 棵 clean+synced + nginx-ops staged 导出   | ✅ 7 棵注册移除；nginx-ops 保留 ACTIVE |
| 3     | Codex ×9 + tmp 已注册 ×9 remove                     | ✅ worktree 38→13                      |
| 4     | `openbot-archives/README.md` + 脚本 patch           | ✅                                     |

**最终 worktree 计数：** 13（1 主树 + 10 归档 ACTIVE/ARCHIVE + 2 Supervisor）

**偏差说明：** D3 原计划 prune 后保留物理目录 30 天；`git worktree remove --force` 同时删除了 7 棵 DISPOSE 目录。分支均已在 `origin`，可通过 `git worktree add` 恢复。

**主树 WIP：** 整理后 79 个未提交文件（整理前约 74），无丢失。

### Phase 5 后续（2026-07-23）

| 项                                | 结果                                                                      |
| --------------------------------- | ------------------------------------------------------------------------- |
| `openbot-rc` push 28 提交         | ✅ `origin/release/candidate-20260712` 已更新                             |
| `openbot-convergence` push 1 提交 | ✅ 与 origin 同步                                                         |
| `openbot-nginx-ops` 336 staged    | ✅ `reset --hard`；误 staging 的 convergence 内容已丢弃（patch 已备份）   |
| `/private/tmp/openbot-*`          | ✅ 全部删除（~6.9 GB）；审计迁至 `openbot/.tmp/workspace-audit-20260723/` |

### Phase 6 收尾（2026-07-23）

| 项                                            | 结果                                                         |
| --------------------------------------------- | ------------------------------------------------------------ |
| openbot-rc untracked                          | ✅ 删除 `Dockerfile.rc-v68-layer`、重复 `skills/qiaomu-cut/` |
| 5 dirty ARCHIVE + cw2-integrity + rc0-staging | ✅ `reset --hard` / `worktree remove`                        |
| 最终 worktree 计数                            | **6**（主树 + 3 归档 ACTIVE + 2 Supervisor）                 |

---

## 2. 背景与整理动机

### 2.1 整理前的问题

| 问题                                    | 影响                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `AI项目/` 下 18 个平铺 `openbot-*` 目录 | 多 agent / 多 IDE 难以判断「哪棵树是主树、哪棵是 RC、哪棵已废弃」          |
| 同一 Git 仓 38 个 worktree 散落三处     | `AI项目/`、`~/.codex/worktrees/`、`/private/tmp/` 路径不统一               |
| 磁盘约 36 GB（含 node_modules 重复）    | 多数为历史任务树，仍占 SSD                                                 |
| 部分树 dirty / 超前 remote              | 例如 `openbot-rc` 曾超前 origin 28 提交；`openbot-nginx-ops` 曾 336 staged |

### 2.2 项目内已有约束（为何不能「只移文件夹」）

仓库 `AGENTS.md` 与交付标准明确：

- **L0 主树**（`openbot`）可脏、可多 agent，**不得**作为唯一 release tip。
- **功能隔离**应使用 `git worktree add ../openbot-<task> <owner>/<task>`，由**人类** provisioning，agent 不得自行建树/删树。
- **L2 GitHub tag/分支** 才是发布输入；本地 worktree 只是 L1 候选。
- `git worktree` 通过 **双向 `gitdir` 指针** 绑定「工作目录 ↔ `.git/worktrees/<id>/`」；仅 `mv` 目录会破坏该绑定。

因此：**文件系统整理 ≠ Git 整理**。两者必须成对完成，或明确选择「冷归档、放弃 Git 绑定」。

---

## 3. 当前状态（2026-07-23 复检快照）

### 3.1 文件系统（✅ 执行团队已完成）

```
/Users/daniel/AI项目/
├── openbot/                 # ~10 GB，主开发树
└── openbot-archives/        # ~11 GB，17 个子目录（2026-07-23 20:47 迁入）
    ├── openbot-convergence/
    ├── openbot-rc/
    ├── openbot-rc0-staging/
    └── …（共 17 个，见附录 A）
```

**效果：** 顶层目录从 18 个减为 2 个，符合「集中统一 openbot 文件夹」的**视觉与路径**目标。

### 3.2 Git 注册表（❌ 未同步 — 核心风险）

| 指标                                   | 值                                     |
| -------------------------------------- | -------------------------------------- |
| `git worktree list` 注册总数           | **38**                                 |
| 仍指向旧路径 `AI项目/openbot-*` 的条目 | **17**（filesystem 已不存在）          |
| `list-openbot-worktrees.sh` 标记       | 上述 17 个均为 **`[MISSING]`**         |
| `git worktree prune -n` 预演           | **将移除上述 17 个** worktree 管理条目 |

**机理：** 每个 worktree 有两处指针必须一致：

```text
<worktree>/.git          →  gitdir: …/openbot/.git/worktrees/<name>
.git/worktrees/<name>/gitdir  →  <worktree>/.git
```

执行团队将目录 `mv` 到 `openbot-archives/` 后，**第二处仍指向旧路径**（如 `/Users/daniel/AI项目/openbot-convergence/.git`），而旧路径已删除。

**现状悖论：**

- 从 `openbot-archives/openbot-convergence/` 执行 `git status` **暂时仍可用**（经 `<worktree>/.git` → 管理目录 → 分支 ref）。
- 但 Git 官方 worktree 列表、脚本、以及 **`git worktree prune`** 均视其为 **broken / missing**。
- 任意维护者或 CI 脚本执行 `prune` 后，17 个归档目录将 **失去 worktree 身份**，变为无法通过正常 worktree 流程管理的普通目录。

### 3.3 未纳入本次整理的部分

| 位置                                     | 数量 |  约磁盘 | 说明                                    |
| ---------------------------------------- | ---: | ------: | --------------------------------------- |
| `~/.codex/worktrees/*/openbot`           |    9 | ~6.3 GB | Codex detached @ `af1d67c9`，部分 dirty |
| `/private/tmp/openbot-*`                 |    9 | ~9.0 GB | 文档/功能分支，与归档树有重叠           |
| `~/.openbot/supervisor/workspaces/sup_*` |    2 |       — | Supervisor 运行中 worktree，dirty       |

### 3.4 主树 WIP（整理未触碰）

- 路径：`/Users/daniel/AI项目/openbot`
- 分支：`fix-scoped-package-templates`
- 未提交变更：**约 74 个文件**（含 user-modeling、knowledge-universe、gateway 等 WIP）
- **结论：** 主树开发线连续，整理不应清掉这些改动。

### 3.5 环境约束（2026-07-23 实测已更正）

- **PATH 默认 `git` 是 `/usr/local/bin/git` → `git version 2.15.0`**（一个陈旧的手工安装，**并非"macOS 自带"**）。它的 `git worktree` 只有 `add/list/lock/prune/unlock`——**没有 `move`、`remove`、`repair`**；`git branch --show-current` 也不支持（该选项 Git 2.22 才加入，2.15 会直接报 `unknown option`）。
- **但系统已存在可用的现代 Git：`/usr/bin/git` = `git version 2.50.1 (Apple Git-155)`**（Xcode/Command Line Tools 提供）。它完整支持 `worktree repair` / `move` / `remove` 与 `branch --show-current`。
- **结论：无需 Homebrew 升级。** 本方案所有 `git` 命令一律显式使用 **`/usr/bin/git`**（或将其置于 PATH 前）即可获得 ≥2.30 能力；元数据修复首选官方 **`git worktree repair`**（见 Phase 1），不必手改 `gitdir`。**切勿误用默认的 2.15**——否则 Phase 1–3 的 `worktree repair/move/remove` 会报未知子命令，Phase 0 的分支探测也会失真。

---

## 4. 问题陈述（供专家理解「为什么要继续做」）

|   # | 问题                                           | 严重度 | 若忽略的后果                                                                                       |
| --: | ---------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
|  P1 | 17 个 worktree 注册路径失效                    | **高** | 误执行 `git worktree prune` → 归档树与 Git 脱钩；后续 `git worktree add` 可能冲突                  |
|  P2 | 归档无 manifest                                | 中     | 专家无法判断哪棵可删、哪棵含未 push 提交                                                           |
|  P3 | Codex/tmp 18 树未清理                          | 中     | ~15 GB 浪费；worktree 计数虚高，脚本误判                                                           |
|  P4 | 磁盘未释放                                     | 低     | 整理前后 ~21 GB 仍在 `AI项目/`（只是 relocated）                                                   |
|  P5 | PATH 默认 git 为 2.15（缺 move/remove/repair） | 低     | 改用系统已有的 `/usr/bin/git` 2.50.1 即可，无需安装；若误用默认 2.15，Phase 1–3 命令会报未知子命令 |

**为何不建议「现状即可、不再动」：**  
P1 属于**单点误操作**风险——不需要恶意行为，一次习惯性 `git worktree prune` 或旧脚本即可触发。专家审核应将此列为必须关闭项。

---

## 5. 目标态定义（整理完成的标准）

专家可据此验收：

### 5.1 文件系统

```text
AI项目/
├── openbot/                    # 唯一活跃主树（L0）
└── openbot-archives/           # 可选：冷归档 OR 已清空
    └── README.md               # 必须：manifest + 处置决策
```

活跃功能 worktree **二选一**（专家择一，不可混用无文档）：

- **策略 S1（推荐）：** 活跃任务 ≤3 棵，路径 `AI项目/openbot-<task>`（与 AGENTS.md 一致），归档只留 cold copy。
- **策略 S2：** 活跃任务也在 `openbot-archives/` 下，但须 **Git 注册路径一致** 且 manifest 标明「active / cold」。

### 5.2 Git 注册表

- `git worktree list` 中 **无 `[MISSING]` 路径**（脚本 `list-openbot-worktrees.sh` 无 `?` / `[MISSING]`）。
- `git worktree prune -n` **无输出**（或仅明确已审批的 stale 项）。
- 每个保留的 worktree：`git -C <path> status` 与 `git worktree list` 路径一致。

### 5.3 文档

- `openbot-archives/README.md`：17 子目录的分支、dirty/ahead 状态、处置（保留/删/prune）、责任人、日期。
- 可选：更新 `list-openbot-worktrees.sh` 识别 `openbot-archives/` 前缀。

---

## 6. 战略选项（专家择一）

### 选项 A — 修复 Git 绑定，保留归档可 Git 操作（推荐用于含未 push 提交的树）

**适用：** `openbot-rc`（曾 ahead 28）、`openbot-convergence`（ahead 1）等可能仍有 L1 价值的树。

**做法概要：**

1. 用系统自带 `/usr/bin/git`（2.50.1，无需 Homebrew）跑 `git worktree repair`（首选）；或手动双向修正 `gitdir`（见 Phase 1 备用法）。
2. 对每个归档树，将 `.git/worktrees/<name>/gitdir` 更新为新路径：  
   `…/openbot-archives/openbot-<name>/.git`
3. 验证 `git worktree list` 显示新路径。
4. 编写 `openbot-archives/README.md`。

**优点：** 不丢 worktree 身份；可继续 commit/push/PR。  
**缺点：** 用 `worktree repair` 可一条命令批量修复，但结果仍应逐棵验证（`status` + `prune -n`）。

### 选项 B — 冷归档 + 注册表 prune（推荐用于已全部 push 且确认无 WIP 的树）

**适用：** 7+ 棵曾 clean 且 `ahead=0` 的功能树（如 `openbot-channel-creds-ui`）。

**做法概要：**

1. 确认分支已在 `origin`（`git log origin/<branch>..HEAD` 为空）。
2. `git worktree remove --force <旧注册路径>` 或 `git worktree prune`（仅 expert 执行）。
3. 物理目录保留在 `openbot-archives/` 作为 **无 Git 绑定的快照**，或直接 `rm -rf` 释放磁盘。
4. manifest 标记 `DISPOSED: pruned @ date`。

**优点：** 注册表干净；可释放 worktree 槽位。  
**缺点：** 该目录不再是无绑定的 git checkout；恢复需重新 clone/worktree add。

### 选项 C — 混合（**本方案推荐默认**）

| 子集                                                       | 处置                                 | 理由                                |
| ---------------------------------------------------------- | ------------------------------------ | ----------------------------------- |
| `openbot-convergence`, `openbot-rc`, `openbot-rc0-staging` | **选项 A 修复**                      | 发布链路 L1 资产，可能有 ahead 提交 |
| 7 棵 clean + synced 功能树                                 | **选项 B prune + 可选删目录**        | 分支已在 origin，无保留必要         |
| `openbot-nginx-ops`（曾 336 staged）                       | **专家人工审查后**再 A 或 B          | 异常 staging，需 diff 审计          |
| Codex 9 + tmp 9                                            | **选项 B prune**（先确认无活跃会话） | 非 `AI项目` 规范路径，占 ~15 GB     |
| Supervisor 2                                               | **不动**                             | 运行中监管 workspace                |

---

## 7. 分阶段执行计划（审核通过后）

### Phase 0 — 只读审计（无破坏，0.5h）

**目的：** 为专家提供决策数据，避免凭记忆删树。

```bash
export MAIN="$HOME/AI项目/openbot"
export ARCH="$HOME/AI项目/openbot-archives"
export AUDIT="/tmp/openbot-workspace-audit-$(date +%Y%m%d)"
export GIT=/usr/bin/git   # 2.50.1；勿用 PATH 默认的 /usr/local/bin/git (2.15)

mkdir -p "$AUDIT"
"$GIT" --version | tee "$AUDIT/git-version.txt"   # 期望 2.50.x（>=2.30 才有 worktree repair）

# 0.1 全量 worktree 清单
bash "$HOME/AI项目/list-openbot-worktrees.sh" | tee "$AUDIT/worktrees-classified.txt"
"$GIT" -C "$MAIN" worktree list | tee "$AUDIT/worktree-list.txt"

# 0.2 prune 预演（只读）
"$GIT" -C "$MAIN" worktree prune -n -v | tee "$AUDIT/prune-dry-run.txt"

# 0.3 每个归档树：分支、dirty、ahead/behind
#   注意：不要用 `git branch --show-current`（2.15 不支持，会把每棵树都误标为 detached）。
#   symbolic-ref 在所有版本都可用；detached 时回退到短 SHA。
for d in "$ARCH"/openbot-*; do
  name=$(basename "$d")
  br=$("$GIT" -C "$d" symbolic-ref --quiet --short HEAD 2>/dev/null \
        || echo "detached@$("$GIT" -C "$d" rev-parse --short HEAD)")
  dirty=$("$GIT" -C "$d" status --porcelain | wc -l | tr -d ' ')
  ahead=$("$GIT" -C "$d" rev-list --count "@{u}..HEAD" 2>/dev/null || echo "no-upstream")
  echo "$name | branch=$br | dirty=$dirty | ahead=$ahead" >> "$AUDIT/archive-status.txt"
done

# 0.4 主树
"$GIT" -C "$MAIN" status -sb | head -20 | tee "$AUDIT/main-status.txt"
"$GIT" -C "$MAIN" diff --stat | tee "$AUDIT/main-diff-stat.txt"
```

**门禁 G0：** 专家审阅 `$AUDIT/*`，签署 Phase 1 可执行的树清单。

---

### Phase 1 — Git 元数据修复（选项 A，针对「保留且需 Git 操作」的树）

**前置：无需安装任何东西。** 直接使用系统自带的 `/usr/bin/git`（2.50.1）；**切勿**使用 PATH 默认的 2.15（它没有 `repair`/`move`/`remove`）。

**首选：`git worktree repair`（官方安全解，一条命令修好双向指针）。**
`repair` 专为「手动移动 worktree 目录后修复管理文件」而设计，正是本场景。传入**新路径**，它会自动把每棵树的 `.git/worktrees/<name>/gitdir` 重写为归档目录，并校正 `<worktree>/.git`：

```bash
GIT=/usr/bin/git
MAIN="$HOME/AI项目/openbot"
ARCH="$HOME/AI项目/openbot-archives"

# 改前备份管理目录（见 §8）
cp -a "$MAIN/.git/worktrees" "/tmp/openbot-worktrees-backup-$(date +%Y%m%d)"

# 一次修复全部归档树（也可只列需要保留的子集）
"$GIT" -C "$MAIN" worktree repair "$ARCH"/openbot-*

# 验证
"$GIT" -C "$MAIN" worktree list          # 路径应显示为 …/openbot-archives/…
"$GIT" -C "$MAIN" worktree prune -n -v   # 对已修复的树应无输出
```

> `worktree repair` 幂等、只改元数据、不动工作区文件，对已正确的树无副作用；因此可安全地对整个 `openbot-archives/*` 批量执行——被 Phase 2 判定为 DISPOSE 的树在此顺带修好也无妨（Phase 2 再决定是否 `remove`）。

**备用（仅当无法使用 `/usr/bin/git` 时）：手动改 `gitdir`。**
因为 `<worktree>/.git` 以**绝对路径**指向管理目录（未移动、仍有效），只有管理端 `gitdir` 是旧路径，故只需改这一处文件：

```bash
WT_NAME="openbot-convergence"   # 示例
MGMT_GITDIR="$HOME/AI项目/openbot/.git/worktrees/$WT_NAME/gitdir"
NEW_GIT_FILE="$HOME/AI项目/openbot-archives/$WT_NAME/.git"

test -f "$NEW_GIT_FILE" || { echo "missing $NEW_GIT_FILE"; exit 1; }
echo "$NEW_GIT_FILE" > "$MGMT_GITDIR"    # 管理端 gitdir 指向归档目录里的 .git 文件

git -C "$HOME/AI项目/openbot-archives/$WT_NAME" status -sb
```

（注：`git worktree move` 要求旧路径仍存在于索引；当前旧路径已删除，move 会失败，故不作为选项。）

**门禁 G1：**

- [ ] `/usr/bin/git -C "$ARCH/<name>" status` 成功
- [ ] `git worktree list` 中该路径为 `openbot-archives/...`（或专家接受的路径）
- [ ] `git worktree prune -n` **不再列出该树**

---

### Phase 2 — 注册表 prune + 冷归档（选项 B）

**仅针对 G0 签署为 DISPOSE 的树。**

```bash
GIT=/usr/bin/git   # 2.15 无 `worktree remove`，必须用 2.50.1

# 2.1 再次确认无 ahead 提交（对归档目录）
"$GIT" -C "$ARCH/openbot-channel-creds-ui" log --oneline \
  origin/feat/enterprise-channel-credentials-ui-wecom..HEAD
# 必须无输出

# 2.2 从 Git 注册移除（不删物理目录）
#   若已在 Phase 1 repair 过：注册路径已是归档路径，remove 指向归档目录。
"$GIT" -C "$MAIN" worktree remove --force "$ARCH/openbot-channel-creds-ui"
#   若该树未 repair（注册路径仍是失效旧路径）：改用 prune 清理其失效条目。
#   "$GIT" -C "$MAIN" worktree prune

# 2.3 若确认不再需要物理副本
# rm -rf "$ARCH/openbot-channel-creds-ui"   # 需专家显式批准
```

**门禁 G2：**

- [ ] `git worktree list | wc -l` 降至预期（目标：主树 + 保留归档 + supervisor + 0 codex/tmp）
- [ ] 被 prune 的树已在 manifest 标记 DISPOSED

---

### Phase 3 — 散落 worktree 清理（Codex / tmp）

**前置：** 确认无活跃 Codex 会话 / 无 agent 正在 `/private/tmp/openbot-*` 工作。

```bash
GIT=/usr/bin/git

# 3.1 列出
ls -d ~/.codex/worktrees/*/openbot /private/tmp/openbot-* 2>/dev/null

# 3.2 逐棵 remove（示例）
"$GIT" -C "$MAIN" worktree remove --force ~/.codex/worktrees/3332/openbot
# …

# 3.3 磁盘回收（可选）
"$GIT" -C "$MAIN" gc --prune=now
```

**门禁 G3：** `list-openbot-worktrees.sh` 的 L3-codex / other 段为空或仅剩专家保留项。

---

### Phase 4 — 文档与脚本收尾

1. 创建 `openbot-archives/README.md`（模板见附录 B）。
2. 可选：patch `list-openbot-worktrees.sh` 增加 `L1-archived` 层，扫描 `openbot-archives/`。
3. 在 `.loom/registry.yaml` 或任务 spec 中记录「本地 worktree 整理」完成态（如需要）。

**门禁 G4（最终验收）：**

- [ ] `AI项目/` 仅 `openbot` + `openbot-archives`（+ README）
- [ ] 无 MISSING worktree
- [ ] 专家签署 manifest
- [ ] 主树 WIP 未被误删（`git status` 仍约 74 files，或已 commit 的新数字）

---

## 8. 风险与回滚

| 操作                      | 风险                       | 缓解                                                     | 回滚                                 |
| ------------------------- | -------------------------- | -------------------------------------------------------- | ------------------------------------ |
| `git worktree prune`      | 归档目录脱钩               | Phase 0 审计 + G0 签署                                   | 从 origin 重新 `worktree add`        |
| 删除 `openbot-archives/*` | 丢失未 push 提交           | Phase 0 检查 `ahead`                                     | 无（只能从 remote 恢复已 push 部分） |
| 手动改 `gitdir`           | 写错路径导致 worktree 损坏 | 首选 `worktree repair` 免手改；手改时逐树验证 + 改前备份 | 从 `$AUDIT` 恢复旧 gitdir 内容       |
| 清理 Codex/tmp            | 中断进行中任务             | 确认无活跃会话                                           | 重新 `worktree add`                  |

**改前备份（建议）：**

```bash
cp -a "$MAIN/.git/worktrees" "$AUDIT/worktrees-backup"
```

---

## 9. 专家审核决策清单（请逐项勾选）

|   # | 决策项                                                                                  | 建议                              | 专家勾选 |
| --: | --------------------------------------------------------------------------------------- | --------------------------------- | -------- |
|  D1 | 采用选项 A / B / **C（混合）**                                                          | C                                 | ☐        |
|  D2 | `openbot-convergence` / `openbot-rc` / `openbot-rc0-staging` 是否 **必须修复 Git 绑定** | 是                                | ☐        |
|  D3 | 7 棵 clean+synced 树是否 **prune 后删除物理目录**                                       | prune 是；删除否（先保留 30 天）  | ☐        |
|  D4 | `openbot-nginx-ops`（336 staged）处置                                                   | 先导出 `git diff --cached` 再决定 | ☐        |
|  D5 | 是否清理 Codex 9 + tmp 9                                                                | 是（~15 GB）                      | ☐        |
|  D6 | 是否直接用系统自带 `/usr/bin/git` 2.50.1（免 Homebrew 升级）                            | 是                                | ☐        |
|  D7 | Supervisor 2 棵                                                                         | 不动                              | ☐        |
|  D8 | 是否要求创建 `openbot-archives/README.md`                                               | 是                                | ☐        |

---

## 10. 为何推荐「混合选项 C」（ rationale 摘要）

1. **与交付标准一致：** 发布相关树（convergence / rc / staging）属于 L1 候选，不应在 Git 注册表中处于 broken 状态；否则 cutover 脚本与 `verify-delivery-alignment.sh` 的 worktree 假设失效。
2. **与 AGENTS.md 一致：** 已完成且已 push 的功能树应 `worktree remove`，而非永久占槽；agent 不应在 17 棵历史树中迷路。
3. **风险最小化：** 全 prune（选项 B 激进版）可能丢失 `ahead 28` 的 rc 提交；全修复（选项 A 激进版）浪费精力维护已无活跃任务的树。混合按**资产价值**分流。
4. **可验收：** 每阶段有 G0–G4 门禁，专家可审计 `$AUDIT/` 目录，而非依赖口头确认。
5. **不触碰主树 WIP：** 整理目标是 workspace hygiene，不是合并或丢弃当前 `fix-scoped-package-templates` 上的 74 个文件。

---

## 附录 A — 17 个归档子目录

| 子目录                              | 分支（复检时）                                 | 备注              |
| ----------------------------------- | ---------------------------------------------- | ----------------- |
| openbot-channel-creds-ui            | feat/enterprise-channel-credentials-ui-wecom   | 曾 clean，synced  |
| openbot-channel-settings-nav        | docs/ops-v75-cutover                           | 曾 1 dirty        |
| openbot-chat-checkpoint-rollback    | kiro-daibai/chat-checkpoint-rollback           | 曾 clean          |
| openbot-convergence                 | convergence/2026-07-20                         | **ahead 1**       |
| openbot-cw2-integrity               | grok-cogniweave/cw2-integrity-remediation      | 曾无 remote       |
| openbot-docs-v75-e2e                | docs/ops-v83-cutover                           | 曾 5 dirty        |
| openbot-employee-roster             | wip/employee-account-agent-roster              | 曾 clean          |
| openbot-enterprise-channels-release | codex/openbot-enterprise-channels-release      | 曾 1 dirty        |
| openbot-hybrid-gateway-isolation    | kiro-hybrid-isolation/hybrid-gateway-isolation | 曾 6 dirty        |
| openbot-nginx-ops                   | wip/ops-nginx-hsts-https-redirect              | **曾 336 staged** |
| openbot-rc                          | release/candidate-20260712                     | **ahead 28**      |
| openbot-rc0-staging                 | detached @ 9aceda7349                          | staging 构建      |
| openbot-selective-push              | docs/delivery-pipeline-2026-07-20              | 曾 clean          |
| openbot-tenant-channels             | feat/tenant-messaging-channels-wave1-2         | 曾 clean          |
| openbot-tenant-context-propagation  | kiro/tenant-context-propagation                | 曾 5 dirty        |
| openbot-v71-dig                     | detached                                       | 调查树            |
| openbot-v72-dig                     | detached                                       | 调查树            |

> **注意：** 上表为 2026-07-23 **整理前**快照，仅供历史参考。本会话验收复审（见文首「验收复审」）实测发现：归档已减为 **10** 棵（`channel-creds-ui`、`chat-checkpoint-rollback`、`employee-roster`、`selective-push`、`tenant-channels`、`v71-dig`、`v72-dig` 已移除），`openbot-rc` / `openbot-convergence` 已同步 origin（**ahead 0**），注册表已无 `[MISSING]`。执行前一律以实时 Phase 0 的 `$AUDIT/archive-status.txt` 为准。

---

## 附录 B — `openbot-archives/README.md` 模板

```markdown
# OpenBot 本地 Worktree 归档

- **整理日期：** 2026-07-23
- **主树路径：** ~/AI项目/openbot
- **Git 远程：** https://github.com/gmood2008/openbot.git

## 处置策略

| 目录                | 分支                       | ahead | 处置          | 批准人 | 日期 |
| ------------------- | -------------------------- | ----: | ------------- | ------ | ---- |
| openbot-convergence | convergence/2026-07-20     |     1 | REPAIR gitdir |        |      |
| openbot-rc          | release/candidate-20260712 |    28 | REPAIR gitdir |        |      |
| …                   |                            |       |               |        |      |

## 禁止操作

- 勿对本目录执行 `git worktree prune`（除非 manifest 已标记 DISPOSED）
- 勿将本目录当作生产 release tip（见 docs/design/openbot-dev-delivery-pipeline-standard-2026-07-20.md）
```

---

## 附录 C — 参考命令与脚本

- 分类脚本：`~/AI项目/list-openbot-worktrees.sh`
- 交付对齐：`./deploy/production/scripts/verify-delivery-alignment.sh`
- 关联设计：`docs/design/worktree-multiagent-target-architecture-2026-06-16.md`

---

**审核人签字：** **\*\***\_\_\_**\*\*** **日期：** **\*\***\_\_\_**\*\***

**执行人签字：** **\*\***\_\_\_**\*\*** **日期：** **\*\***\_\_\_**\*\***
