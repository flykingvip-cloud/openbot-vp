# execution-router-phase1-shadow-i1

Phase 1 Shadow Router Checkpoint I1: production-grade offline compute
core only. Default-off. No auto-reply main-chain wiring.

Design source: `.kiro/specs/execution-router-phase1/**` (already on main).
Do not import `.kiro/**` as production runtime.

## Agents

- cursor-grok · role: owner · scope: Phase 1 Shadow Router I1 offline core · paths: packages/toolkit/src/execution-router/shadow/**, packages/toolkit/src/execution-router/index.ts, packages/toolkit/src/index.ts, .kiro/specs/execution-router-phase1-shadow-i1/** · since: 2026-09-07

## Takeover

- verify-then-take from `execution-router-phase0` (owner `cursor-grok`, already merged to main as Phase 0).
- Taken paths: `packages/toolkit/src/execution-router/shadow/**` plus export append on the two toolkit index files.
- Not taken: `src/agents/pi-embedded-runner/run/attempt.ts`, `src/auto-reply/reply/agent-runner-execution.ts`, observation bridges, P2-C evidence.
- Authorized by human I1 assignment. — cursor-grok

## Tasks

- [x] Production TaskEnvelope v1 + strict validation — cursor-grok
- [x] Skill/Tool scoring, low-confidence fallback, apply:false decision — cursor-grok
- [x] Digest-only shadow event projection + offline recall/compare — cursor-grok
- [x] Unit, schema, privacy-negative, P2-C immutability tests — cursor-grok
