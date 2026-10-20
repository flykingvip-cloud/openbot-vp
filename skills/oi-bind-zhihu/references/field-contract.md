# zhihu 字段契约

与 `listUserOperationalIdentityProviderCatalog()` / `renderSocialAccountForm` 对齐。

| 项 | 值 |
|----|-----|
| provider | `zhihu` |
| label | 知乎 |
| authMode | `manual` |
| manualKind | `social_account` |
| registrationReady | `true` |
| path_unstable | `true`（S3 诚实标注；未经云电脑 live 验证） |
| operationalActions | publish_post, reply_comment, sync_profile_metrics |

## 表单 → credentials.bind

| UI（SOCIAL_FORM_COPY / 默认） | bind 参数 | 备注 |
|------------------------------|-----------|------|
| 显示名称 | `displayName` | |
| 知乎账号（placeholder: 用户名 / 主页 Token） | `accountHandle` | 表单态 `credentialHandleId` |
| Cookie / Token（placeholder: 登录 Cookie 或开放平台 Token） | `accessToken` | 表单态 `appSecret`；只进 secret store |
| 提交文案 | 「添加并认证」/「更新并认证」 | |

## Gateway

- `user-operational-identity.credentials.bind`
- 禁止对本 provider 走 `oauth.start`（authMode=manual）
