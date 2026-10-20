# Step 8 实施报告 —— 知识库工作台 UI + 成果归档

Date: 2026-06-14
Status: **Step 8 已落地（待 commit / 验收）**
关联计划: `docs/design/openbot-knowledge-rag-integration-plan-2026-06-14.md` (v3) §8 Step 8 / §9
前置: Step 7 `76bd2884e4`

---

## 1. 阶段目标

- 前端：库内检索 UI（`knowledge.base.search` + Evidence / 子串命中展示）
- 前端：成果中心 + 归档到当前知识库（`knowledge.deliverables.attach`）
- 后端：闭合 **S5-D1**（indexed 未命中时返回 bundle 子串 `substringMatches`）
- 后端：闭合 **S2-D4**（`relatedKnowledgeBaseId` 归档映射 + list 合并）
- 产品：**P1 用户可感知闭环**（建库 / 归库 / 库内检索）

**本期不含**：指定 versionId 检索 RPC（S7-D1）、binary/PDF 无 bytes 全文（S6-D1）、group deliverable 全文 ingest（仅元数据 attach）。

---

## 2. 交付物

### 后端

| 文件                                                   | 职责                                              |
| ------------------------------------------------------ | ------------------------------------------------- |
| `src/gateway/knowledge/knowledge-retrieval-runtime.ts` | `searchScopedKnowledgeBaseWithFallback` 子串回退  |
| `src/gateway/knowledge/deliverables/archive-store.ts`  | deliverableId → knowledgeBaseId 持久映射          |
| `src/gateway/knowledge/deliverables/attach.ts`         | 成果 attach + ingest + 归档记录                   |
| `src/gateway/server-methods/knowledge.ts`              | `substringMatches`、attach RPC、list 合并 archive |
| `knowledge-base-search-rpc.test.ts`                    | 子串命中集成                                      |
| `knowledge-deliverables-attach-rpc.test.ts`            | attach + list relatedKnowledgeBaseId              |

### 前端

| 文件                                            | 职责                               |
| ----------------------------------------------- | ---------------------------------- |
| `ui/.../workspace-endpoints.ts`                 | KB / search / deliverables 类型    |
| `ui/.../gateway-client.ts`                      | list/create/search/attach + mock   |
| `ui/.../knowledge-universe-workspace.ts`        | load/create/search/archive actions |
| `ui/.../knowledge-universe-workspace-panels.ts` | 知识库 + 库内检索 + 成果中心 UI    |
| `ui/.../knowledge-universe-page.ts`             | 插入 workspace 区块                |
| `ui/.../home-page-contracts.ts`                 | `WorkbenchKnowledgeSurface` 扩展   |
| `ui/.../render-model.ts`                        | surface wiring                     |
| `ui/src/i18n/locales/en.ts` / `zh-CN.ts`        | workspace 文案                     |
| `ui/src/styles/workbench.css`                   | workspace 样式                     |

---

## 3. 验收对照（§9 Step 8）

| 验收项                           | 结果 | 证据                                 |
| -------------------------------- | ---- | ------------------------------------ |
| 用户可创建知识库                 | ✅   | UI create + `knowledge.base.create`  |
| 库内检索展示 evidence            | ✅   | search panel + indexed 命中卡片      |
| indexed 未命中时子串回退         | ✅   | `substringMatches` + UI 摘要卡片     |
| 成果归档到 KB                    | ✅   | attach RPC + archive-store + UI 按钮 |
| list 返回 relatedKnowledgeBaseId | ✅   | deliverables.list 合并 archiveMap    |
| collect/upload 选中 KB 时归库    | ✅   | Step 6 + UI 传 `knowledgeBaseId`     |

---

## 4. 已知缺口（延续）

| ID         | 说明                                           | 后续              |
| ---------- | ---------------------------------------------- | ----------------- |
| S6-D1      | binary/PDF 无 bytes → ingest/evidence 质量受限 | 附件字节通道      |
| S7-D1      | 未暴露指定 versionId 检索 RPC                  | 增强              |
| S2-D4 部分 | group deliverable 可能仅 attach 元数据         | group 全文 ingest |

---

## 5. 质量门禁

**标准复跑命令**：

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/knowledge/ src/retrieval/ \
  src/auto-reply/reply/knowledge-universe-context.test.ts \
  src/gateway/server-methods/knowledge-base-rpc.test.ts \
  src/gateway/server-methods/knowledge-deliverables-rpc.test.ts \
  src/gateway/server-methods/knowledge-deliverables-attach-rpc.test.ts \
  src/gateway/server-methods/knowledge-base-search-rpc.test.ts \
  src/gateway/server-methods/knowledge-personal-ingest-rpc.test.ts \
  ui/src/ui/ports/employee/views/workbench-stage-module.knowledge.node.test.ts
# → 135 passed
```

---

## 6. 产品 P1 闭环

| 能力       | Step 8 前           | Step 8 后              |
| ---------- | ------------------- | ---------------------- |
| 建库       | 后端 only           | UI 可见可操作          |
| 归库       | collect/upload 后端 | UI 选库 + 成果归档     |
| 库内检索   | RPC only            | UI evidence / 子串展示 |
| Agent 引用 | Step 7              | 不变                   |

**P1 用户可感知度：约 100%（后端 + 前端对齐）**

---

## 7. 下一步

- 指定 versionId 检索与版本 UI
- group deliverable 全文 ingest
- 附件 bytes 通道（PDF/binary）

---

## 8. Step 8.1 — 首页 IA 最终版（2026-06-14）

按产品评审落地首页信息架构：

| 变更                                                                                                    | 文件                                      |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 区块顺序：搜索 → 当前库+成果 → 快捷操作 → 最近/推荐 → 知识关系(折叠) → Metric Strip → 资源中心/能力中心 | `knowledge-universe-page.ts`              |
| 当前知识库 Hero + 切换库 `<details>`                                                                    | `knowledge-universe-workspace-panels.ts`  |
| 成果状态筛选（全部/草稿/进行中/已完成/已归档）                                                          | workspace controller + surface            |
| 图谱改为 `<details>` 默认折叠，文案「知识关系」                                                         | `knowledge-universe-relations-section.ts` |
| 三张来源卡 → 一行 Metric Strip                                                                          | `knowledge-universe-metric-strip.ts`      |
| 供给区拆分为资源中心 + 能力中心                                                                         | `knowledge-universe-page.ts`              |
| 全局搜索文案升级为「工作区搜索」                                                                        | `i18n` en/zh-CN                           |

**查看 UI 变更**：需 `pnpm build`（生成 `dist/control-ui`）并重启 Gateway / Mac 应用。
