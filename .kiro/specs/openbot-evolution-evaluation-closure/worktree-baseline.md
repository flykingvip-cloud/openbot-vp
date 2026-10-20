# E0.1 Worktree / Ancestry Evidence

Date: 2026-09-19

| Check                                                     | Result                                                                                                                                                                           |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worktree                                                  | `/Users/daniel/AI项目/openbot-evolution-evaluation-closure`                                                                                                                      |
| Branch                                                    | `cursor-grok/evolution-evaluation-closure`                                                                                                                                       |
| Create SHA                                                | `5cd01d20d3f4f2141f853860e825b003ac433329`                                                                                                                                       |
| `git merge-base --is-ancestor origin/main HEAD` at create | **ANCESTOR_OK**                                                                                                                                                                  |
| Clean before edits                                        | porcelain empty                                                                                                                                                                  |
| Fetch                                                     | HTTPS `git fetch origin` timed out on 443. Remote tip confirmed via `git fetch git@github.com:gmood2008/openbot.git` and `gh api repos/gmood2008/openbot/commits/main --jq .sha` |
| Tip subject at create                                     | Identity: Official Account AppID contract, grant fallback, and credential skill (#1200)                                                                                          |

Created by explicit user authorization: `git worktree add -b cursor-grok/evolution-evaluation-closure <path> origin/main`.

E0.2 note: `origin/main` later moved to `954df53219` (seq95 cutover). Replay this branch onto that tip after the E0.2 commit so the ancestor gate holds again.
