# Cursor 任务指令：仓库收敛 Phase D3 — 会话 / Transcript 薄包 + Checkpoint

把下面整段（从「角色与任务」到文末）复制给 **Cursor Agent**。  
本 brief：`.kiro/specs/repository-wide-branch-convergence/CURSOR-PHASE-D3-SESSION-TRANSCRIPT-BRIEF.md`

**前置（已验收）：**

| 阶段        | 状态                                                                  |
| ----------- | --------------------------------------------------------------------- |
| Day0 / Base | LOCKED `85eee3e7b987…`                                                |
| D0          | PASS · `pnpm build` 绿                                                |
| D1          | PASS · forged-tenant 拒绝                                             |
| D2          | PASS · S1–S5 session store / promote heal · tests 29 · tsgo **77**    |
| Worktree    | `/Users/daniel/AI项目/openbot-convergence` · `convergence/2026-07-20` |

**必读：**

- `…/phase-d2/PHASE-D2-HANDOFF.md`
- `…/phase-d2/invariants-matrix.md`（S1–S5 已落地，D3 **不得回退**）
- 执行计划 §10.4（原 D3 会话薄包）
- 共享树只读参考（**可移植、禁止整枝**）：
  - `src/gateway/checkpoint-store.ts`
  - `src/gateway/server-methods/chat-checkpoints*.ts`
  - `src/gateway/server-methods/chat.ts`（history / restore）
  - `kiro-daibai/chat-checkpoint-rollback` 相关设计若存在

---

## 角色与任务

你是 **Phase D3 会话/transcript 薄包** lander。

| 字段         | 值                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **Task**     | `repository-wide-branch-convergence`                                                                                            |
| **Agent id** | `cursor-convergence-phase-d3`                                                                                                   |
| **允许**     | checkpoint 列表/只读查询、history 与 transcript 读路径加固、与 D2 promote 的回归、最小 restore 若已有契约；测试与 phase-d3 报告 |
| **禁止**     | 共享树 merge；D4 知识导入大包；monthly-usage / 商业 UI；生产部署；破坏 S1–S5                                                    |

### 锁定坐标

```text
WORKTREE=/Users/daniel/AI项目/openbot-convergence
BRANCH=convergence/2026-07-20
LOCKED_BASE=85eee3e7b987b14b3f83301e3f200b3e1d797cc6
TSGO_CEILING=77
BUILD_GATE=pnpm build   # must stay 0
```

### Step 0 — 工作区消毒（强制）

```bash
cd "$WORKTREE"
git status -sb
git restore --staged . 2>/dev/null; git restore . 2>/dev/null
# 删除无关 untracked（先 dry-run）
git clean -fdn | head -50
# 确认无 monthly-usage / 大块 UI WIP 后再动手
git rev-parse HEAD
pnpm build   # 必须仍绿；红则先修
```

Convergence 分支上可能已有 **他人** monthly-usage 提交（D2 备注）。D3 **不要** 再叠这类提交；也不要 revert 除非维护者书面要求。

---

## 硬禁令

1. 只在 `$WORKTREE` 改代码。
2. 不整枝 cherry-pick 共享 tip / `openbot-chat-checkpoint-rollback` 全历史。
3. 热文件最小 diff；method 注册单独 `chore(scopes|methods):` commit。
4. **`pnpm build` = 0**；**tsgo ≤ 77**。
5. **不得回退 D2**：`tenant-context` promote / inbound tenant write 测试必须仍绿。
6. Trailers：
   ```text
   Task: repository-wide-branch-convergence
   Agent: cursor-convergence-phase-d3
   ```
7. 不 push、不生产 cutover。
8. 安全：`SECURITY.md`。

---

## D3 范围（薄包）

### 必须交付（P0）

| ID     | 能力                        | 验收                                                                                                                                           |
| ------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1** | **History 可读**            | `chat.history` 路径在 client 存在时走 `loadSessionEntryForClient`（D2 已接线则加回归测试锁定）                                                 |
| **T2** | **Transcript 读安全**       | `readSessionMessages` / sessionFile 解析不因绝对路径/跨 dir 静默丢消息；有单测或现有测试扩展                                                   |
| **T3** | **Checkpoint 列表（只读）** | 若 base 已有 `chat.checkpoints.list`：补 tenant-aware + 负向/权限；若无：从共享树/设计 **最小移植** list RPC + store 只读 + scopes 登记 + 测试 |
| **T4** | **D2 不变量回归**           | `tenant-context.test.ts` **29+** 仍全绿                                                                                                        |

### 应该交付（P1，时间允许）

| ID     | 能力                                                                                                                 |
| ------ | -------------------------------------------------------------------------------------------------------------------- |
| **T5** | Checkpoint **restore** 最小安全路径（若 P1 设计已有；无则 DEFER 并写清）                                             |
| **T6** | Employee steward session key 与 history 的兼容说明/测试（`resolveEmployeeScopedChatSessionKey` 不丢 agent bot 会话） |

### 明确排除（DEFER）

- 知识导入 / KB 索引 / D4 矩阵
- 全量 conversation lifecycle / CogniWeave 归档
- UI 大改 checkpoint 面板（RPC+测试优先；UI 仅在已有接线且最小时动）
- 清 77 个无关 tsgo
- monthly seat usage

### 选源

- 共享树 `chat-checkpoint-rollback` / `checkpoint-store` 实现可 **文件级** 移植。
- Ledger 中 `session` / checkpoint 相关行可标 `landed`（仅本波真实落地项）。

---

## 验证门禁

| 级别   | 要求                                                                        |
| ------ | --------------------------------------------------------------------------- |
| **P0** | `pnpm exec vitest run src/gateway/tenant-context.test.ts --pool=forks` 全绿 |
| **P0** | Checkpoint / history 相关新测或扩展测全绿                                   |
| **P0** | 至少 1 个 **负向**（无权限/错 session / 非法 archiveId 若触及）             |
| **P1** | `pnpm build` exit **0**                                                     |
| **P1** | `pnpm tsgo` **≤ 77**（before/after 记录）                                   |

```bash
cd "$WORKTREE"
pnpm exec vitest run src/gateway/tenant-context.test.ts --pool=forks
# 追加你新增的 checkpoint/history tests
pnpm build
pnpm tsgo 2>&1 | tee /tmp/tsgo-d3.txt
grep -c 'error TS' /tmp/tsgo-d3.txt
```

---

## 交付物

```text
docs/design/convergence-evidence/2026-07-20/phase-d3/
  scope.md
  capability-matrix.md       # T1–T6 状态
  tests-run.md
  build-tsgo.md              # before=77
  transplant-log.md          # 源 SHA/路径
  d2-regression.md           # 确认 S1–S5 未回退
  PHASE-D3-HANDOFF.md
```

可选：更新 `feature-manifests/session.yaml`。

---

## 步骤

0. 消毒 worktree + 确认 build 绿
1. 盘点 base 上是否已有 checkpoint pack；有则 harden，无则最小移植
2. 加 T1/T2/T4 测试锁定 D2+history
3. scopes/methods wiring（若新 RPC）
4. build + tsgo
5. 写 phase-d3 报告并 commit
6. 中文汇报

### HANDOFF 必须含

1. Final HEAD
2. T1–T6 矩阵
3. 测试列表与结果
4. tsgo 77 → N
5. **D4 可否开始？**（知识导入矩阵）
6. 未混入 monthly-usage 的声明

---

## 验收标准（D3 PASS）

- [ ] T1–T4 完成且测试绿
- [ ] D2 tenant-context 测试未回退
- [ ] build = 0；tsgo ≤ 77
- [ ] 报告齐全；trailers 正确
- [ ] 无共享树 merge；无无关大包误提交

**FAIL：** 回退 promote/heal；或误提交 monthly-usage；或 build 红 / tsgo > 77。

---

## 一键开场

```text
请严格按 brief 执行 Phase D3 会话/transcript 薄包 + checkpoint：

.kiro/specs/repository-wide-branch-convergence/CURSOR-PHASE-D3-SESSION-TRANSCRIPT-BRIEF.md

工作目录：/Users/daniel/AI项目/openbot-convergence
分支：convergence/2026-07-20

开始前清理无关 WIP。先读 phase-d2/PHASE-D2-HANDOFF.md。
保持 pnpm build 绿；tsgo ≤ 77；不得回退 D2 promote/heal。
优先：history 读路径锁定 + checkpoint list（只读）+ 测试。

Task: repository-wide-branch-convergence
Agent: cursor-convergence-phase-d3
```

---

## 预告

D3 PASS → **Phase D4** 知识导入黄金路径矩阵（成功/越权/A-B/幂等/失败恢复/重启）。
