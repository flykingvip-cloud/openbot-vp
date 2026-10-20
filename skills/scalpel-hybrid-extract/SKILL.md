---
name: scalpel-hybrid-extract
description: 在 OpenBot 知识宇宙里拆解抽取任务、在规则/脚本/模型之间做选型、或有人主张全部丢给大模型时使用。遇到「能用规则绝不用 LLM」「混合抽取」「claims 怎么来」务必使用本技能。
user-invocable: true
---

# 柳叶刀混合抽取

手术刀切分，不要端到端大锤。能用规则或脚本完成的，禁止调用模型。

抽取结果进入现有 **claims** 层（ingest/治理作业写入，`extraction_method` 默认 `heuristic`）。**没有** `knowledge.governance.claims.write`。Agent 不得直接改 SQLite，也不得发明写入 RPC。

## 决策树

1. 有标准答案或查表？ → 代码
2. 可枚举模式（格式、类型、金额、日期、条款号）？ → 规则/正则
3. 结构化匹配（同文、同 hash、同系统）？ → 代码（`raw_hash` / `semantic_hash`、chunk `start_line`/`end_line`）
4. 需要语义（因果、意图、未言明约束）？ → 模型，且只进派生层
5. 可安全自动？ → 规则筛候选 + 模型确认
6. 否则 → 人工（宁可漏自动，不可错扩散）

## 对接口

底本（只增不改字）：

- `knowledge.personal.upload` / `collect` / `collectWeb` / `importDataset`
- `knowledge.source.ingest`
- `knowledge.local-folder.sync.commit`

读抽取与冲突：

- `knowledge.governance.claims.list`（`kbId` 或 `chunkIds`）
- `knowledge.governance.summary`
- `knowledge.governance.tasks.list` / `tasks.graph`
- `knowledge.document.preview`、`knowledge.personal.compareVersions`

派生（模型产出，非主数据）：

- `knowledge.deliverables.saveAndArchive` — 记录 method / confidence / evidence_span
- `knowledge.base.agent-knowledge.generate` — 仅 `auto_analysis` / `auto_relation`；禁止把 LLM 因果当成已确认 claim

纠错（人审）：

- `knowledge.governance.tasks.update`：`taskId` + `status`（`open|in_review|resolved|dismissed`）+ `comment`；需要合并时带 `canonicalClaimId`

## 每条抽取必须带

```
method: rule | code | llm | human
confidence: 0-1
evidence_span: 可在原文 grep 到的片段（对齐 chunk start_line/end_line）
```

规则命中记 1.0。模型因果不得写入主数据。ingest 后用 `claims.list` 核对 heuristic 结果；错了开治理任务，不要重写原文。

## 迭代

冷启动：10–20 条高频规则 + 小样本。先跑通 `knowledge-cold-start`。  
扩展：模型成功案例固化成规则。  
收敛：规则覆盖主体，模型只打长尾。

## 不要

- 用模型判断「A 是否晚于 B」而两者已有时间戳
- 为每个特例加一条规则导致爆炸；分层：规则 → 启发式 → 模型 → 人
- 绕过 Gateway 写 `claims` / `chunk_governance`
- `knowledge.base.documents.delete` 来「清掉抽错的」
