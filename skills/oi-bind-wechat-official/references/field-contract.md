# wechat-official 个人绑定字段

| 表单            | API / secret                         | 备注               |
| --------------- | ------------------------------------ | ------------------ |
| displayName     | identity.displayName                 | 后台昵称           |
| appId           | externalAccountId / metadata.appId   | `wx…`              |
| appSecret       | secret.accessToken（kind wechat_oa） | 仅 secret store    |
| gatewayEgressIp | 只读提示                             | 写入微信 IP 白名单 |

Gateway：`user-operational-identity.credentials.bind`  
UI 提交标签：「添加并认证」/「更新并认证」
