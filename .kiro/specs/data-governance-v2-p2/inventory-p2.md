# P2 Inventory Delta — Round 4

## Delta vs Round 3

| Item                | Note                                                                  |
| ------------------- | --------------------------------------------------------------------- |
| Hold vs active op   | Hold receipts exist but do not claim `activeLifecycleOperation`       |
| Marker invalidation | Re-read Catalog; version/hold/op/attempt gates — not atomic FS unlink |
| Purge RPCs          | External schedule OK; internal `resumePurge(operationId, attemptId)`  |
| Receipt             | `requestedBy` + `executedBy[]` / per-stage actor + `attemptId`        |

## Still missing until Phase C

Envelope fields · CAS API · receipt store unique create · logical marker checks · resumePurge · two-phase CA bridge
