# Collab S5 — Limited self-advance with per-tick reauth + dry-run (FINAL v3)

| Field   | Value                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------ |
| Date    | 2026-10-15 Asia/Shanghai                                                                                                 |
| Status  | Code ready; **mode default dry_run**; **executeGroupAllowlist default []**; L1 `botMaySelfAdvanceWithoutHuman` **false** |
| Spec    | `openbot-collab-self-run-FINAL-v3-2026-10-15.md` §S5 + expert hard conditions                                            |
| Depends | **P0 #731**, **S1 #734**, **S2 #735**, **S3 #737**, **S4 #739** (tip `686792f037…`)                                      |
| Code    | `self-advance.ts`, `self-advance-entry.ts`, `collab-s5-limited-self-advance.test.ts`                                     |

## Scope

1. **Keep** platform default off; target group explicit L2 auth; unaccepted valid task required; onboarding blocks; outbound/final still `human_required`.
2. **Per-tick reauth**: every `trySelfAdvance` reloads board + re-evaluates policy/gate; never reuses a prior tick's eligibility.
3. **Invalidation**: cancel / block / return / claimant change (fingerprint mismatch) marks `invalidatedPrior` and clears or re-evaluates pending.
4. **Decision ledger**: each tick appends `taskId`, `boardItemId`, `claimantId`, policy judgment, `triggerSource`, `writeMode`, `execMode`, `advanced`, `executed`, `result` under `<ns>/self-advance-decisions/`.
5. **Dry-run first**: default `mode=dry_run` records decisions only (no wake). Real execute requires `mode=execute` **and** `executeGroupAllowlist` match **and** L2 `botMaySelfAdvanceWithoutHuman=true`.
6. **Semantics**: self_advance ≠ auto-complete. Never submit / accept / finalize. Only plan_nudge or wake for next step; S2/S3 gates still apply.

## Config (defaults stay safe)

| Key                                      | Default                 | Tip gray                       |
| ---------------------------------------- | ----------------------- | ------------------------------ |
| `task.selfAdvance.mode`                  | **dry_run**             | `execute` only when authorized |
| `task.selfAdvance.executeGroupAllowlist` | `[]`                    | scoped `001/grp-…`             |
| L2 `botMaySelfAdvanceWithoutHuman`       | **false** (platform L1) | per-group operatingState       |
| `wakeContract` / allowlist               | false / `[]`            | needed for wake on execute     |
| claim / challenge / LIVE / Floor         | unchanged OFF           | **not** opened here            |

**Does not** open production gray writes. LIVE / Floor untouched. No second orchestrator. Does **not** default `botMaySelfAdvanceWithoutHuman=true`.

## Acceptance

- Vitest: `collab-s5-limited-self-advance.test.ts` + `self-advance.test.ts` green
- LIVE_touched = false
- Platform default off; dry-run ledger without wake; execute only with explicit gray; claimant-change invalidation

## Out of scope

Floor live, multi-beat, tip production gray writes, defaulting L2 self-advance on, auto submit/accept.
