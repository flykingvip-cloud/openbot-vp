# M4a Acceptance: Employee Home Steward Suggestion Bar

Date: 2026-06-30
Session: `019f12e0-ddf4-7751-9ab4-ab663e8c36ed`
Agent: `codex-oig`

## Scope

This acceptance pass is for the employee-home "standing duty" line documented in:

- `docs/design/employee-home-standing-duty-agents-2026-06-29.md`
- §7 M4 steward suggestion layer
- §7.6 M4a landing record

This is **not** the enterprise-operational-identity `M4` placeholder milestone.

## Verdict

Status: accepted, with test rerun blocked by the local dependency state.

## What Matches the M4a Contract

- A dedicated deterministic read model exists at
  `src/gateway/workbench/steward-suggestion-read-model.ts`.
- The read model implements the M4a contract:
  - deterministic template priority from M1/M2/M3 signals,
  - stable `signature`,
  - per-actor cache/dedup,
  - default `10 min` throttle constant,
  - optional `generateSuggestionText` DI seam that is present but not wired by the RPC path.
- The RPC exists at `workbench.steward-suggestion.get` in
  `src/gateway/server-methods/workbench.ts`.
- The RPC is actor-scoped:
  - no actor returns an empty suggestion payload,
  - M1 pending-task aggregation excludes the builtin steward `main`,
  - each source degrades independently.
- The method is registered in:
  - `src/gateway/server-methods-list.ts`
  - `src/gateway/method-scopes.ts`
- The UI path exists and is co-loaded through:
  - `ui/src/ui/controllers/spaces.ts`
  - `ui/src/ui/ports/employee/views/workbench-signals.ts`
  - `ui/src/ui/ports/employee/views/workbench-home-model.ts`
  - `ui/src/ui/ports/employee/views/workbench-signals-surface.ts`
- The surface matches the product contract:
  - single top bar,
  - whale icon,
  - server-provided text,
  - AI tag shown only when `source === "llm"`,
  - null suggestion hides the bar.

## Static Evidence

- Read-model tests exist at `src/gateway/workbench/steward-suggestion-read-model.test.ts`
  and cover:
  - template priority,
  - signature stability,
  - dedup/cache behavior,
  - deterministic-only M4a behavior,
  - M4b seam fallback/throttle behavior.
- RPC tests exist at `src/gateway/server-methods/workbench.test.ts` and cover:
  - no-actor empty result,
  - deterministic actor-scoped aggregation,
  - all-zero null suggestion,
  - per-source degradation.
- Controller tests exist at `ui/src/ui/controllers/spaces.node.test.ts` and cover:
  - co-loading,
  - normalization,
  - request failure clears stale steward suggestion,
  - null/empty suggestion suppression.
- Surface tests exist at
  `ui/src/ui/ports/employee/views/workbench-signals-surface.node.test.ts` and cover:
  - bar render when suggestion exists,
  - AI tag only for LLM source,
  - bar hidden when suggestion is null.

## Limits / Rerun Blocker

I was not able to complete a fresh local test rerun in the current workspace state:

- direct `vitest` execution failed because the current `node_modules/.ignored_vitest`
  tree is missing `@vitest/utils`,
- `pnpm`-based recovery attempted to reinstall dependencies and then stalled on
  restricted-network registry resolution.

That blocker affects local rerun only. It does not change the acceptance reading
of the landed M4a code and test coverage described above.
