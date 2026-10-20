# OpenBot Web Clipper

Thin Chrome extension that clips the current page (or selection) into an OpenBot knowledge base via the existing `knowledge.personal.collectWeb` RPC.

## Install

```bash
openbot web-clipper extension install
```

Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select the printed directory.

## Configure

1. Open extension **Options**
2. Set **Gateway WebSocket** (default `ws://127.0.0.1:18789`)
3. Set **Gateway Token** (same value as `gateway.auth.token` on the gateway host)
4. Optionally pick a default knowledge base and tags

## Clip

- Toolbar popup: **剪藏本页** / **剪藏选区**
- Context menu: **Clip page to OpenBot** / **Clip selection to OpenBot**

The extension sends `text` captured in-browser so login-gated pages work without server-side fetch.

## RPC contract

`knowledge.personal.collectWeb` accepts:

| Field | Required | Notes |
|-------|----------|-------|
| `url` | yes | Page URL |
| `text` | no | When set, skips server fetch |
| `html` | no | Converted server-side; skips fetch |
| `title` | no | Overrides extracted title |
| `knowledgeBaseId` | no | Target KB; omit for personal inbox |
| `tags` | no | String array |

Response may include `clipSource`: `client-text` | `client-html` | `server-fetch`.
