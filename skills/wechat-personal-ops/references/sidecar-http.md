# sidecar HTTP 契约

OpenBot 不实现微信协议。本文件是 Gateway / 桌面节点对 **loopback sidecar** 的期望。协议二进制由运营方提供。

默认 base：`http://127.0.0.1:3000`。必须是 loopback。可选 `Authorization: Bearer <apiKey>`（来自 `wechat-personal-worker.json` 的 `apiKey`）。

实现：`src/gateway/user-operational-identity-wechat/local-http-worker.ts`。

## 端点

| sidecar                                               | OpenBot 用途                                  |
| ----------------------------------------------------- | --------------------------------------------- |
| `GET /api/loginStatus`                                | probe / status / login.wait 轮询              |
| `POST /api/login` `{ "deviceType": "ipad" \| "mac" }` | login.start；必须返回 `qrCodeUrl`             |
| `POST /api/sendTextMsg` `{ "to", "content" }`         | `wechat.personal.sendText`                    |
| `POST /api/logout`                                    | logout；404 视为未实现，返回 `cleared: false` |

## 字段

`GET /api/loginStatus` JSON：

- `status`：至少识别 `logged_in`。其它值当未登录继续等。
- `qrCodeUrl`：`data:` URL 或可 fetch 的图片 URL（节点会转成 `qrDataUrl`）。
- `wxid` / `nickname`：仅 `status === "logged_in"` 时采用。

`POST /api/login` JSON：`qrCodeUrl` 必填；`loginId` 可选。

`POST /api/sendTextMsg` JSON：`msgId` 可选，缺省时节点自造。

HTTP 401/403 → 节点报 `unauthorized`，不要改成公网 URL 重试。连接拒绝才允许按 `command` 拉起 sidecar。

## 入站

sidecar 主动 POST `http://127.0.0.1:<webhookPort><webhookPath>`，默认 `18789` + `/webhook/wechat`。

节点 advertise `wechat.personal.probe` 时优先听这个口，再发 `wechat.personal.inbound`。无节点时仅本机 Gateway 听 `127.0.0.1`（从不 `0.0.0.0`）。云端 Gateway 不开公网 webhook。

## 不要写进契约

- OneBot / 5031 / 网页版 wx.qq.com
- 解密 `MSG.db`、注入客户端
- 群发、图片、文件、语音（本切片忽略）
