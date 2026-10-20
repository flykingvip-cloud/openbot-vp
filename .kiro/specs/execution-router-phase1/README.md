# Phase 1 Shadow Router design

Design and offline contracts only. Live implementation stays off.

```
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  --config .kiro/specs/execution-router-phase1/vitest.config.ts
```

Do not edit `.kiro/specs/execution-router-phase03-p2/**`.
Do not enable Top-K, DAG, ConversationTask, or `ORCHESTRATION_LIVE_INVOKE`.
Implementation requires a later, separate PR.
