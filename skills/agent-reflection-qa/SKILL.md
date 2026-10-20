---
name: agent-reflection-qa
description: 对 OpenBot 知识宇宙里模型抽取的实体、事件、关系做质量审查和多轮修正时使用。遇到「反思」「按类型审查」「错误模式库」「迭代纠错」务必使用本技能。禁止用 name/id `agent`（会撞库内 Agent 生成知识 tab）。
user-invocable: true
---

# Agent 反思质检

AI 抽取的错误是系统性的。核心产出是错误模式表，不是一份改完的数据。没有 `knowledge.reflection` RPC。结论落到现有治理任务和技能 diff。

## 三维

| 维度   | 做法                         | 接口                                                                                         | 抓不到         |
| ------ | ---------------------------- | -------------------------------------------------------------------------------------------- | -------------- |
| 按文档 | 一份一份过 preview           | `knowledge.base.documents.list` + `document.preview` + 该 doc 的 `claims.list`（`chunkIds`） | 跨文档矛盾     |
| 按类型 | 同一 predicate / kind 全库扫 | `knowledge.governance.claims.list`（`kbId` + `normalizedKey`）                               | 篇章特有语境   |
| 跨文档 | 冲突组、重复组               | `knowledge.governance.summary` / `tasks.list` / `tasks.graph`；`knowledge.relationships`     | 成本高，放后轮 |

## 循环

初始抽取（ingest 的 heuristic claims）然后规则核对，然后本技能反思，然后 `knowledge.governance.tasks.update` 批量关任务，然后人工抽检 5–10%，然后把模式写入技能。

纠错只走：

- `knowledge.governance.tasks.update`（`taskId` + `status` + `comment`，合并用 `canonicalClaimId`）
- 派生说明：`knowledge.deliverables.saveAndArchive` 或 `knowledge.base.agent-knowledge.generate`（仅 `auto_analysis`）

禁止直接写 claims 表，禁止 `documents.delete` 清错。

## 停轮

同时满足才停：修正量相对 open task 塌缩；**新模式连续两轮 = 0**；抽检未发现新的系统误差。未塌缩就先找新模式，不要加轮次硬磨。

## 每一轮交付

1. 本轮 `tasks.update` 清单（可回放）
2. 新模式：编号、频率、修法、能否脚本化
3. 是否污染锚点（升级确定性可能把错年份经 `semantic_hash` 传开）
4. 技能 diff：模式写入 `scalpel-hybrid-extract` 或本技能

可选读 `knowledge.cognitive.bundle` 看消费面，不当质检通过证明。
