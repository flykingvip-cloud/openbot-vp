# Collaboration C0 — Progress export + freeze (2026-10-13)

> Status: **observe-only**. No Floor live, no `ui.*` RPC, no default flag flips.
> Implements upgrade plan §6 C0 from `openbot-collab-upgrade-from-ogui-2026-10-13.md`.

## Field evidence (must not ignore)

From tip「数字人战队」2030 AI strategy soak (2026-10-13):

1. Assistant replies that `@` peers do **not** open a new round / wake peers — wake wire is **C2**; C0/C1 at least make progress **visible**.
2. After assignment there is **no** inter-round active submission; no「我完成了」state; secretary’s promised four-tier progress was **never** posted to an authoritative surface.
3. No `listBoard` / `getProgress` RPC; `operating-state` only carries `currentTaskId`; claim barely auto-follows after `applied`.
4. Report not landed / **stitch_only** risk (parallel long writes without structured review).

C0 answers: **can we export who is claimed / in_progress / submitted / returned today?**
(AS-IS board statuses are `published|claimed|applied|cancelled`; C1 adds the rest.)

## Inventory-first (AS-IS)

| Surface                                      | Status       | Note                                                |
| -------------------------------------------- | ------------ | --------------------------------------------------- |
| `board-claims/*.jsonl`                       | EXISTS (P4b) | Authority for claim facts under `<ns>/board-claims` |
| `listBoardClaimItems` (library)              | EXISTS       | No production RPC list/progress yet (C1)            |
| `operatingState.activeContext.currentTaskId` | EXISTS       | No per-member progress map                          |
| Chat `@` inside assistant text               | EXISTS       | Does **not** wake peers (C2)                        |
| RCIS / Shadow                                | EXISTS       | Must stay observe-only / not rewrite speaker        |

## What this PR adds

| Surface                                     | Behavior                                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `member-progress-export.ts`                 | Pure read of board-claims (+ optional operating-state) → member progress table                                             |
| `scripts/collab-member-progress-export.mjs` | CLI for tip soak; prints JSON + text table                                                                                 |
| Freeze tests                                | oral≠board fact; RCIS `drivesAdmission===false`; Shadow fuse/cap invariants still importable; export answers member×status |
| Design doc                                  | This file                                                                                                                  |

## Explicit non-goals

- Progress state machine writes (`in_progress` / `submitted_for_review`) — **C1**
- Wake ledger / `@` → new round — **C2**
- Peer-review hard gate — **C3**
- Floor live / `ui.*` RPC / default-on flags / LIVE cutover

## Acceptance checklist (执行效率合入验收)

1. Diff is gap-only: export + freeze tests + docs; **no** Floor live / second orchestrator / `ui.*`.
2. Flags stay default OFF; no LIVE config edits in this PR.
3. Export can list each claimant’s latest board status from tip `board-claims` (including today’s `applied`-stuck items).
4. Freeze: `oralDispatchCreatesBoardFact()===false`; RCIS snapshot `drivesAdmission===false`.
5. Tests in diff; CI unstable does not block (same policy as P0–P5).
