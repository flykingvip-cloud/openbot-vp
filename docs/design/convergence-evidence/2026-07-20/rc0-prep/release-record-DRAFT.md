# Release record — DRAFT (RC0-PREP)

> **DRAFT only.** Not a production cutover. Sign-off fields intentionally blank.  
> Style aligned with `deploy/production/RELEASE_RECORD.md` (shared tree, read-only).

## Candidate (staging decision input)

| Field                           | Value                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| Date (prep)                     | 2026-07-20                                                                                         |
| Branch                          | `convergence/2026-07-20`                                                                           |
| **RECOMMENDED_RC0_TIP**         | `9aceda7349da2190e00bb2fbb029175a517ecde7`                                                         |
| Worktree HEAD at prep           | `08027a70063c218190e234f11be2f81990cf43a1` (contains pollution — **do not** prefer)                |
| LOCKED_BASE / prod rollback SHA | `85eee3e7b987b14b3f83301e3f200b3e1d797cc6`                                                         |
| Suggested image tag             | `openbot:rc-convergence-20260720`                                                                  |
| Image id / digest               | **pending** (not built / not pushed this wave)                                                     |
| Container (staging)             | pending maintainer deploy                                                                          |
| Includes                        | D0–D4 convergence pack (auth/tenant, session promote, history/checkpoint locks, localFolder K1–K6) |
| Excludes                        | monthly-usage UI after D4; other KB import kinds; production cutover                               |
| Tests (this wave)               | `pnpm build` 0; vitest 40/40 (tenant 29 + localFolder 6 + history 2 + checkpoints 3)               |
| Readiness expectation           | `healthz` 200; `readyz` may 503 `failing:["wecom"]` per waiver expiring 2026-08-20                 |
| Rollback                        | Production v69 image `openbot:rc-amd64-v69` @ `85eee3e7…` / prior `rc-amd64-v68`                   |

## Waivers

- wecom readyz — see `readyz-waiver-status.md` — expires **2026-08-20**

## Production Sign-off

| Role                       | Signature                    | Date |
| -------------------------- | ---------------------------- | ---- |
| Maintainer (staging GO)    | _(blank)_                    |      |
| Maintainer (production GO) | _(blank — PRODUCTION_GO=NO)_ |      |

```text
PRODUCTION_GO=NO
PROD_CUTOVER=FORBIDDEN
```

## Explicitly not done

- No production deploy
- No `docker push`
- No edits to live `openbot-gateway-rc`
- No filling production RELEASE_RECORD cutover section as “shipped”
