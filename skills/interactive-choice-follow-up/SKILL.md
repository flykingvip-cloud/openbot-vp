---
name: interactive-choice-follow-up
description: "When the user must pick among options so the agent can continue (config, plan, diagnosis branch), emit a chat-delivery 「你选」 block. Control-ui renders clickable choices plus 「确认并继续」, which submits a natural-language summary as the next user turn. Prefer this over free-form multi-param questions when options are mutually exclusive."
metadata: { "openclaw": { "emoji": "☑️" } }
---

# Interactive Choice Follow-up

## Two layers

| Layer | Responsibility |
| --- | --- |
| **Skill** (this file) | When to show choices, which questions/options, how to interpret the submitted answer |
| **Renderer** (control-ui `chat-delivery`) | Clickable options, selection state, 「确认并继续」 → `chat.send` / `handleSendChat` |

Do **not** invent DIL.useState / GenUI.issueNewTurn APIs. OpenBot already maps 「你选 / A.」 into `chat-delivery` and sends via the normal chat capability.

## When to use

Use when **two or more** mutually exclusive options gate the next step (commercial mode, deploy target, diagnosis branch, export path).

Do **not** force a panel for a single missing fact — ask in plain text.

## Agent output format (Skill → Renderer)

Emit a normal reply-surface / chat-delivery envelope:

```text
<结论一行>

<可选说明段>

下一步
<下一步动作>

你选
A · <完整选项文案>
B · <完整选项文案>
C · <完整选项文案>
```

Rules:

- Option labels must be **complete and mutually exclusive** (not key-only).
- Prefer 2–5 options in one group (MVP = single 「你选」 group).
- Do not invent choices for collaboration **Supplement** replies.

## Submit message (Renderer → next turn)

After the user selects and clicks **确认并继续**, control-ui sends a user turn shaped like:

```text
请基于以下选择继续完成任务：

你选：A · <完整选项文案>

请据此继续原任务，并明确区分事实、建议与假设。不要重复询问已回答的问题。
```

Helpers: `buildInteractiveChoiceSubmitMessage` / `formatChoiceComposerText` in `ui/src/ui/chat/chat-delivery.ts`.

On receive: continue the original task from those values; **do not** re-ask answered questions.

## Markdown fallback (no interactive UI)

If the client cannot render choices, keep the same numbered/lettered list and ask the user to reply with the key or full label.

## Out of scope (MVP)

- Porting DIL / GenUI
- Multi-question radio panels (P1; types already scaffolded as `InteractiveChoiceQuestion[]`)
- Mobile native parity
- Enabling LIVE ROUTER / DIGEST

## Demo (control-ui)

1. Ask the steward something that yields a 「你选」 block (or paste a delivery-shaped reply in a test session).
2. Click an option → it highlights and fills the composer preview.
3. Click **确认并继续** → a structured user turn is sent; the agent continues from that choice.
