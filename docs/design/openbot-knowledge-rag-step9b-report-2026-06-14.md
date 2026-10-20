# Step 9b 实施报告 — versionId 检索 / 推荐 reason / 成果索引召回

Date: 2026-06-14  
Status: **正式通过（技术轨，2026-06-14）** — commits `ae61530f2d` (backend), `b9128c7aab` (UI selection), `5c31a8e3cb` (CSS)  
关联: `docs/design/openbot-knowledge-rag-integration-plan-2026-06-14.md` §8 Step 9b / §9

---

## 1. 范围

| 项           | 说明                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| S7-D1        | `knowledge.base.search` 支持 `versionId`（及可选 `docId`）精确检索历史版本                                        |
| 推荐 reason  | 后端 `buildRelationshipRecommendations` 已带 `reason`；UI 已有 `.knowledge-universe__recommendations-reason` 渲染 |
| 成果全文索引 | attach → ingest 进 KB 索引；新增 `artifact` RetrievalSource + workspace 成果组从 evidence 召回                    |

**附带修复**: `ui/src/styles/cost-budget.css` 补全 `.cost-budget-seat-member-picker__summary` 选择器，`pnpm ui:build` 绿。

---

## 2. 后端改动

### versionId 检索链

- `RetrievalOpts.versionId` / `docId`（`src/retrieval/types.ts`）
- `kb-retrieve.ts`: `buildMetaJoin(currentVersionOnly)` + `buildVersionIdFilter`；传 `versionId` 时检索非 current 版本
- `knowledge.base.search` RPC 解析 `versionId`、`documentId`/`docId` 并回传

### 成果 RetrievalSource

- `src/retrieval/sources/deliverable-source.ts` — `artifact` source，仅召回已 archive 的成果 docId
- `ensureDeliverableRetrievalSourceRegistered` 与 knowledge source 一同 bootstrap
- `retrieval-service.ts` 按 `sourceUri` 去重，避免双 source 重复命中

### Workspace 成果组

- `workspace-search.ts`: `deliverableHitsFromEvidence` — 索引 evidence 的 `docId` 映射 `skill:*` 成果，标题不匹配也能召回

---

## 3. 测试

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/knowledge/kb-retrieve.test.ts \
  src/gateway/server-methods/knowledge-base-search-rpc.test.ts \
  src/gateway/knowledge/workspace-search.test.ts \
  src/gateway/knowledge/workspace-search-step9b.integration.test.ts \
  src/gateway/knowledge/knowledge-recommendations.test.ts
```

| 用例                                | 验证                                            |
| ----------------------------------- | ----------------------------------------------- |
| kb-retrieve historical versionId    | V1 在 V2 为 current 时仍可 FTS 召回             |
| knowledge.base.search versionId RPC | 传 `versionId` 返回 V1 evidence                 |
| workspace deliverable from evidence | 标题不含 query，正文索引命中成果组              |
| workspace-search-step9b integration | attach 后 `zeta-9b-body` workspace 搜索命中成果 |
| knowledge-recommendations           | 每条推荐带非空 `reason`                         |

---

## 4. §9 Step9b 验收对照

| 验收项                                      | 状态                                                        |
| ------------------------------------------- | ----------------------------------------------------------- |
| `versionId` 检索                            | ✅ `knowledge.base.search`                                  |
| 推荐卡片带 `reason`                         | ✅ 后端 + UI 已有；补测试                                   |
| 成果 attach 后全文进索引且 workspace 可召回 | ✅ ingest + artifact source + deliverables 组 evidence 映射 |

---

## 5. 验证

```bash
pnpm ui:build
```
