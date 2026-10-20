# Step 3 实施报告 —— sqlite 拆表 + kb-ingest

Date: 2026-06-14
Status: **正式通过（技术轨，2026-06-14 第四轮验收）** / 产品 P1 ~55%
关联计划: `docs/design/openbot-knowledge-rag-integration-plan-2026-06-14.md` (v3) §8 Step 3 / §9 验收
提交: `5940da5b5c`（Task: `knowledge-rag-step3` / Agent: `cursor-composer`）
关联整改: `e242c57103`（S2-D1 / S2-D2 已关闭）

---

## 1. 阶段目标

- `~/.openbot/knowledge/index/personal/<userId>.db` 与 `tenant/<tenantId>.db` 索引路径
- 拆表 schema：`documents` / `document_versions` / `chunks` / `chunk_meta` + fts5 + sqlite-vec vec0
- heading-aware 分块（`chunkers/hierarchical.ts`）
- 入库流：抽取 → 两层 hash 版本判断 → 分块 → embed（可选）→ upsert
- `unchanged` / `raw_only` 跳过 chunk 重建；`new_semantic_version` 保留 V1/V2 历史

**本期不含**：KnowledgeSource 召回（Step 4）、`knowledge.base.search` RPC（Step 5）、upload 钩子（Step 6）。

---

## 2. 交付物

| 文件                                                  | 职责                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------ |
| `src/gateway/knowledge/kb-index-schema.ts`            | 拆表 DDL + vec0/fts5 初始化                                  |
| `src/gateway/knowledge/kb-index.ts`                   | 索引路径、文档/版本 CRUD、chunk 写入                         |
| `src/gateway/knowledge/chunkers/hierarchical.ts`      | Markdown 标题感知分块                                        |
| `src/gateway/knowledge/kb-ingest.ts`                  | 完整 ingest 编排 + `resolveKnowledgeIngestEmbeddingProvider` |
| `src/gateway/knowledge/kb-index.test.ts`              | 4 用例（路径、拆表写入、版本历史、schema）                   |
| `src/gateway/knowledge/chunkers/hierarchical.test.ts` | 2 用例（heading/section、纯文本回退）                        |
| `src/gateway/knowledge/kb-ingest.test.ts`             | 4 用例（ingest、V1/V2、unchanged、raw_only）                 |

---

## 3. 验收对照（§9 Step 3）

| 验收项                                   | 结果 | 证据                                            |
| ---------------------------------------- | ---- | ----------------------------------------------- |
| 长文档按标题分块，带 heading/section     | ✅   | `hierarchical.test.ts` + `kb-ingest.test.ts`    |
| V1→V2 两版本均在 `document_versions`     | ✅   | `kb-index.test.ts` + `kb-ingest.test.ts`        |
| 拆表写入正确（chunks + chunk_meta 分离） | ✅   | `kb-index.test.ts`                              |
| semantic 不变跳过重建                    | ✅   | `unchanged` / `raw_only` 用例                   |
| 无 embedding provider 降级 fts-only      | ✅   | `FTS_ONLY_EMBEDDING_MODEL` + null provider 测试 |

---

## 4. 设计要点

### 索引路径

- 个人库：`personal/<ownerId>.db`
- 企业租户库：`tenant/<tenantId>.db`（`tenantId` 非空时）

### 版本流

```
extract → planKnowledgeDocumentVersionDelta
  unchanged     → 无写入
  raw_only      → 更新 current version raw_hash
  new_semantic  → 新建 version (V{n+1}) + 更新 current_version_id + 写入新 chunks
```

### 分块

- 使用 **原始抽取文本** `extracted.text` 保留 Markdown 结构（`cleanedText` 会折叠换行，仅用于 semantic hash）
- 超长 section 复用 `chunkMarkdown` + `enforceEmbeddingMaxInputTokens`

### Embedding

- 注入 `embeddingProvider` 时写入 vec0；否则 `model=fts-only`，仅 fts5
- `resolveKnowledgeIngestEmbeddingProvider(cfg, agentId)` 继承 `memorySearch` 配置

---

## 5. 质量门禁

| 门禁                                                    | 结果                     |
| ------------------------------------------------------- | ------------------------ |
| Step 3 新增测试                                         | **10/10**                |
| knowledge + retrieval + KB/deliverables RPC（标准口径） | **98/98**                |
| oxlint（Step 3 新文件）                                 | ✅ 0 warnings / 0 errors |
| 提交                                                    | ✅ `5940da5b5c`          |

**标准复跑命令**（与第四轮验收一致，勿混用更宽 glob）：

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/knowledge/ src/retrieval/ \
  src/gateway/server-methods/knowledge-base-rpc.test.ts \
  src/gateway/server-methods/knowledge-deliverables-rpc.test.ts
# → 98 passed
```

> 注：若使用 `src/gateway/server-methods/knowledge` 等更宽路径，计数会偏高（如 104）；文档与验收统一采用上式。

---

## 6. 第四轮验收结论（2026-06-14）

| 维度          | 结论                            |
| ------------- | ------------------------------- |
| RAG Step 3    | ✅ 正式通过，准予 Step 4        |
| S2-D1 / S2-D2 | ✅ 已关闭                       |
| 成果中心后端  | ✅ 正式通过（RPC 集成测试已补） |
| 产品 P1 整体  | ❌ ~55%（用户体感仍为 0）       |

### 残余技术债（不阻断 Step 4）

| 编号  | 问题                                               | 归属               |
| ----- | -------------------------------------------------- | ------------------ |
| S3-D1 | `ingestKnowledgeDocument` 未接入 upload/attach RPC | Step 6             |
| S3-D2 | `kb-index` 无检索 SQL                              | Step 4             |
| S3-D3 | `insertKnowledgeChunks` 无显式事务                 | Step 4 前补强      |
| S3-D4 | 无 `knowledge.base.ingest` RPC                     | Step 5/6           |
| S3-D5 | V1 chunks 保留（版本历史设计）                     | 文档已说明，可接受 |

---

## 7. 后续 Step 依赖

| Step   | 依赖本步能力                                                 |
| ------ | ------------------------------------------------------------ |
| Step 4 | `kb-index` 检索 SQL + `KnowledgeSource`                      |
| Step 5 | `knowledge.base.search` RPC                                  |
| Step 6 | `personal-mutations` / upload 调用 `ingestKnowledgeDocument` |

已知缺口 **S2-D5**（抽取未接入 upload）→ Step 6 接线 `kb-ingest`。
