# OpenBot 知识宇宙 M3 待审核报告

Date: 2026-06-05

权威方案：`docs/design/openbot-knowledge-universe-final-task-plan-2026-06-05.md`（v5 定稿）

## 1. 阶段目标

M3：智能关系运行时 + 详情增强 + 最近访问 + 推荐（KU-10 ~ KU-14A）

- 知识对象模型升级（`relationshipSummary` 由运行时回填）
- Intelligent Relationship Runtime（Builder / Score / Conflict / Recommendation）
- 知识对象详情页分组关联展示
- 最近访问记录与列表
- 运行时驱动的 `knowledge.recommendations` 与分组 `knowledge.related`

## 2. 交付清单

### 2.1 Gateway Runtime

| 文件                                                              | 任务                                                                          |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/gateway/knowledge/runtime/types.ts`                          | 运行时类型                                                                    |
| `src/gateway/knowledge/runtime/relationship-builder.ts`           | KU-11-1 候选边构建                                                            |
| `src/gateway/knowledge/runtime/relationship-score-engine.ts`      | KU-11-2 评分                                                                  |
| `src/gateway/knowledge/runtime/relationship-conflict-detector.ts` | KU-11-3 冲突检测                                                              |
| `src/gateway/knowledge/runtime/relationship-recommendation.ts`    | KU-11-4 / KU-14 推荐                                                          |
| `src/gateway/knowledge/runtime/relationship-runtime.ts`           | KU-11 主编排                                                                  |
| `src/gateway/knowledge/runtime/related-groups.ts`                 | KU-14A 分组关联                                                               |
| `src/gateway/knowledge/recent-visits.ts`                          | KU-13 最近访问 store                                                          |
| `src/gateway/knowledge/graph-builder.ts`                          | 委托 runtime 构图 + enriched objects                                          |
| `src/gateway/knowledge/empty-bundle.ts`                           | 生产 bundle 使用 runtime 对象/图                                              |
| `src/gateway/knowledge/source-bundle.ts`                          | mock 路径同步 runtime                                                         |
| `src/gateway/knowledge/router.ts`                                 | related 分组、runtime 推荐、recent                                            |
| `src/gateway/knowledge/types.ts`                                  | `KnowledgeRecentVisit` / `KnowledgeRecommendation` / `KnowledgeRelatedGroups` |
| `src/gateway/server-methods/knowledge.ts`                         | 新增 `knowledge.recent` / `knowledge.recent.record`                           |

**新增/升级 RPC：**

- `knowledge.recommendations` — 返回 `{ object, score, reason }[]`，支持 `focusObjectId`
- `knowledge.related` — 返回分组：`knowledge` / `dataCapabilities` / `agents` / `owners` / `conflicts`
- `knowledge.recent` — 最近访问列表
- `knowledge.recent.record` — 记录访问并返回更新列表

### 2.2 UI

| 文件                                                    | 说明                                          |
| ------------------------------------------------------- | --------------------------------------------- |
| `ui/src/ui/views/knowledge-universe-detail-preview.ts`  | KU-12 分组关联 + 冲突计数                     |
| `ui/src/ui/views/knowledge-universe-recent-visits.ts`   | KU-13 最近访问区                              |
| `ui/src/ui/views/knowledge-universe-recommendations.ts` | KU-14 推荐区（含 reason）                     |
| `ui/src/ui/views/knowledge-universe-page.ts`            | 接入最近访问/推荐/分组详情                    |
| `ui/src/ui/capability/knowledge-universe/facade.ts`     | 选中对象时加载 related + record recent        |
| `ui/src/ui/controllers/knowledge-universe.ts`           | `recentVisits` / `relatedGroups` / 推荐项状态 |
| `ui/src/styles/workbench.css`                           | 最近访问/推荐/详情分组样式                    |
| `ui/src/i18n/locales/zh-CN.ts` / `en.ts`                | 新文案键                                      |

### 2.3 测试

| 文件                                                                           | 覆盖                         |
| ------------------------------------------------------------------------------ | ---------------------------- |
| `src/gateway/knowledge/runtime/relationship-runtime.test.ts`                   | 构图 + summary + 推荐        |
| `src/gateway/knowledge/runtime/related-groups.test.ts`                         | 分组关联                     |
| `src/gateway/knowledge/recent-visits.test.ts`                                  | 访问记录去重                 |
| `src/gateway/knowledge/graph-builder.test.ts`                                  | 经 runtime 的企业→数据能力边 |
| `src/gateway/server-methods/knowledge.test.ts`                                 | 推荐/related/recent RPC      |
| `ui/src/ui/ports/employee/views/workbench-stage-module.knowledge.node.test.ts` | 页面仍渲染                   |

## 3. M3 验收对照

| 验收项                                        | 状态 | 证据                                                           |
| --------------------------------------------- | ---- | -------------------------------------------------------------- |
| KU-10 对象 relationshipSummary                | ✅   | `relationship-runtime.ts` `summarizeObjectRelationships`       |
| KU-11 Intelligent Relationship Runtime        | ✅   | `runtime/*` + `graph-builder.ts` 委托                          |
| KU-12 详情页增强（分组关联）                  | ✅   | `knowledge-universe-detail-preview.ts`                         |
| KU-13 最近访问                                | ✅   | `recent-visits.ts` + `knowledge.recent*` + UI panel            |
| KU-14 运行时推荐                              | ✅   | `relationship-recommendation.ts` + 推荐区                      |
| KU-14A knowledge.related 分组                 | ✅   | `related-groups.ts` + router/handler                           |
| 任意对象可发现相关知识/数据能力/机器人/负责人 | ✅   | related 分组 + runtime 候选边（含 agent/owner）                |
| 生产路径不回退 mock                           | ✅   | `empty-bundle.ts` / `source-bundle.ts` 仅 `preferMock` 用 demo |

## 4. 风险与尾差

| 项                         | 说明                                          |
| -------------------------- | --------------------------------------------- |
| 最近访问为进程内内存 store | 重启 gateway 会清空；M4+ 可落盘到用户 profile |
| 冲突检测为启发式           | 基于标签/摘要关键词，非 LLM 裁决              |
| 空图时推荐可为空           | 符合运行时语义；单对象环境无邻居时不强行填充  |

## 5. 审核结论

**建议：通过 M3，可进入 M4（Agent 消费层 / 任务上下文注入）。**

定向测试：15/15 通过（`vitest run` 上述 M3 相关文件）。
