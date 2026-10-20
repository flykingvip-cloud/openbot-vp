# C5 joint matrix — A6 recheck facts and B EvaluationPolicy

Status: joint acceptance only. This is not single-track evolution and not E5.2.

A supplies `DiagnosisRecheckResult` facts. B reads `outcome` through `decideEvaluationOutcome`. B does not call Adapter Apply. Direct mutators stay in place, so E5.2 stays **No-Go**.

| A recheck fact                                                  | B decision | reason                 |
| --------------------------------------------------------------- | ---------- | ---------------------- |
| `RESOLVED` plus improved experiment, samples, confidence, drill | promote    | `evaluation_passed`    |
| `STILL_OPEN`                                                    | hold       | `finding_still_open`   |
| `REGRESSED`                                                     | rollback   | `finding_regressed`    |
| `INCONCLUSIVE`                                                  | observe    | `recheck_inconclusive` |
| `BLOCKED`                                                       | block      | `recheck_blocked`      |

## Shadow evidence

| Store state                             | cutoverReady                          | e52SwitchAllowed |
| --------------------------------------- | ------------------------------------- | ---------------- |
| corrupt or truncated JSONL              | false                                 | false            |
| unsupported schema                      | false                                 | false            |
| write did not land                      | false                                 | false            |
| empty window                            | false                                 | false            |
| any unresolved denyReason               | false                                 | false            |
| shadow row says kill switch or rollback | false; the row is not a drill receipt | false            |
| `executedConsumer`                      | always false                          | false            |
| direct mutators still present           | false for the switch                  | false            |

`observationStoreHealthy`, `corruptionCount`, and `persistenceFailure` are part of the readiness report. A damaged line is counted. It is not dropped and then reported healthy. Those faults are latched on disk. A gateway restart does not clear them. Only an audited admin recovery plus a revalidated observation window can clear the latch.
