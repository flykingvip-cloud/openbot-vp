# x-twitter 字段契约

与 `listUserOperationalIdentityProviderCatalog()` / `renderOauthPersonalForm`（`x-twitter`）对齐。

| 项                 | 值                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------- |
| provider           | `x-twitter`                                                                                 |
| label              | X                                                                                           |
| authMode           | `oauth`                                                                                     |
| manualKind         | `null`（勿走 credentials.bind）                                                             |
| registrationReady  | `true`                                                                                      |
| path_unstable      | `false`（应用内 OAuth 主路径；开发者门户点击序仍可为 UNKNOWN）                              |
| verified_live      | `false`（待 OHBE（https://github.com/flykingvip-cloud/harness-Benchmark-Engine）/真机验收） |
| operationalActions | sync_profile_metrics；publish_post / reply_comment（需 `tweet.write`）                      |

## 表单 → API

| UI       | oauth.start / 会话         | 备注                                   |
| -------- | -------------------------- | -------------------------------------- |
| 显示名称 | `displayName`              | 缺省可用 X `@username`                 |
| X 用户名 | 可选；真 OAuth 留空        | 模拟绑定时填写；真回调用 `/2/users/me` |
| 重新认证 | `identityId` + 同 provider | purpose=reauthorize                    |

## Gateway

- `user-operational-identity.oauth.start`
- `user-operational-identity.oauth.status`
- `user-operational-identity.oauth.cancel`
- 回调：既有 OAuth callback（authorization code + PKCE → token → register/rotate identity）

UI 按钮文案：「授权绑定」/「重新认证」。
