# execution-router-phase0

Phase 0: unified observation contracts and stage metrics. No Skill/Tool Top-K.
No orchestration live invoke. Checkpoint A is isolated infrastructure only.

## Agents

- cursor-grok · role: owner · scope: execution-router-phase0 · paths: packages/toolkit/src/execution-router/contracts.ts, packages/toolkit/src/execution-router/contracts.test.ts, packages/toolkit/src/execution-router/observation.ts, packages/toolkit/src/execution-router/observation.test.ts, packages/toolkit/src/execution-router/privacy.ts, packages/toolkit/src/execution-router/package-root-import.test.ts, packages/toolkit/src/index.test.ts, packages/toolkit/vitest.config.ts, src/gateway/chat-inbound-stage-events.ts, src/gateway/chat-inbound-stage-events.test.ts, src/gateway/execution-router-observation.ts, src/gateway/execution-router-observation.test.ts, src/agents/pi-embedded-runner/run/attempt.ts, src/agents/pi-embedded-runner/run/execution-router-baselines.ts, src/agents/pi-embedded-runner/run/execution-router-baselines.test.ts, src/agents/pi-embedded-runner/run/execution-router-shadow.test.ts, src/agents/pi-embedded-runner/run/execution-router-shadow-cli.test.ts, src/agents/pi-embedded-runner/run/execution-router-shadow-identity.test.ts, src/agents/pi-embedded-runner/run/execution-router-shadow-revalidate.test.ts, src/auto-reply/reply/execution-router-mainchain.test.ts, .kiro/specs/execution-router-phase0/\*\* · since: 2026-09-06

## Tasks

- [x] Loom register `execution-router-phase0` / owner `cursor-grok`. — cursor-grok
- [x] Checkpoint A: contracts, aggregator, privacy filter, unit tests (no main-chain wiring). — cursor-grok
- [x] Checkpoint A.1: root export + privacy-safe receipt projection + nested secret tests. — cursor-grok
- [x] Checkpoint B1: observation bridge + inbound stage mapping. — cursor-grok
- [x] Checkpoint B1.1: first-write-wins stages, hashed session, terminal sink. — cursor-grok
- [x] Checkpoint B2: attempt.ts Skill/Tool baselines after exact-file takeover. — cursor-grok
- [x] Checkpoint B2.1: move Tool baseline after `applyEmbeddedCustomToolPolicy`; move `system_prompt_ready` to immediately before `session.prompt`. — cursor-grok
- [x] Checkpoint C: baseline collection method, remaining risks, next-phase entry. — cursor-grok
- [x] Phase 0 code gate: ancestry + collaboration dist + 103/25 tests + build. Shadow pending. — cursor-grok
- [x] Operational shadow after #1002: 54 complete + 6 ttl/error terminals, privacy 0. — cursor-grok
- [x] Correction: those 60 rows are fixture/component samples. E2E gate pending. — cursor-grok
- [x] E2E shadow: runEmbeddedAttempt + prompt + emitChatInboundStage; 50+5; validator. — cursor-grok
- [x] Split gates: fixture accepted; attempt integration accepted; main-chain and real perf pending until evidence. — cursor-grok
- [x] Collector writes mkdtemp only; explicit collect/accept; expanded logical digest. — cursor-grok
- [x] Main-chain E2E via dispatchReplyFromConfig + getReplyFromConfig; fake backend wiring only. — cursor-grok
- [x] Phase 0.2: vi.stubEnv + full porcelain; collect/accept CLI reject tests; independent collect/accept; fixture and attempt gates accepted; main-chain wiring E2E pending independent acceptance; operational performance pending; Phase 1 entry blocked. — cursor-grok
- [x] Phase 0.2 identity: rebase onto origin/main; production blobs from sourceCommit; three-way identity fail-closed; main-chain pending independent revalidation; Phase 1 blocked. — cursor-grok
- [x] Phase 0.2a: execFileSync for dynamic Git args; malicious sourceCommit is a ref error only; main-chain accepted; 24-test independent acceptance recorded; performance pending; Phase 1 blocked. — cursor-grok
- [x] Phase 0.2a rebase onto `08eeec9113` (#1004): regenerate harness summary/digest/blob identity; no Skill/Tool/policy change; Phase 1 still blocked. — cursor-grok

Phase 0 closeout note: `.kiro/specs/execution-router-phase0/phase0-closeout.md`.
Do not start Skill Top-K, Tool Top-K, or orchestration live invoke.
Phase 1 entry is blocked.

## Checkpoint B ownership

Do not transfer `src/**`. Exact-file takeover trail required. SharedPaths alone is not a transfer; it only resolves leftover `src/**` overlap after the path is released.

| File                                                    | Status                                                                                                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/gateway/chat-inbound-stage-events.ts` + `.test.ts` | verify-then-take complete 2026-09-06. Predecessor `cursor-chat-inbound-depth`; successor `cursor-grok`.                                                                                    |
| `src/agents/pi-embedded-runner/run/attempt.ts`          | verify-then-take complete 2026-09-06. Predecessors `daibai-super-steward:kiro-daibai` and `pi-sdk-family-migration-v3:cursor`; successor `cursor-grok`. Path lists and `src/**` unchanged. |
| `src/agents/pi-tools.ts`                                | Do not transfer; do not modify.                                                                                                                                                            |
| `src/auto-reply/reply/session-updates.ts`               | Not requested this round.                                                                                                                                                                  |
| `src/auto-reply/reply/agent-runner-execution.ts`        | Not requested this round.                                                                                                                                                                  |
