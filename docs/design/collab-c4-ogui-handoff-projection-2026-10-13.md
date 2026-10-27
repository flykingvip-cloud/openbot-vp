# Collaboration C4 — OGUI 拍板 → handoff 投影（2026-10-13）

> Status: **wired seam** (thin follow-up after Form P0 #672).
> Flag `collaboration.task.oguiHandoffProjection` remains **OFF** by default.
> No Floor live, no `ui.*` RPC, no Gateway `ChatSendParamsSchema` expand.
> Tip may enable the flag for smoke; LIVE stays OFF.

Depends on collab spine through **C2** (#668) and **OGUI Form P0** (#672 @ `208875c0de`).

## Inventory (2026-10-13, `main` + this PR)

| Surface                                       | Status            | Evidence                                                           |
| --------------------------------------------- | ----------------- | ------------------------------------------------------------------ |
| `ogui-form` / `ogui-answer` fence + Form UI   | **Present**       | #672; `oguiFormUiPresentOnMain()===true`                           |
| Interactive Choice Follow-up (#665)           | EXISTS            | NL「确认并继续」→ `chat.send`; **not** OGUI v1                     |
| `ChatSendParamsSchema`                        | CLOSED            | `additionalProperties: false` — C4 must not expand                 |
| HandoffContract                               | EXISTS (flag-off) | propose → accept → approve → apply                                 |
| OGUI→handoff projection seam (#670)           | EXISTS            | parse + project helpers                                            |
| chat.send → projection store + propose enrich | **This PR**       | `ogui-handoff-projection-chat-hook` + `proposeHandoff` assumptions |

## What this PR adds (gap-only)

| Surface                                         | Behavior                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| Flag `collaboration.task.oguiHandoffProjection` | Default OFF; projection fail-closed                                     |
| `recordChatSendOguiProjectionBestEffort`        | Group chat.send: legal `ogui-answer` → `<ns>/ogui-projections` brief    |
| `proposeHandoff` enrich                         | Flag-on: append latest / sourceChatText brief into `assumptions`        |
| Tests                                           | flag-off no write; illegal degrade; flag-on store + propose assumptions |
| Design doc                                      | This file — Form P0 dependency satisfied; tip flag still required       |

## Explicit non-goals (this PR)

- Changing Form P0 fence contract / multi_select / Wizard / Canvas
- Expanding Gateway chat send schema or ProposeHandoff RPC schema / adding `ui.*`
- Floor live / LIVE flag defaults / Steward / Exec Approvals bypass
- Declaring full C4 “production always-on” (tip flag ON only)

## Activation path

1. Form P0 on main: assistant may emit `ogui-form`; user submit emits `ogui-answer` via `chat.send` + `idempotencyKey=submission_id`.
2. Tip enables `collaboration.task.oguiHandoffProjection=true` (LIVE stays OFF).
3. Group message with submitted `ogui-answer` → projection stored; next `proposeHandoff` assumptions include handoff brief.
4. C4 gate: 3× single_select 拍板 → projection visible on next handoff; no schema expand; no approval bypass.

## Acceptance checklist（合入验收）

1. inventory-first / gap-only；无 Floor live / 无第二编排器 / 无 `ui.*`
2. Form P0 已在 main；本 PR 只接线投影消费者
3. 默认 `oguiHandoffProjection` OFF；写/投影路径 fail-closed
4. 合法 `ogui-answer` + flag-on → 可读 handoff brief 入库并可进入 propose assumptions；非法 fence 安全降级
5. `oguiFormUiPresentOnMain()===true`；非 ogui fence 不进 Delivery choices
6. 不扩展 `ChatSendParamsSchema`；测在 diff；CI unstable 不阻塞；**实现方不自 merge**
