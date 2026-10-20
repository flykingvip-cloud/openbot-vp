# OpenBot 知识宇宙 M1 待审核报告

Date: 2026-06-05

权威方案：`docs/design/openbot-knowledge-universe-final-task-plan-2026-06-05.md`（v5 定稿）

## 1. 阶段目标

M1：基础页面与关系网络首页（KU-01 ~ KU-06、KU-05-1~8、KU-10A、KU-10A-1~2）

本阶段使用 Gateway mock 数据完成员工端可访问首页，首页以智能关系网络为核心，不退化为 Tab + 列表。

## 2. 交付清单

### 2.1 Gateway（KU-01 后端骨架）

| 文件                                      | 说明                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/gateway/knowledge/types.ts`          | 领域类型                                                                                        |
| `src/gateway/knowledge/mock-graph.ts`     | 默认图与对象 mock                                                                               |
| `src/gateway/knowledge/router.ts`         | search / relationships / object / recommendations / related / resolve / context / agent-profile |
| `src/gateway/server-methods/knowledge.ts` | RPC handlers                                                                                    |
| `src/gateway/server-methods.ts`           | handler 注册                                                                                    |
| `src/gateway/server-methods-list.ts`      | 方法列表                                                                                        |
| `src/gateway/method-scopes.ts`            | READ_SCOPE                                                                                      |

已注册 RPC：`knowledge.search`、`knowledge.object`、`knowledge.recommendations`、`knowledge.relationships`、`knowledge.related`、`knowledge.resolve`、`knowledge.context`、`knowledge.agent-profile`

### 2.2 UI Capability（KU-01、KU-10A-1/2）

| 文件                                                          | 说明                                           |
| ------------------------------------------------------------- | ---------------------------------------------- |
| `ui/src/ui/capability/knowledge-universe/types.ts`            | 前端领域类型                                   |
| `ui/src/ui/capability/knowledge-universe/endpoints.ts`        | 快照类型                                       |
| `ui/src/ui/capability/knowledge-universe/gateway-client.ts`   | typed RPC client（无 client 时 fallback mock） |
| `ui/src/ui/capability/knowledge-universe/mock-backend.ts`     | 本地 mock                                      |
| `ui/src/ui/capability/knowledge-universe/facade.ts`           | `loadKnowledgeUniverseHomeSnapshot()`          |
| `ui/src/ui/capability/knowledge-universe/graph-layout.ts`     | 径向布局（KU-10A-1）                           |
| `ui/src/ui/capability/knowledge-universe/graph-view-model.ts` | 图适配（KU-10A-2）                             |
| `ui/src/ui/capability/knowledge-universe/index.ts`            | 导出入口                                       |

### 2.3 Controllers & Views（KU-05、KU-05-1~8）

| 文件                                                   | 说明                          |
| ------------------------------------------------------ | ----------------------------- |
| `ui/src/ui/controllers/knowledge-universe.ts`          | 加载、搜索、选中、缩放平移    |
| `ui/src/ui/views/knowledge-universe-page.ts`           | 首页容器                      |
| `ui/src/ui/views/knowledge-universe-source-cards.ts`   | 三类来源卡片（KU-05-2）       |
| `ui/src/ui/views/knowledge-universe-graph-canvas.ts`   | 关系网络画布（KU-05-3/6/7/8） |
| `ui/src/ui/views/knowledge-universe-detail-preview.ts` | 详情预览（KU-05-4）           |

### 2.4 Workbench 接入（KU-02/03/04/06）

| 文件                                                          | 变更                                            |
| ------------------------------------------------------------- | ----------------------------------------------- |
| `ui/src/ui/ports/employee/views/home-page-contracts.ts`       | `WorkbenchKnowledgeSurface` 强类型 contract     |
| `ui/src/ui/ports/employee/views/workbench-stage-contracts.ts` | knowledge contract 类型升级                     |
| `ui/src/ui/ports/employee/views/workbench-stage-module.ts`    | 替换占位页，渲染真实首页（KU-06）               |
| `ui/src/ui/ports/employee/views/workbench-types.ts`           | `knowledgeSurface` props                        |
| `ui/src/ui/ports/employee/views/workbench.ts`                 | surfaceRuntime 注入 knowledge                   |
| `ui/src/ui/ports/employee/render-model.ts`                    | 装配 knowledge surface 与 actions               |
| `ui/src/ui/ports/employee/render-model-shell-actions.ts`      | 切换 knowledge 模块时触发加载                   |
| `ui/src/ui/app-view-state-shell-slices.ts`                    | 状态切片                                        |
| `ui/src/ui/app.ts`                                            | `@state()` 字段与 `loadKnowledgeUniverseHome()` |
| `ui/src/ui/app-port-state.ts`                                 | port 字段透传                                   |

### 2.5 样式与 i18n

| 文件                           | 说明                         |
| ------------------------------ | ---------------------------- |
| `ui/src/styles/workbench.css`  | `.knowledge-universe-*` 样式 |
| `ui/src/i18n/locales/zh-CN.ts` | 中文文案                     |
| `ui/src/i18n/locales/en.ts`    | 英文文案                     |

### 2.6 测试

| 文件                                                                           | 覆盖                  |
| ------------------------------------------------------------------------------ | --------------------- |
| `src/gateway/server-methods/knowledge.test.ts`                                 | Gateway RPC mock      |
| `ui/src/ui/capability/knowledge-universe/graph-layout.node.test.ts`            | 布局                  |
| `ui/src/ui/capability/knowledge-universe/graph-view-model.node.test.ts`        | 图适配与邻居高亮      |
| `ui/src/ui/ports/employee/views/workbench-stage-module.knowledge.node.test.ts` | 非占位页渲染          |
| `ui/src/ui/ports/employee/render-model.node.test.ts`                           | surface contract 装配 |
| `ui/src/ui/ports/employee/render-model-shell-actions.node.test.ts`             | 模块切换加载          |

## 3. M1 验收对照（定稿 §12）

| 验收项                                                 | 状态 | 证据                                                                                |
| ------------------------------------------------------ | ---- | ----------------------------------------------------------------------------------- |
| 知识宇宙模块可访问                                     | ✅   | 导航 `knowledge` 已存在；`workbench-stage-module.ts` 渲染 `knowledge-universe-page` |
| 首页核心是智能关系网络                                 | ✅   | 首页主区为 `knowledge-universe-graph-canvas`，非目录/列表                           |
| 支持搜索知识、企业知识、数据能力、项目、机器人、负责人 | ✅   | 搜索框 + `knowledge.search` / `knowledge.relationships` mock 过滤                   |
| 点击节点后可显示详情预览                               | ✅   | `onSelectNode` → `knowledge.object` → `knowledge-universe-detail-preview`           |
| 不允许首页退化为 Tab + 列表                            | ✅   | 无 Tab 切换与列表主结构；仅来源摘要卡片 + 关系网络 + 详情侧栏                       |

## 4. 已知限制（M1 范围内可接受）

- 数据来源为 Gateway mock，非真实个人/企业/数据能力投影（M2 任务 KU-07~09）。
- `src/gateway/protocol/schema/knowledge.ts` 尚未注册，handlers 使用手动 param 解析。
- 关系运行时独立层（`src/gateway/knowledge/relationships/*`）与 Resolve Engine 属 M3，本阶段由 `router.ts` + mock 图承担。
- 数据能力独立卡片组件 `knowledge-universe-data-capability-card.ts` 未拆分（M2 再补）。

## 5. 专家建议关注点

1. 首页信息层级是否符合 v5 定稿（搜索 → 来源卡片 → 关系网络 → 详情预览）。
2. 员工术语白名单：文案是否避免「知识库后台」「目录树」等表述。
3. mock 图节点集是否足够代表「我 / 三类来源 / 项目 / 机器人 / 负责人」关系语义。
4. 切换 knowledge 模块时的加载时机与错误展示是否满足可用性预期。

## 6. 专家验收结论（2026-06-05）

**结论：有保留通过** — 可进入 M2；进入前需完成两项小修正（已在本节 §7 落地）。

| 维度                                       | 结论                             |
| ------------------------------------------ | -------------------------------- |
| 关系网络首页、模块接入、基础交互、定向测试 | 通过                             |
| 搜索体验闭环                               | 修正前：仅驱动图过滤，无可见反馈 |
| 详情预览语义                               | 修正前：暴露内部 `node.kind`     |

## 7. M1 保留项修正（已进入代码）

### 7.1 搜索反馈区

- 新增 `ui/src/ui/views/knowledge-universe-search-feedback.ts`
- `WorkbenchKnowledgeSurface` 增加 `searchResults`
- 首页在搜索框下方展示：命中数量、关系网络节点数、前 5 条可点击命中预览
- 测试：`ui/src/ui/views/knowledge-universe-search-feedback.node.test.ts`

### 7.2 节点类型员工文案映射

- 新增 `ui/src/ui/capability/knowledge-universe/node-kind-labels.ts`
- 详情预览邻居列表使用「知识 / 数据能力 / 机器人 / 项目 / 负责人」
- 测试：`ui/src/ui/capability/knowledge-universe/node-kind-labels.node.test.ts`

## 8. 记录风险（非 M1 阻塞）

- **深链/记忆模块首载**：当前 knowledge 数据加载依赖模块切换（`render-model-shell-actions.ts`）；若后续支持刷新后直达 knowledge 或记忆上次模块，需补首载逻辑。
- **Protocol schema**：`knowledge.*` 独立 schema 文件延后；当前 handlers 手动解析 params，定向测试已通过。

## 9. 下一步

**M2 启动**：KU-07 我的知识、KU-08 企业知识、KU-09 数据能力空间（真实数据接入，替换 mock）。
