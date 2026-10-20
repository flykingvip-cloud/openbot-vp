# Production SoT alignment (P2)

Date: 2026-07-25

## Facts (verified)

| Item                     | Value                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Immutable production tip | annotated tag `rc-baseline-recovery-20260725` @ `127fc543f0`                                                                 |
| Live image               | `localhost/openbot:rc-amd64-v116-baseline-recovery`                                                                          |
| Shared tree branch       | `deploy/user-modeling-v92` @ local `309090ad1d` — **ahead 2 / behind 8** vs `origin/deploy/user-modeling-v92` (`e860bba1b0`) |
| Shared dirty files       | ~44 (multi-agent WIP; not a build source)                                                                                    |

## Policy (mandatory)

1. **Do not build or cut over production from** `/Users/daniel/AI项目/openbot` shared WIP on `deploy/user-modeling-v92`.
2. **Only** build from a fresh clone/worktree checked out at `rc-baseline-recovery-20260725` (or a newer annotated recovery tag).
3. Keep `deploy/user-modeling-v92` as historical/WIP SoT for in-flight agent commits; production SoT pointer is the recovery tag until an explicit owner rebase lands v116 history onto that branch **without** WIP overlays.
4. Hold file on host: `v116-baseline-recovery BASELINE LOCKED`.
