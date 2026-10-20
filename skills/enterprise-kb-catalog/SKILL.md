---
name: enterprise-kb-catalog
description: 建设或审计 OpenBot 知识宇宙、要从知识工程而非 RAG 起步、或不知道该跑哪道工序时使用。遇到「企业知识库怎么建」「技能目录」「知识工程管线」务必使用本技能。
user-invocable: true
---

# 企业知识库技能目录

从知识工程操作系统落地，不要从切块 embedding 起步。本目录是入口。技能是 Agent 工序，不改变知识宇宙加工结构。

## 四层语义（必须按序）

1. **结构**：定本、条款/段落锚点（`raw_hash`、chunk 行号、`ku://`）
2. **图谱**：claims、duplicate/conflict/reference、7 个 kind
3. **知识**：治理分数、任务、上架（文档 / 交付物 / agent-knowledge）
4. **应用**：search、runtime.context、feed、园丁运营

向量检索只做第 4 层的一种入口，当前不少路径 `vectorEnabled: false`。

## 技能

| 你在做的事         | 技能                                        |
| ------------------ | ------------------------------------------- |
| 不知道从哪开始     | `enterprise-kb-catalog`                     |
| 全流程与依赖       | `enterprise-kb-pipeline`                    |
| 新域冷启动         | `knowledge-cold-start`                      |
| 规则/脚本/模型分工 | `scalpel-hybrid-extract`                    |
| 防改原文、要引用   | `source-lock-and-cite`                      |
| 抽完要纠错         | `agent-reflection-qa`（勿用 id `agent`）    |
| 定领域类型         | `bottom-up-types`                           |
| lint 与质量档      | `five-layer-qa`                             |
| 多源对齐、换域     | `multi-source-fusion`                       |
| 上线后谁改库       | `knowledge-gardener`                        |
| 写 OpenBot 技能    | `skill-authoring`（包一层 `skill-creator`） |

11 条均为 OpenBot AgentSkills 名。Grok Bot 里的 `skill-1788…` / `agent` 加载不进 OpenBot。

## 建议顺序

1. `knowledge-cold-start`
2. `source-lock-and-cite`
3. `scalpel-hybrid-extract` + `agent-reflection-qa`
4. `five-layer-qa`
5. `knowledge-gardener`
6. 总图读 `enterprise-kb-pipeline`

## 非目标

不复制史记符号、静态站。没有 `knowledge.purge`（对话 purge 是另一条）。不碰 S01，不改 LIVE，除非人明确要求。
