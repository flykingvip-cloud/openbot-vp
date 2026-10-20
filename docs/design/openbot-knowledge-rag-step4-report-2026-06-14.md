# Step 4 实施报告 —— KnowledgeSource + kb-retrieve

Date: 2026-06-14
Status: **正式通过（技术轨，2026-06-14 第五轮验收）** / 产品 P1 ~65%
关联计划: `docs/design/openbot-knowledge-rag-integration-plan-2026-06-14.md` (v3) §8 Step 4 / §9
提交: `56049beb76`（Task: `knowledge-rag-step4` / Agent: `cursor-composer`）
前置: Step 3 `5940da5b5c`

---

## 1. 阶段目标

- `kb-retrieve`：拆表 SQL + FTS/向量混合召回，`WHERE kb_id IN (...)`
- `KnowledgeSource` 实现 `RetrievalSource`，注册到 `KnowledgeRetrievalService`
- Visibility Resolver 门禁 → 可见 `kb_id` 集合
- `insertKnowledgeChunks` 事务包装（S3-D3）

**本期不含**：`knowledge.base.search` RPC（Step 5）、upload 钩子（Step 6）、Agent Evidence 注入（Step 7）。

---

## 2. 交付物

| 文件                                             | 职责                                                         |
| ------------------------------------------------ | ------------------------------------------------------------ |
| `src/gateway/knowledge/kb-retrieve.ts`           | FTS/vec 检索 SQL、hybrid merge、Evidence 映射                |
| `src/gateway/knowledge/kb-retrieve.test.ts`      | kb_id IN + current version 召回                              |
| `src/gateway/knowledge/kb-index-groups.ts`       | 按 sqlite 物理文件分组 KB                                    |
| `src/gateway/knowledge/kb-index-groups.test.ts`  | 分组逻辑                                                     |
| `src/retrieval/sources/knowledge-source.ts`      | KnowledgeSource + `ensureKnowledgeRetrievalSourceRegistered` |
| `src/retrieval/sources/knowledge-source.test.ts` | 越权为空 / 授权 Evidence / 租户多库                          |
| `src/gateway/knowledge/kb-index.ts`              | `insertKnowledgeChunks` BEGIN/COMMIT/ROLLBACK                |

---

## 3. 验收对照（§9 Step 4）

| 验收项                       | 结果 | 证据                                           |
| ---------------------------- | ---- | ---------------------------------------------- |
| 越权 seat/用户召回为空       | ✅   | `knowledge-source.test.ts` private kb outsider |
| 单租户库 `kb_id IN` 单次召回 | ✅   | `kb-retrieve.test.ts` + tenant 双 KB 用例      |
| 返回 `KnowledgeEvidence`     | ✅   | sourceUri / kbTitle / heading / version        |
| Visibility Resolver 链       | ✅   | source 内 `resolveAccessibleKnowledgeBases`    |
| S3-D3 事务                   | ✅   | `kb-index.test.ts` duplicate chunk rollback    |

---

## 4. 设计要点

### 检索 SQL

- JOIN 链：`chunks` ↔ `chunk_meta` ↔ `documents` ↔ `document_versions`
- 默认仅命中 `documents.current_version_id`
- FTS：`chunks_fts MATCH` + `m.kb_id IN (...)`
- Vector：`chunks_vec` + `vec_distance_cosine`（有 embedding provider 时）

### KnowledgeSource

1. `listKnowledgeBases` → Visibility 过滤 → `groupKnowledgeBasesByIndexDb`
2. 每个 sqlite 文件一次 `retrieveKnowledgeFromIndex`（单次 `kb_id IN`）
3. 全局按 score 排序后 `maxResults` 截断

### FTS-only 降级

- 无 `embeddingProvider` 时跳过 vector leg，仅 keyword 召回

---

## 5. 质量门禁

| 门禁                                                    | 结果                     |
| ------------------------------------------------------- | ------------------------ |
| Step 4 新增测试                                         | **12/12**                |
| knowledge + retrieval + KB/deliverables RPC（标准口径） | **106/106**              |
| oxlint（Step 4 新文件）                                 | ✅ 0 warnings / 0 errors |
| 提交                                                    | ✅ `56049beb76`          |

**标准复跑命令**：

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/knowledge/ src/retrieval/ \
  src/gateway/server-methods/knowledge-base-rpc.test.ts \
  src/gateway/server-methods/knowledge-deliverables-rpc.test.ts
# → 106 passed
```

---

## 6. 第五轮验收结论（2026-06-14）

| 维度           | 结论                             |
| -------------- | -------------------------------- |
| RAG Step 4     | ✅ 正式通过，准予 Step 5         |
| S3-D3 事务包装 | ✅ 已关闭                        |
| 产品 P1 整体   | ❌ ~65% 后端能力，用户体感仍为 0 |

### 残余技术债（不阻断 Step 5）

| 编号  | 问题                                                             | 归属                         |
| ----- | ---------------------------------------------------------------- | ---------------------------- |
| S4-D1 | `ensureKnowledgeRetrievalSourceRegistered` 未在 gateway 启动调用 | **Step 5 必做**              |
| S4-D2 | 企业 KB 未接 visibility-policy-mapping                           | 后续企业轨                   |
| S4-D3 | 无向量/hybrid 端到端集成测                                       | Step 5 P1 可补 mock provider |
| S3-D1 | ingest 未接入 upload RPC                                         | Step 6                       |
| S3-D4 | 无 `knowledge.base.ingest` RPC                                   | Step 5/6                     |

---

## 7. 下一步（Step 5 — 产品检索对外可用）

- `knowledge.base.search` RPC → `RetrievalService.search`（传 `knowledgeBaseId` + query）
- gateway 启动时 `ensureKnowledgeRetrievalSourceRegistered()`（闭合 S4-D1）
- `router.ts` 经 RetrievalService；有索引优于子串，无索引回退子串

**Step 5 验收三条产品承诺**：有索引优于子串 / 无索引可降级 / 越权为空。
