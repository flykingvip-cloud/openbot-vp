# Watchdog task-closure acceptance (PR #177 follow-up)

- Branch: `grok-sentinel-link/watchdog-task-closure`
- Worktree: `/Users/daniel/.codex/worktrees/watchdog-task-closure/openbot`
- Prior tip (human_todo state+JSONL only): `6da8dd6a8`
- Feature tip: `fe78bd61158410fe1459d2e08e08256780c00295`
- Zone: Asia/Shanghai (UTC+8)
- Written: 2026-11-01 ~10:15 Asia/Shanghai

## Acceptance blockers addressed

### P1 Formal human takeover intake (conversation card + unified todo)

Steering override: **must** show an actionable card in the task conversation **and** sync into the unified pending-tasks list.

Implemented:
- `human-attention-inbox.ts` — durable inbox (`human-attention-inbox.json`) with claim/ack/resolve, dedupe id `groupId|itemId|fingerprint`, version bump on material change.
- `human-attention-card.ts` — failure-kind-gated options:
  - `not_started`: 修复后重试 / 转交 / 取消任务
  - `side_effect_unknown`: 查看执行证据 / 确认结果已完成 / 核实后允许重试 — **no blind retry**
  - `awaiting_review`: 查看成果 / 通过 / 退回修改
  - `retries_exhausted`: 查看失败原因 / 转交 / 人工接管
- `human-attention-emit.ts` — upsert inbox + append ```human-attention``` fence into group public transcript (idempotent by todoId+version).
- `human-attention-actions.ts` — re-check owner / version / fingerprint; ban blind retry; require verification note for `release_after_verify`; resolution receipt with actor+result.
- Heartbeat `appendHumanAttentionRecord` → `openHumanAttentionWithCard` (+ JSONL audit).
- Workbench `pending-tasks-read-model` merges active human-attention rows as kind `human-attention`.
- Gateway RPCs: `collaboration.task.listHumanAttention`, `collaboration.task.actHumanAttention`.
- UI: `ui/src/ui/chat/human-attention-card.ts` sticky actionable cards wired in chat + app-render.

Closed loop: discover → conversation card + pending todo → authorized act → writeback → todo resolved/recovered (heartbeat gate cleared when applicable).

### P2 End-to-end redaction

- Shared `sanitize-dispatch-error.ts` (`sanitizeDispatchError` / `sanitizeDispatchErrorMessage` via `redactSensitiveText(..., { mode: "all" })`).
- Applied to: Mode B catch return `message`, wake-round-dispatch throw/`recordWakeEvent.reason`, human-attention reasons/recovery/resolution, boot `sanitizeWakeRunBotErrorMessage` (delegates to shared helper).

## Tests (exact)

```bash
pnpm exec vitest run \
  src/gateway/collaboration-dispatch/human-attention-intake.test.ts \
  src/gateway/collaboration-dispatch/watchdog-task-closure.test.ts \
  src/gateway/collaboration-dispatch/watchdog-task-closure.integration.test.ts \
  ui/src/ui/chat/human-attention-card.node.test.ts \
  src/gateway/collaboration-dispatch/collab-s4-heartbeat-scheduler.test.ts
```

Result:

```
 ✓ human-attention-card.node.test.ts (2)
 ✓ human-attention-intake.test.ts (8)
 ✓ watchdog-task-closure.test.ts (14)
 ✓ watchdog-task-closure.integration.test.ts (7)
 ✓ collab-s4-heartbeat-scheduler.test.ts (15)
 Primary+UI 31 + scheduler 15 related passing
```

## Format

`oxfmt --check` on touched files: All matched files use the correct format.

## Key files

- `src/gateway/collaboration-dispatch/human-attention-*.ts` (+ intake test)
- `src/gateway/collaboration-dispatch/sanitize-dispatch-error.ts`
- `src/gateway/collaboration-dispatch/group-task-heartbeat.ts`
- `src/gateway/collaboration-dispatch/mode-b-wake-round-dispatcher.ts`
- `src/gateway/collaboration-dispatch/wake-round-dispatch.ts`
- `src/gateway/wake-round-dispatcher-boot.ts`
- `src/gateway/workbench/pending-tasks-read-model.ts`
- `src/gateway/server-methods/human-attention.ts` (+ registry/scopes/schemas)
- `ui/src/ui/chat/human-attention-card.ts` (+ node test, chat/app-render wire)
- `evidence/watchdog-task-closure-acceptance-2026-11-01.md` (this file)

## Unresolved / out of scope

- No prod deploy / restart / force-push / approval skip.
- Full-repo `pnpm check` may still fail on pre-existing unrelated tip hygiene.
- One pre-existing `pending-tasks-read-model.test.ts` multi-agent workspace assertion can flake independently of this change set.
