# Exec efficiency P2 — observability & dashboard notes

**Date:** 2026-10-12  
**Status:** Guidance for operators / SRE (no **remote** sink required)  
**Depends on:** `emitChatInboundStage` (`src/gateway/chat-inbound-stage-events.ts`),
optional `OPENBOT_EXECUTION_ROUTER_OBSERVATION` bridge
(`src/gateway/execution-router-observation.ts`),
local durable harvest `src/gateway/chat-inbound-depth-harvest.ts`
(auto-on with SHADOW/ROUTER; still no remote I/O).

---

## Already emitted (use these; do not invent parallel clocks)

Lifecycle stream events (via `emitAgentEvent`, `stream: "lifecycle"`):

| Stage / event | Useful extras | Maps to KPI |
| --- | --- | --- |
| `chat.depth_decided` | `wouldDepth`, `routeMs`, `mode` (`shadow`\|`router`\|…), `reasons` | depth mix, classifier cost |
| `chat.knowledge_started` / `chat.knowledge_finished` / `chat.knowledge_degraded` | `knowledgeMs`, `depth`, `knowledgeSkippedReason`, `selectedSourceCount` | **knowledgeMs**; chat-lane skip rate |
| `chat.model_started` / `chat.first_token` / `chat.model_finished` | `modelTtftMs` on first_token | **ttfb** (model); compare to UI-visible ACK from P1 thinking progress |
| `chat.tool_policy_applied` / `chat.tool_rejected` | `toolCount`, `toolPolicy`, `toolSkippedReason` | tool ceiling / **tool_rounds** proxy |
| `chat.context_compiled` / `chat.context_provider_boundary` | (when present) budget / provider notes | **context_tokens_in** adjacent signals |
| `chat.execution_observation` (flag on) | `latencies`, `stages`, tool/skill baselines | end-to-end stage histogram |

**ttfb_visible (product):** P1 emits process-channel thinking progress on lifecycle
`start` before knowledge/model work. Dashboard should treat (a) time-to-first
thinking/ACK card and (b) `modelTtftMs` / first assistant delta as **separate** series.
Do not collapse them into one number.

**tool_rounds:** Prefer counting tool-call lifecycle events already on the run, or
`toolBaseline` on `chat.execution_observation` when the observation flag is on. Stage
`tool_policy_applied` with `toolCount: 0` + `toolSkippedReason: depth_chat` means the
router chat lane stripped tools (0 rounds expected).

**context_tokens_in:** Use existing model/usage receipts on the run when available;
pair with compaction / bootstrap truncation logs. Schema recommendations for steward
defaults live in `src/config/schema.help.ts` (`bootstrapMaxChars`, `compaction.*`) —
operators apply via approved config change, not this doc alone.

---

## Recommended dashboards (by depth)

Bucket every series by `extra.depth` or `wouldDepth` (`chat` / `retrieve` / `act`) and
by `flags` containing `chatInboundDepthShadow` / `chatInboundDepthRouter`.

1. **Depth mix** — share of `chat.depth_decided` by `wouldDepth` and `mode`.
2. **knowledgeMs p50/p95** — from `knowledge_finished`; plus skip rate =
   `knowledge_degraded` with `knowledgeSkippedReason=depth_chat` / total steward turns.
3. **ttfb_visible p50/p95** — UI or gateway time from `chat.send` ACK to first process
   thinking / first `chat.delta` (define one probe and stick to it).
4. **modelTtftMs p50/p95** — from `chat.first_token`.
5. **tool_rounds p50/p95** — by depth; alert if `chat` depth shows unexpected tool use
   after ROUTER is on.
6. **context_tokens_in p50/p95** — by depth; watch after compaction / bootstrap changes.

Alert ideas (start warn-only):

- ROUTER on + `knowledgeMs` p95 for `wouldDepth=chat` not near zero (prefetch leak).
- Spike in `spawn docker` / `DG0_MANAGED_DOCKER_RUNTIME_UNAVAILABLE` (P0 regression).
- Sudden drop in `act`/`retrieve` share with rise in failed side-effect tasks (under-route).

---

## Cheap enablement

- Shadow/router greyscale: `deploy/production/exec-efficiency-inbound-depth-greyscale.md`
- Optional richer latencies: `OPENBOT_EXECUTION_ROUTER_OBSERVATION=1` (still no remote I/O;
  emits terminal lifecycle observation only).
- **Durable shadow samples (ROUTER blocker A):** with `OPENBOT_CHAT_INBOUND_DEPTH_SHADOW=1`,
  `chat.depth_decided` also appends to
  `$OPENBOT_STATE_DIR/inbound-depth-harvest/depth-decided-YYYY-MM-DD.jsonl`
  (default retention 14d). Scorecard:
  `bun scripts/ops/inbound-depth-shadow-scorecard.ts --root "$OPENBOT_STATE_DIR/inbound-depth-harvest"`.
  Kill-switch: `OPENBOT_CHAT_INBOUND_DEPTH_HARVEST=0`. Still no remote sink.

No frontend redesign in this note. Harvest landing still needs a Path B DIGEST to LIVE.
