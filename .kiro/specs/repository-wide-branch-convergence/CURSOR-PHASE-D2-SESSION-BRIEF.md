# Cursor 任务指令：仓库收敛 Phase D2 — Session 读写同根 / history promote

把下面整段（从「角色与任务」到文末）复制给 **Cursor Agent**。  
本 brief：`.kiro/specs/repository-wide-branch-convergence/CURSOR-PHASE-D2-SESSION-BRIEF.md`

**前置（已验收）：**

| 阶段        | 状态                                                                  |
| ----------- | --------------------------------------------------------------------- |
| Day0 / Base | LOCKED `85eee3e7b987…`                                                |
| Phase C     | PASS                                                                  |
| Phase D0    | PASS · `pnpm build` 绿 · tsgo **77**                                  |
| Phase D1    | PASS · forged-tenant 拒绝 · scopes 登记 · 33 tests · tsgo **77**      |
| Worktree    | `/Users/daniel/AI项目/openbot-convergence` · `convergence/2026-07-20` |

**必读：**

- `…/phase-d1/PHASE-D1-HANDOFF.md`（`YES_WITH_GATES` → D2）
- `…/phase-d0/tsgo-before-after.md` · D1 `build-tsgo.md`（**tsgo 上限 77**）
- 执行计划 §10.3 / 4B′（session 不变量）
- 共享树（只读）若有历史实现可参考：
  - `src/gateway/tenant-context.ts`（`resolveSessionStorePathForInboundMessage` / `promoteGlobalSessionEntryIfNewer`）
  - `src/auto-reply/reply/session.ts`
  - `src/gateway/server-methods/chat.ts`（`loadSessionEntryForClient` / `chat.history`）  
    **注意：** 这些实现可能只在共享脏 tip，**不在** locked base。允许小范围移植，禁止整枝 cherry-pick。

---

## 角色与任务

你是 **Phase D2 session 不变量** lander。

| 字段         | 值                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------- |
| **Task**     | `repository-wide-branch-convergence`                                                           |
| **Agent id** | `cursor-convergence-phase-d2`                                                                  |
| **允许**     | 在 worktree 实现/移植 session store 同根读写、history promote 愈合、相关测试与报告             |
| **禁止**     | 共享树 merge；D3/D4 产品大包；采纳 **monthly-seat-usage / app.ts 等无关 staged WIP**；生产部署 |

### 锁定坐标

```text
WORKTREE=/Users/daniel/AI项目/openbot-convergence
BRANCH=convergence/2026-07-20
LOCKED_BASE=85eee3e7b987b14b3f83301e3f200b3e1d797cc6
TSGO_CEILING=77
BUILD_GATE=pnpm build   # must stay exit 0
```

### Step 0 强制：清理工作区

D1 handoff 警告：worktree 上 **反复出现** 未提交/已 staged 的 monthly-usage、UI、method-scopes 杂讯。

```bash
cd "$WORKTREE"
git status -sb
# 若存在与 D2 无关的 staged/unstaged 改动：
git restore --staged .
git restore .
git clean -fd -- dry-run first
# 确认干净后再开始（仅保留你的 D2 工作）
```

**禁止** 把 `enterprise-organization-monthly-usage` / organization-position-usage 等打进 D2 commit。

---

## 硬禁令

1. 只在 `$WORKTREE` 改代码。
2. 不整枝 cherry-pick 共享 tip。
3. 热文件最小 diff + 单独 `chore(scopes|methods):` commit（D2 通常不改 scopes；若改 chat 注册需登记）。
4. `pnpm build` 保持 **0**；`pnpm tsgo` **≤ 77**。
5. Trailers：
   ```text
   Task: repository-wide-branch-convergence
   Agent: cursor-convergence-phase-d2
   ```
6. 不 push、不生产 cutover。
7. 安全：`SECURITY.md`；无公开 PoC。

---

## D2 范围（横切不变量 — 必须可测）

### 必须实现 / 验证的不变量

| ID     | 不变量                                        | 验收要点                                                                                                                              |
| ------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **S1** | Multitenant **写路径** 与 **读路径** 同 store | `OPENBOT_MULTITENANT=1` + managed 时，inbound agent 写 tenant store；`chat.history` / `loadSessionEntryForClient` 读同一 tenant store |
| **S2** | Split-brain **promote**                       | 租户 store 空/旧，global 有更新 transcript → history load 时 promote 到 tenant（含 copy jsonl）                                       |
| **S3** | **空较新 tenant entry 不挡 heal**             | tenant `sessions.json` 有更新的 `updatedAt` 但 **无非空 transcript** 时，仍应从 global 非空 transcript promote（D0 前已知 bug 类）    |
| **S4** | Multitenant **off** 时行为不变                | 写/读均 global；不强制 tenant 路径                                                                                                    |
| **S5** | 失败开放                                      | membership 解析失败时写路径可 fail-open global（与现设计一致），并在测试/文档标明；history 侧仍尽量 heal                              |

### 建议触及模块（按 base 实际裁剪）

- `src/gateway/tenant-context.ts`（及 `.test.ts`）
- `src/auto-reply/reply/session.ts`（`resolveSessionStorePathForInboundMessage`）
- `src/gateway/server-methods/chat.ts`（确保 history 走 `loadSessionEntryForClient`）
- `src/gateway/session-utils*.ts` / `readSessionMessages` 仅当 promote 读路径需要

### 明确排除

- 知识导入 D4、协作大包、UI 大改
- 全量清理 77 tsgo
- WeCom 修复
- monthly seat usage 产品功能

### 从共享树移植时

```bash
# 示例：只取单文件历史实现对照（共享树）
git -C "/Users/daniel/AI项目/openbot" show HEAD:src/gateway/tenant-context.ts | head
# 在 worktree 内手工合并最小补丁，跑测试
```

若共享树实现依赖 D1 之后的其它模块，**重写最小子集** 而非拉整树。

---

## 验证门禁

| 级别   | 要求                                                                                                     |
| ------ | -------------------------------------------------------------------------------------------------------- |
| **P0** | 新增/扩展 `tenant-context`（或专用 session-store）测试覆盖 **S2+S3**（推荐 temp dir + mock multitenant） |
| **P0** | 既有 `tenant-context.test.ts` 不红（D1 后 26+ 项）                                                       |
| **P0** | 至少一组 **S4** multitenant-off 回归                                                                     |
| **P1** | `pnpm build` exit **0**                                                                                  |
| **P1** | `pnpm tsgo` **≤ 77**（before/after 写入报告）                                                            |

推荐：

```bash
cd "$WORKTREE"
pnpm exec vitest run src/gateway/tenant-context.test.ts --pool=forks
# 若新增测试文件一并 run
pnpm build
pnpm tsgo 2>&1 | tee /tmp/tsgo-d2.txt
grep -c 'error TS' /tmp/tsgo-d2.txt
```

---

## 交付物

```text
docs/design/convergence-evidence/2026-07-20/phase-d2/
  scope.md
  invariants-matrix.md      # S1–S5 状态：implemented / tested / deferred
  tests-run.md
  build-tsgo.md             # before=77
  transplant-log.md         # 若从共享树移植：源 SHA/路径/取舍
  PHASE-D2-HANDOFF.md
```

---

## 步骤摘要

0. **清理** worktree 无关 staged/unstaged WIP
1. 确认 `pnpm build` 仍绿
2. 实现 S1–S3（S4/S5 测试锁定）
3. 跑测试 + build + tsgo
4. 写 phase-d2 报告
5. Commit：功能与测试分开；热文件单独
6. 中文汇报

### PHASE-D2-HANDOFF 必须含

1. Final HEAD
2. S1–S5 矩阵
3. 测试命令与结果
4. tsgo 77 → N
5. **D3 可否开始？**（会话薄包 / checkpoint）
6. 未采纳的 WIP 列表（证明 monthly-usage 等未混入）

---

## 验收标准（D2 PASS）

- [ ] Worktree 干净提交；无 monthly-usage 等无关文件
- [ ] S2+S3 有自动化测试且绿
- [ ] S4 回归绿
- [ ] `pnpm build` = 0；tsgo ≤ 77
- [ ] 报告齐全 + trailers 正确
- [ ] 未共享树 merge、未推生产

**FAIL：** 把 staged 的 organization monthly-usage 大包误提交；或 tsgo > 77 无说明；或 build 红。

---

## 一键开场

```text
请严格按 brief 执行 Phase D2 session 不变量：

.kiro/specs/repository-wide-branch-convergence/CURSOR-PHASE-D2-SESSION-BRIEF.md

工作目录：/Users/daniel/AI项目/openbot-convergence
分支：convergence/2026-07-20

开始前必须 git restore / 清理无关 staged WIP（monthly-usage、app.ts 等）。
先读 phase-d1/PHASE-D1-HANDOFF.md。
保持 pnpm build 绿；tsgo ≤ 77。
重点：promote heal + 空较新 tenant entry 不挡恢复。

Task: repository-wide-branch-convergence
Agent: cursor-convergence-phase-d2
```

---

## 预告

D2 PASS → **D3** 会话/transcript 薄包与 checkpoint；**D4** 知识矩阵自动化。
