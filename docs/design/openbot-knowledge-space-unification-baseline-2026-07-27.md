# 知识空间统一 — 基线锁定与收口清单（2026-07-27）

关联：

- `docs/design/openbot-knowledge-space-unification-implementation-plan-2026-06-29.md`
- `docs/design/openbot-knowledge-space-unification-migration-flags-2026-06-29.md`

## 1. 目标模型（唯一口径）

| 概念          | SoT                        | 说明                                         |
| ------------- | -------------------------- | -------------------------------------------- |
| 知识空间      | `KnowledgeBase`            | 容器实体                                     |
| 空间类型      | `KnowledgeBase.visibility` | `private` / `team` / `enterprise`            |
| 来源平面      | passive / active           | 被动导入 vs 主动绑定；**不是**另一套空间分类 |
| `backendKind` | 内部兼容字段               | 创建时由 visibility 推导；UI 不以它做分组    |

## 2. 已核实的行为基线（改造前）

### 2.1 后端

- `knowledge.personal.*` / `knowledge.source.bind` 缺省 `knowledgeBaseId` 时走 `resolvePersonalImportKnowledgeBase()` → `ensurePersonalInboxKnowledgeBase()`（「我的收录」）+ `implicit_personal_inbox` warning。
- Phase 3 开关 `OPENBOT_KNOWLEDGE_REQUIRE_KNOWLEDGE_BASE_ID=1` 可将缺省行为改为硬拒绝（默认仍 off，便于旧客户端兼容）。
- `knowledge.base.create`：`backendKind = visibility === "private" ? "personal" : "enterprise"`。

### 2.2 前端（部分已收口）

- 通用入口 `openSpaceImportEntry`：无库 / 无选中空间 → `libraryCreate`，不发起 ingest。
- 各 personal ingest controller 经 `requireSelectedKnowledgeBaseId()` 守卫。
- 库工作台树已按 `private/team/enterprise` 分组。
- 供给页曾仅渲染数据能力；`supply-spaces.ts` 已存在但未挂主路径。
- `openPersonalSpaceImportEntry` / `onEnsurePersonalSpaceForImport` 仍可能静默物化私有空间（本轮收口目标）。

### 2.3 双列表宇宙

- `sourceBrowse.personal/enterprise`：按 `KnowledgeObject.source` 切片（散装对象）。
- `knowledge.base.list`：真正的空间容器列表。
- 本轮供给页改为 **仅** 以 `knowledgeBases` + visibility 展示空间；数据能力保留为 active 平面管理面。

## 3. 本轮收口清单

1. **导入**：任意入口无目标空间 → 只进创建空间页；禁止静默建「我的收录」/无目标打开导入页。
2. **供给页**：personal/team/enterprise 段 = `filterKnowledgeBasesByVisibility`；capabilities = 主动来源管理。
3. **BrowseSubTab**：命名对齐 visibility（`private|team|enterprise|capabilities`），prefs 兼容旧 `personal`/`enterprise`。
4. **库树**：置顶/收藏不抽离出 visibility 段；叶子可带类型角标，避免心智丢失。
5. **测试**：锁定无空间导入拦截、导入继承 visibility、供给与库列表同源。

## 4. 兼容策略

| 路径           | 策略                                                             |
| -------------- | ---------------------------------------------------------------- |
| 新 UI          | 始终传 `knowledgeBaseId`；无选中则不发 RPC                       |
| 旧 RPC 客户端  | 默认仍可走 inbox fallback + warning；生产可开 Phase 3 开关硬拒绝 |
| `backendKind`  | 保留写路径推导；UI 不展示/不筛选                                 |
| `sourceBrowse` | 供给主路径停用；保留 bundle 字段供遗留个人抽屉直至下线           |

## 5. 验收红线

1. 无目标空间的导入路径不得静默创建私有「我的收录」。
2. 创建空间选定 visibility 后，passive 导入与 active 绑定继承该 visibility。
3. 供给页与库工作台看到同一批 `KnowledgeBase`。
4. 入口收敛为「创建空间」与「向当前/所选空间导入」。
