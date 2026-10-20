---
summary: "OpenBot capabilities for digital employees, enterprise IM, consoles, and the Gateway."
read_when:
  - You want a full list of what OpenBot supports
title: "Features"
---

## Highlights

<Columns>
  <Card title="Enterprise IM" icon="building-2">
    WeCom, Feishu, and DingTalk from the enterprise console (long-connection first).
  </Card>
  <Card title="Digital employees" icon="bot">
    Isolated agents with workspace, memory, skills, and audit.
  </Card>
  <Card title="Consoles" icon="layout-dashboard">
    Employee and enterprise Control UI for roster, groups, and knowledge.
  </Card>
  <Card title="WebChat" icon="message-square">
    In-product chat on the Gateway WebSocket.
  </Card>
  <Card title="Skills" icon="sparkles">
    Bundled and workspace skills with console gating.
  </Card>
  <Card title="Optional nodes" icon="smartphone">
    macOS / iOS / Android companion nodes for local device actions — not inbox channels.
  </Card>
</Columns>

## Core platform

- npm package `@upbeyond/openbot`; CLI command `openbot` (`openclaw` is a compatibility alias)
- [Gateway](/gateway) WebSocket control plane: sessions, config, cron, webhooks, Control UI, Canvas host
- [Pi agent runtime](/concepts/agent) in RPC mode with tool streaming
- [Session model](/concepts/session) plus collaboration groups in the employee console
- [Media pipeline](/nodes/images) for images, audio, and documents

## Channels (product vs leftover)

- **Product workplace IM:** [WeCom](/channels/wecom), [Feishu](/channels/feishu), [DingTalk](/channels/dingtalk) via [Enterprise IM setup](/channels/enterprise-im)
- **In-product chat:** [WebChat](/web/webchat)
- Inherited OpenClaw consumer adapters (WhatsApp, Telegram, Slack, Discord, iMessage, and similar) may still exist as plugins. They are **not** the current product headline. Catalog: [Chat Channels](/channels)

## Consoles + optional nodes

- Employee console and enterprise console in the [Control UI](/web)
- Optional companion [nodes](/nodes): macOS / iOS / Android for camera, canvas, and local device actions

## Tools + automation

- [Skills](/tools/skills): bundled and workspace skills with install gating
- [Browser control](/tools/browser), [Canvas / A2UI](/platforms/mac/canvas), [cron](/automation/cron-jobs), [webhooks](/automation/webhook)

<Note>
Pi is the embedded agent runtime. Do not describe OpenBot as a WhatsApp/iMessage personal inbox.
</Note>
