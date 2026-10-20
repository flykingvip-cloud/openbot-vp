# Execution Chain Audit Report

## Conclusion

State the primary bottleneck and whether it is a missing capability, a reachability problem, a policy conflict, or a delivery problem.

## Evidence

| Trace | Stage | Code/module | Observed behavior | Confidence                    |
| ----- | ----- | ----------- | ----------------- | ----------------------------- |
|       |       |             |                   | confirmed/inferred/unverified |

## Conflicts

List each duplicated decision owner and the concrete consequence: repeated retries, contradictory denial, unreachable skill, or leaked internal metadata.

## Remediation

### P0

Only changes required to restore a safe, usable execution path.

### P1

Consolidation, observability, and regression prevention.

### P2

Optional learning, proactive follow-up, or automation.

## Verification

Include focused tests, one failed-path test, and a live smoke trace. Record candidate SHA and runtime build SHA for live checks.

## Metrics

Track authorization success/timeout, same-request retries, resource reachability, fallback selection, time to first useful result, and task completion.
