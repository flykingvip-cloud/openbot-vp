# Collab S1 — Shared board + single-challenger window (FINAL v3)

| Field | Value |
| --- | --- |
| Date | 2026-10-15 Asia/Shanghai |
| Status | Code ready; **flags default OFF** — tip gray needs explicit allowlist |
| Spec | `openbot-collab-self-run-FINAL-v3-2026-10-15.md` §S1 + §2.1 / §C |
| Depends | **P0 #731** tip-proven (`7a577bf851…`) |
| Code | `intent-board-materialize.ts` (§C quality), `challenge-window.ts`, `claim-contract.ts`, `collab-s1-board-challenge-flow.test.ts` |

## Scope

1. Shared contract fact surface + **single** challenger short red/blue:
   `publish → challenge → resolve/skip → claim → apply`
2. Short red/blue **before** hang-board; lead absorb/reject **with reason** (auditable).
3. Intent materialize = **draft only** (FINAL v3 §C):
   - Missing Acceptance / thin Constraints / unreliable Due / non-delivery Goal → `needs_confirm`
   - **Forbidden:** generic default Acceptance masquerading as a complete contract
   - Fuzzy due words → `duePendingConfirm` (+ `dueSuggestedMs` hint), not silent exact deadline
4. Inventory-first: reuse claim-contract / challenge-window / intent-board-materialize — **no** second orchestrator, **no** Floor live.

## Flags (stay OFF in this PR)

| Flag | Default | Tip gray enable |
| --- | --- | --- |
| `collaboration.task.claimContract` | false | Prefer `claimContractGroupAllowlist: ["001/grp-…"]` (P0 scoped) |
| `collaboration.task.challengeWindow` | false | Set true only after gray claim proven |
| `collaboration.runtimeNamespace` | false | Unchanged (N2 unsigned) |
| `botMaySelfAdvanceWithoutHuman` | false | S5 only |

**Does not** open production gray writes. Tip ops must explicitly configure scoped allowlist keys after P0 tip proof.

## Acceptance

- Vitest: intent quality (§C) + `collab-s1-board-challenge-flow.test.ts` green
- Existing challenge-window / claim-contract / P0 gates still green
- LIVE_touched = false

## Out of scope

S2 plan-gate on all exec entries, S3–S5, Floor live, multi-beat, N2 production cutover, flipping tip production gray writes.
