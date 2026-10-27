# OGUI P1′ — TypeBox schema + Wizard mapping (not merge)

> Status: **protocol / design** follow-up after Form P0 (#672) and C4 (#673).
> `LIVE_touched=false`. No Floor live, no `ui.*` RPC, no `ChatSendParamsSchema` expand,
> no Steward / Exec Approvals bypass.

## Goal

Make **ogui/v1** an authoritative TypeBox contract under Gateway protocol schema
(AJV + `protocol:gen`), while keeping Wizard as the **setup session stepper**.
Chat-inline Form remains the primary Generative UI path.

## Canonical shapes

| Fence / surface     | Schema             | Notes                                                                               |
| ------------------- | ------------------ | ----------------------------------------------------------------------------------- |
| ` ```ogui-form` `   | `OguiFormSchema`   | `schema_version: "ogui/v1"`; fields = `single_select` only                          |
| thin choice         | `OguiChoiceSchema` | `type: "choice"`; chat-inline; **not** forced into Canvas                           |
| ` ```ogui-answer` ` | `OguiAnswerSchema` | `answers` is `Record<fieldId, value>`; `submission_id` = chat.send `idempotencyKey` |

Source: `src/gateway/protocol/schema/ogui.ts`  
UI fence parsing (aliases like `form_id`, `version: 1`) stays in
`ui/src/ui/chat/ogui-form.ts` — TypeBox validates the **normalized** body.

## Wizard mapping (adapter only)

| OGUI                      | WizardStep.type                                     | Direction                                             |
| ------------------------- | --------------------------------------------------- | ----------------------------------------------------- |
| `single_select`           | `select`                                            | bidirectional when option values are string-coercible |
| (deferred) `multi_select` | `multiselect`                                       | **not** implemented in P1′                            |
| —                         | `text` / `confirm` / `note` / `progress` / `action` | **no** OGUI invent                                    |

Adapter: `src/gateway/protocol/ogui-wizard-adapter.ts`  
**Does not** share Wizard session state, `wizard.*` RPC, or renderers.

## Explicit non-goals

- Merging Wizard + OGUI implementations
- Canvas / A2UI adapter (P3)
- Skill UI capability frontmatter (P4)
- `multi_select` UX, A2UI v0.9, independent `ui.submit`
- Expanding `ChatSendParamsSchema`

## Related

- Form P0 design: `docs/design/ogui-form-p0-single-select-2026-10-13.md`
- Skill: `skills/ogui-form/SKILL.md`
- TypeBox pipeline: `docs/concepts/typebox.md`
