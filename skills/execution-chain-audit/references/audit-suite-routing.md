# Audit Suite Routing

`fullstack-definition-audit` answers who defines and overrides a behavior. `execution-chain-audit` answers who actually decides and executes a request. They are complementary audit skills, not runtime dependencies.

| Symptom                                                      | First skill                | Follow-up                                         |
| ------------------------------------------------------------ | -------------------------- | ------------------------------------------------- |
| Multiple definitions of one rule                             | fullstack-definition-audit | Remove leftovers or merge to the source of truth  |
| Tool is visible but execution is denied                      | execution-chain-audit      | Trace policy, resource, and approval stages       |
| Approval timeout causes repeated calls                       | execution-chain-audit      | Find retry ownership and stop-loss behavior       |
| UI and gateway disagree                                      | fullstack-definition-audit | Verify compiler and consumers                     |
| New authorization, retry, or state-machine layer is proposed | fullstack-definition-audit | Prove an existing source of truth is insufficient |
| Definitions look singular but a real session fails           | execution-chain-audit      | Trace runtime order and resource reachability     |
| Duplicate definitions and runtime failure coexist            | both                       | Run definition audit first, then execution audit  |

When both skills are used, share these report fields: `object`, `scope`, `source_of_truth`, `decision_owners`, `overlays_or_forks`, `effective_order`, `consumer_paths`, `evidence`, `severity`, `recommended_action`, and `regression_lock`.
