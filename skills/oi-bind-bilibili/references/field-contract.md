# bilibili 字段契约

与 `listUserOperationalIdentityProviderCatalog()` / `renderSocialAccountForm` 对齐。

| 项                 | 值                                                |
| ------------------ | ------------------------------------------------- |
| provider           | `bilibili`                                        |
| label              | 哔哩哔哩                                          |
| authMode           | `manual`                                          |
| manualKind         | `social_account`                                  |
| registrationReady  | `true`                                            |
| path_unstable      | `true`（S3 诚实标注；未经云电脑 live 验证）       |
| operationalActions | publish_post, reply_comment, sync_profile_metrics |

## 表单 → credentials.bind

| UI（SOCIAL_FORM_COPY / 默认）                                 | bind 参数                     | 备注                                  |
| ------------------------------------------------------------- | ----------------------------- | ------------------------------------- |
| 显示名称                                                      | `displayName`                 |                                       |
| 账号标识（placeholder: 用户名 / UID / 主页链接）              | `accountHandle`               | 表单态 `credentialHandleId`           |
| 访问凭证（placeholder: Access Token / Cookie / 开放平台密钥） | `accessToken`                 | 表单态 `appSecret`；只进 secret store |
| 提交文案                                                      | 「添加并认证」/「更新并认证」 |                                       |

## Gateway

- `user-operational-identity.credentials.bind`
- 禁止对本 provider 走 `oauth.start`（authMode=manual）
