# Cursor 任务指令：RC0-PREP **返工**（验收未通过）

把下面整段复制给 **Cursor Agent**。  
本 brief：`.kiro/specs/repository-wide-branch-convergence/CURSOR-PHASE-RC0-PREP-REWORK-BRIEF.md`

---

## 验收结论（2026-07-20 复验）

| 项                                                      | 结果                                                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 路径                                                    | `/Users/daniel/AI项目/openbot-convergence` · `convergence/2026-07-20`                         |
| `docs/design/convergence-evidence/2026-07-20/rc0-prep/` | **不存在**                                                                                    |
| `RC0-PREP-HANDOFF.md` / `release-record-DRAFT.md` 等    | **缺失**                                                                                      |
| 含 `cursor-convergence-rc0-prep` 的 commit              | **无**                                                                                        |
| Worktree HEAD                                           | 仍停在含 org monthly-usage 等后续提交的 tip（如 `08027a7006` 一带），**无 RC0-PREP 文档提交** |

**判定：`RC0-PREP` → FAIL / NOT DELIVERED**

原 brief 仍有效：  
`.kiro/specs/repository-wide-branch-convergence/CURSOR-PHASE-RC0-PREP-BRIEF.md`

本文件 = **强制返工**，补齐交付并堵住上次漏洞。

---

## 角色

| 字段      | 值                                     |
| --------- | -------------------------------------- |
| **Task**  | `repository-wide-branch-convergence`   |
| **Agent** | `cursor-convergence-rc0-prep`          |
| **状态**  | REWORK after FAIL                      |
| **禁止**  | 生产 cutover；共享树 merge；假装已完成 |

```text
WORKTREE=/Users/daniel/AI项目/openbot-convergence
BRANCH=convergence/2026-07-20
LOCKED_BASE=85eee3e7b987b14b3f83301e3f200b3e1d797cc6
OUT=docs/design/convergence-evidence/2026-07-20/rc0-prep
```

---

## 硬要求（相对原 brief 的加强）

1. **所有文件必须出现在 `$WORKTREE/$OUT/`** 且 **commit 到 `convergence/2026-07-20`**。
   - 写在共享树 `/Users/daniel/AI项目/openbot` **不算数**。
2. 完成后执行自检（写入 `RC0-PREP-HANDOFF.md`）：
   ```bash
   test -d "$WORKTREE/$OUT" && ls -la "$WORKTREE/$OUT"
   test -f "$WORKTREE/$OUT/RC0-PREP-HANDOFF.md"
   git -C "$WORKTREE" log -1 --format='%h %s%n%b'   # 必须含 Agent: cursor-convergence-rc0-prep
   ```
3. **`RECOMMENDED_RC0_TIP` 必须可检出且祖先含 LOCKED_BASE**。
   - 优先推荐 **D4 完成点**：`9aceda7349`（`docs(convergence): Phase D4 knowledge import matrix evidence and handoff`），  
     **除非** 你证明后续提交对 RC0 必要且无污染。
   - 若 tip 含 monthly-usage UI，必须在 `candidate-tip.md` 列出污染 commit 表，并说明 tag 是否应指 `9aceda7349`。
4. **必须重跑** 并粘贴摘要到 `regression-pack.md`（不可只抄 D4 旧结果）：
   ```bash
   cd "$WORKTREE"
   pnpm build
   pnpm exec vitest run \
     src/gateway/tenant-context.test.ts \
     src/gateway/knowledge/sources/local-folder-import.golden-path.test.ts \
     src/gateway/server-methods/chat.history-d3.test.ts \
     src/gateway/server-methods/chat-checkpoints.d3.test.ts \
     --pool=forks
   ```
5. 生产：**禁止** 部署；`release-record-DRAFT.md` 的 Production Sign-off 留空；`PRODUCTION_GO=NO`。
6. Trailers：
   ```text
   Task: repository-wide-branch-convergence
   Agent: cursor-convergence-rc0-prep
   ```

---

## 必交文件清单（缺一不可）

```text
$OUT/env.md
$OUT/candidate-tip.md
$OUT/regression-pack.md
$OUT/build-reproducibility.md
$OUT/data-format-inventory.md
$OUT/data-upgrade-dry-run.md
$OUT/data-restore-checklist.md
$OUT/client-protocol-gate.md
$OUT/readyz-waiver-status.md
$OUT/feature-inclusion.md
$OUT/release-record-DRAFT.md
$OUT/RC0-PREP-HANDOFF.md
```

内容要求见原 `CURSOR-PHASE-RC0-PREP-BRIEF.md` §「RC0-PREP 交付范围」。  
返工时 **优先保证清单齐全 + 回归绿 + tip 清晰**；客户端编译允许 RISK，但必须有专节。

---

## 建议执行顺序（最短路径）

```bash
cd /Users/daniel/AI项目/openbot-convergence
git status -sb
# 1) 选 tip
git log --oneline 85eee3e7b987b14b3f83301e3f200b3e1d797cc6..HEAD | head -40
# 推荐记录 9aceda7349 为 RECOMMENDED_RC0_TIP（D4 完成）

# 2) 回归（在当前 HEAD 或 checkout 到推荐 tip 的 detached/临时分支验证均可；
#    若在推荐 tip 验证，报告写明；最终 docs commit 可仍在当前分支 tip）
pnpm build
pnpm exec vitest run src/gateway/tenant-context.test.ts \
  src/gateway/knowledge/sources/local-folder-import.golden-path.test.ts \
  src/gateway/server-methods/chat.history-d3.test.ts \
  src/gateway/server-methods/chat-checkpoints.d3.test.ts --pool=forks

# 3) 写全 $OUT/*
mkdir -p docs/design/convergence-evidence/2026-07-20/rc0-prep

# 4) commit 仅 docs（除非为跑通回归发现 build 回归）
git add docs/design/convergence-evidence/2026-07-20/rc0-prep
git commit -m "$(cat <<'EOF'
docs(convergence): RC0-prep evidence pack for staging decision

Task: repository-wide-branch-convergence
Agent: cursor-convergence-rc0-prep
EOF
)"
```

---

## HANDOFF 最低字段

1. `RECOMMENDED_RC0_TIP=<sha>`
2. 回归表（build + 4 个 vitest）
3. Staging: `GO` | `GO_WITH_GATES` | `NO_GO` + 理由
4. Production: **`NO_GO`**（硬编码，除非维护者另文授权）
5. 污染提交列表（monthly-usage 等）
6. 自检：`ls rc0-prep` 文件数 ≥ 12

---

## 验收标准（返工 PASS）

- [ ] `$WORKTREE/.../rc0-prep/` 存在且 ≥12 个规定文件
- [ ] 最新 commit trailer 含 `cursor-convergence-rc0-prep`
- [ ] 本波重跑回归记录为绿（或 NO_GO 且说明红项）
- [ ] 无生产部署
- [ ] `RECOMMENDED_RC0_TIP` 明确

---

## 一键开场

```text
RC0-PREP 上次验收 FAIL：worktree 内无 rc0-prep/ 目录、无对应 commit。

请按返工 brief 重新完整交付：

.kiro/specs/repository-wide-branch-convergence/CURSOR-PHASE-RC0-PREP-REWORK-BRIEF.md

并遵守原 brief：
.kiro/specs/repository-wide-branch-convergence/CURSOR-PHASE-RC0-PREP-BRIEF.md

必须在 /Users/daniel/AI项目/openbot-convergence 的 convergence/2026-07-20 上
创建 docs/design/convergence-evidence/2026-07-20/rc0-prep/* 并 git commit。
推荐 RECOMMENDED_RC0_TIP=9aceda7349（D4 完成点），除非有充分理由。
生产 cutover 禁止。

Task: repository-wide-branch-convergence
Agent: cursor-convergence-rc0-prep
```

---

## 返工通过后的「下一指令」预告（本次不要做）

**`CURSOR-PHASE-STAGING-DEPLOY-BRIEF.md`**（仅当 RC0-PREP PASS 且维护者书面 GO）：

- 在 **staging** 部署 `RECOMMENDED_RC0_TIP`
- smoke：healthz / 登录 / chat.history / localFolder 矩阵抽样
- 仍 **禁止** 生产 cutover

在 RC0-PREP 未 PASS 前 **不要** 开 staging brief。
