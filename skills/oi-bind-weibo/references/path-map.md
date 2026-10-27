# weibo 路径图（S3 + S5 实测 + S6 证据指针）

```yaml
path_unstable: true
provider: weibo
verified_live: false
live_probe_date: "2026-10-13"
live_probe_channel: cloud_pc
s6_probe_date: "2026-10-19"
live_evidence: references/live-evidence.md
```

**诚实声明**：S5 在 Control UI **云电脑**上对登录/人机验证做了实测，但 **Access Token /
Cookie 绑定尚未 live 成功**，因此 **保持** `path_unstable: true` 与
`verified_live: false`。禁止因见到验证码页就宣称路径已打通。

S6（2026-10-19）复核见 [live-evidence.md](live-evidence.md)：无新的 Cloud PC bind 成功，旗帜不变。

## 公开入口

| 名称                         | URL                                          | 来源级别                        |
| ---------------------------- | -------------------------------------------- | ------------------------------- |
| 微博开放平台（公开文档入口） | `https://open.weibo.com/`                    | public_docs                     |
| 安全验证（GeeTest）          | `https://security.weibo.com/captcha/geetest` | cloud_pc_measured（2026-10-13） |

## 人机步骤

| 步骤                              | 状态                              | 备注                                                                  |
| --------------------------------- | --------------------------------- | --------------------------------------------------------------------- |
| 云电脑打开微博登录 / 开放平台     | measured                          | 2026-10-13 Cloud PC Chrome                                            |
| GeeTest「请先验证身份」           | measured                          | URL 含 `/captcha/geetest`                                             |
| 错误码 **111001**「请重新尝试」   | measured                          | 须真人点「返回」并完成验证，或换已有 Token 粘贴给大白（密钥不进报告） |
| 登录开发者/创作者后台             | UNKNOWN（被 111001 阻断后未越过） | —                                                                     |
| 创建应用 / 开通权限               | UNKNOWN                           | —                                                                     |
| 取得 Access Token / Cookie / 密钥 | UNKNOWN                           | 成功后只经 secret store；禁进聊天/投影                                |
| 复制账号标识（微博账号）          | UNKNOWN                           | —                                                                     |
| 回到 OpenBot「添加并认证」提交    | 产品内路径已知；取证面仍 unstable | `credentials.bind`                                                    |

## 达标才允许翻旗（尚未满足）

同时满足才允许**清除** path_unstable 并标记 verified_live（本切片未做该翻旗）：

1. 人机验证越过（非 111001 死循环）
2. 取得可用 Access Token / Cookie（不进聊天）
3. `user-operational-identity.credentials.bind` 成功且个人授权页 weibo=active

本切片 **未**满足 → 旗帜不变。

## 大白策略

- 默认推荐队列：只推 `verified_live: true` 项；**跳过**本 provider（除非用户显式点名）
- 显式调用时：说明已测到 GeeTest/111001，协助用户完成验证或粘贴已有凭证，勿编造未测菜单序
- 合规：不引导绕过平台 ToS；不确定 Cookie vs Token 时优先开放平台 Token 文案
- S6 证据：[live-evidence.md](live-evidence.md)
