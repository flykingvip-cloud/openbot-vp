# Cursor 任务指令：仓库收敛 Phase RC0-PREP — 发布候选准备包

把下面整段（从「角色与任务」到文末）复制给 **Cursor Agent**。  
本 brief：`.kiro/specs/repository-wide-branch-convergence/CURSOR-PHASE-RC0-PREP-BRIEF.md`

**前置（已验收）：**

| 阶段     | 状态                                                                  |
| -------- | --------------------------------------------------------------------- |
| Base     | LOCKED `85eee3e7b987b14b3f83301e3f200b3e1d797cc6`                     |
| D0       | build 绿 · tsgo 天花板 **77**                                         |
| D1–D3    | auth tenant · session promote · history/checkpoint                    |
| **D4**   | **PASS** · localFolder K1–K6 · build 0 · tsgo 77                      |
| Worktree | `/Users/daniel/AI项目/openbot-convergence` · `convergence/2026-07-20` |

**必读：**

- `…/phase-d4/PHASE-D4-HANDOFF.md`（`YES_WITH_GATES` → RC0 准备）
- `docs/design/convergence-base-decision-2026-07-20.md`
- `docs/design/repository-convergence-execution-plan-2026-07-20.md` §11–§12（RC0 准入、readyz waiver、数据恢复）
- `…/readyz-waivers/wecom.md`（expires **2026-08-20**）
- `deploy/production/RELEASE_RECORD.md`（共享树只读对照）

---

## 角色与任务

你是 **RC0 准备包** agent：在 **不推生产** 的前提下，完成可复现的 RC0 **证据与清单**，使维护者可决定是否开 staging 灰度。

| 字段         | 值                                                                                     |
| ------------ | -------------------------------------------------------------------------------------- |
| **Task**     | `repository-wide-branch-convergence`                                                   |
| **Agent id** | `cursor-convergence-rc0-prep`                                                          |
| **允许**     | worktree 内文档/清单/脚本化 dry-run 报告；可选 **只读** 构建校验；更新 evidence 目录   |
| **禁止**     | 生产 cutover；改生产机/容器；共享树 merge；功能大包 landing；静默把 wecom 503 当永久绿 |

### 锁定坐标

```text
WORKTREE=/Users/daniel/AI项目/openbot-convergence
BRANCH=convergence/2026-07-20
LOCKED_BASE=85eee3e7b987b14b3f83301e3f200b3e1d797cc6
TSGO_CEILING=77
PROD_CUTOVER=FORBIDDEN   # 本 brief 绝对禁止
```

### Step 0 — 消毒与基线确认

```bash
cd "$WORKTREE"
git status -sb
git restore --staged . 2>/dev/null; git restore . 2>/dev/null
# 丢弃无关 monthly-usage / UI WIP；不要把他人提交当本波交付
git rev-parse HEAD
pnpm build          # must exit 0
# 抽样回归（必须绿）
pnpm exec vitest run \
  src/gateway/tenant-context.test.ts \
  src/gateway/knowledge/sources/local-folder-import.golden-path.test.ts \
  --pool=forks
```

记录 tip SHA 为 **RC0 candidate tip**（= 当前干净、含 D0–D4 的 HEAD；若 HEAD 被无关提交污染，在报告中标出 **建议 tag 的 SHA** = 最后一笔 D4/相关收敛提交，例如 D4 docs `9aceda7349` 或你整理后的 tip）。

**强烈建议：** 在 handoff 给出  
`RECOMMENDED_RC0_TIP=<sha>`  
优先选「D4 完成且无后续无关 org-usage UI」的提交；若必须含后续提交，列出污染文件清单。

---

## 硬禁令

1. **禁止** 任何生产部署、改 `openbot-gateway-rc`、写 RELEASE_RECORD 生产 cutover 段落为「已上线」。
2. 只在 `$WORKTREE` 写 RC0 证据；共享树仅 **只读** 抄生产基线。
3. 不整枝 cherry-pick；不新开功能 wave（D5+ 产品）。
4. `pnpm build` 保持 0；tsgo ≤ 77（记录即可，本波不强制再降）。
5. Trailers：
   ```text
   Task: repository-wide-branch-convergence
   Agent: cursor-convergence-rc0-prep
   ```
6. wecom：只引用既有 waiver；检查是否过期/失败面扩大。
7. 安全：`SECURITY.md`；无公开 PoC。

---

## RC0-PREP 交付范围（必须）

在 worktree 创建：

```text
docs/design/convergence-evidence/2026-07-20/rc0-prep/
  env.md
  candidate-tip.md              # RECOMMENDED_RC0_TIP + 祖先证明 + 污染说明
  regression-pack.md            # D1–D4 关键命令与结果
  build-reproducibility.md      # pnpm build / 与 docker 脚本关系；digest 占位
  data-format-inventory.md      # 数据格式/版本字段清单（tenant/session/KB/memory/billing/connector 线索）
  data-upgrade-dry-run.md       # 在副本或模拟路径的 upgrade 尝试；无生产写
  data-restore-checklist.md     # 可验证恢复步骤（可先 checklist + 本地演练记录）
  client-protocol-gate.md       # Android/iOS/macOS/Control UI：能跑的编译或契约测试；不能则记阻塞
  readyz-waiver-status.md       # wecom waiver 复述：有效期、是否扩大失败面
  feature-inclusion.md          # RC0 包含的 feature ids（D0–D4）与明确排除项
  release-record-DRAFT.md       # 镜像/SHA/测试/waiver/rollback 草稿（非生产签字）
  RC0-PREP-HANDOFF.md           # 维护者 go/no-go 清单
```

### 1) Candidate tip 与血统

- 证明 `LOCKED_BASE` 是 tip 祖先。
- 列出 tip 上 **非收敛任务** 提交（monthly-usage 等），建议维护者 tag 时避开或接受。
- 给出 `git rev-list --count LOCKED_BASE..TIP`。

### 2) 回归包（最低）

必须跑并记录：

| 套件                                          | 期望          |
| --------------------------------------------- | ------------- |
| `tenant-context.test.ts`                      | 29+ 绿        |
| `local-folder-import.golden-path.test.ts`     | 6 绿（K1–K6） |
| D3：`chat.history-d3` + `chat-checkpoints.d3` | 绿            |
| `pnpm build`                                  | 0             |

可选：`pnpm tsgo` 计数 ≤ 77。

### 3) 可复现构建

- 记录 Node/pnpm、`pnpm build` 耗时与成功。
- 对照 `deploy/production` Dockerfile：**说明** 生产镜像命令是否与 `pnpm build` 等价；不等价则写差异表（路径 B 文档）。
- **不要** 强行 `docker push`。若本地能 `docker build` 且环境允许，可记 image id；失败则记阻塞原因。

### 4) 数据门禁（执行计划 §11.1 的可执行子集）

| 项                | 最低交付                                                                |
| ----------------- | ----------------------------------------------------------------------- |
| 格式版本清单      | 扫描代码/配置中的 store version 常量与路径（表格）                      |
| upgrade dry-run   | 对 **临时目录** 或 fixture 跑可得的 migrate/load；**禁止** 写生产数据根 |
| 读兼容            | 说明旧 entry 字段是否被新代码 optional 读取                             |
| restore checklist | 分步：停服务 → 恢复备份 → 启服务 → 抽样验证（可未实操生产）             |
| 不可逆迁移        | 列出若有则 **阻断 RC0 生产** 项                                         |

### 5) 客户端协议门禁（执行计划 §10.6 子集）

在 macOS 上尽力：

| 平台                      | 最低                                                          |
| ------------------------- | ------------------------------------------------------------- |
| Control UI / gateway 契约 | 已有 node 测试或协议类型编译                                  |
| Android                   | `./gradlew` 相关 module compile **或** 记「工具链缺失」+ 风险 |
| iOS/macOS Swift           | `xcodebuild` 抽检 **或** 记阻塞                               |

不能跑通不算自动 FAIL，但必须在 `client-protocol-gate.md` 标 **RISK** 与是否阻断 staging。

### 6) Feature inclusion

列出 RC0 **包含**：

- D0 build fixes
- D1 forged-tenant / scopes
- D2 session promote
- D3 history/checkpoint tests + locks
- D4 localFolder knowledge matrix

**排除** 示例：其它 import kinds、全量移动端 UX、未验收商业包、分支上无关 monthly-usage UI（若 tip 含之，标「污染/可选剥离」）。

### 7) Release record DRAFT

字段对齐生产 RELEASE_RECORD 风格：

- branch / candidate SHA
- image tag **建议名**（如 `openbot:rc-convergence-20260720`）— 未构建则 `pending`
- test summary
- waivers
- rollback → 生产 v69 `85eee3e7…` / `rc-amd64-v69`
- **Sign-off 留空**（维护者）

---

## RC0-PREP-HANDOFF 必须含

1. `RECOMMENDED_RC0_TIP`
2. 回归包绿/红表
3. 数据 / 客户端 RISK 列表
4. **Staging go/no-go 建议**：`GO` / `GO_WITH_GATES` / `NO_GO`
5. **Production go/no-go**：**默认 NO_GO** 除非维护者二次签字（本 agent 不得写 PRODUCTION_GO）
6. 明确未做：生产 cutover、push registry

---

## 验收标准（RC0-PREP PASS）

- [ ] `rc0-prep/` 文件齐全
- [ ] 关键回归命令本波重跑记录为绿
- [ ] `pnpm build` 0；候选 tip 血统清晰
- [ ] 数据与客户端门禁有文档（允许 RISK，不允许空白）
- [ ] wecom waiver 状态正确
- [ ] **无** 生产部署痕迹
- [ ] trailers 正确

**FAIL：** 声称已上线生产；或回归红却标 GO；或 tip 混乱无说明。

---

## 一键开场

```text
请严格按 brief 执行 Phase RC0-PREP（禁止生产 cutover）：

.kiro/specs/repository-wide-branch-convergence/CURSOR-PHASE-RC0-PREP-BRIEF.md

工作目录：/Users/daniel/AI项目/openbot-convergence
分支：convergence/2026-07-20

先读 phase-d4/PHASE-D4-HANDOFF.md 与 convergence-base-decision。
重跑 D2/D4 关键回归 + pnpm build；产出 rc0-prep/ 全套清单与 DRAFT release record。
给出 RECOMMENDED_RC0_TIP 与 staging GO/NO_GO；生产默认 NO_GO。

Task: repository-wide-branch-convergence
Agent: cursor-convergence-rc0-prep
```

---

## 维护者在本波之后

1. 审 `RC0-PREP-HANDOFF.md`
2. 决定是否在 **staging** 部署候选 tip
3. 生产 cutover **仅** 维护者二次确认 + 更新正式 RELEASE_RECORD
