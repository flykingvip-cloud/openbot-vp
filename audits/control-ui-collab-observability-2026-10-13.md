# Control-ui collab observability — wake / claim / peer (2026-10-13)

- **When:** 2026-10-13 ~18:50 CST (Asia/Shanghai)
- **Branch:** `feat/control-ui-collab-observability` (from `47c51ae7`)
- **Tip WT:** `/Users/daniel/AI VP/openbot-main-tip-p2-smoke`
- **LIVE_touched:** **false**
- **C4 / oguiHandoffProjection:** **not enabled** (intentional OFF)

## Goal

Operators can see collaboration wake / claim / peer without digging filesystem JSONL.

## What shipped

### Server (thin read RPC)

- **Existing (reused):** `collaboration.task.whoWokeWhom`, `listWakeEvents`, `listBoardItems`, `getMemberProgress`
- **New read-only:** `collaboration.task.listPeerReviews` → wraps `listPeerReviews` via `listCollaborationPeerReviews` (observe AS-IS; **no** claim/requirePeerReview flag required)

### Control-ui

- Controller: `ui/src/ui/controllers/collaboration-observability.ts`
- Panel: `ui/src/ui/collaboration/collaboration-observability-panel.ts`
- Mounted in group profile **Capabilities** (group wake timeline) and **Task detail** (wake + board claims + peer reviews + progress summary)
- Refresh button forces RPC reload; opens with governance view / task detail

## Tests

```
pnpm exec vitest run \
  ui/src/ui/controllers/collaboration-observability.node.test.ts \
  ui/src/ui/collaboration/collaboration-observability-panel.node.test.ts
→ 2 files / 5 tests PASS
```

## Non-goals / follow-ups

- No Floor live, no new exec system, no generative UI runtime
- Does not enable C4
- Historical dirty wake tokens still not rewritten
- Optional tip live `无需回复` silence observational PASS: still unit-covered; live force deferred unless Owner asks again

## Handoff

Please **Agent 交互能力验收** (`87474657-5e40-49f5-9610-51a8fd447070`) gate the PR (static + tip smoke: open Capabilities → wake table; open task detail → claim/peer sections when data exists). **Do not self-merge.**
