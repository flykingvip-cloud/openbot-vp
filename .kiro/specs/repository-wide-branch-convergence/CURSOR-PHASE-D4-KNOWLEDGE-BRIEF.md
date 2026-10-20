# Cursor 任务指令：仓库收敛 Phase D4 — 知识导入黄金路径矩阵

把下面整段（从「角色与任务」到文末）复制给 **Cursor Agent**。  
本 brief：`.kiro/specs/repository-wide-branch-convergence/CURSOR-PHASE-D4-KNOWLEDGE-BRIEF.md`

**前置（已验收）：**

| 阶段     | 状态                                                                  |
| -------- | --------------------------------------------------------------------- |
| Day0–D2  | Base 锁 · build 绿 · session promote heal · auth tenant               |
| **D3**   | **PASS** · T1–T4+T6 · 72 tests · tsgo **77** · build 0                |
| Worktree | `/Users/daniel/AI项目/openbot-convergence` · `convergence/2026-07-20` |

**必读：**

- `…/phase-d3/PHASE-D3-HANDOFF.md`（`YES_WITH_GATES` → D4）
- 执行计划 §10.5 知识矩阵 + 附录 D
- `docs/design/convergence-evidence/2026-07-20/feature-manifests/knowledge_import.yaml`（若无则创建/补全）
- 共享树只读参考（**可移植、禁止整枝**）：
  - `src/gateway/knowledge/sources/local-folder-import.golden-path.test.ts`
  - `src/gateway/knowledge/**` 导入/绑定/检索相关
  - Day0 `critical_feature_checklist.md` 知识条目

---

## 角色与任务

你是 **Phase D4 知识导入矩阵** lander。

| 字段         | 值                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Task**     | `repository-wide-branch-convergence`                                                                                  |
| **Agent id** | `cursor-convergence-phase-d4`                                                                                         |
| **允许**     | 在 worktree 移植/实现 **一条** 可自动化的知识导入闭环 + 矩阵六项测试；补 RPC/runtime 缺口到「可测」；写 phase-d4 报告 |
| **禁止**     | 共享树 merge；全量 UI 大改；商业/billing；monthly-usage；生产部署；回退 D1–D3                                         |

### 锁定坐标

```text
WORKTREE=/Users/daniel/AI项目/openbot-convergence
BRANCH=convergence/2026-07-20
LOCKED_BASE=85eee3e7b987b14b3f83301e3f200b3e1d797cc6
TSGO_CEILING=77
BUILD_GATE=pnpm build
```

### Step 0 — 消毒 + 回归

```bash
cd "$WORKTREE"
git status -sb
git restore --staged . 2>/dev/null; git restore . 2>/dev/null
git clean -fdn | head -40
pnpm build   # must be 0
pnpm exec vitest run src/gateway/tenant-context.test.ts --pool=forks   # D2 29 不红
```

---

## 硬禁令

1. 只在 `$WORKTREE` 改代码。
2. 不整枝 cherry-pick 共享 tip。
3. 热文件最小 diff + 单独 wiring commit。
4. **`pnpm build` = 0**；**tsgo ≤ 77**。
5. **不回退** D2 promote / D1 tenant / D3 history·checkpoint 测试。
6. Trailers：
   ```text
   Task: repository-wide-branch-convergence
   Agent: cursor-convergence-phase-d4
   ```
7. 不 push、不生产 cutover。
8. 安全：`SECURITY.md`；导入路径勿引入路径穿越。

---

## D4 范围：知识导入矩阵（必须自动化）

选定 **一种** 主路径（推荐 **localFolder / 本地文件夹 → KB → 绑定 → 检索/Agent 可见**，与 Day0 golden 叙述一致）。在报告 `scope.md` 写死 kind。

| 用例 ID | 名称                | 必须                                           |
| ------- | ------------------- | ---------------------------------------------- |
| **K1**  | **成功路径**        | 导入 → 索引/物化（或测试替身）→ 检索/消费可见  |
| **K2**  | **越权拒绝**        | 无权限主体失败且无跨租户数据泄漏               |
| **K3**  | **Tenant A/B 隔离** | A 数据对 B 不可见（multitenant 测或等价 mock） |
| **K4**  | **重复同步幂等**    | 二次同步不产生重复权威对象（或可接受去重断言） |
| **K5**  | **失败恢复**        | 中途失败可重试/可诊断（错误码或状态机）        |
| **K6**  | **重启持久化**      | 重启后（reload store / 重读磁盘）状态仍在      |

> 执行计划要求六项自动化，**不是**「演示一条 happy path 即可」。

### 实现策略

1. **优先** 让 shared 上已有 `local-folder-import.golden-path.test.ts` 在 worktree **跑绿**（移植依赖模块的最小集）。
2. 若 locked base 缺整条栈：用 **test doubles** 测契约 + 1 条真实集成；但 K2–K6 不得省略。
3. 扩展 `feature-manifests/knowledge_import.yaml` 填真实 `rpc_methods` / `tests` / `tenant_scope`。
4. 不做全 UI kinds 矩阵（file/url/git/…）— **一种 kind 做深** 即可标 D4 PASS；其余 DEFER 写入 handoff。

### 排除

- 全渠道 connector 产品化
- CogniWeave 全引擎重写
- 清 77 tsgo 噪声
- RC0 镜像推送

---

## 验证门禁

| 级别     | 要求                                                        |
| -------- | ----------------------------------------------------------- |
| **P0**   | K1–K6 均有自动化测试且绿（可同文件多 case）                 |
| **P0**   | D2 `tenant-context` 29 仍绿；D3 history/checkpoint 抽测不红 |
| **P1**   | `pnpm build` = 0                                            |
| **P1**   | tsgo ≤ 77                                                   |
| **契约** | manifest 更新诚实                                           |

```bash
cd "$WORKTREE"
# 知识矩阵（按你落地的测试路径调整）
pnpm exec vitest run \
  src/gateway/knowledge/sources/local-folder-import.golden-path.test.ts \
  # + 你的 K2–K6 文件 \
  --pool=forks
pnpm exec vitest run src/gateway/tenant-context.test.ts --pool=forks
pnpm build
pnpm tsgo 2>&1 | tee /tmp/tsgo-d4.txt
grep -c 'error TS' /tmp/tsgo-d4.txt
```

---

## 交付物

```text
docs/design/convergence-evidence/2026-07-20/phase-d4/
  scope.md                 # 选定 UI kind / RPC 列表
  matrix.md                # K1–K6 状态 + 测试名
  tests-run.md
  build-tsgo.md            # before=77
  transplant-log.md
  regression-d1-d3.md      # auth/session/history 抽测
  PHASE-D4-HANDOFF.md      # → RC0 准备 / 是否可开 staging 清单
```

更新：`feature-manifests/knowledge_import.yaml`  
可选：ledger 中 knowledge 行 `status=landed`（仅本波真实项）。

---

## 步骤

0. 消毒 + build + D2 回归
1. 盘点 worktree 是否已有 knowledge 模块；缺口从共享树最小移植
2. 实现/接通一条导入路径
3. 写满 K1–K6 测试
4. build + tsgo
5. 报告 + commit
6. 中文汇报

### HANDOFF 必须含

1. Final HEAD
2. K1–K6 矩阵与测试命令
3. tsgo 77 → N；build exit
4. **RC0 准备是否 YES_WITH_GATES**（数据 dry-run / 客户端协议门禁可能仍缺）
5. 未覆盖的 import kinds
6. 无 monthly-usage 混入声明

---

## 验收标准（D4 PASS）

- [ ] K1–K6 自动化全绿
- [ ] D1–D3 关键回归不红
- [ ] build 0；tsgo ≤ 77
- [ ] phase-d4 报告齐全；trailers 正确
- [ ] 未共享树 merge；未推生产

**FAIL：** 只有 happy path；或缺 K2/K3；或 tsgo 上升；或回退 session heal。

---

## 一键开场

```text
请严格按 brief 执行 Phase D4 知识导入黄金路径矩阵：

.kiro/specs/repository-wide-branch-convergence/CURSOR-PHASE-D4-KNOWLEDGE-BRIEF.md

工作目录：/Users/daniel/AI项目/openbot-convergence
分支：convergence/2026-07-20

开始前清理无关 WIP。先读 phase-d3/PHASE-D3-HANDOFF.md。
保持 pnpm build 绿；tsgo ≤ 77；不回退 D1–D3。
必须自动化 K1–K6（成功/越权/A-B/幂等/失败恢复/重启持久化），推荐 localFolder 深做一种 kind。

Task: repository-wide-branch-convergence
Agent: cursor-convergence-phase-d4
```

---

## 预告（D4 之后）

- **RC0 准备包**：数据 upgrade dry-run、客户端协议门禁、release record 草稿
- 仍 **禁止** 无二次确认的生产 cutover
