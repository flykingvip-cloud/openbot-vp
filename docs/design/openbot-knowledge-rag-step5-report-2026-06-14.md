# Step 5 实施报告 —— knowledge.base.search + router 升级

Date: 2026-06-14
Status: **Step 5 已落地（commit `319d8b5647`），待第五轮验收**
关联计划: `docs/design/openbot-knowledge-rag-integration-plan-2026-06-14.md` (v3) §8 Step 5 / §9
前置: Step 4 `56049beb76`

---

## 1. 阶段目标

- `knowledge.base.search` RPC：`knowledgeBaseId` + `query` → `KnowledgeEvidence[]`
- gateway 首次检索时 lazy 注册 `ensureKnowledgeRetrievalSourceRegistered()`（闭合 S4-D1，不修改 H1G `server-startup.ts`）
- `router.ts`：`knowledgeSearch` 有索引走 RetrievalService，无索引/无命中回退 bundle 子串

**本期不含**：upload 自动 ingest（Step 6）、Agent Evidence 注入（Step 7）、前端 UI（Step 8）。

---

## 2. 交付物

| 文件                                                           | 职责                                                |
| -------------------------------------------------------------- | --------------------------------------------------- |
| `src/gateway/knowledge/knowledge-retrieval-runtime.ts`         | 检索运行时：Evidence 搜索、索引探测、lazy bootstrap |
| `src/gateway/server-methods/knowledge.ts`                      | `knowledge.base.search` handler                     |
| `src/gateway/knowledge/router.ts`                              | `knowledgeSearch` indexed/substring 双路径          |
| `src/gateway/knowledge/kb-index.ts`                            | `knowledgeBaseHasIndexedChunks`                     |
| `src/gateway/server-methods/knowledge-base-search-rpc.test.ts` | RPC 集成 3 条                                       |
| `src/gateway/knowledge/router.search-index.test.ts`            | router 索引/回退 2 条                               |
| `method-scopes.ts` / `server-methods-list.ts`                  | 注册 `knowledge.base.search`                        |

---

## 3. 验收对照（§9 Step 5）

| 验收项                                | 结果 | 证据                                                        |
| ------------------------------------- | ---- | ----------------------------------------------------------- |
| `knowledge.base.search` 返回 Evidence | ✅   | RPC 测试 indexed 路径                                       |
| 越权用户搜索为空 / not found          | ✅   | RPC 测试 outsider                                           |
| 无索引降级 substring 模式             | ✅   | RPC + router 测试                                           |
| 有索引优于子串（router）              | ✅   | `router.search-index.test.ts`                               |
| gateway lazy 注册 KnowledgeSource     | ✅   | `ensureGatewayKnowledgeRetrievalBootstrapped` 于首次 search |
| S4-D1 闭合                            | ✅   | bootstrap 内 `ensureKnowledgeRetrievalSourceRegistered`     |

---

## 4. API 摘要

### `knowledge.base.search`

请求：`{ knowledgeBaseId, query, limit?, minScore? }`

响应：

```json
{
  "knowledgeBaseId": "kb_...",
  "query": "...",
  "evidence": [ /* KnowledgeEvidence[] */ ],
  "searchMode": "indexed" | "substring"
}
```

- 有 chunk 索引且命中 → `searchMode: "indexed"` + `evidence`
- 无索引或未命中 → `searchMode: "substring"` + `evidence: []`（Step 6 前不在此 RPC 做 bundle 子串）

### `knowledge.search`（router 升级）

响应新增字段：`evidence`、`searchMode`（`indexed` | `substring`）。有 accessible 索引且命中时返回 `evidence`，`results` 为空；否则保持原有 bundle 子串 `results`。

---

## 5. 质量门禁

| 门禁                                                 | 结果                 |
| ---------------------------------------------------- | -------------------- |
| Step 5 新增测试                                      | **5/5**              |
| knowledge + retrieval + RPC（标准口径 + search RPC） | **111/111**          |
| oxlint（Step 5 改动文件）                            | ✅ 无新增 diagnostic |

**标准复跑命令**：

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/knowledge/ src/retrieval/ \
  src/gateway/server-methods/knowledge-base-rpc.test.ts \
  src/gateway/server-methods/knowledge-deliverables-rpc.test.ts \
  src/gateway/server-methods/knowledge-base-search-rpc.test.ts
# → 111 passed
```

---

## 6. 残余技术债

| 编号  | 问题                                                           | 归属                 |
| ----- | -------------------------------------------------------------- | -------------------- |
| S3-D1 | ingest 未接入 upload                                           | Step 6               |
| S4-D2 | 企业 visibility-policy-mapping                                 | 后续                 |
| S4-D3 | 无向量/hybrid RPC 集成测                                       | 可选补 mock provider |
| S5-D1 | `knowledge.base.search` substring 模式暂不返回 bundle 子串结果 | Step 6 或后续增强    |

---

## 7. 下一步（Step 6）

- `personal-mutations` / upload 钩子调用 `ingestKnowledgeDocument`
- 文件归库闭环 + 上传即可检索
