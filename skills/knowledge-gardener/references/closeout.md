# 预写对账与收工

园丁白名单仍然有效。本页只补「动手前 / 收工时」必须看见的东西。不要另装 Markdown vault 或手改 SQLite。

## 预写对账（任何 write 之前）

1. `knowledge.governance.summary`（当前 `kbId`）
2. 抽一条将要引用的原句，`knowledge.document.preview` / `knowledge.base.search` 必须 grep 到
3. 检索命中但 preview 对不上 → 停手，记缺口，不要用向量命中当原文
4. 一次只处理一类 `task_type`

搜不到原句就不要 `tasks.update` 结案。

## 收工（本轮最后一条 write 之后，或准备结束对话时）

交付物写入 `knowledge.deliverables.saveAndArchive`（或已有交付物 `attach`），至少包含：

- 本轮碰过的 `kbId` / document id
- 关闭的 task 与仍为 `open` 的 task
- 失败次数；连续失败则停
- 检索与正文是否仍一致（抽检一句）
- 是否需要人重建索引：只报告，不手改 SQLite，不 `upload` 覆盖 `raw_hash`

没有写库则收工可以是一句「本轮只读，无变更」。

## 禁止用收工做的事

- `knowledge.base.delete` / unbind
- 为了「索引刷新」重传同一正文
- 新建第二套记忆目录绕开 `knowledge.*`
