# Execution Decision Matrix

| Layer                  | Owns                                                                  | Must not own                                |
| ---------------------- | --------------------------------------------------------------------- | ------------------------------------------- |
| Capability catalog     | Tool identity, read/write mode, side-effect level                     | Per-user authorization                      |
| Session/channel policy | Which tools are visible in this context                               | Host path resolution                        |
| Resource authorization | Which resource handles are readable/writable                          | Tool existence or retry count               |
| Exec approval          | Explicit approval for one high-risk action                            | Expanding allowlists or permanent elevation |
| Elevated policy        | Whether host execution is configured and which sources may request it | Natural-language approval interpretation    |
| Retry policy           | Whether a technical failure is transient and safe to retry            | Permission escalation                       |
| Task orchestration     | Ordering, deduplication, stop-loss, fallback selection                | Reimplementing every underlying ACL         |
| Delivery layer         | User-safe conclusion, next step, and options                          | Re-deciding execution authority             |

## Decision distinctions

- Tool not visible is different from tool visible but execution-denied.
- Resource out of scope is different from missing approval.
- Approval timeout is different from explicit denial.
- Transient transport failure is different from policy or authorization failure.
- Model reflection may suggest a next action; runtime owns the final decision.

## Minimum trace fields

`taskId`, `sessionId`, `intent`, `toolName`, `resourceHandle`, `decisionStage`, `decisionCode`, `attemptNumber`, `retryable`, `fallback`, `userVisibleOutcome`.
