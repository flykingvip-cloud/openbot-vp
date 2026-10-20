---
name: bottom-up-types
description: 设计或演进 OpenBot 知识宇宙的类型、实体体系、动作/事件类型，或有人要先做完整本体时使用。遇到「类型怎么定」「标注体系」「自下而上本体」务必使用本技能。
user-invocable: true
---

# 领域类型自下而上

本体是从数据长出来的，人负责修剪。不要从空白 OWL 开干。没有 ontology store。产出是技能 references 或租户 workspace 覆盖文件，不是新 Gateway 表。

## 先用产品已有的 7 个 kind

`document | policy | template | project | contract | metric | insight`

冷启动只选一个（默认 `policy`）。对象分类 ≠ 本体 schema。不要在第一年申请第 8 个 kind。

## 从数据长类型

读：

- `knowledge.governance.claims.list`：`normalized_key` / subject / predicate 的频次簇
- `knowledge.base.datasets.list` 与 dataset schema（`columns_json`）
- KB / 文档 `tags`
- `knowledge.relationships` 的边类型（仅 related/supports/conflicts/derived-from 等产品枚举）

流程：

1. 最小 4–6 个业务标签，允许「其他」
2. 扁平、互斥、禁止嵌套
3. 动作是一等对象：批准、变更、作废、发布。用 claim predicate 或 `auto_analysis` 记录，不要只标名词
4. 「其他」出现稳定簇（建议 ≥10 条或连续两轮）再升格成 tags / 技能类型表
5. 一类混两种用法就拆；两类总打架就写总则，不要靠模型临场发挥
6. 连续两轮无新类：类型表收敛，再补属性

## 消歧

- 别名与规范名分离（映射表放租户 workspace，不要 bundled）
- 同名异实用维度：时间、组织、系统、kbId
- 名词层与动作层不可互转

## 不要

- 第一年把 OWL 推理机当目标
- 预设 50 个属性导致空值
- 把史记 22 类符号抄进企业库
- 调用不存在的 `knowledge.ontology.*`
