# Phase D4 — K1–K6 matrix

| ID     | Name                 | Status   | Test                                                                      |
| ------ | -------------------- | -------- | ------------------------------------------------------------------------- |
| **K1** | Success path         | **pass** | `K1 closes team KB → bind → scan → search → sources → consume → reload`   |
| **K2** | Authz deny           | **pass** | `K2 denies bind without user context (authz)`                             |
| **K3** | Tenant A/B isolation | **pass** | `K3 tenant B cannot search tenant A knowledge base`                       |
| **K4** | Idempotent resync    | **pass** | `K4 rescan is idempotent for documents and links`                         |
| **K5** | Failure recovery     | **pass** | `K5 bind outside data root fails then recovers with allowOutsideDataRoot` |
| **K6** | Restart persistence  | **pass** | `K6 binding persists on disk after process-local reload`                  |

File: `src/gateway/knowledge/sources/local-folder-import.golden-path.test.ts`
