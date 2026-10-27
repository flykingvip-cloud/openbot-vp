# OGUI P3 — Canvas / A2UI adapter toward unified OGUI contract

> Status: **thin adapter + routing policy**. Depends on P1′ TypeBox (`OguiForm` /
> `OguiChoice` / `OguiAnswer`). `LIVE_touched=false`.
> No Floor live, no `ui.*` RPC, no A2UI v0.9 / `createSurface`, no forcing simple
> choices into Canvas.

## Inventory (reuse, do not reinvent)

| Surface             | Path                           | Role vs OGUI                                  |
| ------------------- | ------------------------------ | --------------------------------------------- |
| Chat-inline Form P0 | `ui/.../ogui-form.ts`          | **Primary** Generative UI                     |
| Canvas skill        | `skills/canvas/SKILL.md`       | HTML visuals / `canvas.present` / deliverable |
| A2UI host           | `src/canvas-host/a2ui.ts`      | v0.8 only; `sendUserAction` bridge            |
| Mac Canvas docs     | `docs/platforms/mac/canvas.md` | WKWebView panel + A2UI v0.8                   |

## Routing policy

| Component                   | Surface                                     |
| --------------------------- | ------------------------------------------- |
| `ogui-form` / `ogui-choice` | **chat-inline** always                      |
| Charts / architecture HTML  | Canvas / materials                          |
| A2UI component tree         | Canvas host (v0.8) — not chat form renderer |

## Adapter

`src/gateway/protocol/ogui-canvas-adapter.ts`

- `routeOguiComponent` → always `chat-inline` for form/choice
- `mustNotForceChoiceIntoCanvas` → policy guard
- `oguiAnswerToCanvasUserAction` → optional map onto existing `sendUserAction`
  shape (`name: "ogui.answer"`) when Canvas HTML already has the bridge
- Does **not** call `chat.send`, does **not** bypass Steward / Exec Approvals

## Non-goals

- A2UI v0.9 / `createSurface`
- Replacing chat-inline Form with Canvas for binary choices
- Merging Canvas skill runtime with OGUI TypeBox session state
