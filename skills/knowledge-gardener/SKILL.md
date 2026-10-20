---
name: knowledge-gardener
description: 上线后用 Agent 维护 OpenBot 知识宇宙、或要防止模型静默改库时使用。遇到「知识园丁」「Butler」「白名单」「引文保护」「governance task」「closeout」「预写对账」务必使用本技能。
user-invocable: true
---

# 知识园丁白名单

知识库腐烂是运营问题。维护 Agent 只能做菜单上的事，不能自由写库。本技能是工序，不是新的数字员工类型；大白（builtin steward）同样受这张白名单约束。

## 允许的动作（机械门禁）

读：

- `knowledge.base.list` / `get` / `documents.list` / `recycle.list` / `snippets.list` / `sources.list`
- `knowledge.governance.summary` / `claims.list` / `tasks.list` / `tasks.graph` / `expert.get`
- `knowledge.actions.list` / `knowledge.feed.digest` / `knowledge.lineage.explain`
- `knowledge.document.preview` / `knowledge.personal.versions` / `compareVersions`

写（仅下列）：

- `knowledge.governance.tasks.update` — 关任务、写 comment、指定 `canonicalClaimId`
- `knowledge.base.documents.restore` — 从回收站恢复
- `knowledge.personal.updateTags` — 改标签，不改正文
- `knowledge.deliverables.attach` — 把已有交付物挂到库；不覆盖底本
- `knowledge.web.setRefreshPolicy` — 网页源刷新策略（不改已抓正文）

单次变更必须小到可审。多任务拆轮次。受保护内容（原文 chunk、已确认 claim、引文）只许经 task 决议，不许覆盖。

## 禁止

- `knowledge.base.delete`
- `knowledge.base.documents.delete` / `detach`
- `knowledge.source.unbind` / `knowledge.local-folder.unbind` / `knowledge.connector.unbind`
- `knowledge.governance.expert.upsert`（提权；人审另走）
- 直接改 `knowledge/bases.json` 或 SQLite 索引
- 用重新 `upload` 覆盖已有 `raw_hash` 正文来「润色」
- 用更长的 system prompt 代替这张名单

没有的动作就停，向人汇报。

## 运营节奏

1. 开轮预写对账：`knowledge.governance.summary` + `tasks.list`（`status: "open"`）+ 抽一句原文 `preview`/`search` 对得上再写。细则 `references/closeout.md`。
2. 每次只处理一类 task_type
3. 每 N 次 `tasks.update` 后，把系统性问题写入交付物（`saveAndArchive`），不要改本技能以外的存储
4. 连续失败 N 次停手，记 failures，不再重试同一 write
5. 收工 closeout：列出变更、仍开的 task、抽检检索与正文；需要重建索引只报告，不手改 SQLite、不重传覆盖 `raw_hash`

## 人

敏感域（制度/合同原文、已审结论）要审批。园丁权限不超过该 KB 的 editor。首页/检索只推荐 governanceStatus 为 `healthy` 的对象。
