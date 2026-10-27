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
| W3 acceptance/budget   | merged #102 | `f53e027b`                                                              |
| W4 experience verified | merged #109 | `b8ff8ea4`                                                              |
| W5 structure closeout  | in PR       | bounded `evolution-loop-log`; matrix convergence; bypass inventory-only |

See `docs/design/task-outcome/call-chain-and-replacements.md` for the converged matrix.
