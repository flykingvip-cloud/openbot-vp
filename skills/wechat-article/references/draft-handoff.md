# 草稿箱交接（wechat-article）

排版、封面、配图由本技能脚本负责。**写入微信草稿箱只有一个真源**：已授权的公众号身份工具。

不要把 `scripts/publish_agi_axios.js` / `scripts/publish_article.py` 当活路径。它们是遗留脚本：企业或个人身份已授权时禁止再跑。

## 何时交给身份工具

HTML 已通过 `validate_wechat_html.py`，封面文件已生成（或已有可访问的封面 URL）之后。

| 身份范围             | 工具                        | 动作            |
| -------------------- | --------------------------- | --------------- |
| 企业席位已授权公众号 | `operational_identity`      | `publish_draft` |
| 个人身份已授权公众号 | `user_operational_identity` | `publish_draft` |

先 `list` / `resolve`，确认 `publish_draft` 在 `allowedActions` 里，再 `execute`。

## 必填入参

- `identityId`（企业）或 `provider=wechat-official`（个人）
- `title`
- `content`：排版后的 HTML 片段，不是未排版 Markdown
- 封面三选一：`thumbUrl`（http/https）、`thumbMediaId`、`thumbBase64`（≤64KB）

不要把整张封面的 base64 塞进对话当 `imageBase64` 冒充封面。正文配图用 `upload_content_image` 的 `imageUrl` / `imageBase64`。

成功：`executed=true`，输出含草稿 `mediaId` 且 `status` 为 `draft_created`。不要用 `publishId=0` 验收，不要自动 `publish_article` / 群发。

## 禁止

- 身份已授权时再 `exec` 遗留发布脚本或向用户要 AppSecret
- 只用标题+正文、不传封面就调用 `publish_draft`
- 在 `wechat-official-account` 里发草稿（那是运营策划技能）
