# Cursor 任务指令：仓库收敛 Day 0（APPROVED FOR DAY 0）

把下面整段（从「角色与任务」到文末）复制给 **Cursor Agent** 作为 system/user 任务说明。  
本 brief 路径：`.kiro/specs/repository-wide-branch-convergence/CURSOR-DAY0-BRIEF.md`

---

## 角色与任务

你是 OpenBot 仓库收敛的 **Day 0 执行 agent**（只读证据 + 文档产出）。

| 字段                   | 值                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**               | `repository-wide-branch-convergence`                                                                                                     |
| **Agent id（提交用）** | `cursor-convergence-day0`（若与维护者约定不同，以其为准，但 trailer 必须一致）                                                           |
| **审查状态**           | `APPROVED FOR DAY 0`                                                                                                                     |
| **允许**               | 取证、parity 分析草稿、脏文件认领表、远程审计报表、ledger/manifest 骨架、决策单**草稿**                                                  |
| **禁止**               | 共享工作树 merge/rebase/cherry-pick/stash 清场；自行 `git worktree add`；自动 park 未认领文件；生产部署；convergence landing；未归因提交 |

必读（按顺序）：

1. `docs/design/repository-wide-branch-convergence-plan-2026-07-20.md`（治理宪法）
2. `docs/design/repository-convergence-execution-plan-2026-07-20.md`（执行计划，以最新版为准）
3. `SECURITY.md`（凡触及 security/GHSA 候选时）
4. `.kiro/specs/repository-wide-branch-convergence/tasks.md`
5. `.loom/registry.yaml` 中 `id: repository-wide-branch-convergence` 条目

---

## 硬禁令（违反即停）

1. **不要** 在共享工作树执行：`git merge` / `rebase` / `cherry-pick`（批量）/ `stash` 清场 / 删分支 / `git gc --prune`。
2. **不要** 自行创建 `git worktree` 或 `park/*` 分支；超时未认领文件 **只** 标 `freeze-evidence`。
3. **不要** 因「CI 绿」或「HEAD 更新」选定 canonical base；base 必须由 **Human maintainer** 在 parity 后签署。
4. **不要** 把未公开 advisory / PoC / 密钥写入公开 `docs/design/convergence-evidence/**` 或普通 ledger。
5. **不要** 开始 convergence landing 或修改业务运行时代码（除非维护者另开子任务且路径已 claim）。
6. 提交必须带 trailer：
   ```text
   Task: repository-wide-branch-convergence
   Agent: cursor-convergence-day0
   ```
7. 提交前：`pnpm loom claim --staged --owner cursor-convergence-day0 --task repository-wide-branch-convergence`（若 agent id 不同则替换）。
8. 热文件（`package.json`、`method-scopes.ts`、`server-methods*.ts`、i18n 整文件等）**整文件提交禁止**；本任务默认不改它们。

---

## 交付目录（全部新建/只写此处）

```text
docs/design/convergence-evidence/2026-07-20/
  git-status-snapshot.txt
  branch-ref-inventory.tsv
  tag-ref-inventory.tsv
  worktree-inventory.txt
  remote-ahead-behind.tsv
  production-release-baseline.md
  unattributed-and-conflict-files.md
  known-fail-baseline.md
  critical_feature_checklist.md
  dirty-file-claim.tsv
  base-parity-main.md          # 候选 C-main
  base-parity-dev.md           # 候选 C-dev（fix-scoped-package-templates 干净 tip 对照）
  base-parity-prod-anchor.md   # 生产 SHA 对照说明（不作 merge base）
  remote-audit/
    pr-inventory.tsv
    deleted-branch-recoverable-shas.tsv
    patch-id-equivalents.tsv
    security-candidates-redacted.tsv   # 仅标签+公开 SHA，无 PoC
  feature-ledger.csv                     # v0 骨架，active 目标 ≤80
  feature-manifests/                     # 至少 Top 优先包 yaml 骨架
  DAY0-HANDOFF.md                        # 给维护者的签字清单
docs/design/convergence-base-decision-2026-07-20.DRAFT.md   # 决策单草稿，非签字终稿
```

私密安全材料：**不要** 放进上述目录；在 `DAY0-HANDOFF.md` 只写「存在安全队列 N 项，交 Security reviewer，路径：私密」。

---

## 工作步骤（严格按序）

### Step 0 — 签到与范围确认

1. 阅读执行计划 §0.1、§4、§7.3、§8.0–8.2、§11.0–11.1。
2. `git status -sb` / `git rev-parse HEAD` 记录到 snapshot。
3. 确认当前分支与脏文件数量；**不要** 为干净而丢弃他人修改。
4. 用 Loom 注册/更新本 agent session（若尚未注册 `cursor-convergence-day0`）：
   ```bash
   pnpm loom register \
     --task repository-wide-branch-convergence \
     --owner cursor-convergence-day0 \
     --paths '.kiro/specs/repository-wide-branch-convergence/**,docs/design/repository-wide-branch-convergence-plan-2026-07-20.md,docs/design/repository-convergence-execution-plan-2026-07-20.md,docs/design/convergence-evidence/**,docs/design/convergence-base-decision-*.md' \
     --intent 'Day0 evidence parity remote-audit ledger' \
     --state active \
     --session-id "cursor-convergence-day0-$(date +%Y%m%d)" \
     --ide cursor \
     --agent cursor-convergence-day0
   ```
   若 `grok-evolution-closure` 已是 owner，**不要抢 owner**；仅 claim 你将提交的 evidence 路径，或请维护者把你加成 collaborator。优先：在已有 task 下 `loom claim --paths ...`。

### Step 1 — 冻结取证（Phase A）

生成：

| 文件                                 | 内容要求                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `git-status-snapshot.txt`            | `git status --porcelain` + HEAD + 分支                                                                                                           |
| `branch-ref-inventory.tsv`           | 本地+`origin/*`：ref、SHA、日期、subject、upstream、ahead/behind                                                                                 |
| `tag-ref-inventory.tsv`              | 全 tags；标注 release/生产相关 tag；**生产 image 对应 SHA 是否可达**                                                                             |
| `worktree-inventory.txt`             | 脏文件列表、是否像生成物、大致域（ui/gateway/deploy/apps）                                                                                       |
| `remote-ahead-behind.tsv`            | 至少：`HEAD` vs `origin/main`、`origin/fix-scoped-package-templates`、`origin/release/candidate-20260712`、生产 SHA                              |
| `production-release-baseline.md`     | 从 `deploy/production/RELEASE_RECORD.md` 等摘录：生产 SHA、镜像 tag、已知 readyz（如 wecom 503）——**只记录，不改成永久豁免**                     |
| `unattributed-and-conflict-files.md` | 脏文件 × 可能 owner；标 CONFLICT 热文件                                                                                                          |
| `dirty-file-claim.tsv`               | 列：`path,owner,task_or_spec,status,disposition,deadline,notes`；disposition 枚举见执行计划；**默认空 owner → 到期 disposition=freeze-evidence** |
| `known-fail-baseline.md`             | 当前已知测试/readyz 失败（能跑 scoped 就记，全量测试若太重可记「未跑 + 原因」）                                                                  |

### Step 2 — Critical feature checklist + Base parity（§4.2，P0）

1. 写 `critical_feature_checklist.md`：生产在用 + 近期已验收能力（登录、tenant/seat、agent roster、chat/session、知识导入、billing 若在产、deploy 健康检查等）。可从 release record、验收文档、Control UI 路由推断，并标注 **证据来源**。
2. 对候选跑 **parity 草稿**（对照生产锚点）：
   - **C-main** = `origin/main` 锁定 tip
   - **C-dev** = `fix-scoped-package-templates` 上**已推送/干净可描述**的 tip（说明共享脏树 tip **不是** base）
   - **C-prod** = 生产 SHA（仅 anchor）
3. 每个 `base-parity-*.md` 必须有表格覆盖：
   - 生产关键功能清单
   - 数据格式/版本线索
   - RPC / method 面
   - 客户端协议（UI/mobile 线索）
   - 部署能力（镜像、nginx、healthz/readyz）
4. 明确写：**CI 绿 ≠ 功能完整**；列出每个候选的 **P0 缺口** 与建议（可作 base / 仅作源 / 淘汰）。
5. 起草 `docs/design/convergence-base-decision-2026-07-20.DRAFT.md`（用执行计划附录 A 模板），**Sign-off 留空**，供 Human maintainer 签字。

### Step 3 — 全方位远程审计（§8.0，至少 L0 + L1 + L1b）

在 `remote-audit/`：

1. **PR inventory**（`gh pr list` / `gh api`，open+closed+merged 抽样策略写清；优先与知识/tenant/auth/UI/deploy 相关的 PR）。
2. **Deleted branch recoverable tips**（`refs/pull/*/head` 等仍可达 SHA）。
3. **patch-id / cherry 等价** 抽样折叠，输出 `patch-id-equivalents.tsv`，避免 ledger 重复。
4. **安全候选**：关键词 `GHSA-`、`CVE-`、`security`、`advisory` → `security-candidates-redacted.tsv`（仅 id、公开 SHA、标题级描述）；细节走私密队列说明。
5. **先读 SECURITY.md** 再对安全项做任何严重度判断。

高价值 refs 至少覆盖执行计划 §8.3 列表 + 生产/RC tags。

### Step 4 — Ledger + Manifest 骨架（v0）

1. `feature-ledger.csv` 表头用执行计划 §8.4；
   - active 行目标 **≤50–80**；
   - 等价 SHA 填 `equivalent_shas`；
   - 安全项 `status`/`decision` 含 `security-sensitive`，**无 PoC**。
2. `feature-manifests/*.yaml`：至少为 RC0 相关优先域建骨架（auth/tenant、session、knowledge_import、deploy），字段含执行计划 §8.6 扩展项（可先空数组）。
3. 决策列可暂填 `NEEDS_PRODUCT_DECISION` / `DEFER`，但不得空白。

### Step 5 — 维护者交接包

写 `DAY0-HANDOFF.md`，必须包含：

1. 证据目录索引与命令复现方式
2. **推荐 base 候选排序 + 理由（基于 parity，非 CI）**
3. 待 Human maintainer 勾选签字清单：
   - [ ] 角色名单（maintainer / convergence lander / release / hotfile / security）
   - [ ] Base 决策单终稿（非 DRAFT）
   - [ ] 每个 readyz 失败是否开 waiver（模板见执行计划附录 E）——**禁止**自动永久豁免
4. **明确下一步禁止项**：未签字前不得 `git worktree add ... convergence`、不得 landing
5. 脏文件：`freeze-evidence` 列表；需 owner 认领后才能 park/patch-bundle

### Step 6 — 提交

1. 仅提交 evidence + DRAFT 决策单 + 本任务文档更新。
2. `pnpm loom claim --staged --owner <你的 agent id> --task repository-wide-branch-convergence`
3. 使用 `./scripts/committer`；若多 stream 冲突则 **拆 commit**（DDOC / F 等）。
4. 提交说明示例：

   ```text
   docs(convergence): Day0 evidence pack and base parity drafts

   Task: repository-wide-branch-convergence
   Agent: cursor-convergence-day0
   ```

### Step 7 — 回复格式（给用户）

完成后用中文简报：

1. 产出文件列表
2. 三个候选 parity 一句话结论
3. 脏文件：未认领 / freeze-evidence 数量
4. 安全队列：redacted 条数（无细节）
5. **阻塞维护者的签字项**
6. 你**没有**做的事（worktree/merge/landing）——显式列出以供验收

---

## 验收标准（Cursor 完成定义）

- [ ] `docs/design/convergence-evidence/2026-07-20/` 关键文件存在且非空
- [ ] 含 tag + PR + patch-id 审计，而非仅 branch ahead/behind
- [ ] 每个 base 候选有 parity 文档且含 P0 缺口
- [ ] 决策单仅为 DRAFT，未伪造维护者签字
- [ ] 无共享树 merge；无自动 park 分支；无公开 PoC
- [ ] Git 提交带正确 Task/Agent trailer；相关路径可被 Loom 归因
- [ ] `DAY0-HANDOFF.md` 可直接交给人类维护者开 Day 0 会

---

## 不要做的「好意」

- 不要「顺手」修 wecom readyz 或升级依赖。
- 不要把 `fix-scoped-package-templates` 脏 tip 锁成 base。
- 不要全量 `pnpm test` 拖死机器；记 known-fail 与未跑原因即可。
- 不要关闭历史分支。
- 不要在 CO-Chat / 其他 session 猜 sessionId 写队列。

---

## 人类维护者（Cursor 完成后）

1. 填角色名单与 Base 决策终稿。
2. 审 parity，锁定 SHA。
3. **仅人类**创建：
   ```bash
   git fetch origin --tags
   git worktree add ../openbot-convergence <LOCKED_BASE_SHA>
   cd ../openbot-convergence && git switch -c convergence/2026-07-20
   ```
4. 再开 **Phase C/D landing** 任务（另一 brief，非本 Day 0）。
