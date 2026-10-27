# x-twitter live 证据（S6）

```yaml
provider: x-twitter
path_unstable: false
verified_live: false
live_probe_date: "2026-10-19"
live_probe_tz: Asia/Shanghai
live_probe_channel: mac_worktree_no_cloud_pc
product_path: in_app_oauth_pkce
skill: oi-bind-x-twitter
```

**诚实声明**：应用内 OAuth2+PKCE 产品路径已存在（`path_unstable: false`）。
S6（2026-10-19）本机**未**完成 OHBE（https://github.com/flykingvip-cloud/harness-Benchmark-Engine）/真机 OAuth 至 `oauth` completed /
个人授权页 X=active。**保持** `verified_live: false`。禁止口头称为已 live。

## E2E 尝试（2026-10-19）

| 序  | 步骤                                                   | 环境             | 结果                                                      |
| --- | ------------------------------------------------------ | ---------------- | --------------------------------------------------------- |
| 1   | 复核 oauth-path / adapter authorize URL 形态           | Mac worktree     | ok（product_path 文档）                                   |
| 2   | `oauth.start` → 隔离浏览器打开 authorizeUrl → 用户同意 | Cloud PC / 真机  | **未执行**：本切片无云电脑会话；未配置/未跑真 Client 授权 |
| 3   | callback → secret store → 授权页 active                | gateway oauth.\* | **未达**                                                  |

## 失败点 / 阻断

- 无 Cloud PC / 真机 OAuth 完成证据。
- 开发者门户 App 创建点击序仍可为 UNKNOWN（非产品主路径）。
- 未配置真 `OPENBOT_USER_OPERATIONAL_IDENTITY_X_TWITTER_CLIENT_ID`/`SECRET` 时可能仅 simulate——**不得**把 simulate 当 verified_live。

## 翻旗前置（尚未满足）

1. 运维已配真 X OAuth Client（服务端）
2. 真机/云电脑：`oauth.start` → 用户同意（含 2FA）→ callback completed
3. 个人授权页 X=active；scope 含约定权限
4. 回写成功步骤到本文件后再允许 `verified_live: true`

## 禁止

用 credentials.bind 绑 X；把 access_token / refresh_token / code 进聊天/PR/投影；
伪造 verified_live；直接改 OI JSON。
