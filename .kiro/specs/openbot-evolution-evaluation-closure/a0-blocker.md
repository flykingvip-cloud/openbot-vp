# Blocker: Track A A4 close consumed from origin/main

C4.1 Diagnosis Recheck joint evaluation is **unblocked**.

Trunk consumed: `f1c2669353487da23b49f4b9c8b3671b5c510600`.
A4 merge/squash: `b20c28825cd98f3f2fb4a5cb639c1f996a42ba46` (`#1217`).
A4 close / `#1222` squash: `7c1a196320674b9d7311645960f93a44d3915389`.

| Field                            | Value                                                                    |
| -------------------------------- | ------------------------------------------------------------------------ |
| Waiting for                      | **cleared** — `#1222` is on `origin/main`                                |
| Consumed from `origin/main`      | `f1c2669353487da23b49f4b9c8b3671b5c510600`                               |
| A4 merge SHA                     | `b20c28825cd98f3f2fb4a5cb639c1f996a42ba46`                               |
| A4 close / `#1222` SHA           | `7c1a196320674b9d7311645960f93a44d3915389`                               |
| Named A5 squash                  | **none on main** — no separate A5 PR; A4 close is `#1222`                |
| Track A producer freeze          | `a4368cfade4e16dd80df0b4a4c843ed338b834c3`                               |
| Rejected preview SHAs            | `c7d7aa54f2`, `bb97b44ce6` — still **not** consumed                      |
| `DiagnosisRecheckPort` interface | `packages/evolution-core/src/diagnosis-recheck.ts`                       |
| A4 port implementation           | `src/diagnosis/diagnose-evolution-recheck.ts#createDiagnosisRecheckPort` |
| A4 observer contract             | `src/diagnosis/diagnose-evolution-recheck.ts#DiagnosisRecheckObserver`   |
| B WDNA / Skill observer          | `src/gateway/evolution-control/diagnosis-recheck-observer.ts`            |
| WDNA authority source            | `src/gateway/agent-growth/working-style-store.ts`                        |
| Skill authority source           | `src/gateway/skill-lifecycle-store.ts` via `adapters/skill.ts`           |
| Gateway live bind                | `src/gateway/evolution-control/gateway-plane.ts`                         |

`structuralCandidateDtoReady()` remains `true`.
Preview SHAs `c7d7aa54f2` and `bb97b44ce6` remain rejected.
`#1222` SoT hash, P26 No-Go, and Recheck observer semantics are consumed from the main squash only.

C4.1 does **not** cut over E5, open auto, or Apply from Diagnosis.
