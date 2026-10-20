# Cursor 任务指令：仓库收敛 Phase D1 — 身份 / 租户 / 权限薄包

把下面整段（从「角色与任务」到文末）复制给 **Cursor Agent**。  
本 brief：`.kiro/specs/repository-wide-branch-convergence/CURSOR-PHASE-D1-AUTH-TENANT-BRIEF.md`

**前置（已验收，勿重做）：**

| 阶段     | 状态                                                                  |
| -------- | --------------------------------------------------------------------- |
| Day0     | PASS · Base 锁定 `85eee3e7b987…`                                      |
| Phase C  | PASS · install 绿 · build 红基线                                      |
| Phase D0 | PASS · **Path A `pnpm build` exit 0** · **tsgo 86→77**                |
| Worktree | `/Users/daniel/AI项目/openbot-convergence` · `convergence/2026-07-20` |

**必读：**

- `…/phase-d0/PHASE-D0-HANDOFF.md`（`YES_WITH_GATES` → D1）
- `…/phase-d0/tsgo-before-after.md`（carryover；**tsgo 上限 77**）
- `docs/design/repository-convergence-execution-plan-2026-07-20.md` §10.2 D1、§10.8 验证
- `docs/design/convergence-base-decision-2026-07-20.md`
- Day0 ledger：`feature-ledger.csv` 中 auth/tenant 相关行 + `feature-manifests/auth_tenant.yaml`

---

## 角色与任务

你是 **Phase D1 身份/租户/权限薄包** lander（convergence worktree only）。

| 字段         | 值                                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **Task**     | `repository-wide-branch-convergence`                                                                                       |
| **Agent id** | `cursor-convergence-phase-d1`                                                                                              |
| **允许**     | 在 worktree 内落地 **已验收/parity 所需** 的 auth·tenant·seat·method-scope **最小闭环**；写 phase-d1 报告；跑 scoped tests |
| **禁止**     | 共享树 merge；D2/D3/D4 大包；知识导入；商业大爆炸；生产部署；采纳 worktree 里 **他人未提交 WIP**（见下）                   |

### 锁定坐标

```text
WORKTREE=/Users/daniel/AI项目/openbot-convergence
BRANCH=convergence/2026-07-20
LOCKED_BASE=85eee3e7b987b14b3f83301e3f200b3e1d797cc6
TSGO_CEILING=77          # 不得无说明超过
BUILD_GATE=pnpm build    # 必须保持 exit 0
```

### 工作区脏文件警告（D0 handoff）

Worktree 上可能存在 **未 staged** 的他人 WIP，例如：

- `src/gateway/method-scopes.ts`（+1 行 enterprise monthly-seat-usage）
- `ui/src/ui/app.ts`

**D1 默认：`git checkout -- <file>` 丢弃无关脏改动，或 `git stash -u` 隔离后再干。禁止把不明 WIP 打进你的 commit。**  
若该行确属 D1 范围，必须在报告中写清来源与测试，并走热文件规则。

---

## 硬禁令

1. 只在 `$WORKTREE` 改代码并 commit。
2. **不要** merge/cherry-pick 共享脏 tip 的整枝历史。
3. 热文件（`method-scopes.ts`、`server-methods*.ts`、`server.impl.ts`、`package.json`、i18n 整文件、`app.ts`）：
   - 优先 **最小 diff**；
   - **禁止** 整文件从别处覆盖；
   - 每波末热文件改动单独 commit：`chore(scopes): …` / `chore(methods): …`，subject 标明 wiring。
4. **`pnpm build` 必须保持绿**；若变红，先修回再继续功能。
5. **`pnpm tsgo` error 计数 ≤ 77**（或 checkpoint 书面说明临时上升原因与回落计划）。
6. 安全候选：先读 `SECURITY.md`；无私有 PoC 进公开树。
7. Trailers：
   ```text
   Task: repository-wide-branch-convergence
   Agent: cursor-convergence-phase-d1
   ```
8. 不 `git push` 除非维护者要求；不生产 cutover。

---

## D1 范围（薄包 — 功能闭环优先）

### 目标

在 locked base + D0 修复之上，保证 **员工/企业登录后的租户与权限边界** 在 gateway 层可测、可回归，为 D2 session 不变量打底。

### 建议包含（按证据裁剪，勿贪大）

| 子域                        | 期望                                                      |
| --------------------------- | --------------------------------------------------------- |
| Platform auth 配置/会话解析 | 与生产 checklist「登录」一致的最小路径                    |
| Tenant context              | `resolveTenantContext` / membership 权威；hint 不作权威   |
| Seat / employee 绑定        | 列表或解析不跨租户泄漏（负向测试）                        |
| Method scopes               | D1 新增/使用的 RPC **已登记** scope；无 unclassified 新洞 |
| 权限负向                    | 无 scope / 错租户 → 拒绝                                  |

### 明确排除（DEFER）

- 完整 Control UI 大改版、移动端全量登录 UX
- Knowledge import、CogniWeave 产品功能
- Evolution governance / skill-auto
- 清理全部 77 个 tsgo（仅允许顺手修 **你改动文件上的** 错误）
- UI shell-slices 23 错误大扫除

### 选源策略

1. 读 `feature-ledger.csv` 中 `auth_*` / `tenant_*` / `target_wave=D1` 行。
2. 若源在其他分支：用 **`git show <sha>:path`** 或 **小范围 cherry-pick 单 commit**，禁止整枝。
3. 与当前 arch 冲突 → `ACCEPT_WITH_REWORK` / 重写最小集，不要硬并。
4. 安全类提交 → L3 路由（`SECURITY.md`），不进普通 commit 塞 PoC。

---

## 验证门禁（D1）

| 级别     | 要求                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------ |
| **P0**   | 改动文件 scoped vitest（tenant-context / platform-auth / seats / method-scopes 等相关）**全绿**        |
| **P0**   | 权限 **负向** 测试至少 1 组（无 scope 或跨租户）                                                       |
| **P1**   | `pnpm build` exit **0**                                                                                |
| **P1**   | `pnpm tsgo` 计数 **≤ 77**（记录 before/after）                                                         |
| **契约** | 更新 `feature-manifests/auth_tenant.yaml` 填真实 rpc/auth_rules/tests 引用（可仍不完整但不得空白撒谎） |

推荐命令示例：

```bash
cd "$WORKTREE"
pnpm exec vitest run src/gateway/tenant-context.test.ts --pool=forks
# 按实际改动追加：
# pnpm exec vitest run src/gateway/platform-auth*.test.ts --pool=forks
pnpm build
pnpm tsgo 2>&1 | tee /tmp/tsgo-d1.txt
grep -c 'error TS' /tmp/tsgo-d1.txt
```

---

## 交付物

```text
docs/design/convergence-evidence/2026-07-20/phase-d1/
  scope.md                    # 本波包含/排除与源 SHA
  tests-run.md                # 命令与 pass/fail
  build-tsgo.md               # build exit；tsgo before=77 after=N
  hotfile-wiring.md           # 热文件 diff 摘要（若有）
  manifest-delta.md           # auth_tenant.yaml 变更说明
  PHASE-D1-HANDOFF.md         # 给 D2 的交接
```

可选：更新 ledger 中对应行 `status=landed`（仅 D1 范围）。

---

## 步骤

### Step 0 — 干净起点

```bash
cd "/Users/daniel/AI项目/openbot-convergence"
git status -sb
# 丢弃或 stash 非本人、非 D1 的脏文件（尤其 method-scopes / app.ts 不明 WIP）
git rev-parse HEAD
pnpm build    # 确认 D0 仍绿；红则先修再 D1
```

### Step 1 — 定 scope

写 `scope.md`：本波 RPC/模块列表、源分支/SHA、明确不做什么。  
维护者未指定时默认：**tenant-context + method-scopes 完备性修补 + 既有 auth 回归测试加固**，以「负向+隔离」为验收核心。

### Step 2 — 实现与测试

小步 commit；测试驱动。  
热文件单独 wiring commit。

### Step 3 — 全量门禁

`pnpm build` + tsgo 计数写入 `build-tsgo.md`。

### Step 4 — Handoff

`PHASE-D1-HANDOFF.md`：

1. Final HEAD
2. 落地了什么 / 没落地什么
3. 测试列表
4. tsgo 77 → N
5. **D2 可否开始？** `YES` / `YES_WITH_GATES` / `NO`
6. 建议 D2 第一刀：session 读写同根 / promote heal（执行计划 §10.3）

### Step 5 — 汇报用户（中文）

结果表 + 风险 + 未做事项。

---

## 验收标准（D1 PASS）

- [ ] 仅 convergence worktree 改动
- [ ] `pnpm build` 仍为 0
- [ ] tsgo ≤ 77（或书面豁免且维护者已接受——默认不接受上升）
- [ ] 权限负向 + tenant 相关 scoped tests 绿
- [ ] 无不明 WIP 误提交
- [ ] `phase-d1/` 报告 + HANDOFF 齐全
- [ ] 正确 Task/Agent trailers
- [ ] 未做 D2–D4 产品大包、未推生产

---

## 一键开场

```text
请严格按 brief 执行 Phase D1 身份/租户/权限薄包：

.kiro/specs/repository-wide-branch-convergence/CURSOR-PHASE-D1-AUTH-TENANT-BRIEF.md

工作目录：/Users/daniel/AI项目/openbot-convergence
分支：convergence/2026-07-20

先读 phase-d0/PHASE-D0-HANDOFF.md。
保持 pnpm build 绿；tsgo ≤ 77。
丢弃 worktree 上无关脏 WIP（method-scopes/app.ts 等）除非写入 scope 并测试。

Task: repository-wide-branch-convergence
Agent: cursor-convergence-phase-d1
```

---

## 预告

D1 PASS → **Phase D2** brief：session store 读写同根、`chat.history` promote、空 tenant entry 不挡 heal（执行计划 4B′ / §10.3）。
