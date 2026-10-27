# wechat-personal 字段契约

与 `listUserOperationalIdentityProviderCatalog()` / `user-operational-identity.wechat-personal.*` 对齐。勿臆造字段。

| 项                     | 值                                    |
| ---------------------- | ------------------------------------- |
| provider               | `wechat-personal`                     |
| label                  | 微信个人号                            |
| category               | social                                |
| authMode               | `qr_channel`                          |
| manualKind             | `null`（勿走 credentials.bind）       |
| registrationReady      | `true`                                |
| rolloutTier            | `deferred`                            |
| operationalActions     | `probe_status`（探测通道）            |
| 落库 externalAccountId | `wxid`                                |
| 路径                   | `non_cloud_primary`（非云电脑主路径） |

## Gateway API（仅这些）

| RPC                                                       | 用途              |
| --------------------------------------------------------- | ----------------- |
| `user-operational-identity.wechat-personal.status`        | 通道探活 / 登录态 |
| `user-operational-identity.wechat-personal.qr.start`      | 开始扫码          |
| `user-operational-identity.wechat-personal.qr.wait`       | 等待扫码结果      |
| `user-operational-identity.wechat-personal.bind-existing` | 绑定已登录 wxid   |

## 明确不是

| 误用                             | 正确                      |
| -------------------------------- | ------------------------- |
| `credentials.bind`               | 上表 wechat-personal.\*   |
| `oauth.start` / `oauth.complete` | 上表 wechat-personal.\*   |
| 公众号 AppID/AppSecret           | `oi-bind-wechat-official` |
| 企微                             | 企业身份路径，非本 skill  |

UI：个人设置 → 授权 → 微信个人号；常见本机入口 `http://127.0.0.1:18789/`。
