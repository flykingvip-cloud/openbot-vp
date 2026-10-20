---
summary: "Current OpenBot product setup: Gateway, consoles, and workplace IM"
read_when:
  - You want the current OpenBot setup path
  - A link pointed at /start/openbot
title: "OpenBot setup"
---

# OpenBot setup

OpenBot (`@upbeyond/openbot`) is an **enterprise Agent OS for digital employees**.
The Gateway is the control plane. Operators use the employee and enterprise consoles.
Product workplace IM is **WeCom, Feishu, and DingTalk**. In-product chat is **WebChat**.

This is the current setup path. It is **not** the inherited OpenClaw personal WhatsApp inbox.

<Steps>
  <Step title="Install">
    ```bash
    npm install -g @upbeyond/openbot@latest
    openbot onboard --install-daemon
    ```
    Details: [Getting Started](/start/getting-started).
  </Step>
  <Step title="Open the consoles">
    ```bash
    openbot dashboard
    ```
    Or open `http://127.0.0.1:18789/` on the gateway host.
  </Step>
  <Step title="Connect workplace IM">
    Enterprise console → Message channels → WeCom / Feishu / DingTalk (long-connection first).
    See [Enterprise IM](/channels/enterprise-im).
  </Step>
</Steps>

## Related

- [Getting Started](/start/getting-started)
- [Onboarding wizard](/start/wizard)
- [Enterprise IM](/channels/enterprise-im)
- [WebChat](/web/webchat)
- [Chat channels catalog](/channels) (includes leftover inherited adapters)

<Warning>
The leftover personal-inbox walkthrough (dedicated WhatsApp number, two-phone pairing)
is at [Personal assistant setup](/start/openclaw). That page is previous-project content,
not the product default.
</Warning>
