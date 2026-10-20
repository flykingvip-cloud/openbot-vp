# Base parity — C-prod (production SHA anchor)

Captured: 2026-07-20T09:46:11Z  
Prod SHA: `85eee3e7b987b14b3f83301e3f200b3e1d797cc6` (`openbot:rc-amd64-v69`)  
**Role: rollback + parity anchor ONLY — not recommended as long-lived merge base for future feature landings without a branch tip.**

## What prod has (from RELEASE_RECORD)

- Image `rc-amd64-v69` from fix-scoped at `85eee3e7b987b14b3f83301e3f200b3e1d797cc6`
- healthz OK; readyz **wecom 503**
- Backend exec approval fallback + PID1 signal guard; prior Control UI / qiaomu / ffmpeg retained

## Parity table (self)

| Area                          | Status on prod SHA   | Notes                                                                                                    |
| ----------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------- |
| Login / Control UI            | Present (image)      | Exact UI hash in older notes; v69 retains UI                                                             |
| Tenant/seat                   | Present historically | Confirm env flags on container                                                                           |
| Knowledge localFolder package | **Likely absent**    | Package commits are descendants of prod in local HEAD, not in `85eee3e7b987b14b3f83301e3f200b3e1d797cc6` |
| readyz                        | Known fail wecom     | Not a feature parity pass                                                                                |
| Deploy assets                 | Match RELEASE_RECORD |                                                                                                          |

## P0 gaps if used as Canonical Base alone

1. Missing post-prod local work (knowledge-import, convergence docs, etc.).
2. Using prod SHA as base is OK **only** if convergence branch starts at prod and lands features forward — still requires human worktree.
3. wecom readyz must not be silently waived forever.

## Recommendation

**Use as parity/rollback anchor.** Acceptable **starting point** for human-created `convergence/2026-07-20` **if** maintainer locks “start from prod SHA then land ledger waves”. Not a substitute for feature completeness.
