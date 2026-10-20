---
name: enterprise-kb-pipeline
description: 规划或落地 OpenBot 知识宇宙全流程、要对齐工序依赖、或有人主张先上 RAG / embedding 时使用。遇到「知识库怎么分层」「ingest 管线」「从文档到图谱」务必使用本技能。
user-invocable: true
---

# 企业知识库建设管线

定本先行。只编排现有 `knowledge.*`，不另起 ingest 引擎，不把九步做成新作业队列。

先跑 `knowledge-cold-start` 拿到一个私有库和 5 份原文。抽字段用 `scalpel-hybrid-extract`。上线维护用 `knowledge-gardener`。

## 原则

1. 源文件有错，后面全错。先 `knowledge.document.preview` 对过原文。
2. 没有稳定锚点（chunk `start_line`/`end_line`）不要谈实体。
3. 标注不得改 `raw_hash` 对应字节。
4. 能规则就算的不要 LLM。每步用治理 summary / consume receipt 当 lint。
5. 人定 kind 边界和停轮；Agent 做规模执行。

## 九步如何落到现有系统

产品已经覆盖的，直接调 RPC。没有独立工序的，用 Agent 规程 + claims/治理，**不要假装有 `knowledge.pipeline.step`。**

| 步           | 做什么                 | 现有接口                                                                                                | 完成标准                                                   |
| ------------ | ---------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 01 定本      | 接入官方正文           | `knowledge.personal.upload` / `collectWeb` / `source.ingest` / `local-folder.sync.commit`               | `preview` 能打开；`document_versions.raw_hash` 有值        |
| 02 结构      | 标题、条款、段落锚点   | ingest 写入 `chunk_meta`（heading/section/start_line/end_line）；`knowledge.base.snippets.list`         | 每段可预览，锚点与对象 id 解耦                             |
| 03 实体      | 领域对象               | `knowledge.governance.claims.list`（heuristic SPO）；kind 仅 7 枚举                                     | 类型互斥；证据能 grep                                      |
| 04 事件/变更 | 签署、发布、作废       | 派生：`deliverables.saveAndArchive` 或 `agent-knowledge.generate`（`auto_analysis`）                    | 带时间、参与者、evidence_span；不进主数据                  |
| 05 关系      | 重复、冲突、引用       | `knowledge.relationships`；chunk/claim 关系仅 `duplicate\|conflict\|reference`（claim 另有 `supports`） | 每条能说出 method；因果只放派生层                          |
| 06 约束      | 分类与边界             | 现有 kind + tags；不要扩 schema                                                                         | 自下而上，人修剪；新 kind 另走 `bottom-up-types`           |
| 07 一致性    | 矛盾与反常             | `knowledge.governance.summary` / `tasks.list` / `tasks.graph`                                           | 冲突先示警，不当事实                                       |
| 08 上架      | 事实/流程/交付物分库存 | 文档在 KB 内；交付物 `saveAndArchive`；Agent 产出 `agent-knowledge.list`                                | 有治理健康度，不要求零冲突                                 |
| 09 应用      | 检索、问答、图谱       | `knowledge.search` / `base.search` / `runtime.context` / `cognitive.bundle` / `feed.list`               | consume receipt 为 `consumed` 或 `partial`；低质量默认不推 |

横向：权限走 KB member（viewer/editor/admin）和 consume fail-closed。不要靠「库不公开」。S01 memory-workspace 不在本管线。

## 并行

01 完成后才能做 02，必须串行。实体（claims）稳定后，04/05/06 可并行，但都不得改原文。白话/摘要必须能指回 chunk 行号。

## 人机

- 人：选 kind、红线、抽检 5–10%、`tasks.update` 决议、停轮
- Agent：ingest、检索核验、claims 核对、把 ≥3 次错误写入技能

## 不要

- 第一步做 chunk + embedding，或要求打开 `vec0`
- 把因果推断当主数据 / 已确认 claim
- 跳过 01/02 直接抽三元组
- 为九步各建一套存储
