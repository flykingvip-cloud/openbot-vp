---
name: five-layer-qa
description: 给 OpenBot 知识宇宙设计 lint、质量档、引文核验或检索过滤策略时使用。遇到「五层质检」「stub 到 premium」「引文必须能 grep」「governance summary」务必使用本技能。
user-invocable: true
---

# 知识库五层质检

质量看治理健康和引文能否 grep，不看「已向量化篇数」。后端没有五层质量 API。下面五层是技能流程，映射到已有信号。Lint 失败不得当 featured 推出。能脚本化的不要用模型做质检。

## 五层（从便宜到贵）

1. **源/格式**  
   ingest 是否成功、originals 是否可 `knowledge.document.preview`。`.doc` 可能接受但不解析。失败则停在这一层。

2. **切块/版本**  
   `document_versions.raw_hash` / `semantic_hash`；`chunk_meta.start_line`/`end_line`；`knowledge.personal.compareVersions`。无锚点不得升档。

3. **检索可召回**  
   用原文句子打 `knowledge.base.search`。命中 indexed chunk 才算。substring 兜底不算 featured。不要把 `vec0` 当验收。

4. **声明一致**  
   `knowledge.governance.claims.list` + claim_relations（`duplicate`/`conflict`/`supports`/`reference`）。冲突未决议不得当事实推出。

5. **治理健康 + 人抽检**  
   `knowledge.governance.summary`（healthScore、openConflictCount、quality/trust/freshness）+ `tasks.list`。人看 5–10%，低信任优先。

## 质量光谱（技能档，不是库字段）

`stub`（仅容器）→ `indexed`（有 chunk）→ `claimed`（有 heuristic claims）→ `governed`（无 open conflict 或已决议）→ `cited`（答案带可 grep 的 evidence_span / `ku://` 坐标）

- 检索/门户默认只推 `governed` 及以上（`governanceStatus` 为 `healthy`）
- stub 可存在，不要堆积
- 升档必须过 `source-lock-and-cite`：preview 然后原句 search 然后模型（最后）

## 红旗

- 引文无法在 preview 原文检索到
- 把交付物或 `auto_analysis` 写进引文
- 覆盖已有原文 / 已确认 claim
- healthScore 无区分度（先修解读，不要再堆 LLM 打分）

## 执行

对一个 `kbId`：`governance.summary` + `tasks.list` + `claims.list` + 抽样 `base.search` + 抽样 `document.preview`。结果写入交付物，不要发明 `knowledge.qa.report`。
