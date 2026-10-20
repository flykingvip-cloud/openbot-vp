---
summary: "Personal WeChat QR bind via a local worker. Not 公众号 and not WeCom."
read_when:
  - You want to bind a personal WeChat account from Workbench 个人设置
  - You need the fail-closed local-worker QR flow
  - A user does not know how to start the local WeChat worker
title: "WeChat (personal)"
---

# WeChat (personal)

This channel is **微信个人号**, not:

- 微信公众号 official-account AppID/AppSecret (`wechat-official`)
- [WeCom / 企微](/channels/wecom) tenant-shared workplace IM

Workbench **个人设置 → 绑定账户 → 微信个人号** can bind a personal WeChat identity
when a **local worker** is online: QR → `wxid` → operational identity + optional
grant to an owned digital employee.

The local worker is a channel process on the user's computer (OpenBot desktop
node / sidecar). It is **not** "phone WeChat is online".

Operator skills: `wechat-personal-catalog` (route), `wechat-personal-ops` (QR/grant/sidecar), `wechat-personal-kb` (export folder → knowledge).

## Real login chain

Gateway `resolveWechatPersonalWorker()` picks the first working backend:

1. An injected test worker (`setWechatPersonalWorker`, tests only).
2. A **connected desktop node** that advertises `wechat.personal.probe` (and the
   other `wechat.personal.*` commands). The Mac node talks to a **loopback**
   protocol sidecar and returns QR/status over `node.invoke.request`.
3. A **loopback sidecar HTTP** process on the same machine as Gateway, configured
   only via env / local JSON (never LIVE `channels.wechat.proxyUrl`).
4. Otherwise **fail-closed**: no QR, probe offline.

We do **not** ship an in-process WeChat protocol stack. You must run the existing
local protocol sidecar that speaks these HTTP endpoints on loopback:

- `POST /api/login` `{ deviceType }` → `{ qrCodeUrl }`
- `GET /api/loginStatus` → `{ status, qrCodeUrl?, wxid?, nickname? }`
  (`logged_out` | `qr_pending` | `scanning` | `confirming` | `logged_in`)
- `POST /api/sendTextMsg` `{ to, content }` → `{ msgId }`
- `POST /api/logout` (404 is treated as not cleared)

Sidecar URL **must** be loopback (`127.0.0.1` / `localhost` / `::1`). Any other
host is rejected.

## Config

Loopback sidecar (Gateway on the same machine, or the Mac node):

```bash
export OPENBOT_WECHAT_PERSONAL_PROXY_URL=http://127.0.0.1:3000
# optional
export OPENBOT_WECHAT_PERSONAL_API_KEY=...
export OPENBOT_WECHAT_PERSONAL_DEVICE_TYPE=ipad   # or mac
```

Or a local file **on the computer that holds the session** (never commit secrets;
chmod 600). Primary path:

`~/.openbot/wechat-personal-worker.json` (leftover `~/.openclaw/...` is fallback only):

```json
{
  "proxyUrl": "http://127.0.0.1:3000",
  "apiKey": "...",
  "command": "/absolute/path/to/sidecar",
  "args": [],
  "cwd": null,
  "webhookPort": 18789,
  "webhookPath": "/webhook/wechat"
}
```

`proxyUrl` must stay loopback (default `http://127.0.0.1:3000`, not the inbound webhook
port 18789). Optional `command` is an **operator-supplied** absolute path; OpenBot
does not download a protocol binary and does not recommend huohuoer / `wechat-cli`.
When `command` is set, the Mac desktop node (primary) or a **local-direct** Gateway
may spawn that process if probe sees connection-refused / host-unreachable. If the
sidecar is already listening, it does not spawn a second process. No `command` keeps
today's fail-closed probe. Cloud / LIVE never spawns.

Also: `OPENBOT_WECHAT_PERSONAL_WORKER_FILE`, or
`${OPENBOT_STATE_DIR}/wechat-personal-worker.json` when `OPENBOT_STATE_DIR` is set.

Do **not** point `channels.wechat.proxyUrl` at LIVE. Gateway never reads that
LIVE channel field for this personal-QR path.

## Cloud Gateway (LIVE / remote workbench)

The protocol session **never** lives on the cloud Gateway. Config files on the
LIVE host are ignored.

1. On the **Mac that will hold WeChat**, put `~/.openbot/wechat-personal-worker.json`
   there (not on the server). If `command` is set, opening the desktop app is
   enough to start the loopback sidecar; otherwise start the operator-supplied
   binary yourself on `127.0.0.1:3000`.
2. Open the OpenBot desktop app on that Mac and wait until its node is connected
   **to this cloud Gateway**. The node advertises `wechat.personal.*` and
   invokes the sidecar on `127.0.0.1`.
3. In the cloud workbench: **个人设置 → 微信个人号**. Worker online means the
   Mac node + sidecar answered, not "phone WeChat is online".
4. Generate QR and scan. Rebuild the Mac app if the node does not advertise
   `wechat.personal.probe` yet.

If a wechat-capable node is connected, Gateway pins to it even when the sidecar
is temporarily down (probe fails closed with the node's error). It will **not**
fall through to loopback on the cloud host.

## Local-direct Gateway only

Loopback sidecar HTTP on the Gateway process is allowed **only** when the
workbench request is local-direct (Gateway on the same computer). Cloud / LIVE
leaves `allowLocalSidecar` false for identity QR/status RPCs.

Gateway binds loopback inbound **only** when no wechat-capable desktop node is
connected. Otherwise the Mac Node listens. Cloud still requires the Mac Node.

## User setup (when worker is offline)

1. Write `~/.openbot/wechat-personal-worker.json` on **that Mac**. Optional
   `command` lets the desktop start the operator-supplied loopback sidecar.
2. Open the OpenBot desktop app (required for cloud; also the supervisor). If
   there is no `command`, start the sidecar yourself on loopback.
3. Open the OpenBot desktop app, wait until the node is connected to this
   Gateway (required for cloud; optional only for local-direct Gateway).
4. Return to **个人设置 → 微信个人号**. When the page says worker online, generate
   the QR and scan with phone WeChat.
5. Scanning occupies the account's iPad/Mac login slot and can drop the phone
   client. Ban / ToS risk is on the user.

Digital employees should follow bundled skill `wechat-personal-worker-setup`.

## Digital-employee takeover (DM text only)

Once the worker is `logged_in` and an `AgentRouteBinding` exists
(`channel: "wechat"`, `accountId`), inbound **private text** from the sidecar is
routed to that digital employee. Replies go back through `worker.sendText`
(Mac `node.invoke` on cloud, loopback HTTP on local-direct). This is **not**
`user-operational-identity.execute`.

Group chat and media are out of scope: they are ignored (logged, no send
pretend).

### Inbound path (cloud-safe)

The sidecar must POST inbound JSON to loopback, never to a public Gateway URL:

`POST http://127.0.0.1:18789/webhook/wechat`

**Who listens on 18789**

- If a wechat-capable desktop node is connected (`wechat.personal.probe`), the
  **Mac Node** owns `127.0.0.1:18789` and forwards `wechat.personal.inbound`
  over the existing node event channel. Cloud / LIVE still requires that Mac
  Node. Gateway never binds a public webhook.
- If no wechat-capable node is connected (local-direct Gateway + sidecar on
  the same machine), Gateway binds loopback inbound itself (`127.0.0.1` only,
  never `0.0.0.0`).
- Same-machine Gateway + Mac Node fighting over `127.0.0.1:18789` is
  **fail-open**: whoever bound the port wins; the other logs and continues.
  Inbound still works through the process that holds the socket.

Default listen is `127.0.0.1:18789` (or `webhookPort` / `webhookPath` in
`~/.openbot/wechat-personal-worker.json`). Rebuild the Mac app if the node is
older than this inbound listener.

Payload (text DM): `{ "msgType": "text", "fromUser": "<wxid>", "content": "..." }`.

## What this slice does

- Local worker online → QR → identity (`externalAccountId = wxid`) + grant
- Probe `logged_in` is fail-closed if the worker is unreachable
- `startAccount` marks the channel running only when the worker is `logged_in`
- Inbound DM text → routed agent; outbound via `worker.sendText` (no LIVE
  `channels.wechat.proxyUrl`)
- Gateway loopback inbound only when no wechat-capable node is connected;
  otherwise Mac Node listens. Same-machine port conflict is fail-open
- Session files stay on the worker (chmod 600). Gateway does **not** store
  `context_token` or proxy `apiKey`

## Fail-closed

- Worker / Mac node offline, and no loopback sidecar → no QR, probe fails,
  `startAccount` does not pretend to run
- Non-loopback sidecar URL → rejected
- Duplicate `wxid` → `USER_IDENTITY_EXTERNAL_ACCOUNT_ALREADY_BOUND`
- Do **not** use `user-operational-identity.oauth.start` for this provider

## Not in this slice

- Group chat and media (ignored; do not pretend to send)
- Cloud-only personal WeChat / `channels.wechat.proxyUrl` on LIVE
- In-process WeChat protocol (user must run the sidecar)
- LIVE deploy / container swap
- Public Gateway webhook

This is a local-worker experimental path (`rolloutTier: deferred`). LIVE frozen
images will not see it until a later cutover. There is no LIVE swap in this
slice. ToS / ban risk of using a personal-WeChat protocol sidecar stays with
the operator.
