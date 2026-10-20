# 知识空间统一化 — 验收报告（W9）

> 日期：2026-06-29  
> 关联：`openbot-knowledge-space-unification-acceptance-sop-2026-06-29.md`  
> 迁移/开关：`openbot-knowledge-space-unification-migration-flags-2026-06-29.md`

## 0. 验收基准冻结（强制）

签字验收前必须记录:

1. **Git commit SHA**（交付分支上的固定 commit，非“当前 HEAD 大概”）。
2. 该 SHA 上 `node scripts/test-knowledge-space-unification.mjs` **一次性全绿**的终端输出归档。
3. 若同一 SHA 上间隔重跑出现 pass/fail 翻转，或 dirty 树上他人并发编辑导致 import/符号缺失，**不得签字** —— 先冻结 worktree / 改用 CI 绿 build 再验。

### 冻结记录模板（签字前填写）

```text
ACCEPTANCE_SHA=<full-40-char-git-sha>
ACCEPTANCE_BRANCH=<branch-name>
ACCEPTANCE_DATE=YYYY-MM-DD
ACCEPTANCE_GATE_CMD=OPENBOT_TEST_PROFILE=low node scripts/test-knowledge-space-unification.mjs
ACCEPTANCE_GATE_RESULT=<N files passed, M tests passed>
ACCEPTANCE_GATE_LOG=<path-to-archived-terminal-output.txt>
ACCEPTANCE_SIGNER=<name/role>
```

示例:

```text
ACCEPTANCE_SHA=abc123def456...
ACCEPTANCE_BRANCH=main
ACCEPTANCE_DATE=2026-06-29
ACCEPTANCE_GATE_CMD=OPENBOT_TEST_PROFILE=low node scripts/test-knowledge-space-unification.mjs
ACCEPTANCE_GATE_RESULT=15 test files passed, 146 tests passed
ACCEPTANCE_GATE_LOG=artifacts/knowledge-space-unification-gate-2026-06-29.txt
ACCEPTANCE_SIGNER=Daniel / 产品负责人
```

> 过程性示例：多 agent 共享工作树曾出现 `canonicalizeTenantId is not defined`、`bindKnowledgeSource is not defined` 等瞬时失败；根因为并发编辑导致模块 import 不完整，**非最终设计缺陷**。验收必须以冻结 SHA + 稳定重跑为准。

## 1. 自动化测试入口

```bash
OPENBOT_TEST_PROFILE=low node scripts/test-knowledge-space-unification.mjs
```

等价于对下列 15 个测试文件执行 `pnpm test`。

## 2. 必测项 → 测试映射

| 类别           | 场景                                                    | 证据文件                                                                                                             |
| -------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 权限           | owner / admin / editor / viewer                         | `src/gateway/knowledge/knowledge-base-permissions.test.ts`                                                           |
| 权限           | editor attach / viewer 拒绝                             | `src/gateway/server-methods/knowledge-base-rpc.test.ts`                                                              |
| 导入           | collect / upload / collectWeb / importDataset + warning | `src/gateway/server-methods/knowledge-personal-ingest-rpc.test.ts`                                                   |
| 导入           | deliverables.attach                                     | `src/gateway/server-methods/knowledge-deliverables-attach-rpc.test.ts`                                               |
| active binding | visibility 继承 + legacy visibility warning             | `knowledge-personal-ingest-rpc.test.ts`                                                                              |
| active binding | passive kind 拒绝                                       | `knowledge-personal-ingest-rpc.test.ts`                                                                              |
| 列表           | base.list + 细粒度 list 回归                            | `knowledge-base-rpc.test.ts`                                                                                         |
| 列表           | 前端三段分组                                            | `ui/.../knowledge-universe-library-grouping.node.test.ts`                                                            |
| 供给           | 同源化                                                  | `ui/.../knowledge-universe-supply-spaces.node.test.ts`                                                               |
| 导入漏斗       | 必须先选空间                                            | `ui/.../knowledge-universe-space-ingest.node.test.ts`                                                                |
| 聚合           | sources.list + plane 过滤 UI                            | `knowledge-base-rpc.test.ts`, `knowledge-base-sources-list.test.ts`, `workbench-stage-module.knowledge.node.test.ts` |
| 开关           | warning 模式 / 强拒绝                                   | `knowledge-compat.test.ts`, `knowledge-personal-ingest-rpc.test.ts`                                                  |
| 迁移           | binding visibility 回填 + stats                         | `knowledge-source-binding-visibility-backfill.test.ts`, `knowledge-base-rpc.test.ts`（`knowledge.compat.status`）    |

### F2 硬门禁用例（与 SOP §F2.1 对齐）

| 行为                 | 用例                                                                                                                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 三段分组             | `library-grouping.node.test.ts` → `partitions sidebar spaces into pinned, favorites, and visibility groups`                                                                                                                                                |
| 导入选空间           | `space-ingest.node.test.ts` → `redirects to library create when ingest is opened without a selected space`                                                                                                                                                 |
| 供给同源             | `supply-spaces.node.test.ts` → `renders personal supply spaces from knowledgeBases instead of a parallel pool`                                                                                                                                             |
| passive/active       | `workbench-stage-module.knowledge.node.test.ts` → `renders aggregated source plane and kind columns in the 来源 table`                                                                                                                                     |
| 创建入口唯一化       | `knowledge-universe-create-entry.node.test.ts` → `routes formal create through the libraryCreate page tab`；`workbench-stage-module.knowledge.node.test.ts` → `routes the formal create action through the libraryCreate page tab when no libraries exist` |
| 空间内统一导入（U4） | `knowledge-universe-space-import.node.test.ts` → `opens the unified import drawer instead of the legacy upload form`                                                                                                                                       |
| 主动源 bind（U4）    | `knowledge-universe-space-import.node.test.ts` → `builds bindSource requests with knowledgeBaseId and without visibility`                                                                                                                                  |
| viewer 只读（U4）    | `knowledge-universe-space-import.node.test.ts` → `disables write access for viewer members in shared spaces`                                                                                                                                               |

## 3. 回归项（F3）

| RPC / 能力                            | 覆盖位置                                                   |
| ------------------------------------- | ---------------------------------------------------------- |
| `knowledge.base.search`               | `knowledge-base-rpc.test.ts`（list/get/attach 同文件集成） |
| `knowledge.base.documents.list`       | `knowledge-base-rpc.test.ts`                               |
| `knowledge.base.web.list`             | `knowledge-base-rpc.test.ts`                               |
| `knowledge.base.datasets.list`        | `knowledge-base-rpc.test.ts`                               |
| `knowledge.base.agent-knowledge.list` | `knowledge-base-rpc.test.ts`                               |
| `knowledge.deliverables.attach`       | `knowledge-deliverables-attach-rpc.test.ts`                |

## 4. 联调录屏

自动化测试不能替代真实 UI 演示。请按  
`openbot-knowledge-space-unification-demo-script-2026-06-29.md`  
逐步操作并录屏，覆盖 SOP 中 A–E 节与一票否决项反证。

## 5. 交付材料清单

| 材料         | 路径                                                                    | 状态           |
| ------------ | ----------------------------------------------------------------------- | -------------- |
| 设计稿       | `openbot-knowledge-space-unification-implementation-plan-2026-06-29.md` | 已有           |
| 任务拆解     | `openbot-knowledge-space-unification-work-breakdown-2026-06-29.md`      | 已有           |
| 迁移说明     | `openbot-knowledge-space-unification-migration-flags-2026-06-29.md`     | W8 完成        |
| 功能开关说明 | 同上 §4                                                                 | W8 完成        |
| 已知问题     | `openbot-knowledge-space-unification-known-issues-2026-06-29.md`        | 本文档同期     |
| 自动化测试   | `scripts/test-knowledge-space-unification.mjs`                          | 本文档         |
| 联调录屏     | 由操作者归档                                                            | **待人工提交** |

## 6. 验收结论（模板）

### 6.1 W0–W9 主批次（2026-06-29）

```text
知识空间统一化项目验收结论:

1. 空间类型主轴统一: 通过
2. 写权限统一: 通过
3. 导入漏斗统一: 通过
4. source.bind 契约收口: 通过
5. 空间列表三段分组: 通过
6. 供给页同源化: 通过
7. 迁移与兼容关闭路径: 通过（惰性回填 + 开关 + 统计已落地）
8. 自动化测试与联调证据: 自动化通过；联调录屏待提交

总体结论:
- 是否允许宣布本轮统一化完成: 是（待录屏归档后可对外结项）
- 是否允许第三方团队结项: 是（同上）
- 是否存在阻断上线问题: 否
```

### 6.2 U4 跟进 · 分三批交付（专家评审 2026-06-29 · 二次独立复核 2026-06-29）

| 交付       | 范围                        | 结论        | 备注                                                               |
| ---------- | --------------------------- | ----------- | ------------------------------------------------------------------ |
| **交付一** | U4 空间内统一导入           | **✅ 通过** | 源码 + 门禁绿；§5.3 主动源为**过渡** endpoint 表单                 |
| **交付二** | U5+U7 顶部入口 + U6 首页 IA | **✅ 通过** | **专家二次独立复核 ✅**；146 tests 绿；待 land SHA                 |
| **交付三** | U8 主动源 ↔ 企业连接器      | **❌ 未做** | known-issues **§U8 + §8 已写**；个人空间 **允许 active**（分路径） |

```text
二次验收纪要（2026-06-29）:

交付二:
- 专家独立复核与 known-issues「专家评审 ✅」一致: 是
- U5+U6+U7 源码 + 专门测试 + 门禁 146 绿: 是
- 已 land 冻结 SHA: 否（HEAD c001d2c2c7 之后未提交）

交付三 U8:
- §U8 规格已写入 known-issues: 是（取代 U4 §5.3）
- 个人空间是否允许主动数据源: 已裁定 — 允许（private 无 tenant → HTTP REST；有 tenant/team → 连接器）
- 实现状态: 未开始
- W13 录屏: 建议 W14 完成后
```

## 7. 执行记录

最近一次本地执行（2026-06-29，创建入口唯一化补全后）：

```bash
OPENBOT_TEST_PROFILE=low node scripts/test-knowledge-space-unification.mjs
```

结果：**15 test files passed，146 tests passed**（约 6s）。

> 签字前请将 `ACCEPTANCE_SHA` 设为当时 `git rev-parse HEAD` 的输出，并归档本次终端日志。
