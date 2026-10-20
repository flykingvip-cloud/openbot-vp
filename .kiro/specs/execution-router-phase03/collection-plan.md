# Phase 0.3 collection plan

Checkpoint P1 does not call a live model. It only defines the evidence
contract, the collector library, and the validator. P2 is blocked until all
of the following are true:

1. P1 tests are green.
2. PR #1006 is on `origin/main` (squash `af0e5bf9b2`).
3. An isolated gateway is available.
4. Real model credentials and quota are available.

## P2 sample plan

At least 20 successful terminals:

| Scenario             | Count | Side-effect rule         |
| -------------------- | ----: | ------------------------ |
| plain_text_qa        |     5 | text only                |
| skill_dense_readonly |     5 | read-only skills         |
| single_readonly_tool |     5 | one read-only tool       |
| multi_readonly_tool  |     5 | multiple read-only tools |

Also capture, or explicitly record absence:

- 2 model fallbacks, or "fallback did not occur"
- 2 tool failure/retry terminals
- 2 concurrent runId groups

All tasks must use the official model-selection chain, a real wall clock,
and model-returned usage. No write/send/publish/delete tools. No prompt or
tool bodies in evidence. Raw logs stay under `/tmp` and are not committed.

## Allowed record fields

sourceCommit, runIdDigest, sessionKeyHash, scenarioType, provider/model
digest, Skill/Tool counts, prompt/completion/total tokens, routePrepMs,
ttftMs, totalMs, toolCallCount, firstToolSuccess, fallbackCount,
terminalStatus, errorClass, invariant results.

## P2 command (not accepted in P1)

```
pnpm exec tsx .kiro/specs/execution-router-phase03/collect-performance.ts --output /tmp/phase03-perf.json
```

The P1 CLI refuses this path so harness or synthetic usage cannot become a
production baseline.
