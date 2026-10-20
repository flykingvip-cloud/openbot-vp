# 意图分流

本文件只做分流。扫码循环以 `browser-scan-proxy` 为准。执行以本技能 `SKILL.md` 为准。

## 用本技能

| 用户说                                      | 是否触发                                |
| ------------------------------------------- | --------------------------------------- |
| 配公众号 / 配 AppID / AppSecret             | 是                                      |
| IP 白名单 / 把出口 IP 写进公众号            | 是                                      |
| 扫码帮我写白名单 / 你打开公众号后台我来扫   | 是（扫码循环交给 `browser-scan-proxy`） |
| 测试连接失败 / 40164 / 40001 / invalid ip   | 是                                      |
| 开发者密码 / 重置 AppSecret                 | 是（高风险，须用户明确同意）            |
| mp.weixin.qq.com / developers.weixin.qq.com | 是（凭证或白名单语境）                  |
| 企业数字身份 / 个人数字身份 的公众号配置    | 是                                      |

## 不用本技能

| 用户说                                         | 交给                                                     |
| ---------------------------------------------- | -------------------------------------------------------- |
| 找不到按钮、带我点、我自己配                   | `user-guidance-protocol` + `references/wechat-oa.yaml`   |
| 排版 / 转 HTML / 封面配图                      | `wechat-article`                                         |
| 写入草稿箱                                     | `wechat-article` 排版后走 `draft-handoff.md`（身份工具） |
| 选题、涨粉、菜单、转化策略                     | `wechat-official-account`                                |
| 个人微信绑定数字人 / sidecar 3000              | `wechat-personal-catalog`                                |
| 腾讯会议 Token / 预约会议                      | `tencent-meeting`                                        |
| 视频号 OAuth                                   | 企业身份视频号档案；不要用公众号 AppSecret               |
| 读公开文章 / 调研                              | `wechat-article` 归档段或 `web-research`                 |
| 只要 CLI 且用户已把 AppID/AppSecret 放进身份店 | 直接 `verify_credentials` / 测试连接，不必再开后台       |

## 与相邻技能

- `browser-scan-proxy`：人扫码 + 隔离会话。本技能在 OPEN_SCAN / 管理员确认码时调用它，不重写扫码循环。
- `browser` 是工具，不是技能。禁止再起一个叫 `browser` 的技能。
- `user-guidance-protocol`：用户自己点。一旦用户声明「你打开我来扫」，改走本技能，不要再逐步带路。
