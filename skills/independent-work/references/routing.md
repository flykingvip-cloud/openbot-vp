# 意图分流

本文件只做分流。执行以 `SKILL.md` 与被编排技能为准。

## 用本技能编排

| 用户说                                     | 动作                                           |
| ------------------------------------------ | ---------------------------------------------- |
| 独立工作 / 你自己去服务器做 / 调用本机电脑 | 本技能选执行面，再移交具体技能                 |
| 没有连接器也要登后台 / 你打开网页我来扫    | 本技能 → `browser-scan-proxy`                  |
| 浏览器做完再存到我桌面                     | 浏览器验收后 → `exec host=node` 拷贝，路径先查 |
| 本机 App / 屏幕 / TCC / Grant              | 先确认节点 Connected=1 → `peekaboo` / 权限页   |
| 生产机、DNS、容器、公网是否生效            | SSH 远程机验收，不用本机解析                   |

## 直接交给已有技能（不要在本技能重写）

| 用户说                       | 交给                         |
| ---------------------------- | ---------------------------- |
| 只扫码 / 授权过期 / 二次扫码 | `browser-scan-proxy`         |
| 公众号 AppID / IP 白名单     | `wechat-official-credential` |
| 个人微信绑定                 | `wechat-personal-catalog`    |
| 找不到按钮、带我点           | `user-guidance-protocol`     |
| 读公开网页 / 调研            | `web-research` / `defuddle`  |
| 建数字人 / 知识库 / 定时     | `openbot-platform-ops`       |
| 只要 1Password CLI 用法      | `1password`                  |

## 执行面速查

```
有官方工具或已认证连接器？ → 用它（待登录走它自己的认证，不改浏览器绕过）
CLI 要设备码 / OAuth？ → 官方命令 + 把码/链接给用户；不代点 Authorize
页上是二维码？ → browser-scan-proxy
页上是可定位账密/OTP？ → 隔离页代填（procedure A3）；有企业邮则自己读 OTP
否则要动用户磁盘或本机二进制？ → nodes.run / exec host=node
否则要点 macOS 窗口？ → peekaboo（经节点）
否则要动远程机或做公网验收？ → SSH
以上都点不到？ → user-guidance-protocol（只带这一步）
```
