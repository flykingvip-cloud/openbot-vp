# OpenBot 知识宇宙 M2 待审核报告

Date: 2026-06-05

权威方案：`docs/design/openbot-knowledge-universe-final-task-plan-2026-06-05.md`（v5 定稿）

## 1. 阶段目标

M2：三类知识源接入（KU-07、KU-08、KU-09、KU-09-1~3）

- 我的知识：投影自 `skill-lifecycle-store` / 我的沉淀，并补齐最小写路径
- 企业知识：投影自 EDC 治理层（projection spec + binding + feed item），并补齐最小浏览入口
- 数据能力：目录 + 访问状态 + 场景映射 + 分组空间

## 2. 交付清单

### 2.1 Gateway Sources

| 文件                                                          | 任务                               |
| ------------------------------------------------------------- | ---------------------------------- |
| `src/gateway/knowledge/feed/types.ts`                         | KnowledgeFeedItem                  |
| `src/gateway/knowledge/context.ts`                            | 可信席位上下文解析                 |
| `src/gateway/knowledge/sources/personal-source.ts`            | KU-07 只读投影                     |
| `src/gateway/knowledge/personal-mutations.ts`                 | KU-07 写路径（收录/上传/版本）     |
| `src/gateway/knowledge/access-request.ts`                     | 数据能力申请占位                   |
| `src/gateway/knowledge/sources/enterprise-source.ts`          | KU-08                              |
| `src/gateway/knowledge/sources/capability-catalog.ts`         | KU-09 / KU-09-1                    |
| `src/gateway/knowledge/sources/external-data-sources.ts`      | 外部数据源摘要                     |
| `src/gateway/knowledge/sources/capability-access-resolver.ts` | KU-09-2                            |
| `src/gateway/knowledge/sources/capability-scenario-mapper.ts` | KU-09-3                            |
| `src/gateway/knowledge/graph-builder.ts`                      | 真实对象构图                       |
| `src/gateway/knowledge/source-bundle.ts`                      | 三路 source 聚合 + browse/external |
| `src/gateway/knowledge/router.ts`                             | bundle 驱动 search 扩展            |
| `src/gateway/server-methods/knowledge.ts`                     | 读/写 RPC                          |

**新增写 RPC：**

- `knowledge.personal.collect` — 一键收录（委托 `saveSkillAsset`）
- `knowledge.personal.upload` — 上传文档
- `knowledge.personal.versions` — 版本历史
- `knowledge.personal.updateTags` — 标签更新
- `knowledge.personal.compareVersions` — 版本差异比较
- `knowledge.access.request` — 数据能力权限申请占位
- `knowledge.enterprise.access.request` — 企业知识权限申请占位

### 2.2 UI

| 文件                                                         | 说明                                          |
| ------------------------------------------------------------ | --------------------------------------------- |
| `ui/src/ui/views/knowledge-universe-personal-panel.ts`       | 我的知识：收录/上传 + 对象列表 + 跳转我的沉淀 |
| `ui/src/ui/views/knowledge-universe-enterprise-browse.ts`    | 企业知识空间浏览 + 受限对象申请入口           |
| `ui/src/ui/views/knowledge-universe-data-capability-card.ts` | 数据能力分组空间（已授权/待申请/外部）        |
| `ui/src/ui/views/knowledge-universe-page.ts`                 | 首页布局接入上述三区                          |
| `ui/src/ui/controllers/knowledge-universe.ts`                | 写操作与 browse 状态                          |
| `ui/src/styles/workbench.css`                                | 浏览区/分组空间样式                           |

### 2.3 测试

| 文件                                                                           | 覆盖                     |
| ------------------------------------------------------------------------------ | ------------------------ |
| `src/gateway/knowledge/personal-mutations.test.ts`                             | 收录/上传/版本/标签/差异 |
| `src/gateway/knowledge/sources/enterprise-source.test.ts`                      | 受限企业知识投影         |
| `src/gateway/knowledge/sources/capability-scenario-mapper.test.ts`             | KU-09-3                  |
| `src/gateway/knowledge/graph-builder.test.ts`                                  | 企业→数据能力关系边      |
| `src/gateway/knowledge/source-bundle.test.ts`                                  | 种子 catalog 投影        |
| `src/gateway/server-methods/knowledge.test.ts`                                 | search browse 字段       |
| `ui/src/ui/ports/employee/views/workbench-stage-module.knowledge.node.test.ts` | 三区 UI 渲染             |

## 3. M2 验收对照（含专家收尾项）

| 验收项                   | 状态 | 证据                                                                  |
| ------------------------ | ---- | --------------------------------------------------------------------- |
| 三类知识源全部接入       | ✅   | `source-bundle.ts`                                                    |
| 我的知识最小写路径       | ✅   | `knowledge.personal.collect/upload` + personal panel                  |
| 数据能力分组空间         | ✅   | granted / requestable / external + 申请按钮                           |
| 企业知识浏览入口         | ✅   | `knowledge-universe-enterprise-browse.ts` + `sourceBrowse.enterprise` |
| 企业知识权限申请         | ✅   | `enterpriseRestricted` + `knowledge.enterprise.access.request`        |
| 个人知识标签/版本管理    | ✅   | personal panel 管理区 + `updateTags` / `compareVersions`              |
| 来源卡片展示真实摘要     | ✅   | `sourceSummary`                                                       |
| 企业知识支持关系入口     | ✅   | `graph-builder` `recommended-for` 边                                  |
| 数据能力支持能力场景展示 | ✅   | `capability-scenario-mapper` + 分组空间                               |

## 4. 已知限制（M2 范围内可接受）

- 企业知识 payload 仍以 **projection spec/binding 元数据** 为主；完整 Feed 属 M4（KU-15）。
- `knowledge.access.request` / `knowledge.enterprise.access.request` 为 **申请意图占位**，尚未接入真实审批流。
- 无企业席位上下文时 enterprise/data 为空；personal 仍可用；**生产路径不再 fallback mock**，展示真实空态。
- 文档上传：文本/Markdown/图片可读入内容；Office/PDF 当前登记元数据，全文解析属后续里程碑。
- 版本差异比较 UI 为 **最小字段级 diff**，不含富文本并排视图。
- `knowledge.*` protocol schema 仍延后。

## 4.1 M2 签收前尾差（已补齐）

| 尾差                   | 状态 | 证据                                                                                |
| ---------------------- | ---- | ----------------------------------------------------------------------------------- |
| 空数据错误回退 mock    | ✅   | `source-bundle.ts` 仅 `preferMock` 显式启用 mock；`empty-bundle.ts`                 |
| 上传文档非真实文件上传 | ✅   | 文件选择器 + `personal-document-upload.ts` + `knowledge.personal.upload` attachment |

## 5. 审核结论（待填）

| 角色 | 结论         | 备注                                   |
| ---- | ------------ | -------------------------------------- |
| 产品 | **建议通过** | P1 阻塞尾差已补齐，可签收 M2 并进入 M3 |
| 架构 | 待审核       |                                        |
| 研发 | 待审核       |                                        |
| 测试 | 待审核       | 定向测试已通过                         |

**下一步**：启动 M3（KU-10~14、KU-11 Intelligent Relationship Runtime）。
