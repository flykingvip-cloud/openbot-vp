# askOutcome P0 baseline

- Repo: flykingvip-cloud/openbot-vp
- Worktree: openbot-askOutcome-p0-task-outcome-contract
- Branch: executor-acceptance/askOutcome-p0-task-outcome-contract
- Owner: executor-acceptance
- Baseline origin/main at provision: 39cebb4974a8f290dc4b3cb951d89ec8466cfc38
- Scope: TaskOutcome freeze + result core + chat/cron/cli/collab/gateway adapters + durable tests
- Out of scope: P1 budget, experience metrics, legacy collab path retirement (interface only)

## Phase progress (askOutcome W0–W5)

| Phase                  | Status      | main tip                                                                |
| ---------------------- | ----------- | ----------------------------------------------------------------------- |
| W0 baseline            | merged #95  | `1f698e37`                                                              |
| W1 identity/closeout   | merged #98  | `b6c60550`                                                              |
| W2 consumers           | merged #99  | `f3a19e08`                                                              |
| W3 acceptance/budget   | merged #102 + wrap-up | `f53e027b` + runner tip budget path（其余未接）                    |
| W4 experience verified | merged #109 + wrap-up | `b8ff8ea4` + P1（run/task 键；adopted 才 verified）                 |
| W5 structure closeout  | merged #112           | `23314d48` 有界 loop-log；**四态矩阵**；不宣布整体收尾               |

See `docs/design/task-outcome/call-chain-and-replacements.md` for the converged matrix.
