# Phase 0.3 performance evidence

Observation-only. Default observation stays off. No Skill Top-K, Tool Top-K,
DAG, ConversationTask, or `ORCHESTRATION_LIVE_INVOKE`. Phase 0.2a files are
read-only.

## P1 (this checkpoint)

Contract + collector + validator + unit tests. No live model calls.

```
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  --config .kiro/specs/execution-router-phase03/vitest.config.ts

The root Vitest include list does not cover `.kiro/**`. Use this config.
```

The collector writes only to an explicit `--output` path. It refuses the
tracked `performance-summary.json` unless `--force` is passed. Tests use
`mkdtemp` only.

## P2 (blocked)

Requires isolated gateway + real credentials. Do not invent samples.

## Identity

`sourceCommit` is `origin/main`. Production observation blobs must match
`sourceCommit`, `HEAD`, and the worktree `git hash-object` for:

- `src/gateway/execution-router-observation.ts`
- `src/gateway/chat-inbound-stage-events.ts`
- `src/agents/pi-embedded-runner/run/attempt.ts`
- `src/agents/pi-embedded-runner/run/execution-router-baselines.ts`
