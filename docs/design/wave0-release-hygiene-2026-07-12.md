# Wave 0 — 发布治理与工作区纪律

> **状态**：执行中（2026-07-12）  
> **关联**：`docs/design/production-p0-blockers-remediation-plan-2026-07-12.md` §Wave 0  
> **目标**：定义可复现的生产候选基线；不把 WIP 功能堆进生产构建。

---

## 1. 当前工作区快照（核实）

| 项             | 值                                                                 |
| -------------- | ------------------------------------------------------------------ |
| 分支           | `fix-scoped-package-templates`                                     |
| HEAD（快照时） | 见本地 `git rev-parse HEAD`（曾见 `582f2ec5d9` 一带）              |
| Remote         | ahead 于 `origin/fix-scoped-package-templates`（数十 commit 量级） |
| 未提交改动     | ~170+ 路径（持续变动，以 `git status` 为准）                       |

### 1.1 WIP 主题归类（勿混入 RC）

| 主题                            | 主要路径                                                                                        | 首发是否必需             | 建议                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------- |
| **tenant-context P1+**          | `src/gateway/tenant-context*`, `tenant-store-paths*`, `.kiro/specs/tenant-context-propagation/` | **是（B4）**             | **kiro 隔离 worktree**；已 loom register     |
| Enterprise operational identity | `src/gateway/enterprise-operational-identity*`, providers, UI panels                            | 否（功能增量）           | 独立 feature 分支                            |
| Knowledge universe              | `src/gateway/knowledge/**`, `ui/.../knowledge-universe*`                                        | 否                       | 独立 feature 分支                            |
| Supervisor / CLI backends       | `src/gateway/supervisor/**`, `src/agents/cli-backend*`, UI supervisor                           | 部分（若生产依赖）       | 评估后 cherry-pick 或独立线                  |
| Data directory / export         | `src/data/*`                                                                                    | 与 B4 P2 相关            | **P2 时与 kiro/data-directory 协调**，勿抢写 |
| macOS / Node Agent              | `apps/macos/**`                                                                                 | 否（Gateway 首发可不绑） | 独立线                                       |
| 生产阻断文档（本系列）          | `docs/design/production-p0*`, `deploy/production/**`                                            | 是（Wave0/1 产出）       | 可进 RC                                      |

### 1.2 本地不可进镜像/仓库的状态

| 路径                   | 说明                       |
| ---------------------- | -------------------------- |
| `memory/` (~1.4GB)     | gitignore；勿 COPY 进镜像  |
| `groups/`              | gitignore；运行态          |
| `.openclaw/`           | 本地状态                   |
| `openbot-2026.3.9.tgz` | 本地 pack 产物，勿当发布源 |

---

## 2. RC（Release Candidate）冻结策略

### 2.1 命名

```text
release/candidate-YYYYMMDD          # 分支
vX.Y.Z-rc.N                         # tag（可选）
```

### 2.2 允许进入 RC 的变更类型

1. **B4** tenant-context P1–P4（kiro + 已签入协作方）
2. **B0–B3** 生产硬化（本 Wave / deploy/production、Dockerfile、fly、env 权威）
3. **阻塞级 bugfix**（安全、崩溃、数据损坏）
4. 文档/Runbook 与上述直接相关

**禁止**：operational-identity 新 provider、knowledge UI 大改、无关实验、格式化全仓。

### 2.3 操作步骤（操作者执行；勿在共享脏树硬切）

```bash
# 1) 保留当前 WIP（若有未提交）
git status -sb
# 建议：WIP 用独立 worktree 或 stash / 另分支提交

# 2) 从约定基线开 RC（示例：tenant P0 已 harden 之后的 mainline tip）
git fetch origin
git worktree add ../openbot-rc release/candidate-$(date +%Y%m%d)  # 或从指定 SHA 建分支

# 3) 仅 cherry-pick / merge 允许的 PR
# 4) 门禁
pnpm check          # 或约定子集
pnpm test           # 或 CI 等价
docker build -t openbot:rc .

# 5) 记录
echo "RC_SHA=$(git rev-parse HEAD)" >> deploy/production/RELEASE_RECORD.md
# 镜像 digest 构建后写入
```

### 2.4 kiro 并行规则（强制）

| 规则                  | 说明                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| tenant-context 主路径 | **仅 kiro**（或 loom 移交后）在 **隔离 worktree** land                                              |
| RC 合入 B4            | 只合 kiro 已绿的 P1/P2/P4 提交，不夹带 identity/knowledge WIP                                       |
| 其他 agent            | 可改 `deploy/production/**`、Dockerfile/fly 硬化；**不改** `tenant-context.ts` 接线逻辑除非协作登记 |

---

## 3. 门禁清单（RC 退出 Wave 0）

- [ ] 存在命名清晰的 RC 分支或 tag
- [ ] `git status` 在 RC worktree 干净
- [ ] CI 或本地 `check` + 约定测试通过
- [ ] `docker build` 成功，记录 image id/digest
- [ ] WIP 主题均有归属分支/worktree（上表）
- [ ] 本文件 + `deploy/production/README.md` 已入库

---

## 4. 本波已交付（仓库内）

| 产出                 | 路径                                              |
| -------------------- | ------------------------------------------------- |
| 发布纪律本文         | `docs/design/wave0-release-hygiene-2026-07-12.md` |
| 生产部署包（Wave 1） | `deploy/production/`                              |

**未做（需操作者本地 git）**：创建 worktree、打 tag、push RC——避免在未授权情况下改写你的分支历史。

---

## 5. 下一步

1. 操作者：按 §2.3 开 `openbot-rc` worktree。
2. 继续 Wave 1 硬化产物合入 RC。
3. kiro：P1 在独立 worktree 推进；绿后 cherry-pick 进 RC。
