# Cursor 任务指令：仓库收敛 Phase D0 — 构建收口

把下面整段（从「角色与任务」到文末）复制给 **Cursor Agent** 作为任务说明。  
本 brief 路径：`.kiro/specs/repository-wide-branch-convergence/CURSOR-PHASE-D0-BUILD-BRIEF.md`

**前置（已完成，勿重做）：**

| 阶段         | 状态                                                                  |
| ------------ | --------------------------------------------------------------------- |
| Day0 证据    | PASS                                                                  |
| Base 锁定    | `85eee3e7b987b14b3f83301e3f200b3e1d797cc6`                            |
| Worktree     | `/Users/daniel/AI项目/openbot-convergence` · `convergence/2026-07-20` |
| Phase C 基线 | PASS · `YES_WITH_GATES` · install 绿 · **build 红** · **tsgo = 86**   |

**Phase C 报告（必读）：**  
`/Users/daniel/AI项目/openbot-convergence/docs/design/convergence-evidence/2026-07-20/phase-c/`  
尤其：`PHASE-C-HANDOFF.md`、`build-baseline.md`、`tsgo-baseline.md`、`known-fail-convergence.md`

---

## 角色与任务

你是 OpenBot 收敛 **Phase D0 构建收口 agent**：在 **同一 convergence worktree** 上把 locked base 的 **可发布构建** 收绿（或证明官方发布路径不依赖失败步骤并更新门禁），并压住/降低 tsgo 基线。

| 字段         | 值                                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **Task**     | `repository-wide-branch-convergence`                                                                                       |
| **Agent id** | `cursor-convergence-phase-d0`                                                                                              |
| **允许**     | 在 convergence worktree 内修 **构建阻塞** 与 **明确的类型错误**；写 phase-d0 报告；convergence 分支 commit                 |
| **禁止**     | 共享树 merge；功能 landing（知识导入/会话产品/UI 大包）；生产部署；热文件整文件重写；为“消错”而删除测试/放宽 tsconfig 蒙混 |

### 锁定坐标

```text
WORKTREE=/Users/daniel/AI项目/openbot-convergence
BRANCH=convergence/2026-07-20
LOCKED_BASE=85eee3e7b987b14b3f83301e3f200b3e1d797cc6
SHARED_TREE=/Users/daniel/AI项目/openbot   # 只读对照，禁止集成
```

所有构建/修复命令必须在 `$WORKTREE` 执行。

---

## 硬禁令

1. **不要** 在 `$SHARED_TREE` 做 merge / rebase / 功能实现。
2. **不要** 从共享脏 tip 大批量 cherry-pick「先变新」。
3. **不要** 整文件重写热文件：  
   `package.json`、`pnpm-lock.yaml`、`src/gateway/method-scopes.ts`、`src/gateway/server-methods*.ts`、`server.impl.ts`、`ui/src/i18n/locales/en.ts`、`zh-CN.ts`、`ui/src/ui/app.ts`。  
   若 **必须** 改 `package.json`（例如补 `@types/pg`），单独 commit，说明理由，**尽量不** 改 lockfile 大范围；若不得不更新 lock，单独 commit 且 diff 最小化。
4. **不要** 用 `// @ts-ignore` / 删测试 / `skipLibCheck` 投机取巧掩盖 build-blocking 错误（除非 handoff 论证「生产镜像从不跑该步」且维护者路径一致）。
5. **不要** `git push --force`、不要生产 cutover。
6. **不要** 扩大 `readyz` 失败面；wecom 继续引用已有 waiver（至 2026-08-20）。
7. Trailers：
   ```text
   Task: repository-wide-branch-convergence
   Agent: cursor-convergence-phase-d0
   ```
8. 安全：先读 `SECURITY.md`；无公开 PoC。

---

## 目标（完成定义）

### 主目标（必须达成其一）

**路径 A — 脚本全绿（优先）**

在 worktree 上：

```bash
pnpm build:collaboration:packages   # 若需要，与 Phase C 一致先跑
pnpm build                          # 或仓库约定的与 docker 一致的全量 build
```

- **exit 0**
- 特别是 **`pnpm build:plugin-sdk:dts` / `tsc -p tsconfig.plugin-sdk.dts.json` 不再失败**

**路径 B — 门禁对齐生产（仅当 A 不可行）**

若能证明 **v69 生产镜像构建从不执行失败步骤**（对照 `deploy/production` Dockerfile / RELEASE_RECORD / CI）：

1. 写清「生产构建命令图」vs「根目录 `pnpm build`」差异；
2. 在 convergence 上使 **生产等价命令** exit 0；
3. 将根目录 `pnpm build` 失败降级为 **documented non-gate**（写入 phase-d0 报告，**不得** 默默忽略）。

**默认必须先尝试路径 A。** 走 B 须在 `PHASE-D0-HANDOFF.md` 用证据论证。

### 次目标（必须）

| 指标                   | Phase C 基线          | D0 要求                                |
| ---------------------- | --------------------- | -------------------------------------- |
| `pnpm tsgo` error 行数 | **86**                | **≤ 86**；力争下降；**禁止无说明上升** |
| Build-blocking 子集    | 9 个 dts 错误（见下） | 路径 A 下必须清零                      |

### 非目标（本 brief 不做）

- D1 身份/租户功能落地
- D2 session 不变量产品改动（除非为修编译最小触及）
- D3/D4 知识/会话功能
- RC0 镜像推送、staging 部署

---

## Phase C 已定位的阻塞清单（优先清）

### A. `build:plugin-sdk:dts`（9 类/处 — 必须清或走路径 B）

来自 `phase-c/build-baseline.md`：

| 区域                                                      | 问题摘要                                           |
| --------------------------------------------------------- | -------------------------------------------------- |
| `packages/cogniweave-sdk/src/adapters/local-metadata.ts`  | 非法/不当 cast → `LocalMetadataRow[]`              |
| `packages/cogniweave-sdk/src/adapters/postgres-client.ts` | 缺 `@types/pg`；Pool 构造 typing                   |
| `packages/cogniweave-sdk/src/cli.ts`                      | `scope.workspaceId` optional vs required           |
| `src/gateway/billing/seats-store.ts`                      | `string \| null` vs `string \| undefined`          |
| `src/memory/recall-deny-search-wrapper.ts`                | 方法返回 `Promise \| undefined` vs `Promise`（×4） |

### B. 顺序依赖（文档 + 脚本，能修则修）

Phase C：直接 `pnpm build` 可能先炸 collab `UNRESOLVED_IMPORT`。  
`build:docker` / `build:plugin-sdk:dts` 已依赖 `build:collaboration:packages`。

D0 要求：

- 确认根 `pnpm build` 是否应 **显式依赖** collab packages；
- 若是脚本漏洞：最小改 `package.json` scripts **一行级** 修复（单独 commit），避免开发者踩坑。

### C. tsgo = 86（允许暂存，但要可控）

高密度文件（Phase C）：

- `ui/src/ui/app-view-state-shell-slices.ts`（~23）
- `src/gateway/server-methods/enterprise-data-m1.ts`（~9）
- conversations / memory 等多处

D0 策略：

1. **先** 清 build-blocking 与 dts 重叠错误（cogniweave + recall-deny + seats-store）。
2. 其余 tsgo：能安全速修则修；不能则列入 `tsgo-carryover.md`（路径 + 原因 + 建议 target_wave），**计数不得上升**。
3. **禁止** 为消 23 个 UI shell 错误而大改 shell 架构（留给后续 wave）。

---

## 交付物

在 worktree 创建：

```text
docs/design/convergence-evidence/2026-07-20/phase-d0/
  env.md                         # node/pnpm + HEAD
  build-green-checkpoint.md      # 命令、exit code、是否路径 A/B
  dts-fix-log.md                 # 每个原 9 错：文件、修法、或 wontfix+证据
  tsgo-before-after.md           # before=86, after=N, delta, 未修列表
  package-scripts-delta.md       # 若改了 package.json scripts
  hotfile-delta.md               # 若碰了任何热文件：路径+理由+diff 摘要
  PHASE-D0-HANDOFF.md            # 给 D1 的交接
```

---

## 步骤

### Step 0 — 签到

```bash
cd "/Users/daniel/AI项目/openbot-convergence"
git status -sb
git rev-parse HEAD
git merge-base --is-ancestor 85eee3e7b987b14b3f83301e3f200b3e1d797cc6 HEAD
# 必须成功
```

记录当前 tip（应含 Phase C docs commits）。  
Loom（在共享树 registry 上 claim，勿抢 owner）：

```bash
cd "/Users/daniel/AI项目/openbot"
pnpm loom claim --owner cursor-convergence-phase-d0 --task repository-wide-branch-convergence \
  --paths 'docs/design/convergence-evidence/**/phase-d0/**' || true
```

### Step 1 — 复现 Phase C 红灯

```bash
cd "/Users/daniel/AI项目/openbot-convergence"
pnpm build:collaboration:packages
pnpm exec tsc -p tsconfig.plugin-sdk.dts.json   # 或 pnpm build:plugin-sdk:dts
# 确认仍失败且错误集与 Phase C 同类
```

把复现结果写入 `dts-fix-log.md` 开头。

### Step 2 — 最小修复循环

对每个 build-blocking 错误：

1. 读上下文，选 **最小类型/实现修正**（优先改实现侧类型一致性，避免 `as any`）。
2. 单测：若有邻近 test，跑 scoped：
   ```bash
   pnpm exec vitest run <related.test.ts> --pool=forks
   ```
3. 每逻辑修复组单独 commit（便于 revert）：

   ```text
   fix(build): <area> for plugin-sdk dts on convergence base

   Task: repository-wide-branch-convergence
   Agent: cursor-convergence-phase-d0
   ```

### Step 3 — 全量 build 验证

```bash
pnpm build
# 期望路径 A：exit 0
echo $?
```

若失败：继续修或评估路径 B（需 Dockerfile 证据）。

### Step 4 — tsgo 对比

```bash
pnpm tsgo 2>&1 | tee /tmp/tsgo-d0.txt
# 统计 error TS 行数
grep -c 'error TS' /tmp/tsgo-d0.txt || true
```

写入 `tsgo-before-after.md`（before 固定 **86**）。  
若 **after > 86**：必须回滚导致上升的提交或立即再修到 ≤86，否则 D0 **FAIL**。

### Step 5 — 报告与 Handoff

`PHASE-D0-HANDOFF.md` 必须含：

1. Final HEAD
2. 路径 A 或 B + 证据
3. `pnpm build` exit code
4. tsgo before/after
5. **Phase D1 可否开始？** `YES` / `YES_WITH_GATES` / `NO`
6. 未做事项列表

### Step 6 — 提交纪律

- 源码修复 commit 与 `docs/.../phase-d0/` 报告可分开。
- **不要** push，除非维护者明确要求。
- **不要** merge 进 `fix-scoped-package-templates` 共享树。

### Step 7 — 中文汇报用户

1. 路径 A/B
2. build 绿/红
3. tsgo 86 → N
4. 关键 commits 列表
5. D1 是否放行
6. 明确未做功能 landing

---

## 验收标准（D0 PASS）

- [ ] 工作始终在 `openbot-convergence`
- [ ] 仍为 locked base 的后代（仅多 D0 修复 + 报告）
- [ ] **路径 A：`pnpm build` exit 0**，或 **路径 B：生产等价 build exit 0 + 书面论证**
- [ ] tsgo 计数 **≤ 86** 且有 before/after 记录
- [ ] `phase-d0/` 报告齐全 + `PHASE-D0-HANDOFF.md`
- [ ] 无共享树集成；无生产 cutover
- [ ] 热文件改动（若有）有 `hotfile-delta.md` 且最小
- [ ] 正确 Task/Agent trailers

**FAIL 条件：** build 仍红且无路径 B 证据；或 tsgo > 86；或为消错删除/跳过大量测试；或改到共享脏树。

---

## 修复风格提示

| 场景                                | 建议                                                            |
| ----------------------------------- | --------------------------------------------------------------- |
| `null` vs `undefined`               | 与周边 store API 对齐，统一一种                                 |
| `Promise \| undefined` vs `Promise` | 返回 `Promise.resolve(...)` 或收窄类型                          |
| 缺 `@types/pg`                      | 优先 `devDependencies` 精确添加；或正确的 type-only import 策略 |
| cast 错误                           | 修正数据结构/泛型，避免双重断言                                 |
| collab 顺序                         | 修 `package.json` 的 `build` 脚本依赖顺序                       |

对照生产：`deploy/production/` 与 `RELEASE_RECORD.md`（共享树可读）。

---

## 一键开场（贴给 Cursor）

```text
请严格按 brief 执行 Phase D0 构建收口（禁止功能 landing）：

.kiro/specs/repository-wide-branch-convergence/CURSOR-PHASE-D0-BUILD-BRIEF.md

工作目录：/Users/daniel/AI项目/openbot-convergence
分支：convergence/2026-07-20
锁定 base：85eee3e7b987b14b3f83301e3f200b3e1d797cc6

先读 phase-c 的 build-baseline.md / tsgo-baseline.md / PHASE-C-HANDOFF.md。
目标：pnpm build 绿（或路径 B 证明）且 tsgo ≤ 86。

Task: repository-wide-branch-convergence
Agent: cursor-convergence-phase-d0
```

---

## 完成后下一步（预告）

D0 PASS → 开 **Phase D1** brief（身份/租户/权限薄包），仍在同一 worktree，遵守热文件 wiring 规则。
