# OGUI Form P0 — single_select (`ogui-form` / `ogui-answer`)

> Status: **implementation PR** (control-ui + skill). Unlocks C4 Form presence.
> Flag `collaboration.task.oguiHandoffProjection` remains **OFF** by default.
> No Floor live, no `ui.*` RPC, no Gateway `ChatSendParamsSchema` expand,
> no Steward / Exec Approvals bypass.

Depends on Interactive Choice Follow-up (#665) for submit wiring pattern, and on
C4 deferred seam (#670) for `ogui-answer` projection helpers.

## Contract

### `ogui-form` (assistant)

```json
{
  "schema_version": "ogui/v1",
  "component_id": "biz-model-form-1",
  "title": "可选标题",
  "fields": [
    {
      "id": "channel",
      "label": "获客模式",
      "type": "single_select",
      "options": [
        { "value": "direct", "label": "直销" },
        { "value": "hybrid", "label": "混合" }
      ]
    }
  ],
  "submit_label": "确认拍板"
}
```

Aliases accepted: `id` / `form_id` → `component_id`; `version: 1` → `schema_version: "ogui/v1"`; `submit.label` → `submit_label`.

### `ogui-answer` (user submit via `chat.send`)

```json
{
  "schema_version": "ogui/v1",
  "component_id": "biz-model-form-1",
  "submission_id": "<uuid>",
  "answers": { "channel": "hybrid" },
  "submitted_at": "<iso-optional>"
}
```

`submission_id` lives in the fence **and** is passed as `chat.send`
`idempotencyKey` (existing Gateway field — schema stays closed; do **not**
expand `ChatSendParamsSchema`). Same `submission_id` retries must not double-run.

## Surfaces

| Surface       | Path                                                                              |
| ------------- | --------------------------------------------------------------------------------- |
| Parse / build | `ui/src/ui/chat/ogui-form.ts`                                                     |
| Renderer      | `ui/src/ui/chat/ogui-form-view.ts`                                                |
| Wiring        | `ui/src/ui/chat/grouped-render.ts` (plain markdown path; ``` gate skips delivery) |
| Skill         | `skills/ogui-form/SKILL.md`                                                       |
| C4 presence   | `oguiFormUiPresentOnMain() === true`                                              |
| Projection    | unchanged; flag default OFF                                                       |

## Behavior

1. Detect first legal `ogui-form` fence on assistant final bubble.
2. Strip fence from markdown display; render single_select + submit.
3. Option click → draft only (+ composer preview).
4. Submit → readable summary + `ogui-answer` via existing `onSubmitChoice` → `handleSendChat`.
5. Illegal fence → safe degrade (plain markdown / ignore).

## Explicit non-goals

- multi_select / Wizard / Canvas / mobile
- LIVE flag defaults / Floor live / Production Auto Failover
- Expanding chat send schema or adding `ui.*` RPC
- Auto-enabling `oguiHandoffProjection` on LIVE
- Breaking Interactive Choice 「你选」 path

## Tip smoke (after merge; tip only)

1. Tip config: do **not** flip LIVE flags.
2. In a tip session, paste or have an agent emit a legal `ogui-form`.
3. Select options → preview; submit → transcript shows summary + `ogui-answer`.
4. Optional: tip-only `collaboration.task.oguiHandoffProjection=true` and confirm C4 projection brief (not required for this PR gate).

## Acceptance（执行效率合入验收）

1. inventory-first / gap-only；无 Floor live / 无第二编排器 / 无 `ui.*`
2. 合法 form 可渲染；非法 envelope 安全降级；非 ogui fence 不变
3. 提交消息含 UUID `submission_id` + `answers`；不扩 `ChatSendParamsSchema`
4. `oguiFormUiPresentOnMain()===true`；`oguiHandoffProjection` 仍默认 OFF
5. Interactive Choice 路径不回归；测在 diff；**实现方不自 merge**

## Follow-up (P1′)

Authoritative TypeBox schemas + Wizard mapping (not merge):
`docs/design/ogui-p1-typebox-schema-2026-10-13.md` ·
`src/gateway/protocol/schema/ogui.ts` ·
`src/gateway/protocol/ogui-wizard-adapter.ts`.
