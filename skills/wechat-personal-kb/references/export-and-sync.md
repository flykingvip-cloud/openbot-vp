# 导出与目录同步

底本 = 用户已经拿得出来的明文。OpenBot 不从微信客户端解库。

## 允许当 source 的路径

用户自己放到某个文件夹的：

- 微信「导出聊天记录」得到的 txt / html
- 用户整理过的 csv / json / markdown（内容仍是聊天原文，不要先让模型改写再传）
- 单文件：走 `knowledge.personal.upload`，不要 invent 专用 kind

## 禁止当 source 的路径

- Windows `xwechat_files` / `Msg/MSG.db` / `MSG0.db`
- macOS 微信容器里的加密库
- 任何需要 `wx_key.dll`、内存扫描、SQLCipher 才能读的目录
- sidecar 会话文件、`context_token`、proxy `apiKey`

用户说「连一次目录」时：让他指出 **导出文件夹的绝对路径**。若指向客户端数据根，停下来说明不可读，改为导出。bind 前跑 `scripts/accept_snapshot.py`（见 `snapshot-accept.md`）。边车 WAL/SHM 或 `MSG.db` 一律拒绝。

## bind / sync

1. `knowledge.local-folder.bind`：绝对路径，一次一个库。
2. `knowledge.local-folder.sync.plan`：看将新增/跳过哪些文件。
3. `knowledge.local-folder.sync.commit`：以 ingest 结果为准。
4. 新导出覆盖同名文件时，冲突进治理，不要静默改 originals。
5. 没有 `knowledge.wechat.watch`。定时同步 = 用户更新文件后再跑 plan → commit。

单文件调试用 `knowledge.personal.upload`（`knowledgeBaseId` + attachment）。网页收藏与本技能无关。
