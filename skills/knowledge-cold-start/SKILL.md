---
name: knowledge-cold-start
description: 新业务域、新文书类型刚接入 OpenBot 知识宇宙、没有现成规范时使用。遇到「冷启动」「先标几份看看」「先建一个私有库跑通」务必使用本技能。不要在已有稳定类型上推倒重来时用。
user-invocable: true
---

# 知识宇宙冷启动

好东西是总结出来的，不是设计出来的。只走现有 `knowledge.*` Gateway，不新建索引、不改 schema、不碰 S01 memory-workspace。

默认垂直：`policy`（制度）。用户点名合同再用 `contract`。一次只开一个 kind。

## 硬约束

- 对象 kind 只能用现有枚举：`document | policy | template | project | contract | metric | insight`
- 可见性先 `private`。没有 tenant 上下文禁止 `team` / `enterprise`
- 向量不是默认路径；不要要求打开 `vec0`
- 失败也要记：写进交付物，不要静默重来

## 流程

1. **建私有库**  
   `knowledge.base.create`：`title` 必填，`visibility: "private"`，`tags` 带 kind（如 `policy`）。记下返回的 `knowledgeBase.id`。

2. **5 份样本入库（原文）**  
   本地文件：`knowledge.personal.upload`，带 `knowledgeBaseId`（或 `kbId`）和 `attachment`（`fileName` / `mimeType` / `kind` = `text|image|binary`）。  
   网页：`knowledge.personal.collectWeb`（`url` 必须 http(s)）。  
   文件夹：`knowledge.local-folder.bind` 后 `knowledge.local-folder.sync.plan` → `sync.commit`，不要直接扫盘写索引。  
   已有 source：`knowledge.source.bind` 后 `knowledge.source.ingest`（`sourceDescriptorId` + `knowledgeBaseId`）。

3. **核验原文进了库**  
   `knowledge.base.documents.list` → `knowledge.document.preview`。  
   再 `knowledge.base.search` 用样本里的原句检索。命不中就停，先查 ingest 是否 skipped，不要改原文。

4. **跑一次消费**  
   `knowledge.runtime.context`，`selection.refs` 用 consume ref：  
   `{ "type": "knowledge-base", "id": "<kbId>" }` 或 `{ "type": "knowledge-file", "id": "<docId>", "parentId": "<kbId>" }`。  
   收据不是 `consumed` / `partial` 就 fail-closed，禁止用裸 id 撞库。

5. **看治理底线**  
   `knowledge.governance.summary`（`kbId`）。记下 chunkCount / conflictCount / healthScore。冷启动不要求清零冲突。

6. **沉淀决策，不写空规范**  
   用当前 session：`knowledge.deliverables.saveAndArchive`（`knowledgeBaseId` + `sessionKey` + `title` + `content`）。内容只记「为什么选 A 不选 B」、5 份样本清单、检索是否命中。  
   需要会话摘要时用 `knowledge.base.agent-knowledge.generate`（`knowledgeBaseId` + `sessionKey`，modes 限 `conversation_summary` / `auto_analysis`）。这是派生知识，不是底本。

7. **错误 ≥3 次**  
   立刻写成模式，更新本技能或交给 `scalpel-hybrid-extract`。禁止继续纯手工。

## 不要

- 先做完整本体或新 kind
- 并行改类型表、工具、流程、标准
- `knowledge.base.delete` / `knowledge.base.documents.delete`
- 把 Grok Bot 的 `skill-*` id 当成 OpenBot 技能名

## 完成标准

私有库存在；≥5 份原文可 preview；至少一条 consume receipt 为 `consumed`；一份决策交付物已归档。
