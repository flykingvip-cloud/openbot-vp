---
summary: "Enterprise console guides for WeCom, Feishu, and DingTalk"
read_when:
  - You configure tenant message channels in the enterprise console
  - You need the long-connection-first setup path for China IM platforms
title: "Enterprise IM setup"
---

# Enterprise IM setup

OpenBot enterprise tenants connect **WeCom**, **Feishu**, and **DingTalk** from:

**Enterprise console → System settings → Message channels**

This hub matches the curated onboarding form in that page: pick a connection mode, fill only the fields for that mode, then verify with a real chat message.

## Design principles

| Principle             | What it means in OpenBot                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| Long connection first | Prefer WebSocket / Stream when the platform supports it — no public Callback URL required      |
| Mode mutual exclusion | Long connection and URL callback are different credential sets; do not mix them                |
| Curated fields        | Enterprise page writes `channels.<id>.accounts.t_<tenant>_default.*` — not the full ops schema |
| Two-part checklist    | Open-platform prep first, then OpenBot save / Callback copy / “你好” + Probe                   |
| China IM only         | QQ is out of scope for enterprise message channels                                             |

## Choose a channel

| Channel       | Recommended mode                | Minimum credentials       | Guide                          |
| ------------- | ------------------------------- | ------------------------- | ------------------------------ |
| WeCom         | AIBot WebSocket long connection | Bot ID + Secret           | [WeCom](/channels/wecom)       |
| Feishu / Lark | WebSocket long connection       | App ID + App Secret       | [Feishu](/channels/feishu)     |
| DingTalk      | Stream long connection          | Client ID + Client Secret | [DingTalk](/channels/dingtalk) |

URL callback / HTTP webhook remains available when you already have a public gateway URL and prefer server-push.

## Shared verification loop

1. Complete the open-platform checklist for the chosen mode (visibility / bot capability / permissions / publish).
2. In OpenBot, select the same mode and save credentials.
3. Only for callback / webhook modes: copy the read-only **Callback URL** back to the open platform.
4. Message the bot with `你好`.
5. Click **测试连通** (Probe) on the enterprise channel page.

## Related help

- [Help hub](/help)
- [Chat channels overview](/channels)
- [Channel troubleshooting](/channels/troubleshooting)
- [Pairing](/channels/pairing)
