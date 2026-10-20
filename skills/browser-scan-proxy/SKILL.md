---
name: browser-scan-proxy
description: "用户只扫码/点确认，数字人用 OpenBot browser 工具在隔离会话里全权代操作控制台。明确说扫码登录、你打开网页我来扫、重新启动浏览器、授权过期、二次扫码，或没有 AccessKey/CLI 却要改阿里云/云控制台/后台时务必使用。不要用来引导用户自己点界面（那是 user-guidance-protocol）；不要用来做无登录的公开页抓取（web_fetch / web-research / defuddle）。"
user-invocable: true
metadata:
  openclaw:
    emoji: "🪪"
    promptPriority: 88
    requires:
      config:
        - browser.enabled
---

# 浏览器扫码代理

用户只负责扫码 / 点确认。登录后的点击、填表、提交、验收全部由数字人用 OpenBot `browser` 工具做完。不要把控制台操作交回给用户。

分流细则读 [references/routing.md](references/routing.md)。工具契约读 [references/browser-tool.md](references/browser-tool.md)。完整案例读 [references/examples.md](references/examples.md)。

## 角色切分

| 谁     | 只做这些                                                   | 不做这些                                             |
| ------ | ---------------------------------------------------------- | ---------------------------------------------------- |
| 用户   | 扫当前会话的二维码；手机上点确认；说「重新启动浏览器」     | 自己点控制台、自己抄记录、自己改 DNS                 |
| 数字人 | 开隔离浏览器、亮码、等登录、关浮层、导航、改配置、独立验收 | 让用户去「另一个 Chrome」扫；编 DKIM / 密钥 / 验证码 |

用户原话类似「你打开网页，我帮你扫码，你自行获得你需要的东西」时，按本技能执行，不要改成「请你登录后把截图发给我」。

## 铁律

1. **登录页开在隔离配置。** 默认 `profile="openclaw"`。禁止把登录页开到 `profile="chrome"`（用户自己的 Chrome / Browser Relay）再在隔离页上干等。
2. **每次重新登录换新标签。** 失败重扫先 `browser` `action=close` 旧标签，再 `open` 新登录 URL。不要 reload 过期二维码充数。
3. **登录后不要停。** 扫码成功不是终点。按事先写好的任务清单继续，直到独立验收通过。
4. **授权过期就重扫，不要重做已完成步骤。** 记下 checkpoint，重登后先读当前状态再续做。
5. **控制台给出的密钥 / DKIM / token 必须从页面抄，禁止编造。**
6. **本技能压过带路协议。** 一旦判定走扫码代理，禁止改走 `user-guidance-protocol` 让用户自己点。
7. **`browser.enabled` 未开则停。** 告诉用户先打开浏览器控制，不要假装已经点过控制台。
8. **页上是账密/OTP 而不是二维码，不是「未落入」。** 不要重开扫码页。交给 `independent-work` 的打字段路径（隔离代填 / `op` / 已接管邮箱）。**禁止截图核验密码框。**
9. **不要替用户点最终 Authorize。** 除非用户已明确要求且 snapshot 已确认就是授权页。

## 主循环

```
NEED_AUTH? ──yes──► OPEN_SCAN ──► WAIT_LOGIN ──► EXECUTE
    ▲                    ▲              │
    │                    │         timeout / 仍停在登录页
    │                    └──────── RESTART_SCAN
    │
    └── 执行中出现登录页 / 401 / 授权过期 / 会话失效
```

开始前先写私有清单（不要发给用户当操作手册）：

```
goal: <一句话要改成什么>
loginUrl: <带 callback 的登录 URL>
successTexts: ["控制台首页", "发信域名"]
forbidden: [<不能动的资源>]
checkpoint: { lastDone, next, evidence }
```

### 1. OPEN_SCAN

```
browser action=status
browser action=start          # 未启动时
browser action=open profile=openclaw url=<loginUrl>
browser action=screenshot     # 把当前二维码发给用户
browser action=snapshot       # 确认是扫码态，不是账密态
```

对用户只说三句：

1. 干净浏览器已打开，请扫 **这一张** 码（站点指定的 App）。
2. 码会过期，扫刚发的这一张，不要扫旧截图。
3. 扫完并在手机上点确认后说一声；之后不用再点控制台。

### 2. WAIT_LOGIN

用 `browser` `action=act` `kind=wait` 等 URL 离开登录域，或 snapshot 出现 `successTexts`。一次最多 180s。

| 结果                                  | 判定                    | 动作                                           |
| ------------------------------------- | ----------------------- | ---------------------------------------------- |
| URL 离开 login，命中 successTexts     | 成功                    | 进入 EXECUTE                                   |
| 超时，页面仍是登录 / 二维码           | 没落到这扇浏览器        | 见「未落入」                                   |
| 页面是用户名/密码/OTP 表单，不是码    | 不是扫码态              | 停止扫码循环，改走 `independent-work` A3       |
| 用户说「重新启动浏览器 / 再扫一次」   | 主动重扫                | `RESTART_SCAN`                                 |
| 出现「确认登录」但仍在 passport       | 只扫了还没点确认        | 再等一次，不要重开                             |
| `profile=chrome` 的标签已经进了控制台 | 扫到了用户自己的 Chrome | 丢掉它；`RESTART_SCAN`，让用户扫你刚开的隔离页 |

**未落入（最常见）：** 用户扫的是自己的 Chrome，不是 `openclaw` 隔离页。不要空等第二次。立刻 `RESTART_SCAN`，并写明：「请扫我刚刚重新打开的这一张，不要扫别的浏览器窗口。」

同一轮最多自动重扫 **2** 次；再失败就停下来等用户指令。

### 3. RESTART_SCAN

```
browser action=close          # 旧登录标签
browser action=open profile=openclaw url=<loginUrl>
browser action=screenshot
再 WAIT_LOGIN
```

禁止：reload 旧登录页、复用已过期截图、改用 `profile=chrome`「省一次扫码」。

### 4. EXECUTE

1. `snapshot` 确认当前标签还在隔离配置。
2. 关掉控制台全局浮层。a11y 点失败就 `act kind=evaluate`。
3. 导航。Hash 路由用 `evaluate` 改 `location.hash`，再 snapshot 等目标文案。
4. 先读官方值，再改。DKIM / token / 验证串从配置页抄。
5. 改之前核 `forbidden`。
6. 长按「我是人类」用 `evaluate` 按下并等待，不要改走带路。图形拼图才交接。
7. 独立验收。控制台「验证通过」不够：用不受本机劫持的解析源再查。本机 `dig` / `8.8.8.8` 若走 fake-ip，结果作废。
8. 用证据回复：改了什么、没改什么、是否已生效。需要落到用户磁盘时，交回 `independent-work` 的 B（选节点 → 授权 → 拷贝 → 核路径）。

### 5. 中途授权过期

执行中一旦出现登录页、passport、401、或按钮全部变成「请登录」：

1. 把 checkpoint 写成：`lastDone` / `next` / `evidence`。
2. 走 `RESTART_SCAN`。
3. 登录后 **先回读当前状态**，确认上次写入还在，再做 `next`。
4. 不要把整个任务从第一步重来；不要重复提交已成功的表单。

用户说「已经扫码完毕」时：立刻 `tabs` + `snapshot`。已在控制台就续做；仍在登录页就 `RESTART_SCAN`。

## 反模式

- 登录页开在 `profile=chrome`，却在 `openclaw` 标签上干等
- 扫码成功后把「请到控制台添加 XXX」丢回给用户
- 二维码过期还让用户扫同一张截图
- 产品浮层挡住点击就改走带路协议
- 账密页当成扫码失败而重开二维码
- 截图核验密码框；未确认就点 Authorize
- 本机 DNS 被劫持时用本地 `dig` 当验收
- 把 AccessKey / cookie / 扫码截图写进仓库或知识库
- `browser.enabled=false` 还假装已经改过配置

## 完成标准

- 用户只扫了码，没有被要求自己改配置
- 任务清单上的写入已发生，且 `forbidden` 未动
- 有独立于控制台文案的验收证据
- 若中途重扫过：checkpoint 被续上，没有重复破坏性写入
