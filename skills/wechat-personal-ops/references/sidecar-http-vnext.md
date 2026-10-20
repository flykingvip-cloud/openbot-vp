# sidecar HTTP 契约增量（vNext · 草案）

在 [sidecar-http.md](sidecar-http.md) **现行必选契约**之上，吸收外部 agent-bridge 类工具（如公开文档中的 REST/SSE 形状）的**接口设计**，用于演进 OpenBot 与运营方 sidecar 的约定。

## 硬边界（不变）

- OpenBot **不实现**微信网络协议，不解密客户端库，不扫内存密钥，不用 Accessibility/UIA 点微信窗口。
- 本文件只描述 **loopback HTTP JSON**；协议/会话如何实现由**运营方自备二进制**负责。
- 默认 base 仍是 `http://127.0.0.1:3000`（或 `localhost` / `::1`）。禁止公网、禁止 Cloudflare Tunnel / 任意穿透作为默认路径。
- 现行切片仍以 **私聊文本** 为主；群聊 / 图片 / 文件 / 语音标为可选扩展，未实现前 Gateway **忽略**，技能不要假装已支持。
- **不是**把第三方 CLI（wechat-cli / wechat-use）写进官方步骤；若运营方自选类似实现，必须经 **adapter** 露出本契约，OpenBot 只认 3000。

## 与现行契约的关系

| 层级           | 文档              | Gateway / 节点                                                                 |
| -------------- | ----------------- | ------------------------------------------------------------------------------ |
| **v1 必选**    | `sidecar-http.md` | 已接线：`loginStatus` / `login` / `sendTextMsg` / `logout` + webhook 入站      |
| **vNext 可选** | 本文              | **尚未**要求实现；草案供运营方与产品对齐；落地需单独 PR 改 `local-http-worker` |

未声明支持 vNext 的 sidecar：行为完全按 v1。

## 能力拆分（读 / 发 / 听）

避免一个「连上微信」故事混所有事：

| 能力        | v1                                             | vNext（可选）                                                      |
| ----------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| 登录 / 探活 | `GET /api/loginStatus`、`POST /api/login`      | 可增 `GET /api/health`（含 `sendReady`）                           |
| 发          | `POST /api/sendTextMsg`                        | 统一三态结果（见下）                                               |
| 听（入站）  | sidecar **推** `POST` → Gateway webhook        | 可选 sidecar **拉** SSE（见下）；OpenBot 仍以 webhook 为主消费路径 |
| 查历史      | 不在 ops；历史入库走 `wechat-personal-kb` 导出 | 不在 vNext ops 必选里加「解库查询」                                |

## 1. `GET /api/health`（可选）

```json
{
  "ok": true,
  "loggedIn": true,
  "wxid": "wxid_…",
  "sendReady": true,
  "engine": "operator-supplied",
  "contract": "openbot-sidecar-vnext-0"
}
```

- `sendReady: false`：已登录但发送管线未就绪（例如运营方实现需要「热身」）→ 节点 / 技能应提示用户按运营方文档完成一次本机确认，**不要**改成扫密钥或 UIA。
- 401/403 与 v1 相同 → `unauthorized`。

## 2. 发送结果三态（建议 `POST /api/sendTextMsg` 响应）

在保留现有请求体 `{ "to", "content" }` 前提下，建议响应：

```json
{
  "ok": true,
  "status": "delivered",
  "msgId": "optional",
  "diagnostic": {}
}
```

| `status`                | 含义           | OpenBot 建议                                  |
| ----------------------- | -------------- | --------------------------------------------- |
| `delivered`             | 已确认投递     | 成功                                          |
| `submitted_unconfirmed` | 已提交、未确认 | 成功但可记 warning；勿立即盲重试打爆          |
| `status_unknown`        | 不明           | 一次有限重试或人工确认                        |
| `failed`                | 失败           | 失败；读 `diagnostic`；**禁止**自动换公网 URL |

顶层也可带 `ok: boolean`，便于 agent 分支：`ok === false` 时必有失败原因字符串或 `status: "failed"`。

收件人消歧（可选，未实现前不要 invent RPC）：

```json
{
  "ok": false,
  "status": "ambiguous",
  "hint": "Lisa",
  "candidates": [{ "wxid": "…", "displayName": "lisa", "lastSeen": "…" }]
}
```

技能侧：有多候选时让用户选明确 `wxid`，再 `sendText`；不要猜。

## 3. 入站事件字段（webhook body 增量）

现行：sidecar POST 到 `http://127.0.0.1:<webhookPort><webhookPath>`。

建议私聊文本事件逐步对齐稳定字段（名称可映射，不必照抄外部分字段名）：

```json
{
  "messageId": "string",
  "chatId": "wxid_…",
  "senderId": "string",
  "senderName": "string",
  "body": "文本",
  "isGroup": false,
  "fromSelf": false,
  "timestamp": 1710000000
}
```

消费者清单（数字人 / Gateway）：

- **丢弃** `fromSelf === true`，避免自回环（不要只用 `senderId === myWxid` 判断私聊方向）。
- 本切片：`isGroup === true` → **忽略**（或只记日志），不要当私聊回复。
- `body` 为空或非文本 → 忽略；不要假装发了图/文件。

群 `@`、媒体、小程序等字段可预留，但 **未产品化前不得当完成标准**。

## 4. 可选 SSE（运营方侧；OpenBot 非主路径）

部分外部桥提供 `GET /messages/stream?since=<epoch>`。若运营方实现：

- **必须**要求 `since`；缺省回灌全历史对 agent 有害。
- OpenBot **主消费路径仍是 webhook 推入**；SSE 仅作运营方内部或实验适配器，不写进 LIVE 必选。
- 禁止默认把 SSE 端口隧道到公网。

## 5. 适配器说明（若运营方使用第三方本机桥）

允许架构：`第三方本机工具 → 薄适配器 → 本契约 :3000`。

适配器职责：

- 把外部分 API 翻译成 v1（及已承诺的 vNext）路径与字段；
- 继续只绑 loopback；
- **不得**要求 OpenBot 技能去执行取钥、重签名、UIA。

OpenBot 仓库与技能文档不捆绑、不安装该第三方工具。

## 验收（草案）

v1 仍按 `sidecar-http.md` + ops 完成标准。

宣称支持 vNext 时额外：

1. `GET /api/health` 在已登录且可发时 `sendReady: true`。
2. `sendTextMsg` 失败返回 `status: failed`（或 `ok: false`），不返回 200 空体。
3. 入站带 `fromSelf`；自消息不触发数字人回复。
4. 未实现群/媒体时，相关事件被忽略且无假成功。

## 明确不做

- 把审计/技能改成推荐 wechat-cli、wechat-use、DLL、内存密钥、UIA
- 在 OpenBot 运行时内嵌第三方桥
- 用 Cloudflare Tunnel / orchestrate 作为默认「打通个人微信」路径
- 与 `wechat-personal-kb` 合并成「解库即入库」
