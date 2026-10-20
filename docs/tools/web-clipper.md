---
summary: "Chrome web clipper: save pages into knowledge bases"
read_when:
  - You want to clip web pages into OpenBot knowledge bases from Chrome
  - You need login-gated page capture without server-side fetch
title: "Web clipper"
---

# Web clipper extension

The OpenBot web clipper is a thin Chrome extension that calls the existing Gateway RPC `knowledge.personal.collectWeb`. It captures page text **in the browser** (selection or article/body) and sends it as `text`, so pages that require login work without Gateway-side fetching.

This is separate from the [Chrome extension](/tools/chrome-extension) used for browser automation relay.

## Install

```bash
openbot web-clipper extension install
```

Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select the directory printed by the install command (or `openbot web-clipper extension path`).

## Configure

Open the extension **Options** page:

1. **Gateway WebSocket** — default `ws://127.0.0.1:18789`
2. **Gateway Token** — must match `gateway.auth.token` on the gateway host (`openbot config get gateway.auth.token`)
3. **Default knowledge base** — optional; leave empty to use the personal inbox
4. **Tags** — optional comma-separated defaults

## Use

- Popup: **剪藏本页** (full page/article) or **剪藏选区** (requires a text selection)
- Context menu: **Clip page to OpenBot** / **Clip selection to OpenBot**

Clipped content flows through the same ingest → chunk → governance pipeline as URL import in the knowledge workspace.

## RPC fields

`knowledge.personal.collectWeb` accepts optional client payload:

- `text` — plain text from the clipper (skips server fetch)
- `html` — HTML blob (converted server-side; skips fetch)
- `title`, `tags`, `knowledgeBaseId` — same as workspace URL collect

The response may include `clipSource`: `client-text`, `client-html`, or `server-fetch`.
