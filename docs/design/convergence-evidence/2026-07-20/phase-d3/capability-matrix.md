# Phase D3 — capability matrix

| ID     | Capability                              | Status                      | Evidence                                                                       |
| ------ | --------------------------------------- | --------------------------- | ------------------------------------------------------------------------------ |
| **T1** | History via `loadSessionEntryForClient` | **locked + tested**         | `chat.history-d3.test.ts`                                                      |
| **T2** | Transcript read safety                  | **locked + tested**         | existing candidates safety + new `readSessionMessages` unsafe-sessionFile case |
| **T3** | Checkpoint list (read-only)             | **present + hardened**      | pack already on branch; `chat-checkpoints.d3.test.ts` negatives                |
| **T4** | D2 invariants regression                | **pass**                    | `tenant-context.test.ts` 29/29                                                 |
| **T5** | Checkpoint restore                      | **deferred (pre-existing)** | `chat.restore` already shipped; not extended                                   |
| **T6** | Employee steward key vs agent bot       | **tested**                  | `employee-steward-session.d3.test.ts`                                          |
