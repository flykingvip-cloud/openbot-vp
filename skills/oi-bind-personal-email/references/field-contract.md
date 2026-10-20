# personal-email 绑定字段

| 表单 | bind 参数 | 备注 |
|------|-----------|------|
| displayName | displayName | |
| 发件邮箱 | credentialHandleId / email | |
| 平台代发 | smtp.usePlatformSmtp | 126/163/yeah → false |
| SMTP 主机/端口/用户 | smtp.host/port/user | |
| IMAP 主机/端口/用户 | imap.host/port/user | 非平台代发需要 |
| SMTP 授权码 | smtp.pass / appSecret | 仅 secret store |

Gateway：`user-operational-identity.credentials.bind`  
UI：「添加并认证」/「更新并认证」；浏览器协助按钮「打开邮箱网页」「获取授权码」。
