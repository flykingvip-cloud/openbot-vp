---
name: ogui-form
description: "When the user must pick among mutually exclusive options (口径拍板, 分支选择) so the agent can continue with a structured answer, emit an ```ogui-form``` fence (ogui/v1 single_select). Control-ui renders options + 「提交」, which sends a readable summary plus ```ogui-answer``` via chat.send. Prefer this over free-form multi-param questions when options are mutually exclusive and the answer must be machine-projectable (C4 handoff). Distinct from interactive-choice-follow-up (NL 「你选」)."
metadata: { "openclaw": { "emoji": "📋" } }
supported-ui-components: ogui-form, ogui-choice
requires-ui-confirmation: true
---

# OGUI Form — single_select (P0)

## Two layers

| Layer | Responsibility |
| --- | --- |
| **Skill** (this file) | When to emit a form, field/option wording, how to read `ogui-answer` |
| **Renderer** (control-ui `ogui-form` / `ogui-form-view`) | Clickable options, draft selection, 「提交」 → `chat.send` / `handleSendChat` |

Canonical wire shapes are TypeBox `OguiForm` / `OguiAnswer` (`src/gateway/protocol/schema/ogui.ts`, `schema_version: ogui/v1`). Wizard mapping is a thin adapter only — do not merge Wizard session stepper with this skill.

Do **not** invent `ui.*` RPC or expand `ChatSendParamsSchema`. Submit stays on the normal chat capability. Pass `submission_id` as `chat.send` `idempotencyKey` (existing field). Do **not** bypass Steward / Exec Approvals / Admission.

## When to use

Use when **one or more** single-select fields gate the next step and the answer should be **projectable** (e.g. handoff brief via C4 `ogui-answer`).

Prefer **interactive-choice-follow-up** (「你选」) for lightweight NL continuation when no structured projection is needed.

Do **not** force a form for a single missing free-text fact — ask in plain text.

## Agent output format (Skill → Renderer)

Emit a short prose lead-in, then exactly one fence:

~~~~text
请拍板以下口径：

```ogui-form
{
  "schema_version": "ogui/v1",
  "component_id": "<stable-id>",
  "title": "<可选标题>",
  "fields": [
    {
      "id": "<fieldId>",
      "label": "<人类可读标签>",
      "type": "single_select",
      "options": [
        { "value": "<machine-value>", "label": "<完整选项文案>" },
        { "value": "<machine-value-2>", "label": "<完整选项文案>" }
      ]
    }
  ],
  "submit_label": "确认拍板"
}
```
~~~~

Rules:

- `schema_version` must be `ogui/v1`; `type` may be `"form"` or omitted.
- `component_id` (or `id`) is required and stable across retries.
- P0: every field `type` is **`single_select`** with 2–5 options; labels complete and mutually exclusive.
- Do not invent forms for collaboration **Supplement** replies.

## Submit message (Renderer → next turn)

After the user selects and clicks **提交**, control-ui sends a user turn shaped like:

~~~~text
已提交 OGUI 表单选择：

表单：<title>

- <field label>：<option label>（<value>）

请据此继续原任务；答案见下方 ogui-answer（只读投影，非审批旁路）。

```ogui-answer
{
  "schema_version": "ogui/v1",
  "component_id": "<same>",
  "submission_id": "<uuid>",
  "answers": { "<fieldId>": "<value>" },
  "submitted_at": "<iso>"
}
```
~~~~

Helpers: `buildOguiAnswerSubmitMessage` / `parseOguiFormFromText` in `ui/src/ui/chat/ogui-form.ts`.

On receive: continue from `answers` values; **do not** re-ask answered fields. Treat the fence as **projection input**, never as an approval bypass.

## Markdown fallback (no Form UI)

If the client cannot render the form, keep option lists in prose and ask the user to reply with the value or full label. Invalid fences must not crash the chat path.

## Out of scope (P0)

- multi_select / Wizard / Canvas
- Mobile native parity
- Expanding Gateway chat send schema or adding `ui.action` / `ui.submit`
- Enabling LIVE ROUTER / Floor live / Production Auto Failover
- Using form submit to bypass Steward / Exec Approvals

## Demo (control-ui)

1. Ask (or paste) a message that includes a legal `ogui-form` fence.
2. Click options → highlight + composer preview (draft only).
3. Click **提交** → structured user turn with `ogui-answer`; agent continues from those values.
