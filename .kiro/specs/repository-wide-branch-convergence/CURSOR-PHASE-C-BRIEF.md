# Cursor 任务指令：仓库收敛 Phase C（BASE LOCKED）

把下面整段（从「角色与任务」到文末）复制给 **Cursor Agent** 作为任务说明。  
本 brief 路径：`.kiro/specs/repository-wide-branch-convergence/CURSOR-PHASE-C-BRIEF.md`

**前置状态（已完成，勿重做 Day0）：**

- Day0 证据验收 **PASS**
- Base **已锁定**（代理维护者签字）
- Worktree **已创建**

---

## 角色与任务

你是 OpenBot 仓库收敛的 **Phase C 基线 agent**（在已锁定 SHA 的干净 worktree 上建立可构建基线，**不**做功能 landing）。

| 字段                         | 值                                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**                     | `repository-wide-branch-convergence`                                                                                                                  |
| **Agent id（提交 trailer）** | `cursor-convergence-phase-c`                                                                                                                          |
| **状态**                     | `BASE LOCKED` → Phase C                                                                                                                               |
| **允许**                     | 在 **convergence worktree** 内 install/build/tsgo/scoped test；写 Phase C 基线报告与 handoff；在 **convergence 分支** 上提交报告文件；更新 Loom claim |
| **禁止**                     | 在 **共享工作树** merge/rebase/landing；修改热文件整文件；功能 cherry-pick/merge；生产部署；自动 park；把安全 PoC 写入公开树                          |

### 锁定坐标（不得改）

| 项                      | 值                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| Locked base SHA         | `85eee3e7b987b14b3f83301e3f200b3e1d797cc6`                                                             |
| Branch                  | `convergence/2026-07-20`                                                                               |
| Worktree                | `/Users/daniel/AI项目/openbot-convergence`                                                             |
| Shared tree（只读对照） | `/Users/daniel/AI项目/openbot`（`fix-scoped-package-templates`，脏，**禁止集成**）                     |
| Binding decision        | `docs/design/convergence-base-decision-2026-07-20.md`（在共享树；worktree 可能无此文件，用绝对路径读） |

### 必读

1. `docs/design/convergence-base-decision-2026-07-20.md`
2. `docs/design/repository-convergence-execution-plan-2026-07-20.md` §9 Phase C、§10.8 验证分层
3. `docs/design/convergence-evidence/2026-07-20/DAY0-HANDOFF.md`
4. `docs/design/convergence-evidence/2026-07-20/readyz-waivers/wecom.md`
5. `.kiro/specs/repository-wide-branch-convergence/tasks.md`

（以上路径若 worktree 内不存在，用共享树绝对路径读取，**不要** 为了读文档去改共享树业务代码。）

---

## 硬禁令（违反即停）

1. **不要** `cd` 到共享树 `/Users/daniel/AI项目/openbot` 做 merge / rebase / cherry-pick / 功能实现。
2. **不要** 把共享树脏文件拷进 convergence「先凑合能跑」。
3. **不要** 改 locked base 含义（禁止 `reset --hard` 到别的大 tip 当新 base）。
4. **不要** 整文件提交热文件：  
   `package.json`、lockfiles、`src/gateway/method-scopes.ts`、`server-methods*.ts`、`server.impl.ts`、`ui/src/i18n/locales/en.ts`、`zh-CN.ts`、`ui/src/ui/app.ts`。  
   Phase C **默认零改业务代码**；若 build 必须极小修复，只允许 **convergence 分支** 上独立 commit，并在报告里标 `BASELINE_PATCH`，且不做热文件整文件重写。
5. **不要** 生产部署、不要改 `deploy/production` 线上 cutover。
6. **不要** 全量 `pnpm test` 拖死机器（除非报告中注明抽样策略且超时可控）。
7. 提交 trailer：
   ```text
   Task: repository-wide-branch-convergence
   Agent: cursor-convergence-phase-c
   ```
8. 安全材料：遵守 `SECURITY.md`；无公开 PoC。

---

## Phase C 目标（完成定义）

在 locked SHA 上证明：**干净 worktree 可安装、可构建，基线错误可记录且可复现**，并写出给 Phase D lander 的交接包。

**Phase C 不包含：** 功能 merge、知识导入落地、RC0 镜像、生产灰度。

---

## 工作目录约定

```bash
# 所有构建命令必须在此执行
cd "/Users/daniel/AI项目/openbot-convergence"
git status -sb
git rev-parse HEAD   # 必须为 85eee3e7b987b14b3f83301e3f200b3e1d797cc6 或其上仅含 Phase C 报告/基线补丁的后代
git branch           # 必须在 convergence/2026-07-20
```

若 worktree 不存在或 SHA 不对：

1. **停止**，在 `PHASE-C-HANDOFF.md` 写阻塞原因。
2. **不要** 自行乱建 worktree 指到脏 tip；可提示维护者重跑：
   ```bash
   cd "/Users/daniel/AI项目/openbot"
   git worktree add ../openbot-convergence 85eee3e7b987b14b3f83301e3f200b3e1d797cc6
   cd ../openbot-convergence && git checkout -b convergence/2026-07-20
   ```

---

## 交付物（写在 convergence 分支）

在 worktree 内创建（base 上可能没有 Day0 目录，**新建**即可）：

```text
docs/design/convergence-evidence/2026-07-20/phase-c/
  env-baseline.md              # node/pnpm/os、锁文件哈希
  install-log-summary.md       # pnpm install 结果（成功/失败、关键 warning）
  build-baseline.md            # pnpm build 结果
  tsgo-baseline.md             # pnpm tsgo 错误数与 top 错误（允许非零）
  check-baseline.md            # 若跑 pnpm check：结果；未跑则说明原因
  known-fail-convergence.md    # 相对 Day0 known-fail + 本 worktree 新发现
  hotfile-touch-policy.md      # 确认热文件 owner 与「Phase C 未改热文件」声明
  PHASE-C-HANDOFF.md           # 给 Phase D 的交接
```

可选（时间允许）：

```text
  scoped-tests.md              # 抽样 vitest 列表与结果（gateway/session 相关优先）
```

**同时** 在共享树更新状态指针（仅文档，可选但推荐）：

- 更新 `.kiro/specs/repository-wide-branch-convergence/tasks.md` 中 Phase C checklist
- 若共享树 commit 与 convergence 分离：共享树只提交 tasks/brief 指针；**构建报告以 convergence 分支为准**

---

## 步骤（严格按序）

### Step 0 — 环境签到

1. 确认 worktree HEAD == locked SHA（或仅含你的 Phase C 文档 commit）。
2. 记录：`node -v`、`pnpm -v`、`uname -a`。
3. Loom（在**共享树**仓库执行 claim，因 registry 在共享树）：
   ```bash
   cd "/Users/daniel/AI项目/openbot"
   pnpm loom register \
     --task repository-wide-branch-convergence \
     --owner cursor-convergence-phase-c \
     --paths 'docs/design/convergence-evidence/**/phase-c/**,.kiro/specs/repository-wide-branch-convergence/**' \
     --intent 'Phase C baseline on locked SHA' \
     --state active \
     --session-id "cursor-convergence-phase-c-$(date +%Y%m%d)" \
     --ide cursor \
     --agent cursor-convergence-phase-c
   ```
   若 owner 已被 `grok-evolution-closure` 占用：**不要抢 owner**，只：
   ```bash
   pnpm loom claim --owner cursor-convergence-phase-c --task repository-wide-branch-convergence \
     --paths 'docs/design/convergence-evidence/2026-07-20/phase-c/**'
   ```
   若 claim 失败，在 handoff 写明，仍可把报告提交在 convergence 分支。

### Step 1 — Install

```bash
cd "/Users/daniel/AI项目/openbot-convergence"
pnpm install
```

写入 `install-log-summary.md`：exit code、是否改写 lockfile（**若 lockfile 被改：不要提交 lockfile**，记为偏差并恢复 lockfile，除非维护者另示）。

### Step 2 — Build

```bash
pnpm build
# 若仓库约定不同，使用 package.json 中与 gateway/docker 一致的最小可发布 build；失败则记录完整错误摘要
```

写入 `build-baseline.md`：绿/红、耗时、失败模块。

**Build 失败时：**

- 先区分：环境问题 vs 源码在 locked SHA 上即失败。
- 允许尝试 **非热文件** 的最小修复 **一处**，单独 commit：`fix(baseline): ...` + trailers；在 `build-baseline.md` 标 `BASELINE_PATCH=yes`。
- 禁止借机功能开发。

### Step 3 — Typecheck

```bash
pnpm tsgo
# 记录错误总数；允许非零，但必须列出 top 20 与是否「基线噪声」
```

写入 `tsgo-baseline.md`。后续 Phase D **只允许错误数下降或持平**，禁止无说明上升。

### Step 4 — Check（可选）

```bash
pnpm check   # 若过慢/失败，记入 check-baseline.md 并 stop，不强制绿
```

### Step 5 — Known-fail 对齐

对照共享树：

- `docs/design/convergence-evidence/2026-07-20/known-fail-baseline.md`
- `readyz-waivers/wecom.md`

写 `known-fail-convergence.md`：

- 继承 wecom waiver（勿当作永久豁免）
- 本 worktree 新失败
- 明确：**new-fail 无主理人不得进入 Phase D landing**

### Step 6 — 热文件策略确认

写 `hotfile-touch-policy.md`：

| 文件                             | Owner                  | Phase C 是否修改 |
| -------------------------------- | ---------------------- | ---------------- |
| package.json / lockfiles         | grok-evolution-closure | 否（期望）       |
| method-scopes / server-methods\* | grok-evolution-closure | 否               |
| i18n en/zh-CN                    | grok-evolution-closure | 否               |
| app.ts / employee render-model   | UI/convergence         | 否               |

### Step 7 — PHASE-C-HANDOFF.md（必须）

必须包含：

1. HEAD SHA（最终）与是否含 BASELINE_PATCH
2. install/build/tsgo 一句话结论
3. 错误基线数字（tsgo count 等）
4. **Phase D 可以开始吗？** `YES_WITH_GATES` / `NO` + 原因
5. 建议 Phase D 第一刀：执行计划 **D1 身份/租户** 或 **D2 横切 session 不变量**（二选一推荐，附理由）
6. 明确未做：功能 merge、RC0、生产

### Step 8 — 提交

**在 convergence worktree：**

```bash
cd "/Users/daniel/AI项目/openbot-convergence"
# 仅 stage phase-c 报告文件
git add docs/design/convergence-evidence/2026-07-20/phase-c/
# 若无 scripts/committer 或版本过旧，可用：
git commit -m "$(cat <<'EOF'
docs(convergence): Phase C baseline on locked prod SHA

Task: repository-wide-branch-convergence
Agent: cursor-convergence-phase-c
EOF
)"
```

**不要** `git push` 除非维护者明确要求。  
**不要** merge 进共享树 `fix-scoped-package-templates`。

若需在共享树登记 Phase C 完成状态，另开小 commit 只改：

- `.kiro/specs/repository-wide-branch-convergence/tasks.md`

并带相同 Task/Agent trailer（Agent 可用 phase-c id）。

### Step 9 — 回复用户（中文）

1. worktree HEAD 与分支确认
2. install/build/tsgo 结果表
3. 报告文件路径
4. `PHASE-C-HANDOFF` 结论：`YES_WITH_GATES` 或 `NO`
5. 你**没有**做的事（merge/landing/prod）

---

## 验收标准（Phase C PASS）

- [ ] 命令均在 `openbot-convergence` 执行
- [ ] HEAD 基于 `85eee3e7b987…`（仅可多 Phase C 文档/最小 BASELINE_PATCH）
- [ ] `phase-c/` 报告齐全，含 `PHASE-C-HANDOFF.md`
- [ ] 未改共享树业务代码；未整文件提交热文件
- [ ] 未做功能 landing / 未推生产
- [ ] 提交含正确 Task/Agent trailer
- [ ] wecom 仅引用已有 waiver，未宣称永久修复

---

## 明确不要做的「好意」

- 不要从共享脏树 cherry-pick「先把知识导入弄进来」。
- 不要为了 build 绿升级半个 monorepo 依赖。
- 不要关闭 wecom 检查或删 readiness 探针。
- 不要把 Phase D 功能实现塞进 Phase C。
- 不要 `git push --force`。

---

## Phase D 预告（本 brief 不做）

Phase C PASS 后，另开 brief，在 **同一 worktree** 按执行计划：

`D0 构建收口 → D1 身份/租户 → D2 session 不变量 → D3 会话薄包 → D4 知识矩阵`

每波：P0/P1 → 热文件由 convergence owner 单独 wiring commit → checkpoint。

---

## 一键开场（可先贴给 Cursor）

```text
请严格按仓库 brief 执行 Phase C（基线 only，禁止功能 landing）：

.kiro/specs/repository-wide-branch-convergence/CURSOR-PHASE-C-BRIEF.md

工作目录必须是：/Users/daniel/AI项目/openbot-convergence
分支：convergence/2026-07-20
锁定 SHA：85eee3e7b987b14b3f83301e3f200b3e1d797cc6

Task: repository-wide-branch-convergence
Agent: cursor-convergence-phase-c

完成后按 brief「回复格式」用中文汇报。
```
