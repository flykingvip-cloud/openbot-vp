---
name: source-lock-and-cite
description: 入库前锁定 OpenBot 知识宇宙的官方正文、防止模型改字、或需要条款级引用与审计时使用。遇到「原文不可变」「raw_hash」「段落锚点」「consume receipt」「integrity lint」务必使用本技能。
user-invocable: true
---

# 底本锁定与引用坐标

模型改源文字节是事故。知识对象 id 和文档锚点必须解耦。OpenBot 已有指纹和行号，本技能只规定怎么用，不另做 overlay 存储。

## 铁律

1. **定本不可变。** 官方文件只经 ingest RPC 进入 originals（`knowledge/originals/<kbId>/<docId>`）和 `document_versions`。Agent 禁止改这些字节，禁止用「润色后再 upload」覆盖同一逻辑文档。
2. **哈希是 lint。** `raw_hash` 对字节；`semantic_hash` 对正文。`knowledge.personal.compareVersions` 看出变更种类。hash 对不上就拒绝当引用。
3. **稳定段落锚点。** 引用用 `chunk_meta.start_line` / `end_line` / heading / section，不要用会变的抽取 id。对象 id 变更后仍必须能 `knowledge.document.preview` 打开同一段。
4. **消费必须有收据。** `knowledge.runtime.context` 的 consume refs 只许：
   - `{ "type": "knowledge-base", "id": "<kbId>" }`
   - `{ "type": "knowledge-file", "id": "<docId>", "parentId": "<kbId>" }`
   - `{ "type": "deliverable", "id": "<id>", "parentId": "<kbId>" }`
   - `{ "type": "folder" | "api", "id": "<id>" }`（可带 parentId）
     收据不是 `consumed` / `partial`（`denied` / `unavailable` / `ambiguous_identity`）就 fail-closed，禁止裸 id 撞库。
5. **证据可 grep。** 答案必须带 `evidence_span`，且能在 preview 原文中找到。找不到则降级或不出。核验顺序：originals / preview → `base.search` 原句 → 模型（最后）。

## 对接口

- 写入底本：`knowledge.personal.upload` / `collect` / `collectWeb` / `source.ingest` / `local-folder.sync.commit`
- 读底本：`knowledge.document.preview`（走 originals，过大 fail-closed）
- 版本：`knowledge.personal.versions` / `compareVersions`
- 锚点：`knowledge.base.snippets.list`、claims 上的 chunk_id
- 消费：`knowledge.runtime.context`（`selection.refs`）
- 血缘：`knowledge.lineage.explain`

没有独立的 integrity RPC。把 preview + hash + consume receipt 当 lint。失败则停，不要 invent `knowledge.integrity.check`。

## 受保护节

原文、法定条款、已确认 claim：append-only。覆盖只能经 `knowledge-gardener` 白名单 + 人审任务。不要 `documents.delete` 来「清掉再传」。

## 不要

- 把向量命中当引用
- 改锚点时顺手改对象 id
- 审查面只剩 embedding；专家必须能 preview / grep
- 把交付物或 `auto_analysis` 当成定本
