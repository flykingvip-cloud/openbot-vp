# 排版段交接（wechat-article）

本文件是平台成稿链上**排版段的单一约定**。封面、配图由本技能脚本负责；草稿箱写入走 `references/draft-handoff.md`。主题组件库不进本仓库。

## 产物合同

排版段必须交出一份**公众号正文片段** HTML（不是完整网页）：

- 从容器标签开始（通常是 `section`），不要包 `html` / `head` / `body`
- 样式全部写在 `style="..."`；不要 `class` / `id`
- 可见文字包在 `span` 里，避免粘贴或入库后掉样式
- 不要 `script` / `iframe` / `form`，不要 `position:absolute|fixed|sticky`、`display:grid`、`@media`、CSS 变量

把这份 HTML 交给身份工具的 `content` 字段。不要把未排版的 Markdown 直接丢进草稿箱。

## 引擎选择（只选一条，不要叠）

1. **工作区已装 `gzh-design`**（技能列表里能看到该名字）→ 读它的 `SKILL.md`，按它的主题/校验流程出 HTML，再回到本技能做封面、配图，然后按 `references/draft-handoff.md` 写入草稿箱。不要把那套主题文件抄进本目录。
2. **未装主题引擎，用户只要合规底稿或直接发草稿箱** → 跑本技能 `scripts/wrap_wechat_html.py`，再跑 `scripts/validate_wechat_html.py`。
3. **未装主题引擎，用户明确要「摸鱼绿 / 主题精排 / 粘贴进编辑器不掉格式」** → 不要用本地底稿冒充主题精排。说明当前只能出合规底稿；要主题精排需工作区安装 `gzh-design`。用户确认用底稿再走第 2 条。

Word / PDF / 纯文本：先变成 Markdown（已装 `gzh-design` 时跟它的归一化；否则用现成抽取工具），再进入上面三条。不要为此新建第二套主题库。

## 不要走错技能

| 意图                             | 走                                            |
| -------------------------------- | --------------------------------------------- |
| 公众号正文 HTML / 成稿           | 本技能（排版段）                              |
| 写入草稿箱                       | 本技能排版后走 `draft-handoff.md`（身份工具） |
| 公众号选题、涨粉、转化           | `wechat-official-account`                     |
| 配 AppID / AppSecret / IP 白名单 | `wechat-official-credential`                  |
| 正式 PDF                         | `nano-pdf`                                    |
| PPT                              | `cyber-ppt`                                   |
| 对话内交互图                     | `visualize`                                   |
