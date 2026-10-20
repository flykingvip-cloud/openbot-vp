# github-personal 字段契约

与 `listUserOperationalIdentityProviderCatalog()` / `renderGithubPersonalForm` 对齐。

| 项 | 值 |
|----|-----|
| provider | `github-personal` |
| label | GitHub（个人） |
| authMode | `oauth` |
| manualKind | `null`（勿走 credentials.bind） |
| registrationReady | `true` |
| operationalActions | create_issue, create_pull_request, comment |

## 表单 → API

| UI | oauth.start / 会话 | 备注 |
|----|-------------------|------|
| 显示名称 | `displayName` | 缺省可用 GitHub `login` |
| GitHub 用户名 | 可选；真 OAuth 留空 | 模拟绑定时填写；真回调用 API user.login |
| 重新认证 | `identityId` + 同 provider | purpose=reauthorize |

## Gateway

- `user-operational-identity.oauth.start`
- `user-operational-identity.oauth.status`
- `user-operational-identity.oauth.cancel`
- 回调：既有 OAuth callback（authorization code → token → register/rotate identity）

UI 按钮文案：「授权绑定」/「重新认证」。
