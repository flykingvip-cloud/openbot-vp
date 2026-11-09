# 执行权威收口 T0 基线登记（2026-11-09）

- 日期：2026-11-09（Asia/Shanghai）
- 性质：开工登记与路径归属；不是已完成声明，不授权 push / 合入 / 生产部署。
- 状态：**实施中 / 待验收**（批次 A：T0 登记完成，下一步 T1 权威与消费者盘点）
- 方案依据：`execution-authority-closure-plan-2026-11-09.md`（冲突时以方案「先核准后迁移」为准；盘点 MD 不宜原样作实施指令）

## 1. 开工 SHA 与分支

| 项 | 值 |
|---|---|
| 开工 SHA | `efdb1b98d83e096a31e251095080de954f5883ec` |
| 说明 | 最新 `origin/main` tip（含 #249 同事计划等） |
| 分支 | `codex/openbot/runtime-authority-closure`（track `origin/main`） |
| 工作树 | `/Users/daniel/.codex/worktrees/runtime-authority-closure/openbot` |
| 与 origin/main | 同步：ahead 0 / behind 0 |
| 业务源码 | 本回合未改 |
| 暂存区 | 空；仅 specs 未跟踪文档 |

## 2. 已核准 PR（禁止从旧基线重做）

| PR | 标题 | 状态 | merge commit | 结论 |
|---|---|---|---|---|
| #250 | Runtime: converge executor mainline and retire redundant control paths | **MERGED** | `cf364161a0b391d8bfdc0f3fcb956720c97d5192` | squash 合入 main；头曾为 `e3fef11c8…`；包1主链接管已在 main，**禁止从旧 tip 重做** |
| #252 | Runtime: converge executor execution and versioned observation | **MERGED** | `45c6c227c51ec42baccf90527e9cf7663f36db77` | 合入 main；观测/执行残差已在 main，接续不重做 |
| 其他 open runtime PR | — | 无 | — | 仅 dependabot #236/#237；不挡本批开工 |

方案原文抽核基线曾为 `e3fef11c8b40a8ec0ace10a29e2fd82e07c9be66`；实际开工已刷新到含 #250/#252 的 main tip `efdb1b98d…`。

## 3. 负责人与路径归属

| 角色 | 身份 | 权限边界 |
|---|---|---|
| 批次 A 实施 | 执行器迁移 / grok-bot · batch-A implementer | 仅写本批登记/盘点交付物；小步绿色切片待用户确认后再提交 |
| 独立验收 | 方案编制方 **codex-runtime-manager**（及用户独立验收） | 固定 SHA 验收；本登记不转移验收权 |
| Owner / 合入 | **codex-runtime-manager** | Owner 合入权不因本登记转移 |
| 他人 WIP | observability / `.loom` 等 | **不改**；不覆盖、不暂存他人改动 |

### 本批路径归属（specs）

- `.kiro/specs/agent-runtime-convergence/execution-authority-*.md`
- `component-migration-matrix.md`、`rule-catalog-coverage.md`、`retirement-disposition.md`（后续批次产出）
- 方案与盘点输入：`execution-authority-closure-plan-2026-11-09.md`、`collab-policy-state-migration-boundary-2026-11-09.md`、`individual-policy-state-closure-slices-2026-11-09.md`
- 本文件：`execution-authority-t0-baseline-2026-11-09.md`

## 4. 输入保全与指纹（sha256）

| 文件 | sha256 |
|---|---|
| `execution-authority-closure-plan-2026-11-09.md` | `3c727a062e703de31fb52b8e1b834420ab08041b0f99edc607fe0c8595950ba2` |
| `collab-policy-state-migration-boundary-2026-11-09.md` | `52517a80f939fcbae9010c0e93e049350cbf516f2f3cd7bd4d8016a078aa2c3c` |
| `individual-policy-state-closure-slices-2026-11-09.md` | `ee2b19900144b8210dacfa41b2715256ce0b85977eb9f1bedf736b040a9df5ba` |

三者已在本实施分支工作树 specs 目录（未暂存、未提交）。方案原文与用户附件字节一致（同指纹）。

## 5. 推荐流程约束（用户 t39u）

1. 从最新 origin/main 建专用树/分支并登记负责人与路径 — **本回合完成登记**。
2. 分批实施；完整、测试通过的切片单独提交 — 后续；本回合不提交。
3. 推送并建 Draft PR（组件表、理由、测试证据）— **本回合不推**。
4. 针对固定提交 SHA 独立验收；修复后重核受影响项。
5. 验收及仓库门禁通过后经 PR 合入 main。
6. 干净最新 main 统一运行验收后，再按部署授权上线。

避免重复施工：已合入 PR 的实现接续，不从旧基线再做一遍。

## 6. 批次 A 门禁与下一步

| 项 | 内容 |
|---|---|
| 批次 A 范围 | T0—T2（权威/消费者盘点 + 规则目录） |
| 独立验收放行 | T0—T2 评审通过后才开批次 B（行为迁移） |
| T0 本回合 | 基线、PR 核准、负责人、路径、输入指纹已写入 |
| 下一步 | **T1** 权威和消费者盘点（行为ID 表；核实 classifyTurnRelation / shouldTaskParkAbortInFlight 等现役事实） |
| 非目标 | 本回合不改业务源码；不 push；不部署；不用 scripts/committer（待「现在提交」或与 T1 一并确认） |

## 7. 工作树快照（登记时）

```
HEAD     efdb1b98d83e096a31e251095080de954f5883ec
branch   codex/openbot/runtime-authority-closure
dirty    仅 specs 下未跟踪 MD（方案/盘点/本登记）；无已暂存；无业务源码 diff
```

— 执行器迁移 / grok-bot（batch-A implementer）
