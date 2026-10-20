---
name: multi-source-fusion
description: 在 OpenBot 知识宇宙合并多源文档/主数据、做别名消歧，或把知识工程技能迁到新业务域时使用。遇到「数据融合」「跨系统对齐」「技能迁移」「换一个域怎么复用」务必使用本技能。
user-invocable: true
---

# 多源融合与技能迁移

没有 fusion 引擎。多源 = 多种 source 绑进同一个 `kbId`。融合 = 去重/冲突走治理。技能迁移 = 拷 SKILL.md，不是拷数据。

对齐顺序：字符串（hash）然后实体（claims）然后事件（派生）然后知识单元（交付物）。禁止在字符串层做完就宣布融合。

## 接入同一库

- 上传：`knowledge.personal.upload` / `collectWeb` / `importDataset`
- 目录：`knowledge.local-folder.bind` 然后 `sync.plan` / `sync.commit`
- 外部：`knowledge.source.bind` 然后 `knowledge.source.ingest`
- 连接器：`knowledge.connector.bind` 然后 `sync.plan` / `sync.commit`

租户 ingest 必须带已认证 session 的 `governanceOwnershipProof`（#862）。无认证 watcher 会 skip，不要当成融合失败。

无选中空间时只打开创建页，禁止静默落到个人 inbox。

## 融合规程

1. **键**：`raw_hash` 去字节重复；`semantic_hash` 去正文重复；业务主键（合同号、工号）放 tags / claims。没有主键再用「名称+组织+时间窗」
2. **冲突**：`governance.summary` 的 duplicate/conflict；`tasks.graph` 看组。事实层以定本+时间为准；推断层可并存并打来源
3. **决议**：`knowledge.governance.tasks.update` + `canonicalClaimId`。不要手写第二套主数据
4. **增量**：以文档版本/哈希为单元，不要全库重抽

别名表、系统 ID 映射只放租户 workspace，不要 bundled 进产品技能。

## 迁到新域

保留元技能：`knowledge-cold-start`、`agent-reflection-qa`、`scalpel-hybrid-extract`、`five-layer-qa`、`knowledge-gardener`。替换：类型表、锚点规则、别名维、制度规则。

流程：试点 1 条垂直（一个 kind）然后一轮反思然后改技能再铺开。不要把甲域的 100 个工序文件原样拷到乙域。技能安装走 workspace `skills/` 覆盖或 ClawHub，不走不存在的 fusion RPC。
