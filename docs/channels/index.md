---
summary: "Product workplace IM is WeCom, Feishu, and DingTalk. Other names are inherited adapters."
read_when:
  - You want to choose a chat channel for OpenBot
  - You need a quick overview of supported messaging platforms
title: "Chat Channels"
---

# Chat Channels

OpenBot’s **product** workplace IM is **WeCom, Feishu, and DingTalk** (Enterprise
console → Message channels, long-connection first), plus **WebChat**.

This page is a catalog. Names below that are not WeCom / Feishu / DingTalk / WebChat
are **inherited adapters** from the previous project. They may still load as plugins.
They are not the current OpenBot headline and are not what you should sell as
“supported inbox channels.”

Each enabled channel connects via the Gateway. Text is supported everywhere; media and
reactions vary by channel.

## Product channels

For tenant onboarding in **Enterprise console → Message channels**, start here:

- [Enterprise IM setup](/channels/enterprise-im) — WeCom / Feishu / DingTalk hub (long-connection first)
- [WeCom](/channels/wecom) — AIBot WebSocket or corp-app callback
- [Feishu](/channels/feishu) — WebSocket or webhook
- [DingTalk](/channels/dingtalk) — Stream or HTTP webhook
- [WebChat](/web/webchat) — in-product chat over the Gateway WebSocket

## Inherited adapters (not the product headline)

These remain in the tree for compatibility. Do not treat this list as OpenBot’s
current workplace IM surface.

- [WeChat (personal)](/channels/wechat) — local-worker QR bind for 微信个人号 (not 公众号 / not WeCom)
- [BlueBubbles](/channels/bluebubbles) — leftover iMessage path via BlueBubbles macOS server REST API
- [Discord](/channels/discord) — Discord Bot API + Gateway
- [Google Chat](/channels/googlechat) — Google Chat API app via HTTP webhook
- [iMessage (legacy)](/channels/imessage) — deprecated `imsg` CLI path
- [IRC](/channels/irc) — classic IRC servers
- [LINE](/channels/line) — LINE Messaging API bot (plugin)
- [Matrix](/channels/matrix) — Matrix protocol (plugin)
- [Mattermost](/channels/mattermost) — Bot API + WebSocket (plugin)
- [Microsoft Teams](/channels/msteams) — Bot Framework (plugin)
- [Nextcloud Talk](/channels/nextcloud-talk) — Nextcloud Talk (plugin)
- [Nostr](/channels/nostr) — NIP-04 DMs (plugin)
- [Signal](/channels/signal) — signal-cli
- [Synology Chat](/channels/synology-chat) — Synology NAS Chat (plugin)
- [Slack](/channels/slack) — Bolt SDK workspace apps
- [Telegram](/channels/telegram) — Bot API via grammY
- [Tlon](/channels/tlon) — Urbit-based messenger (plugin)
- [Twitch](/channels/twitch) — Twitch chat via IRC (plugin)
- [WhatsApp](/channels/whatsapp) — Baileys QR pairing (leftover personal-inbox path)
- [Zalo](/channels/zalo) — Zalo Bot API (plugin)
- [Zalo Personal](/channels/zalouser) — Zalo personal QR login (plugin)

## Notes

- Fastest **product** path: Enterprise console → Message channels → WeCom / Feishu / DingTalk. See [Enterprise IM](/channels/enterprise-im).
- Fastest **in-product** chat: open the Control UI / [WebChat](/web/webchat) (no inbox pairing).
- Inherited adapters can still run if you enable them; they are not the default onboarding target.
- Group behavior varies by channel; see [Groups](/channels/groups).
- DM pairing and allowlists still apply on inherited consumer adapters; see [Security](/gateway/security).
- Troubleshooting: [Channel troubleshooting](/channels/troubleshooting).
- Model providers are documented separately; see [Model Providers](/providers/models).
