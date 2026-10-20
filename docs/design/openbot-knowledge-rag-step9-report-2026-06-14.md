# Step 9 实施报告 —— 工作区统一搜索

Date: 2026-06-14  
Status: **技术轨完成（待 commit / Gateway 重启验证 UI）**  
关联计划: `docs/design/openbot-knowledge-rag-integration-plan-2026-06-14.md` §8 Step 9

---

## 1. 阶段目标

一次查询返回分组结果，覆盖知识首页 Spotlight 式「工作区统一搜索」：

| 分组     | 来源                              |
| -------- | --------------------------------- |
| 知识     | 个人/数据知识对象 + 索引 evidence |
| 企业知识 | `source=enterprise` 对象          |
| 成果     | `listWorkspaceDeliverables` 过滤  |
| 数据能力 | bundle `dataCapabilities`         |
| 机器人   | 关系图 `agent` 节点               |
| 人员     | 关系图 `owner` 节点               |

---

## 2. 交付物

### 后端

| 文件                                                                | 职责                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------- |
| `src/gateway/knowledge/workspace-search.ts`                         | `searchWorkspace` + 纯函数 `buildWorkspaceSearchGroups` |
| `src/gateway/knowledge/workspace-search.test.ts`                    | 分组逻辑单测                                            |
| `src/gateway/server-methods/knowledge.ts`                           | RPC `knowledge.workspace.search`                        |
| `src/gateway/server-methods/knowledge-workspace-search-rpc.test.ts` | RPC handler 单测                                        |
| `src/gateway/method-scopes.ts`                                      | READ scope 注册                                         |
| `src/gateway/server-methods-list.ts`                                | 方法名注册                                              |

**RPC 契约**

```typescript
// request
{ query?: string; limitPerGroup?: number }  // default limitPerGroup=5

// response
{
  query: string;
  searchMode: "indexed" | "substring" | "mixed";
  totalCount: number;
  groups: Array<{ group: WorkspaceSearchGroupId; hits: WorkspaceSearchHit[] }>;
  legacyResults: KnowledgeObject[];  // 图过滤 / 旧 UI 兼容
}
```

### 前端

| 文件                                           | 改动                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `ui/.../workspace-endpoints.ts`                | DTO 类型                                                                                        |
| `ui/.../gateway-client.ts`                     | `searchWorkspace` mock + RPC                                                                    |
| `ui/.../controllers/knowledge-universe.ts`     | `submitKnowledgeUniverseSearch` 改调 workspace RPC；`selectKnowledgeUniverseWorkspaceSearchHit` |
| `ui/.../knowledge-universe-search-feedback.ts` | 分组结果 UI                                                                                     |
| `ui/.../knowledge-universe-page.ts`            | 传入分组 props                                                                                  |
| `ui/.../home-page-contracts.ts`                | Surface 契约扩展                                                                                |
| `ui/.../render-model.ts`                       | 状态与回调接线                                                                                  |
| `ui/src/i18n/locales/{en,zh-CN}.ts`            | 分组标题 + searchMode 文案                                                                      |
| `ui/src/styles/workbench.css`                  | 分组 / hit 样式                                                                                 |

---

## 3. 行为说明

1. **首页搜索框 Enter / 点击搜索** → `knowledge.workspace.search` + 并行 `knowledge.relationships`（图按 query 过滤）。
2. **空 query** → 清空分组，回退 `refreshKnowledgeUniverseHome`。
3. **点击命中**：
   - 有 `nodeId` / `objectId` → 选中节点或对象详情
   - `deliverableId` → 滚动到 `#ku-deliverables` 并高亮成果卡片
   - `capabilityId` → 滚动到 `#ku-capability-center`
   - `kbId`（索引 evidence）→ 切换当前库并高亮 Hero

4. **选中态（Step 9 polish）**：`selectedWorkspaceSearchHitId` / `selectedWorkspaceSearchDeliverableId` 驱动搜索 hit 与成果卡片 `is-selected` 样式。

---

## 4. 测试

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/knowledge/workspace-search.test.ts \
  src/gateway/knowledge/workspace-search.integration.test.ts \
  src/gateway/server-methods/knowledge-workspace-search-rpc.test.ts \
  ui/src/ui/views/knowledge-universe-search-feedback.node.test.ts \
  ui/src/ui/ports/employee/views/workbench-stage-module.knowledge.node.test.ts
```

---

## 5. Landed commits（2026-06-14）

| SHA          | 说明                                           |
| ------------ | ---------------------------------------------- |
| `f2b4615a60` | Step 9 RPC + `workspace-search.ts`             |
| `75cd8a30e3` | `searchWorkspace` 集成测试（非 mock 核心逻辑） |
| `970fd38dc6` | render-model / app-port-state 接线             |
| `2905ad8be5` | app.ts 状态字段                                |
| `b3a733a9b2` | 首页 IA + 分组搜索 UI + 选中态                 |
| `ed1ff7b7d7` | 分组搜索 i18n（en/zh-CN）                      |

---

## 6. 已知缺口（后续 Step）

| 编号  | 问题                 | 计划                    |
| ----- | -------------------- | ----------------------- |
| S7-D1 | versionId 精确检索   | Step 9b / 索引增强      |
| S6-D1 | PDF/二进制全文       | ingest 管线             |
| —     | 成果全文 ingest 检索 | deliverable 索引 source |
| —     | 推荐 reason 字段     | Step 9b 或推荐轨        |

---

## 7. UI 验证

```bash
pnpm ui:build
# 重启 Gateway / Mac 应用后，在知识宇宙首页搜索「销售」等关键词，应看到分组命中面板。
```
