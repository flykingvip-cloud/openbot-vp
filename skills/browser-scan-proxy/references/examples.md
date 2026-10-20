# 案例：阿里云邮件推送 SPF

任务：给 `mail.openbot.love` 补阿里云邮件推送 SPF，根域企业邮 SPF 不动。

## 清单

```
goal: mail.openbot.love 具备 DirectMail SPF，控制台四项验证通过，公网 TXT 可解析
loginUrl: https://account.aliyun.com/login/login.htm?oauth_callback=https%3A%2F%2Fdm.console.aliyun.com%2F
successTexts: ["发信域名", "邮件推送", "控制台首页", "确认登录"]
forbidden: [openbot.love 根域 TXT v=spf1 include:spf.qiye.aliyun.com]
```

## 路径

1. 登录页若落到用户自己的 Chrome，隔离会话一直停在登录。判定：未落入。
2. 用户说「请重新启动你的浏览器，我来扫码」。关掉旧标签，`profile=openclaw` 重开登录页，重新亮码。
3. 用户回「已经扫码完毕」。`tabs` 已是邮件推送控制台。不再开登录页。
4. `evaluate` 关掉「展开产品面板」，hash 跳到发信域名，抄官方 SPF/DKIM/DMARC/MX。
5. 只补 `mail` 子域 TXT，不改根域企业邮 SPF。
6. 本机 `dig @8.8.8.8` 不可信时，改走不受 fake-ip 污染的解析源做公网验收。

## 可复用决策

- 扫码没落入：不要再干等，换新标签重开隔离页。
- 用户主动要求重启浏览器：立即重开。
- 「已经扫码完毕」：先看当前标签，已在控制台就续做。
- 验收不看本机污染 DNS。
- 只补子域，不碰根域企业邮。
