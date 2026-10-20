# Phase 0 real operational performance

Status: **pending**

This report is separate from fixture/component recall and from
runEmbeddedAttempt harness calculations.

Do not copy these harness values into this file:

- required-skill recall = 1
- required-tool recall = 1
- TTFT avg = 15
- prompt tokens avg = 12
- first-tool success = 1

Those are `metricsKind: harness_calculation` only.

## Required for acceptance

At least 20 isolated-environment samples that:

- use the current official model selection
- record real usage / TTFT / prompt tokens / total time
- call no side-effect tools
- store source SHA, model ID digest, and scenario type
- store no prompt body

Collect command (refuses until the live path exists):

```bash
pnpm exec tsx .kiro/specs/execution-router-phase0/shadow/cli.ts collect-perf \
  --output /tmp/phase0-shadow-perf.json
```
