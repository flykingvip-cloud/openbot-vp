# Phase D2 — invariants matrix

| ID     | Invariant                                    | Status                   | Evidence                                                                                                              |
| ------ | -------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **S1** | Multitenant write/read same store            | **implemented + tested** | `resolveSessionStorePathForInboundMessage` + `session.ts` wiring; test: tenant path ≠ global when user+domain present |
| **S2** | Split-brain promote on history load          | **implemented + tested** | `promoteGlobalSessionEntryIfNewer` from `loadSessionEntryForClient`; test copies global jsonl into tenant             |
| **S3** | Empty newer tenant entry does not block heal | **implemented + tested** | promote prefers global when tenant has no non-empty transcript even if `updatedAt` is newer                           |
| **S4** | Multitenant off → global                     | **tested**               | `falls back to global store when multitenant is off`                                                                  |
| **S5** | Fail-open on membership failure (write)      | **implemented**          | `resolveSessionStorePathForInboundMessage` catch → global; history still best-effort heal                             |

`chat.history` already uses `loadSessionEntryForClient` on this branch — heal runs on that path after D2.
