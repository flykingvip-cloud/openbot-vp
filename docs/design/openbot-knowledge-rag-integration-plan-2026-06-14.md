# OpenBot 检索平台 + 知识工作台 RAG 实施计划(v3 · 二轮专家评审)

Date: 2026-06-14
Status: 草案 v3(评审目标成熟度 9.5+/10,可进入开发)
关联:

- `docs/design/openbot-knowledge-workspace-optimization-2026-06-14.md`(产品侧 P1+P3)
- 外部参考 SDK:`@knowledge-sdk`(RAG 能力被 openbot `src/memory/` 取代,仅借鉴 heading 分块思路,见 §10)

> **v3 相对 v2 的关键升级(二轮评审三项必做)**:
>
> 1. **检索平台目录升级**:`src/gateway/knowledge/rag/` → `src/retrieval/`(平台,不绑定 knowledge;knowledge 只是一个 `RetrievalSource`)。
> 2. **版本历史(非当前快照)**:`documents` 与 `document_versions` 分离,chunk 指向 `version_id`,V1/V2/V3 全部保留。
> 3. **Chunk / Metadata 拆表**:核心 `chunks(text+embedding)` 与 `chunk_meta(kb_id/doc_id/version_id/…)` 分离,避免超宽表。
>
> 另含"schema 预留、暂不实现"项:文档/章节级权限(`visibility` + `accessibleScopes`)、两层 hash(raw+semantic)、Retrieval `synthesize()` 证据压缩。本期文档解析仅 **PDF/Markdown/Text**(docx 延后)。

---

## 0. 核心决策(已定稿)

| 决策                        | 结论                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 不移植 `@knowledge-sdk` RAG | ✅ 复用 openbot `src/memory/` Primitive 层                                                                              |
| 架构                        | **检索平台 + 知识源**:独立 Knowledge Runtime,复用 Memory Primitive,存储域隔离,统一 Retrieval Platform 之上挂载多 source |
| 目录                        | **`src/retrieval/`**(平台层)+ `src/gateway/knowledge/`(知识源实现)                                                      |
| embedding 配置              | 继承 `agents.defaults.memorySearch`(单一向量空间,**不**新增 `knowledge.embedding.*`)                                    |
| 权限                        | 物理分库 ≠ 权限隔离;检索入口强制 Visibility Resolver;预留文档/章节级                                                    |
| 版本                        | **Versioned Knowledge**(全量版本历史),非 Current Snapshot                                                               |
| 存储                        | `personal/<userId>.db` + `tenant/<tenantId>.db`(不做 per-kb DB)                                                         |
| docx                        | 本期不做(PDF/MD/Text 覆盖 ~80%)                                                                                         |

---

## 1. 分层架构(检索平台)

```text
┌──────────────────────────────────────────────────────────────┐
│                  Retrieval Platform (src/retrieval/)           │
│   RetrievalService: search → rerank → (synthesize*) → cite     │
│   RetrievalSource[] 统一挂载  ·  Visibility Resolver  ·  Evidence│
└───────┬─────────────┬─────────────┬───────────┬───────────────┘
        │             │             │           │      (* 预留)
 ┌──────▼───┐  ┌──────▼────┐  ┌─────▼─────┐ ┌───▼──────┐
 │Knowledge │  │ Memory    │  │ Artifact  │ │ Web /    │
 │ Source   │  │ Source*   │  │ Source*   │ │ DB Src*  │
 │(本期)    │  │(未来)     │  │(成果中心) │ │(未来)    │
 └────┬─────┘  └───────────┘  └───────────┘ └──────────┘
      │ 复用(不复制)
┌─────▼──────────────────────────────────────────────────────┐
│      Primitive Layer (src/memory/, 函数级复用)               │
│ createEmbeddingProvider · sqlite-vec · cosineSimilarity      │
│ buildFtsQuery · bm25RankToScore · mergeHybridResults · MMR   │
│ temporal-decay · embedding-chunk-limits                      │
└─────────────────────────────────────────────────────────────┘
                            ▲
        ┌───────────────────┴──┐
        │   Memory Runtime      │  (agent 记忆,独立存储域,生命周期不同)
        └──────────────────────┘
```

**`retrieval-service.ts` 不再是 KB 模块,而是检索平台雏形。** 未来个人库/企业库/成果中心/Agent Memory/数据库/网页都实现 `RetrievalSource` 挂载,统一走 `Retrieve → Rerank → Evidence → Inject`。

**为何不复用 `MemoryIndexManager`**(生命周期与范围不同):

|          | Memory                                          | Knowledge                 |
| -------- | ----------------------------------------------- | ------------------------- |
| 生命周期 | 增长/遗忘/衰减/总结                             | 长期/可审计/可版本/可权限 |
| 范围     | agent(`MemorySource="memory"\|"sessions"` 闭合) | 用户/席位/租户            |
| 共用     | 基础设施(Embedding/Chunk/Retrieval)             | 同左                      |
| 不共用   | 存储域                                          | 同左                      |

> **复用边界(重要)**:因 v3 拆表 + 版本历史,KB schema 已偏离 memory 单 `chunks` 表,故**不直接复用** `searchVector/searchKeyword`(硬编码 memory 表);改为复用更底层 **Primitive 函数**(嵌入、sqlite-vec 加载、余弦、`buildFtsQuery/bm25RankToScore/mergeHybridResults/MMR`),KB 针对拆分 schema 写薄向量/关键词 SQL(仿 `src/memory/manager-search.ts`)。

---

## 2. 存储与 Schema

### 2.1 物理布局(已确认)

```text
~/.openbot/knowledge/index/
  personal/<userId>.db     # 用户全部个人库,kb_id 区分
  tenant/<tenantId>.db     # 租户全部企业库统一一库,kb_id 区分(100~1000+ KB 不爆炸)
```

检索 **一次查询**:`... WHERE model = ? AND kb_id IN (?, ?, ...)`(kb_id 由 Visibility Resolver 给出),不做 N 库逐召回 merge。

### 2.2 拆表 + 版本历史 + 两层 hash 预留

```sql
CREATE TABLE documents (
  doc_id              TEXT PRIMARY KEY,
  kb_id               TEXT NOT NULL,
  title               TEXT NOT NULL,
  current_version_id  TEXT,            -- 检索默认用
  content_type        TEXT,
  created_at INTEGER, updated_at INTEGER
);

CREATE TABLE document_versions (        -- 全量版本历史(Versioned Knowledge)
  version_id    TEXT PRIMARY KEY,
  doc_id        TEXT NOT NULL,
  version_label TEXT,                   -- e.g. "V3"
  raw_hash      TEXT NOT NULL,          -- 原文件 SHA256(第一层)
  semantic_hash TEXT NOT NULL,          -- 清洗后(去时间戳/页码/页眉脚)SHA256(第二层)
  published_at  INTEGER, created_at INTEGER
);

CREATE TABLE chunks (                    -- 核心:仅 text+embedding,供 vector/FTS 独立优化
  id    TEXT PRIMARY KEY,
  text  TEXT NOT NULL,
  model TEXT NOT NULL
);
-- + sqlite-vec vec0(向量) + fts5(全文 BM25),均挂 chunk id

CREATE TABLE chunk_meta (                -- 元数据:可独立扩展,不撑爆核心表
  chunk_id   TEXT PRIMARY KEY,
  kb_id      TEXT NOT NULL,             -- 检索过滤主键
  doc_id     TEXT NOT NULL,
  version_id TEXT NOT NULL,             -- → document_versions
  heading    TEXT, section TEXT,        -- heading-aware
  start_line INTEGER, end_line INTEGER,
  visibility TEXT,                      -- 预留:文档/章节级权限(本期继承 kb)
  source     TEXT
);
CREATE INDEX idx_meta_kb      ON chunk_meta(kb_id);
CREATE INDEX idx_meta_doc_ver ON chunk_meta(doc_id, version_id);
```

- 检索默认命中 `documents.current_version_id`;历史版本保留 → 可回答"去年的制度"。
- `KnowledgeEvidence` 带 `version_label/published_at`,引用可写"《销售制度 V3(2026-05-01)》第 3.2 节"。

---

## 3. 模块与文件落点

```text
src/retrieval/                         [新增] 检索平台
├── types.ts                           RetrievalSource / RetrievalContext / KnowledgeEvidence / RetrievalQuery
├── retrieval-service.ts               编排:search → rerank →(synthesize 预留)→ cite;挂载 sources
├── rerank.ts                          复用 memory MMR / mergeHybridResults
├── visibility-resolver.ts             RetrievalContext → 可见 kb_id[](预留 scope 级)
└── sources/
    └── knowledge-source.ts            KnowledgeSource implements RetrievalSource(调 knowledge kb-index)

src/gateway/knowledge/
├── knowledge-base-store.ts            [新增] KB 容器(create/list/get/update/delete/attach)
├── kb-index.ts                        [新增] 拆表 sqlite + KB 薄检索 SQL
├── kb-ingest.ts                       [新增] 抽取→两层 hash→版本判断→hierarchical chunk→embed→upsert
├── chunkers/hierarchical.ts           [新增] heading-aware 分块(必做)
├── document-extract.ts               [新增] text/md 直读;pdf=pdfjs(本期不含 docx)
├── content-clean.ts                   [新增] 清洗页码/时间戳/页眉脚 → semantic_hash
├── router.ts                          [改] knowledgeSearch 经 RetrievalService(无索引回退子串)
├── resolve/context-builder.ts         [改] 注入 KnowledgeEvidence(正文+出处+版本+权限)
├── personal-mutations.ts              [改] collect/upload 归属库时触发 kb-ingest
└── server-methods/knowledge.ts        [改] KB + 检索 RPC(强制传 RetrievalContext)
```

依赖方向:`src/retrieval/` 定义平台与接口;`knowledge` 提供 `KnowledgeSource` 并注册,**平台不硬依赖各业务域**。所有对 `src/memory/` 的引用用静态 import。

---

## 4. 检索平台接口(权限 + 预留)

```ts
// src/retrieval/types.ts
export type RetrievalContext = {
  userId: string | null;
  seatId: string | null;
  tenantId: string | null;
  departmentId?: string | null;
  roleCodes?: string[];
  accessibleScopes?: string[]; // 预留:文档/章节级可见(本期 kb 级)
};

export type KnowledgeEvidence = {
  sourceKind: "knowledge" | "memory" | "artifact" | "web" | "database";
  docId: string;
  docTitle: string;
  kbId: string;
  kbTitle?: string;
  versionId: string;
  versionLabel?: string;
  publishedAt?: number;
  score: number;
  chunkText: string;
  heading?: string;
  section?: string;
  sourceUri: string; // ku://kb/<kbId>/doc/<docId>@<versionId>#<section>
};

export interface RetrievalSource {
  id: string;
  search(query: string, ctx: RetrievalContext, opts?: RetrievalOpts): Promise<KnowledgeEvidence[]>;
}

export interface KnowledgeRetrievalService {
  registerSource(source: RetrievalSource): void;
  search(query: string, ctx: RetrievalContext, opts?: RetrievalOpts): Promise<KnowledgeEvidence[]>;
  // 预留:synthesize(evidence[], budget)(防 context 爆炸)/ retrieve / rerank / cite
}
```

**权限强校验链(物理隔离≠权限隔离)**:

```
RPC / Agent 注入 → 必传 RetrievalContext
  → visibility-resolver: 个人库 owner 校验;企业库复用 feed/visibility-policy-mapping → 可见 kbId[]
  → KnowledgeSource.search: WHERE kb_id IN (...) [未来 AND visibility ∈ scopes]
  → KnowledgeEvidence[]
```

调用层**不得**绕过 RetrievalService 直查库。

---

## 5. 入库流(heading + 版本 + 两层 hash)

```
上传/收录(归属某 KB)
  → document-extract(text/md/pdf) → content-clean(去页码/时间戳/页眉脚)
  → raw_hash=SHA256(原文件); semantic_hash=SHA256(cleaned)
  → 版本判断:
       semantic_hash 已存在 → 跳过重建(即便导出格式/时间戳变)
       raw 变 semantic 同   → 仅更新 raw_hash
       semantic 变/新文档    → 新建 document_version(label 递增, published_at),旧版本保留,current 指向新版
  → hierarchical chunk(保留 {heading,section};超长用 embedding-chunk-limits 二切但保留归属)
  → createEmbeddingProvider(继承 memorySearch).embedBatch
  → upsert: chunks(text+embedding/vec0/fts5) + chunk_meta
  → 无 provider → 仅 fts5,降级关键词
```

---

## 6. Agent 注入(Evidence,预留 synthesize)

```
RetrievalService.search → KnowledgeEvidence[]
context-builder.promptBlock: 正文 + 出处(docTitle/section/sourceUri) + 版本(label/publishedAt) + 权限范围(kbTitle)
（预留 synthesize:topK 过多时压缩/聚类,防上下文窗口爆炸）
```

经现有注入点 `auto-reply/.../knowledge-universe-context.ts`、`cron/isolated-agent/run.ts` 生效。

---

## 7. 配置(继承 memorySearch)

```yaml
agents.defaults.memorySearch:
  provider: auto # local/openai/gemini/voyage/mistral/ollama
  fallback: local
# 知识库检索读取同一 embedding 配置 → memory 与 knowledge 同一向量空间
```

无 provider → 统一 FTS-only 降级。

---

## 8. 分步实施

| Step   | 内容                                                                                              | 风险 |
| ------ | ------------------------------------------------------------------------------------------------- | ---- |
| **1**  | `src/retrieval/` 平台骨架(types/service/RetrievalSource/visibility-resolver)+ KB 容器 store + RPC | 中   |
| **2**  | `document-extract`(pdf)+ `content-clean` + 两层 hash                                              | 中   |
| **3**  | `kb-index`(拆表+版本表)+ `chunkers/hierarchical` + `kb-ingest`                                    | 中高 |
| **4**  | `KnowledgeSource` + `kb-retrieve`(Primitive 函数 + 拆表 SQL)+ Visibility Resolver kb 级           | 中   |
| **5**  | `router.ts` 经 RetrievalService(无索引回退子串);`knowledge.base.search` RPC                       | 中   |
| **6**  | 自动入库钩子(collect/upload 归属库)                                                               | 低   |
| **7**  | Agent 注入 KnowledgeEvidence(版本+出处)                                                           | 中   |
| **8**  | 前端库内检索 + 成果中心(优化文档 P1)                                                              | 中   |
| **9**  | 工作区统一搜索 `knowledge.workspace.search` + 首页分组结果 UI(知识/企业/成果/能力/机器人/人员)    | 中   |
| **9b** | versionId 精确检索、推荐 reason、成果全文索引 `RetrievalSource`                                   | 中   |

**起点:Step 1 + Step 3 + Step 4**——打通"建库 →(heading+版本)入库 → 权限内语义召回 → Evidence"。

---

## 9. 验收

| 阶段   | 验收                                                                                                                                    |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Step1  | 平台可注册 source;建库/归属/列文件;权限字段就位                                                                                         |
| Step2  | PDF 抽取;同语义内容(改时间戳/重导出)命中 semantic_hash 跳过重建                                                                         |
| Step3  | 长文档按标题分块带 heading/section;V1→V2 两版本均在 document_versions;拆表写入正确                                                      |
| Step4  | 越权 seat 召回为空;单租户库 `kb_id IN` 单次召回;返回 KnowledgeEvidence                                                                  |
| Step5  | 库内问句检索带出处优于子串;旧子串路径仍可用                                                                                             |
| Step6  | 收录/上传即可检索                                                                                                                       |
| Step7  | 机器人引用"《文档 V版本(日期)》第X节"+ sourceUri;可指定历史版本检索                                                                     |
| Step8  | 知识首页 IA(当前库 Hero + 成果中心 + 资源/能力中心);`knowledge.base.search` 库内检索 UI;`knowledge.deliverables.*` 成果列表与归档       |
| Step9  | 首页一次查询返回 ≥4 类分组命中(知识/成果/企业/能力/机器人/人员);RPC `knowledge.workspace.search` 注册 READ scope;无索引时子串回退仍分组 |
| Step9b | `versionId` 检索;推荐卡片带 `reason`;成果 attach 后全文进入索引并可被 workspace 搜索召回                                                | ✅ Step 9b 已落地（见 step9b-report） |

---

## 10. `@knowledge-sdk` 微借鉴(仅一项)

- **heading-aware 层级分块思路** → `chunkers/hierarchical.ts`(参考其 `HierarchicalChunker`,MIT,重写为本仓规范)。
- 不借鉴:EmbeddingService(随机向量)、KnowledgeBasePersistenceService(哈希 ID 碰撞/client→server)、HybridSearch(全文/重排 TODO)、React UI、`workspace:*` 依赖。

---

## 11. 风险与多 agent 注意

| 风险                | 应对                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------ |
| 企业库膨胀          | 单租户 DB + `kb_id IN` 单次召回                                                            |
| 重复 embedding 成本 | 两层 hash 增量                                                                             |
| 权限穿透            | RetrievalService 强制 Visibility Resolver;预留 scope/chunk.visibility                      |
| 长文档检索质量      | heading-aware 分块                                                                         |
| 审计/版本困惑       | documents/document_versions 分离 + Evidence 版本                                           |
| 超宽表              | chunks / chunk_meta 拆表                                                                   |
| context 爆炸        | 预留 synthesize                                                                            |
| 联合检索重构        | `src/retrieval/` 平台 + RetrievalSource 抽象                                               |
| 向量空间不一致      | embedding 继承 memorySearch 单一来源                                                       |
| 复用边界误判        | 仅复用 Primitive 函数(见 §1 注)                                                            |
| 动态导入告警        | 对 memory 静态 import;改后 `pnpm build` 查 `[INEFFECTIVE_DYNAMIC_IMPORT]`                  |
| 多 agent 共享树     | `src/retrieval/*`、`knowledge/kb-*`、`knowledge-base-store.ts` 均新增文件;提交按 task 范围 |

---

## 12. 已解决的待确认项

1. 存储:`personal/<userId>.db` + `tenant/<tenantId>.db`,不做 per-kb DB。✅
2. docx:本期不做,仅 PDF/MD/Text。✅
3. 企业库可见性:复用 `feed/visibility-policy-mapping`(`evaluateProjectionVisibility`)做 kb 级;文档/章节级仅 schema 预留。✅

---

## 13. 本轮沉淀的三个长期基础设施

> 评审共识:本轮最大价值是抽出 **Retrieval Platform + Knowledge Runtime + Evidence Model** 三个可长期复用、可支撑成果中心/Agent Memory/企业知识库联合检索的基础设施。
