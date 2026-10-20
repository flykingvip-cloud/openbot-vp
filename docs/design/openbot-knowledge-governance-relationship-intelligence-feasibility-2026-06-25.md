# OpenBot 员工端 · 关系洞察 / 知识运行时智能层 可实施性评估与修订实施方案 v2

Date: 2026-06-25
版本：v2（整合专家评审意见）
评估对象：《OpenBot 员工端 · 关系洞察（知识治理系统）实施方案 v1.0》
评估方式：逐条对照仓库现有代码实证（非纸面推断）

> v1 → v2 变更：v1 完成「方案 vs 代码现状」的可实施性核验；v2 整合专家评审团的架构修正，
> 收敛为一份**可落地的 MVP 实施方案 + 前向兼容架构**。本文取代 v1 作为单一事实来源。

关联现状文档：

- `docs/design/openbot-knowledge-universe-final-task-plan-2026-06-05.md`（知识宇宙 v5 认知层定稿）
- `docs/design/openbot-knowledge-rag-step8-report-2026-06-14.md`（KB / 混合检索 / 成果中心）
- `docs/design/openbot-knowledge-universe-homepage-redesign-acceptance-2026-06-24.md`（首页重构验收）
- `.kiro/specs/cost-budget-billing/`（成本与预算计费系统，本文治理预算与之协同但不混淆）

---

## 0. 修订摘要（v2，TL;DR）

总体判断保持不变：**方向成立、可实施；必须从「新建一个治理模块」重构为「在既有知识宇宙关系层上做纵深扩展」。** 专家评审在此基础上贡献了四条会决定系统长期成败的架构修正，v2 全部纳入并落到可执行粒度：

1. **边膨胀是当前头号工程风险** → 决策：`semantic_similarity` 边**不持久化**，改为查询时动态 KNN；只持久化 `duplicate / conflict / reference` 三类「判定结果边」。
2. **治理 = 异步 AI 系统** → 引入 **Governance Job Runtime**（作业类型 + 状态机），但 MVP 用「SQLite 作业表 + 单进程循环 + 每轮硬上限」最小实现，不上分布式队列。
3. **检索应是治理感知的（Governance-aware Retrieval）** → 治理不是后处理外挂，而是检索打分信号本身：`final = hybrid × trust × freshness × verified`（缺失值→1.0 不惩罚）。
4. **三层模型 Object / Chunk / Claim** → MVP 只做 Object + Chunk；Claim 级治理（真正的冲突粒度）明确推迟到 Phase 4+。

同时采纳但**降级为前向兼容预留**（不在 MVP 建设）：专家权威模型、自动合并、向对象层写回。理由见 §0.1 与 §13。

最重要的一条（与专家最终建议一致）：**MVP 立即收敛为四件事——重复检测、冲突检测、治理任务、RAG 重排。** 其余一律 Phase 3+ / Phase 4+，先把闭环跑通再扩。

### 0.1 专家建议处置表（逐条决策）

| #   | 专家建议                                                | 处置                                  | 落点     |
| --- | ------------------------------------------------------- | ------------------------------------- | -------- |
| E1  | 附加表策略（不改 chunks）                               | ✅ 采纳（v1 已含）                    | §5       |
| E2  | 治理对象应是 Claim 而非 chunk                           | 🕓 方向采纳，推迟 Phase 4+            | §4、§14  |
| E3  | 不持久化 semantic_similarity 边，改查询时 KNN           | ✅ **立即采纳（关键）**               | §5、§6   |
| E4  | 需要 Governance Job Runtime（作业类型/状态机/资源控制） | ✅ 采纳，MVP 最小实现                 | §7       |
| E5  | 专家权威模型（weight/domain/verification_level）        | 🕓 schema 预留，MVP weight=1.0        | §8       |
| E6  | Governance-aware Retrieval（乘性打分）                  | ✅ 采纳                               | §9       |
| E7  | 治理结果写回对象级关系运行时                            | 🕓 采纳为目标，受身份桥接缺口约束推迟 | §10、§15 |
| E8  | UI = Issue Resolution Center（问题流优先，图谱按需）    | ✅ 采纳                               | §11      |
| E9  | 系统更名为 Knowledge Runtime Intelligence Layer         | ✅ 采纳（内部架构名）                 | §2       |
| E10 | 立即收敛 MVP，不做 entity/topic/behavior/auto-merge     | ✅ **采纳（最高优先）**               | §13      |

> 图例：✅ 立即采纳　🕓 方向采纳但本期不建设（预留/推迟）

---

## 1. 现状基线（代码实证）

知识工作台对外产品名为 **「知识宇宙（Knowledge Universe）」**，已上线、持续迭代（M1–M3 + RAG step8 + 首页重构）。与「关系/治理」相关的能力当前被拆为 **两套互不连通的系统**：

### 1.1 系统 A：KB 索引（chunk 级，真实 RAG）—— 治理应接入的底座

- 文件：`src/gateway/knowledge/kb-index.ts`、`kb-index-schema.ts`、`kb-ingest.ts`、`kb-retrieve.ts`
- 存储：按租户/个人分库 SQLite，`resolveKnowledgeIndexDbPath()` → `~/.openbot/knowledge/index/{tenant|personal}/<id>.db`（方案描述准确）。
- 现有表（`ensureKnowledgeIndexSchema`）：`documents`、`document_versions(... raw_hash, semantic_hash ...)`、`chunks(id, text, model)`（仅 3 列）、`chunk_meta(chunk_id, kb_id, doc_id, version_id, heading, section, start_line, end_line, visibility, source)`、`chunks_vec`（sqlite-vec `vec0`）、`chunks_fts`（FTS5）。
- 检索：`retrieveKnowledgeFromIndex()` = 向量(0.7)+BM25(0.3) 混合，经 `src/memory/hybrid.ts` 的 `mergeHybridResults` 融合。
- 写入：`ingestKnowledgeDocument()`：抽取 → 版本 delta → 分块（`chunkers/hierarchical.ts`）→ 嵌入（`embedBatch`）→ `insertKnowledgeChunks`；每个 chunk 已带内容哈希（`chunk.hash`）。
- 关键约束：**嵌入可选**。agent 未开 memory-search 时走 `FTS_ONLY_EMBEDDING_MODEL`，`chunks_vec` 为空 → 一切依赖嵌入的治理能力必须能在「仅 FTS」下降级。

### 1.2 系统 B：关系运行时（对象级，启发式，内存）—— 当前关系页的引擎

- 文件：`runtime/relationship-runtime.ts`（`buildIntelligentRelationshipGraph`）、`relationship-builder.ts`、`relationship-conflict-detector.ts`、`relationship-score-engine.ts`、`relationship-recommendation.ts`、`related-groups.ts`、`agent-cognitive-adapter.ts`
- 粒度：操作 `KnowledgeObject`（document/policy/template/...），**非 chunk**；当前对象数据相当部分由 `mock-graph.ts` / 前端 `mock-backend.ts` 提供，对象 id 形如 `obj:agent:sales-bot`，**与 KB `doc_id` 不共享身份**（这是 §10 写回的根本约束）。
- 类型（`types.ts`）：`RelationshipGraph{nodes,edges}`、边类型已含 `conflicts|supports|related|derived-from|owned-by|used-by|recommended-for`；`KnowledgeObject` 已带 `freshnessStatus: fresh|stale|expired` 与 `relationshipSummary{relatedCount,conflictCount,supportingCount}`。
- 冲突检测现状：`relationship-conflict-detector.ts` 为**关键词标记启发式**（`增长/下降`、`通过/否决`…），非嵌入/实体/LLM。
- 问题子图：`graph-builder.ts` 的 `filterRelationshipGraph({focusNodeId})` + `related-groups.ts` 已实现「围绕某节点的局部子图」。**方案 §7「问题解释器」在对象级已存在。**

### 1.3 已有 UI（关系页 + 图谱画布）—— Dashboard 应扩展而非新建

- 路由：`ui/src/ui/views/knowledge-universe-page.ts`，`pageTab ∈ {workbench, relations, supply, personal, deliverables, assets}`。
- 图谱画布：`knowledge-universe-graph-canvas.ts`（SVG 缩放/平移/选中/悬停）。
- 关系页 / 洞察网格 / 详情预览：`knowledge-universe-relations-section.ts`、`knowledge-universe-insights-grid.ts`（已渲染冲突/关联标签）、`knowledge-universe-detail-preview.ts`（冲突计数）。
- 能力层：`ui/src/ui/capability/knowledge-universe/{types.ts, graph-layout.ts, graph-view-model.ts, gateway-client.ts, mock-backend.ts}`，`mock-backend.ts` 已有 `mockKnowledgeRelationships({query, focusNodeId})`（带 focus 的关系 RPC 契约形态）。

> 命名冲突提醒：员工端已有 `render-model-governance-actions.ts` / `workbench-member-governance-state.ts`，属**成员/组织治理**，与知识治理无关。新模块统一用 `knowledge-governance` 前缀。

---

## 2. 系统定位与命名修正

- **内部架构名（采纳 E9）**：**Knowledge Runtime Intelligence Layer（知识运行时智能层）**。它已不止于「治理」，而是介于 RAG 与认知层之间、持续运行的智能层。
- **对用户呈现名**：沿用「关系洞察」，作为「知识宇宙 · 关系页（`relations` tab）」的纵深能力，不另起一个并行 UI 模块。
- **定位修正**：在既有关系页之上新增 **chunk 级治理数据源 + 异步作业运行时 + 治理感知检索**；复用既有图谱类型/画布/问题子图，避免对象级与 chunk 级两套「冲突计数」在同一界面打架。

---

## 3. 方案声明 vs 代码现状（勘误表，沿用 v1 核验）

| #   | 方案声明                                                                        | 代码现状                                                                   | 结论                    |
| --- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------- |
| 1   | 复用 `src/memory/embeddings.ts`、`sqlite-vec.ts`                                | 存在                                                                       | ✅                      |
| 2   | 复用 `embedding-chunk-limits.ts` chunking                                       | 存在；实际分块在 `chunkers/hierarchical.ts`                                | ✅ 基本准确             |
| 3   | Hybrid 在 `src/gateway/knowledge/rag/`，含 `manager-search.ts/hybrid.ts/mmr.ts` | **路径错误**：在 `src/memory/`；无 `rag/` 目录；KB 检索为 `kb-retrieve.ts` | ❌ 修正                 |
| 4   | 具备 vector/BM25/**MMR**/temporal decay                                         | `mmr.ts`/`temporal-decay.ts` 在 `src/memory/`，但 **KB 检索路径未接 MMR**  | ⚠️ MMR 在 KB 路径未启用 |
| 5   | 当前缺关系层                                                                    | chunk 级关系确实缺；但**对象级关系层已存在**                               | ⚠️ 以偏概全             |
| 6   | **新增** `governance/` 目录                                                     | **已存在**（仅 `compliance.ts`）                                           | ❌ 应扩展               |
| 7   | **扩展 chunks 表**加 6 列                                                       | 全仓库无 `ALTER TABLE`/迁移框架                                            | ❌ 改附加表（§5）       |
| 8   | 新增 `graph_nodes`                                                              | chunk 即节点，`chunk_meta` 已是节点元数据                                  | ⚠️ 冗余，删             |
| 9   | `semantic_hash` 作为 chunk 列                                                   | 已存在于 `document_versions`（文档级）；chunk 级才是新增                   | ⚠️ 澄清粒度             |
| 10  | 「旧知识被新版覆盖」                                                            | 版本系统已存在（`document_versions`+`current_version_id`+delta）           | ✅ 有底座               |
| 11  | freshness 维度                                                                  | `KnowledgeFreshnessStatus` 已存在（对象级）                                | ✅ 有底座               |
| 12  | 问题子图/局部图                                                                 | `filterRelationshipGraph(focusNodeId)` 已实现                              | ✅ 可迁移 chunk 级      |
| 13  | quality_score 含 usage/reference_count                                          | 无检索命中埋点、无跨 chunk 引用抽取                                        | ❌ 依赖新埋点（§9）     |

---

## 4. 三层模型（Object / Chunk / Claim）—— 采纳 E2

专家关键洞察：真正发生冲突的不是 chunk（一个 chunk 含多个事实），而是 **Claim（知识声明）**。例如「销售返点 = 15%」与「= 18%」冲突在**一个字段**，而非整段。因此长期正确的治理粒度是 Claim。

| 层                     | 实体                                   | 现状                          | 本期                       | 治理角色              |
| ---------------------- | -------------------------------------- | ----------------------------- | -------------------------- | --------------------- |
| 对象层（认知层）       | `KnowledgeObject`                      | 已有（启发式/内存/部分 mock） | 不改造，仅作导航与计数展示 | 导航 / 总览计数       |
| Chunk 层（RAG 层）     | `chunks` + `chunk_meta` + `chunks_vec` | 已有                          | **MVP 治理在此层落地**     | 重复/冲突/重排        |
| Claim 层（未来治理层） | claim（chunk → 实体/声明抽取）         | 无                            | **不建设**                 | 精确冲突 / 稳定 merge |

**本期立场**：MVP 在 chunk 层做「粗粒度但可用」的冲突/重复治理，足以驱动闭环与 RAG 重排；**显式接受 chunk 粒度偏粗**，把「精确到字段」的诉求留给 Phase 4+ 的 Claim Extraction Layer（`chunk → entity/claim extraction → claim graph`）。这样可避免现在就背上实体抽取/对齐的复杂度与成本。

---

## 5. 数据模型（附加表，零迁移风险）—— 采纳 E1 + E3

### 5.1 硬约束

`ensureKnowledgeIndexSchema()` 仅 `CREATE TABLE IF NOT EXISTS`，全仓库无 `ALTER TABLE`/`PRAGMA table_info`/迁移工具。故**不改 `chunks` 表**，全部新增附加表。

### 5.2 MVP 表（仅建设支撑「四件事」的表）

```sql
-- chunk 级治理评分与状态（一行一 chunk）
CREATE TABLE IF NOT EXISTS chunk_governance (
  chunk_id TEXT PRIMARY KEY,
  kb_id TEXT NOT NULL,
  quality_score REAL,
  trust_score REAL,
  freshness_score REAL,
  semantic_hash TEXT,           -- chunk 级语义哈希（新增；区别于 document_versions.semantic_hash）
  duplicate_group_id TEXT,
  conflict_group_id TEXT,
  governance_status TEXT,       -- pending|confirmed|merged|archived|suppressed
  reference_count INTEGER DEFAULT 0,
  last_hit_at INTEGER,
  last_analyzed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_chunk_gov_kb ON chunk_governance(kb_id);
CREATE INDEX IF NOT EXISTS idx_chunk_gov_dup ON chunk_governance(duplicate_group_id);
CREATE INDEX IF NOT EXISTS idx_chunk_gov_conflict ON chunk_governance(conflict_group_id);

-- chunk 级「判定结果边」：仅持久化 duplicate/conflict/reference（采纳 E3）
-- ❌ 不持久化 semantic_similarity —— 它是查询时动态 KNN，见 §6.4
CREATE TABLE IF NOT EXISTS chunk_relations (
  id TEXT PRIMARY KEY,
  kb_id TEXT NOT NULL,
  from_chunk TEXT NOT NULL,
  to_chunk TEXT NOT NULL,
  relation_type TEXT NOT NULL,  -- 仅 duplicate|conflict|reference（CHECK 约束）
  weight REAL,
  created_at INTEGER NOT NULL,
  CHECK (relation_type IN ('duplicate','conflict','reference'))
);
CREATE INDEX IF NOT EXISTS idx_chunk_rel_kb ON chunk_relations(kb_id);
CREATE INDEX IF NOT EXISTS idx_chunk_rel_from ON chunk_relations(from_chunk);

-- 治理任务（= UI 问题流的数据源；人面向）
CREATE TABLE IF NOT EXISTS governance_tasks (
  id TEXT PRIMARY KEY,
  kb_id TEXT NOT NULL,
  task_type TEXT NOT NULL,      -- duplicate|conflict|stale|orphan
  status TEXT NOT NULL,         -- open|in_review|resolved|dismissed
  priority INTEGER DEFAULT 0,
  related_chunk_ids TEXT,       -- JSON 数组
  proposed_resolution TEXT,     -- JSON
  assigned_to TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gov_task_kb_status ON governance_tasks(kb_id, status, priority);

-- 治理作业（= 后台 AI 工作；机器面向，见 §7）
CREATE TABLE IF NOT EXISTS governance_jobs (
  id TEXT PRIMARY KEY,
  kb_id TEXT NOT NULL,
  job_type TEXT NOT NULL,       -- dedup|conflict-analysis|orphan-scan|quality-refresh（MVP 仅前两类必需）
  status TEXT NOT NULL,         -- pending|running|retrying|dead_letter|paused|resolved
  priority INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  payload TEXT,                 -- JSON
  last_error TEXT,
  scheduled_at INTEGER,
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gov_job_pick ON governance_jobs(status, priority, scheduled_at);

-- 人工确认标注（MVP 含权威字段快照位，但不参与计分）
CREATE TABLE IF NOT EXISTS governance_annotations (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  expert_id TEXT NOT NULL,
  action TEXT NOT NULL,         -- confirm|reject|merge|edit
  comment TEXT,
  expert_weight REAL DEFAULT 1.0,     -- MVP 恒为 1.0（见 §8）
  verification_level TEXT,            -- 快照位，MVP 可空
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gov_anno_task ON governance_annotations(task_id);
```

修正点：删除方案 `graph_nodes`（chunk 即节点）；`semantic_hash` 明确 chunk 级；区分 `governance_tasks`（问题流/人）与 `governance_jobs`（后台作业/机）。

### 5.3 前向兼容预留（不在 MVP 建设，进入对应阶段再 `CREATE`）

- `governance_expert_authority(expert_id, domain_scope, expert_weight, verification_level, granted_by, created_at)` —— Phase 3+（§8）。
- Claim 层表（`claims`、`claim_relations`）—— Phase 4+（§4）。

---

## 6. 发现层

### 6.1 重复检测（全新，高可行）

- 精确：chunk 已有内容哈希（`chunk.hash`）直接去重；新增 chunk 级 `semantic_hash`（归一化文本 / SimHash）。
- 近似：**必须用 `chunks_vec` 向量 KNN（`vec_distance_cosine` top-k）**，禁止 O(n²) 全量两两比对；阈值 cosine>0.95 合理。
- LLM 同义验证：可选第三阶段，纳入作业预算（§7）。
- 降级：FTS-only（无嵌入）退化为「内容哈希 + FTS 高重叠」。

### 6.2 冲突检测（升级，非新建）

- 现 `relationship-conflict-detector.ts` 是对象级关键词启发式；chunk 级冲突为新代码：KNN 召回候选 → 数值/关键标记对齐 → （可选）LLM 矛盾判定 → 产出 `chunk_relations(conflict)` + `conflict_group_id` → 生成 `governance_tasks(conflict)`。
- 复用既有 `conflicts` 边语义与冲突计数 UI。

### 6.3 孤立检测（数据已具备，规则即可）

- chunk 级：`chunk_relations` 邻居数 + `last_hit_at` 阈值 → `governance_tasks(orphan)`，用于清理/归档。无需模型。

### 6.4 语义相似边：查询时动态生成（采纳 E3，关键）

- **不写 `chunk_relations`**。需要「相似邻居」时（如问题子图展开、相关推荐）**实时跑 `chunks_vec` KNN** 取 top-k 返回，用完即弃。
- 收益：避免边数指数膨胀、规避 re-embedding 后历史边全失效的维护灾难、图规模可控。
- 持久化的只有「判定结论」（重复/冲突/引用），它们是离散、可审计、数量有界的。

---

## 7. Governance Job Runtime（采纳 E4，MVP 最小实现）

**现状实证**：`src/**` 无任何 job/queue/scheduler/dead-letter 基础设施（grep 无匹配）。故作业运行时为**净新增**——但**绝不引入分布式队列**，否则违背「立即收敛」。

MVP 形态：

- 存储：`governance_jobs` 表即作业队列（SQLite，随 KB 分库，天然租户隔离）。
- 执行：**单进程作业循环**，每轮 `SELECT ... WHERE status='pending' ORDER BY priority, scheduled_at LIMIT N`，串行处理；与网关进程同生命周期。
- 状态机：`pending → running → resolved`；失败 `running → retrying`（`attempts<max`）/ `dead_letter`（超限）；`paused` 供人工暂停。**MVP 落地 pending/running/resolved/retrying/dead_letter 五态，priority 仅作排序位**。
- 资源控制（关键，防「后台风暴」）：每轮**硬上限**——最大处理条数、最大 LLM 调用数、最大嵌入调用数；超限即停，下轮续跑（增量分析，只处理新入库/变更 chunk）。
- 触发：`ingestKnowledgeDocument()` 完成 `insertKnowledgeChunks` 后**异步入队**（写 `governance_jobs`，不阻塞 ingest）。

作业类型（MVP 仅前两类必需）：`dedup`、`conflict-analysis`；预留 `orphan-scan`、`quality-refresh`。

**与 cost-budget-billing 的关系（不混淆）**：治理作业内部的 LLM/嵌入「预算」是**节流闸**，与 `.kiro/specs/cost-budget-billing/` 的 SaaS 计费（seat/usage/plan）是两件事。长期可让治理 LLM 消耗发 `UsageReportedEvent` 以纳入成本归因，但该集成**推迟**，MVP 仅做本地硬上限。

**明确推迟**：优先级队列、分布式 worker、自动重试退避策略、跨进程调度。

---

## 8. Expert Authority Model（采纳 E5 方向，MVP 预留）

专家洞察正确：`governance_annotations` 当前仅是 comment 级；企业里「谁确认」（法务负责人 vs 任意人）应影响 trust/ranking/policy。

但**现状无任何 expert/verification/authority/trust 模型**（grep 无匹配），完整建设成本高且非闭环必需。故：

- **MVP**：`governance_annotations.expert_weight` 恒为 `1.0`、`verification_level` 记录但不参与计分——即「任何确认一律等权」。先把人工确认闭环跑通。
- **Phase 3+**：建 `governance_expert_authority`（`expert_weight / domain_scope / verification_level`），并让 `trust_score` 计算消费它（确认者权威越高、领域越匹配 → trust 越高）。权威来源建议对接现有运营身份/席位体系（`operational-identity-governance` spec），避免再造一套身份。

---

## 9. Governance-aware Retrieval（采纳 E6）

从「检索后处理重排」升级为「治理是打分信号本身」：

```
final_score = hybrid_score
            × clamp(trust_score,    floorT, ceilT)     -- 缺失 → 1.0
            × clamp(freshness_score,floorF, 1.0)        -- 缺失 → 1.0
            × verified_weight                            -- 已确认>1，冲突<1，缺失 → 1.0
```

实现要点（插入点清晰）：

- 写入埋点：在 `retrieveKnowledgeFromIndex()` 命中后写回 `chunk_governance.reference_count` / `last_hit_at`（补齐 §3#13 缺口的 usage 维度）。
- 打分接入：候选 SQL 已 JOIN `chunk_meta`，加 `LEFT JOIN chunk_governance`；在 `mergeHybridResults` 之后、`.slice(0, maxResults)` 之前应用乘性因子。
- **防过罚 / 兼容**：各因子 `clamp` 到有界区间（如 trust∈[0.5,1.2]、verified 默认 1.0、冲突降至 ~0.7）；**治理数据缺失（NULL）一律取 1.0**，保证无治理数据时检索行为与现状完全一致（关键兼容性约束）。
- 降级：FTS-only 同样适用（治理因子与嵌入无关）。
- Prompt 注入：`agent-cognitive-adapter.ts` 对「已确认/存在冲突」chunk 加语义标注。

---

## 10. Governance → 对象层写回（采纳 E7 为目标，受约束推迟）

专家担忧成立：若 chunk 级冲突已解决而对象图仍显示冲突，系统失真。

**但存在身份桥接缺口**：对象层 `KnowledgeObject`（id 如 `obj:agent:sales-bot`，部分来自 mock）与 chunk 层 `doc_id` **当前不共享身份**，对象层关系是内存启发式重算。因此「治理结果写回对象图」**目前无法低成本实现**。

分阶段处置：

- **MVP（防失真的务实做法）**：在治理 UI 内，**chunk 级治理计数是唯一事实来源**；对象级关系页保持其既有启发式展示，二者是不同 surface，不在同一视图并列「冲突数」→ 当期不产生可感知失真。
- **Phase 3+**：建立 `doc_id ↔ KnowledgeObject` 身份桥（前提：对象层由真实 KB 文档供数，而非 mock），再实现写回：治理解决 → 更新对象 `relationshipSummary.conflictCount` / 抑制已解决冲突边。
- 列为待决策项 §15#1。

---

## 11. UI：Issue Resolution Center（采纳 E8）

从「Dashboard + Graph + Operations」升级为**问题解决中心**：

- **首页核心 = 问题流**（不是图谱）：`governance_tasks` 列表，按类型（冲突/重复/过期/孤立）+ 优先级排序；顶部仅一行健康计数条（冲突/重复/低质量）。
- **图谱按需出现**：仅在「打开某个问题」后，于问题详情内渲染**该问题的局部子图**——复用 `knowledge-universe-graph-canvas.ts` + `filterRelationshipGraph(focusNodeId)` + 查询时 KNN（§6.4），数据源换成 chunk 级。
- **治理操作随问题动态出现**（执行层不常驻）：确认/忽略/（Phase 2）合并建议；参考既有 `onCreatePublishIntent` 行内动作范式。
- 入口：扩展 `knowledge-universe-insights-grid.ts` 增「知识治理」卡片；新增 `pageTab="governance"`，复用 `renderKnowledgeUniverseSecondaryShell` 二级页骨架。
- 测试：`*.browser.test.ts`（参考 `platform-capabilities-shell.browser.test.ts`）。

---

## 12. 风险评估（v2 更新）

| 风险                             | 说明                                          | 应对                                           | 状态          |
| -------------------------------- | --------------------------------------------- | ---------------------------------------------- | ------------- |
| R1 无迁移框架                    | 改 chunks 列对存量库不生效                    | 全用附加表（§5）                               | 已规避        |
| R2 嵌入可选                      | FTS-only 无向量                               | 全部检测/打分做降级                            | 已纳入设计    |
| R3 相似度复杂度                  | O(n²) 不可行                                  | 强制 vec0 KNN top-k + 增量                     | 已纳入        |
| R4 边膨胀（**头号风险**）        | semantic_similarity 边指数增长、re-embed 失效 | **不持久化，查询时 KNN**（§6.4）               | **已规避**    |
| R5 双系统冲突计数                | 对象级/chunk 级两套计数打架                   | 治理 UI 以 chunk 级为唯一口径（§10）           | 已规避（MVP） |
| R6 后台风暴                      | 治理作业规模化耗尽 LLM/嵌入                   | Job Runtime 每轮硬上限 + 增量（§7）            | 已纳入        |
| R7 LLM 误判冲突                  | 粗粒度误报                                    | 人工确认闭环；Claim 层精化（Phase 4+）         | 部分缓解      |
| R8 治理埋点缺失                  | usage/reference_count 无源                    | 检索命中埋点（§9）                             | 已纳入        |
| R9 多租户/权限                   | 治理读写须守 KB 可见性/席位                   | 复用 `seat-capability-access.ts`；作业按库隔离 | 已纳入        |
| R10 网关无热重载                 | `dist/` 改动需重启                            | 落地后重启网关验证                             | 流程项        |
| R11 复杂度爆炸（**专家最警惕**） | 过早做 entity/topic/auto-merge                | 严格 MVP 收敛（§13）                           | 治理纪律      |

---

## 13. MVP 收敛（采纳 E10，最高优先级）

**MVP 只做四件事**：

1. **重复检测**（`dedup`）
2. **冲突检测**（`conflict-analysis`，粗粒度 chunk 级）
3. **治理任务**（`governance_tasks` 问题流 + 人工确认）
4. **RAG 重排**（governance-aware retrieval）

为支撑这四件事，附带两个**当下就必须定对、但成本极低**的架构决策：① 不持久化 semantic_similarity 边（§6.4）；② 检索命中埋点（§9）。

**MVP 明确不做（写入纪律，越界需评审批准）**：

- ❌ Claim / entity 抽取与 claim graph（Phase 4+）
- ❌ topic evolution / behavior graph
- ❌ 自动合并写回（AI auto merge）—— 至多做「合并建议 + 人工确认」，且不在 MVP
- ❌ 全自动治理（无人确认即改 RAG/对象图）
- ❌ 专家权威加权（MVP 等权，§8）
- ❌ 向对象层写回（§10，Phase 3+）
- ❌ 分布式作业队列 / 优先级调度（§7）

---

## 14. 修订后分阶段计划

### Phase 0：地基（前置，方案原缺）

1. `kb-index-schema.ts`：`ensureKnowledgeIndexSchema` 增 §5.2 五张 MVP 附加表（`CREATE IF NOT EXISTS` + `CHECK`）。
2. `kb-retrieve.ts`：检索命中埋点（写 `chunk_governance.reference_count`/`last_hit_at`）。
3. 确定 chunk 级 vs 对象级冲突计数口径（R5）。

### Phase 1：发现层 MVP（四件事之 1、2）

1. `governance/detection/duplicate-detector.ts`（哈希 + chunk `semantic_hash` + 向量 KNN；FTS-only 降级）。
2. `governance/detection/conflict-detector.ts`（KNN 召回 + 标记对齐 + 可选 LLM；产 `chunk_relations(conflict)` + `governance_tasks`）。
3. `governance/runtime/job-runner.ts`（§7 最小作业循环 + 硬上限）；`kb-ingest.ts` 完成后入队。

### Phase 2：执行层 + UI MVP（四件事之 3）

1. `governance_tasks`/`governance_annotations` 状态机 + RPC（参考 `src/gateway/server-methods/` 知识 RPC 风格）。
2. UI：`pageTab="governance"` 问题流（Issue Resolution Center，§11）+ 问题子图（复用画布）+ 确认/忽略操作。
3. （可选）合并**建议**（不自动写回）。

### Phase 3：治理感知检索 + 权威（四件事之 4 + E5/E7）

1. `chunk_governance` 评分（freshness/consistency/verified；usage 来自 Phase 0 埋点）。
2. `kb-retrieve.ts` 乘性治理打分（§9，含 clamp 与 NULL→1.0）。
3. `governance_expert_authority` + trust 加权（§8）。
4. `doc_id ↔ KnowledgeObject` 身份桥 + 对象层写回（§10，依赖对象层去 mock 化）。

### Phase 4+：Claim 层与关系智能（长期）

- Claim Extraction Layer（`chunk → claim → claim graph`，§4）；entity/topic/behavior graph 按需，且优先复用对象级关系运行时结构。

---

## 15. 待决策项

1. **对象↔文档身份桥**：对象层何时由真实 KB 文档供数（去 mock）？这是 §10 写回的前置。（影响 R5/E7）
2. **冲突检测是否强依赖 LLM**：是否接受 FTS-only 下冲突仅弱启发式？（影响 R2/R6/成本）
3. **自动合并边界**：是否一律「建议 + 人工确认」，禁止任何自动写回？（建议：是）
4. **专家权威来源**：Phase 3 权威模型对接 `operational-identity-governance` / 席位，还是独立？（§8）
5. **治理预算 vs 计费**：治理 LLM/嵌入消耗是否、何时纳入 `cost-budget-billing` 的 `UsageReportedEvent`？（§7）
6. **Claim 粒度时机**：Phase 4+ 是否启动，取决于 chunk 级冲突误报率与专家复核成本的实测数据。

---

## 16. 验收与测试

- 单测：colocated `*.test.ts`，目标 `src/gateway/knowledge/**`；内存压力大时 `OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test <paths>`。
- 检测准确性：构造重复/冲突/孤立样本库，校验 precision/recall（冲突需人工标注集）。
- **降级路径必测**：FTS-only（无嵌入）用例。
- **作业运行时**：每轮硬上限生效、增量只处理新 chunk、dead_letter 流转、租户隔离。
- **检索兼容性**：治理数据全 NULL 时 `final_score` 与现状逐位一致（NULL→1.0 不惩罚）。
- RAG 回归：治理重排开关前后检索质量对比。
- UI：`*.browser.test.ts` 覆盖问题流 + 问题子图按需展开。
- 落地后按 `AGENTS.md` 重启网关（`dist/` 不热重载）再端到端验证。

---

## 附录 A：方案目录 → 实际落点映射

| 方案目录                                    | 实际落点（修正）                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/gateway/knowledge/governance/`（新建） | **已存在**，扩展之；新增 `detection/`、`resolution/`、`runtime/`、`scoring/`                     |
| `graph/`                                    | 复用对象级 `runtime/` + `graph-builder.ts`；chunk 级仅加 `chunk_relations`（判定边）+ 查询时 KNN |
| `models/`                                   | chunk 级类型新增；复用 `types.ts` 的 `RelationshipGraph`                                         |
| `visualization/`                            | **复用** `knowledge-universe-graph-canvas.ts`，不新建                                            |
| `services/`                                 | 复用 `src/memory/{embeddings,sqlite-vec,hybrid}.ts` + `kb-index.ts`/`kb-retrieve.ts`             |

## 附录 B：关键文件索引（实证锚点）

- 索引/写入：`src/gateway/knowledge/kb-index-schema.ts`、`kb-index.ts`、`kb-ingest.ts`
- 检索：`src/gateway/knowledge/kb-retrieve.ts`、`src/memory/hybrid.ts`、`src/memory/mmr.ts`
- 嵌入：`src/memory/embeddings.ts`、`sqlite-vec.ts`、`embedding-chunk-limits.ts`
- 对象级关系：`runtime/relationship-runtime.ts`、`relationship-conflict-detector.ts`、`relationship-score-engine.ts`、`related-groups.ts`、`graph-builder.ts`、`mock-graph.ts`
- 类型：`src/gateway/knowledge/types.ts`；既有 governance：`governance/compliance.ts`
- UI：`ui/src/ui/views/knowledge-universe-page.ts`、`knowledge-universe-relations-section.ts`、`knowledge-universe-graph-canvas.ts`、`knowledge-universe-insights-grid.ts`、`knowledge-universe-detail-preview.ts`
- UI 能力层：`ui/src/ui/capability/knowledge-universe/{types.ts,graph-layout.ts,graph-view-model.ts,gateway-client.ts,mock-backend.ts}`、`ui/src/ui/controllers/knowledge-universe.ts`
- 协同 spec：`.kiro/specs/cost-budget-billing/`、`.kiro/specs/operational-identity-governance/`
