---
name: wechat-official-credential
description: >-
  用隔离浏览器代操作微信公众平台 / 开发者平台，把 AppID、AppSecret 和网关出口 IP
  白名单写入 OpenBot 企业或个人数字身份。用户需连扫 2～3 次：进公众号后台、
  跳转开发者平台、重置 AppSecret；系统不能自动写入微信白名单时还要再扫一次。
  遇到「配公众号」「IP 白名单」「还要再扫」「AppSecret」「测试连接失败」
  「40164」「40001」「扫码帮我写白名单」「开发者密码」
  「mp.weixin.qq.com」「developers.weixin.qq.com」务必使用。
  正确配置只要 AppID + AppSecret + IP 白名单，不要收 Token。
  腾讯会议 Token 走 tencent-meeting。成稿/排版走 wechat-article；草稿箱写入走身份工具（draft-handoff）。
  运营策划走 wechat-official-account。个人微信走 wechat-personal-catalog。
  用户自己点界面走 user-guidance-protocol；本技能是数字人代操作。
metadata:
  openclaw:
    emoji: "🔑"
    promptPriority: 89
    requires:
      config:
        - browser.enabled
---

# 公众号凭证（浏览器代配置）

正确契约：**AppID + AppSecret + 网关出口 IP 白名单**。不要向用户要 Token。微信 `access_token` 是运行时换票结果，不是配置项。腾讯会议 Token 是另一条身份。

扫码循环读并遵循 `browser-scan-proxy`。本技能只补公众号控制台地图、OpenBot 回写与验收。控制台页读 [references/console-map.md](references/console-map.md)。错误码读 [references/errors.md](references/errors.md)。回写字段读 [references/openbot-bind.md](references/openbot-bind.md)。分流读 [references/routing.md](references/routing.md)。

## 先探测，再决定扫几张

新会话默认要扫 **2～3 次**。续做时不要一上来就重扫。

1. 看隔离标签是否已在 `mp.weixin.qq.com` / `developers.weixin.qq.com` 且能认出目标号。还在就续做。
2. 用现有 AppID/AppSecret 换票。通过则跳过 ③。
3. 只在**开发者平台**回读 IP 白名单。旧公众号「查看」名单不可信。
4. 缺哪张码再亮哪张。不要为了走完梯子而重置密钥或重写白名单。

## 扫码次数（新会话主路径）

新会话要扫 **2～3 次**，每次一张**新码**。不要说「扫完就不用再管」。

| 次序 | 码的作用              | 何时出现                                                                   | 能否跳过                                                 |
| ---- | --------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------- |
| ①    | 进入公众号管理后台    | `mp.weixin.qq.com` 登录                                                    | 不能。隔离会话没有登录态就必须扫                         |
| ②    | 跳转微信开发者平台    | 旧后台「能力已迁移 / 前往开发者平台」，或直接开 `developers.weixin.qq.com` | 现网主路径几乎必扫。开发信息、IP、AppSecret 都在新平台   |
| ③    | 获取 / 重置 AppSecret | 开发者密码「重置」或首次查看，管理员确认                                   | 身份店已有可用密钥且换票通过则可跳过                     |
| ④    | 写入 IP 白名单        | 白名单「修改 / 保存」，管理员确认                                          | OpenBot **不能**自动写入微信白名单。只要还要改名单就必扫 |

默认按 ①②③ 准备。白名单仍缺出口 IP 时再加 ④，整段最多 4 次。每一次都走 `browser-scan-proxy` 的 `OPEN_SCAN`：关旧码、开新码、等确认。不要 reload 过期码，不要把后一次码当成登录失败而重走 ①。

OpenBot 能从工作台抄**自己的**出口 IP，不能读取或改写微信侧白名单。所以「系统提不出 / 写不进白名单」时，④ 仍要用户扫。

## 角色

| 谁     | 只做这些                                             | 不做这些                                      |
| ------ | ---------------------------------------------------- | --------------------------------------------- |
| 用户   | 按数字人提示连扫 2～3 张当前隔离页的码；手机点确认   | 自己点后台、自己抄密钥发到聊天                |
| 数字人 | 开隔离浏览器、按序亮码、填白名单、回写身份、换票验收 | 让用户去「另一个 Chrome」扫；谎称扫一次就结束 |

`browser.enabled` 未开则停，说明先打开浏览器控制。不要改走「请你自己打开后台」。

## 私有清单

开始前写好，不要当操作手册发给用户：

```
goal: <哪个公众号> 的 AppID/AppSecret 已写入 <企业|个人> 身份，白名单含全部出口 IP，换票成功
accountHint: <显示名 / AppID / 主体>
bindTarget: enterprise | personal
loginUrl: https://mp.weixin.qq.com/
successTextsMp: ["设置与开发", "基本配置", "功能"]
successTextsDev: ["开发信息", "IP 白名单", "开发者密码"]
egressIps: [<工作台展示的全部出口 IP>]
forbidden: [群发, 删除素材, 改账号主体, 发布已上线图文]
checkpoint: { lastDone, next, evidence }
```

`egressIps` 必须抄 OpenBot 工作台「出口 IP」，**全部写入**，不要只填一个。

## 主循环

```
① SCAN_MP ──► IDENTIFY
      │
      ▼
② SCAN_DEV ──► 开发信息
      │
      ├── 需要新密钥 ──► ③ SCAN_SECRET ──► BIND
      └── 已有可用密钥 ──► BIND
      │
      ▼
   白名单仍缺出口 IP ──► ④ SCAN_IP ──► PROBE
   白名单已含全部出口 IP ──► PROBE
```

对用户先说清次数：先扫公众号后台，再扫开发者平台；若要重置密钥再扫一次；若还要改白名单再扫一次。每次只扫**刚发出的那一张**。

### 1. ① SCAN_MP — 进入公众号管理后台

按 `browser-scan-proxy` 开 `profile=openclaw`，URL 用 `https://mp.weixin.qq.com/`。对用户说：这是第 1 张，进公众号后台；后面还要扫开发者平台。

未落入（扫到用户自己的 Chrome）立刻 `RESTART_SCAN`，不要干等。

### 2. IDENTIFY

登录后先确认当前号，再跳转。

1. `snapshot` 看昵称 / 主体。目标号对不上就切号或停下来问。
2. 打开基本配置，抄 AppID（`wx` 开头）。不要把 AppSecret 打进聊天。
3. 用页上昵称回写 `displayName` / `nickName`。店里不要只留「微信公众号」。

页路径见 [references/console-map.md](references/console-map.md)。

### 3. ② SCAN_DEV — 跳转微信开发者平台

现网开发信息、IP 白名单、AppSecret 都在开发者平台。不要停在旧「基本配置」里反复点。

1. 点「前往微信开发者平台 / 能力已迁移」，或打开 `https://developers.weixin.qq.com/console/product/mp/<appId>`。
2. 出现登录 / 授权码时，这是第 2 张。记下 checkpoint：`lastDone=identified`，`next=dev-console`。走 `OPEN_SCAN` 亮**这一张**，不要重开公众号登录页。
3. 成功文案：「开发信息」「IP 白名单」「开发者密码」。确认仍是同一个 AppID。

### 4. ③ SCAN_SECRET — 获取或重置 AppSecret

身份店已有密钥且换票通过：跳过本步。否则：

1. 用户明确同意后再点「重置」或「查看」。
2. 管理员确认码是第 3 张。checkpoint：`lastDone=dev-console`，`next=secret`。
3. 新密钥只显示一次：立刻写入身份店，清缓存 `accessToken`。不要把密钥打进聊天。
4. 重置弹窗若已经打开：不要关掉，按授权完成 ③。

### 5. BIND

把 AppID / AppSecret 写入 OpenBot，**不要写 Token 字段**。

- 企业：系统设置 → 企业身份 → 微信公众号。
- 个人：个人设置 → 授权 → 微信公众号。

字段与验收见 [references/openbot-bind.md](references/openbot-bind.md)。

### 6. ④ SCAN_IP — 写入 IP 白名单

OpenBot **没有**写入微信 IP 白名单的 API，也不能从微信自动抽出名单。工作台只能提供出口 IP。名单仍缺这些 IP 时必须走本步。

1. 打开「开发信息 → IP 白名单 → 修改」。
2. 写入清单里**每一个** `egressIps`。双出口时两个都写。与最近一次 `40164` 报文里的 IP 合并。
3. 保存弹出的管理员确认码是第 4 张（若跳过了 ③ 则是第 3 张）。checkpoint：`lastDone=bound`，`next=ip-whitelist`。不要重走 ①。
4. 回读白名单文本。控制台「已保存」不够。

禁止：只写工作台曾经展示过的旧 IP；编造 IP；让用户自己去后台加。

### 7. PROBE

凭证通了再谈发布。

1. 企业点「测试连接」；个人走 `verify_credentials`。
2. 真源是微信换票成功（优先 `stable_token`），不是页面上过期的 `lastVerify`。
3. 换票成功后刷新身份页，确认 lastVerify / capabilities 已更新。
4. **不要**用 `publishId=0`、群发、发布已上线图文当验收。
5. 需要证明号对得上：只读拉账号资料（昵称/主体），不要发内容。

失败按 [references/errors.md](references/errors.md) 分类。`40164` 回 ④ SCAN_IP。`40001` / 密钥无效先核对 AppSecret 与缓存票，不要再向用户要 Token。

## 铁律

1. 用户配置面没有 Token。扫码授权第三方平台不是主路径。
2. 登录页只开隔离配置。禁止把扫码落点放到用户自己的 Chrome。
3. 不发布、不群发、不删素材、不改主体。本技能只配凭证与白名单。
4. 不打印 AppSecret、access_token、cookie。
5. ①②③④ 每一张都是新码。授权过期或管理员确认：checkpoint 后续做，不重走 ①，不重复重置密钥。
6. 本技能压过带路协议。用户说「你打开我来扫」时禁止改走 `user-guidance-protocol` 让用户自己点。
7. 腾讯会议 Token、视频号 OAuth、个人微信扫码，分别交给对应技能。

## 完成标准

- 用户按序扫过需要的那几张码（默认 ①②③；改白名单再加 ④），没有被要求自己点后台或粘贴 Token
- 目标号昵称已确认并写入显示名
- AppID + AppSecret 已在正确的企业或个人身份里
- 白名单含工作台列出的全部出口 IP，且回读可见；或确认无需改名单
- 换票验收通过；身份页 lastVerify 已刷新
