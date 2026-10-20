# 可选旁路：wechat-use → OpenBot sidecar 适配器

> **非默认通道。** 默认个人微信运营走工作台 `bind-existing`（见本技能主文与 `sidecar-http.md`）。本文仅说明已交付的 18400→3000 适配器如何接上 OpenBot 契约。
>
> **禁止写进普通用户指引：** Telegram、`t.me/WechatCliBot`、`@WechatCliBot`、`wechat-use auth activate`。大多数用户没有 Telegram，产品已省去这条自助激活路径。

## 前置

普通用户不要走本文。本文只给已经具备本机 wechat-use 会话的运营方做适配器接线。不要把安装 CLI、Telegram 激活写进 OpenBot 安装/绑定说明。OpenBot 仍只认 loopback **`:3000`**。若 `wechat-use` 不在 PATH，只记录缺失，不要远程安装，也不要改口用户去注册 Telegram。

## 位置

| 环境                 | 路径                                           |
| -------------------- | ---------------------------------------------- |
| box 交付包（同步源） | `/workspace/wechat-adapter/`                   |
| Mac 挂载目标         | `/Users/daniel/AI项目/wechat-personal-sidecar` |

适配器核心：`protocol.wechatuse.mjs`（由 sidecar `server.mjs` + `transport.local.mjs` 加载）。OpenBot 仍只认 loopback **`:3000`** 上的 sidecar HTTP。

## 环境变量

| 变量                     | 说明                                                 |
| ------------------------ | ---------------------------------------------------- |
| `WECHAT_PROTOCOL_MODULE` | 设为 `./protocol.wechatuse.mjs`（相对 sidecar 目录） |
| `WECHAT_USE_BRIDGE_URL`  | `http://127.0.0.1:18400`（必须 loopback）            |
| `WECHAT_BRIDGE_BEARER`   | 可选；桥非 `/health` 路由的 Bearer                   |

示例：

```bash
export WECHAT_PROTOCOL_MODULE=./protocol.wechatuse.mjs
export WECHAT_USE_BRIDGE_URL=http://127.0.0.1:18400
# optional: export WECHAT_BRIDGE_BEARER=…
node server.mjs
```

## 无二维码

wechat-use 桥**没有** QR / 扫码登录能力：

- `POST /api/login` → HTTP **501**，`code: "NATIVE_WECHAT_SESSION_REQUIRED"`
- 登录态来自桥 `GET /health`（经适配器映射到 sidecar `loginStatus` / vNext `health`：`loggedIn` / `wxid` / `sendReady`）
- 工作台应视为「原生微信已登录」，**不要**弹扫码

## 硬约束

- **禁止**把 `:18400` 写进默认 `~/.openbot/wechat-personal-worker.json`；`proxyUrl` 默认仍是 `http://127.0.0.1:3000`，指向运营方 sidecar（本旁路也是适配器对外仍暴露 3000）。
- 不要把 wechat-use 安装步骤写进 ops 硬约束推荐路径；本文件只服务「用户已选旁路」场景。
- Gateway **vNext worker 补丁**（health / 发送三态 / `fromSelf` 等）：**#982 opened, not LIVE**（尚未合入正式通道）；见交付包 `GATEWAY-VNEXT-PATCH.md`；契约草案见 [sidecar-http-vnext.md](sidecar-http-vnext.md)。

## 验收 curl（摘要）

完整清单见交付包 `/workspace/wechat-adapter/ACCEPTANCE.md`。关键几条：

```bash
# 1) health（vNext）
curl -s http://127.0.0.1:3000/api/health
# 期望：200；contract=openbot-sidecar-vnext-0；已登录且桥就绪时 loggedIn/sendReady + wxid

# 2) loginStatus（来自桥 health）
curl -s http://127.0.0.1:3000/api/loginStatus
# 期望：logged_in + wxid，或 logged_out

# 3) login → 501（无 QR）
curl -s -w '\nHTTP %{http_code}\n' -X POST http://127.0.0.1:3000/api/login \
  -H 'Content-Type: application/json' -d '{"deviceType":"ipad"}'
# 期望：501 + NATIVE_WECHAT_SESSION_REQUIRED

# 4) sendTextMsg
curl -s -X POST http://127.0.0.1:3000/api/sendTextMsg \
  -H 'Content-Type: application/json' \
  -d '{"to":"filehelper","content":"adapter-ping"}'
# 期望：200 + msgId（或透传 delivered / submitted_unconfirmed）
```

无真微信时：`node test-protocol-mock.mjs`（交付包内）应 exit 0。

## 相关文档

- 现行契约：[sidecar-http.md](sidecar-http.md)
- vNext 草案：[sidecar-http-vnext.md](sidecar-http-vnext.md)（Gateway worker：**#982 opened, not LIVE**）
- 可选技能完整流程（含装 CLI）：[wechat-use](sand-workflow:wechat-use)（非默认；不替代 identity grant）
- 排障：[troubleshooting.md](troubleshooting.md)
