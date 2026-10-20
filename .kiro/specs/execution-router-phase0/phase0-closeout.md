# Phase 0 closeout

Observation-only. Default off. No Skill Top-K. No Tool Top-K. No
`ORCHESTRATION_LIVE_INVOKE`. This document is the Phase 0 delivery for
baseline collection, remaining risk, and next-phase entry. It is not Phase 0
acceptance.

## Checkpoints

| Checkpoint                                    | SHA prefix    | Status                                  |
| --------------------------------------------- | ------------- | --------------------------------------- |
| A contracts / observer                        | `032c0c1106`  | accepted                                |
| A.1 root export + receipt projection          | `69b9e087b7`  | accepted                                |
| B1 inbound stage bridge                       | `145a5883e6`  | accepted                                |
| B1.1 first-write-wins + hashed session + sink | `426c5085dc`  | accepted                                |
| B2 Skill/Tool baselines in `attempt.ts`       | `cf28042b0d`  | accepted                                |
| B2.1 collection-boundary correction           | `706aa9bb55`  | accepted                                |
| C closeout (this note)                        | `364aa0c138`  | collection method only                  |
| Phase 0 code gate                             | this refresh  | passed                                  |
| fixture/component gate                        | `46cb2e0ab3`  | accepted (60 fixture/component samples) |
| runEmbeddedAttempt integration gate           | this worktree | accepted (harness calculation only)     |
| main-chain wiring E2E                         | this round    | accepted                                |
| real operational performance baseline         | this round    | pending                                 |
| Phase 1 entry                                 | —             | blocked                                 |

## Metric catalog

Counts and timestamps only. The terminal payload is
`chat.execution_observation` from `src/gateway/execution-router-observation.ts`.
`sessionKey` is hashed (`sha256` hex, first 16 chars). User text, Skill bodies,
Tool args/results, tokens, and secrets are rejected by `assertNoSensitiveFields`.

| Field                           | Source                                                                                                      | Formula                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `stages.inbound_accepted`       | first of `user_persisted` / `dispatch_started`                                                              | first-write-wins                                       |
| `stages.skill_snapshot_ready`   | after already-built `skillsPrompt`                                                                          | `attempt.ts`                                           |
| `stages.tool_set_ready`         | after `applyEmbeddedCustomToolPolicy`, before `createAgentSession`                                          | `attempt.ts`                                           |
| `stages.system_prompt_ready`    | after context-engine addition + hook `systemPrompt` / prepend / append, immediately before `session.prompt` | first-write-wins                                       |
| `stages.model_started`          | inbound `model_started`                                                                                     | first-write-wins                                       |
| `stages.first_token`            | inbound `first_token`                                                                                       | first-write-wins                                       |
| `stages.run_completed`          | inbound `assistant_persisted`                                                                               | finishes the run                                       |
| `skillBaseline.eligibleCount`   | snapshot `skills.length` or `filterWorkspaceSkillEntries` on already-loaded entries                         | `>= injectedCount`                                     |
| `skillBaseline.injectedCount`   | official `<skill>` blocks in the built `skillsPrompt`                                                       | same algorithm as `src/agents/system-prompt-report.ts` |
| `skillBaseline.promptChars`     | `skillsPrompt.length`                                                                                       | empty string is 0                                      |
| `toolBaseline.constructedCount` | `createOpenClawCodingTools` array length                                                                    | server tools only                                      |
| `toolBaseline.afterPolicyCount` | `toolsRaw.length` after inbound/skill policy, around provider sanitize                                      | server tools only; established口径                     |
| `toolBaseline.exposedCount`     | final `customToolAllowlist.length`                                                                          | after `applyEmbeddedCustomToolPolicy`                  |
| `toolBaseline.schemaChars`      | stable schema of final `filteredCustomTools` (allowlist order, first match)                                 | not pre-filter `clientTools` or `tools`                |
| `latencies.routePrepMs`         | `system_prompt_ready - inbound_accepted`                                                                    | same `runId`                                           |
| `latencies.ttftMs`              | `first_token - model_started`                                                                               | same `runId`                                           |
| `latencies.totalMs`             | `run_completed - inbound_accepted`                                                                          | same `runId`                                           |

Client tools are not part of `constructedCount`. `disableTools` leaves
constructed/afterPolicy at 0 because `createTools` is not called.

## Code-gate results (2026-09-06)

Current `origin/main` is `08eeec9113` and is an ancestor of this worktree.
Phase 0.2a five-file independent acceptance: **24 tests passed**.
Harness evidence was recollected after rebase because `sourceCommit` is part of
the logical artifact digest. Operational performance remains pending. Phase 1
entry is blocked.

| Command                                                                      | Actual count / result                                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chat-inbound-stage-events.test.ts`                                          | 5 passed                                                                                                                                                                                               |
| `execution-router-observation.test.ts`                                       | 16 passed                                                                                                                                                                                              |
| `execution-router-baselines.test.ts`                                         | 25 passed                                                                                                                                                                                              |
| `resolve-embedded-tools.test.ts`                                             | 5 passed (after `pnpm build:collaboration:packages`)                                                                                                                                                   |
| `attempt.test.ts`                                                            | 52 passed (after `pnpm build:collaboration:packages`)                                                                                                                                                  |
| Phase 0 suite total                                                          | 5 files, 103 passed                                                                                                                                                                                    |
| `@openbot/toolkit` test                                                      | 6 files, 25 passed                                                                                                                                                                                     |
| `pnpm build`                                                                 | exit 0                                                                                                                                                                                                 |
| `[INEFFECTIVE_DYNAMIC_IMPORT]`                                               | 5 existing modules, none in Phase 0 paths                                                                                                                                                              |
| `pnpm check`                                                                 | failed at `tsgo`; first error `extensions/diagnostics-otel/src/service.ts` missing `@opentelemetry/api-logs`. Pre-existing worktree / `origin/main` typecheck debt. No Phase 0 file in the error list. |
| `bun scripts/agent-attribution.ts --fail-on-unattributed --fail-on-conflict` | dirty 0, unattributed 0, conflict 0                                                                                                                                                                    |

Collaboration build used the repo script:

```bash
pnpm build:collaboration:packages
```

That is `packages/collaboration-core` → `collaboration-runtime` → `collaboration-openbot-adapter`. Import paths were not changed.

## Baseline collection method

Dry run (no model, no Skill/Tool set change):

```bash
OPENBOT_TEST_PROFILE=low pnpm test \
  src/gateway/chat-inbound-stage-events.test.ts \
  src/gateway/execution-router-observation.test.ts \
  src/agents/pi-embedded-runner/run/execution-router-baselines.test.ts \
  src/agents/pi-embedded-runner/run/resolve-embedded-tools.test.ts \
  src/agents/pi-embedded-runner/run/attempt.test.ts
OPENBOT_TEST_PROFILE=low pnpm --filter @openbot/toolkit test
```

Live shadow (local only, default remains off):

1. Set `OPENBOT_EXECUTION_ROUTER_OBSERVATION=1` on the gateway process.
2. Restart the gateway. The flag is read at observe time; a stale process
   keeps the previous default-off behavior.
3. Send one chat that produces `assistant_persisted`.
4. Read the lifecycle event `chat.execution_observation` for that `runId`.
5. Record the numeric fields above. Do not persist prompt text or schema JSON.
6. Unset the flag and restart to return to zero extra behavior.

Same-`runId` join is required for latencies. B1 inbound stages and B2
preparation stages must see the same `params.runId`. Missing stages omit the
derived latency instead of guessing.

A memory sink is available in tests via
`configureExecutionRouterObservationForTest({ sink })`. Production default sink
is local `emitAgentEvent` only. No remote I/O.

## Not wired in Phase 0

These contracts exist but are not collected from the live tool loop:

- `NormalizedToolResult` (outputChars / truncated)
- `RoutingDecision` / live reason codes
- `attachToolkitReceipt` on real tool executions

They need `src/auto-reply/reply/session-updates.ts` or
`src/auto-reply/reply/agent-runner-execution.ts`. Those files were not
transferred and must not be edited in this round.

`src/agents/skills/workspace.ts` was requested for builder-side
`injectedCount` metadata. It was not taken. Current `injectedCount` is the
official `<skill>` block count of the already-built prompt.

## Remaining risks

1. B2 / B2.1 code is accepted. The 60 rows after #1002 are fixture/component
   samples (see `phase0-shadow-correction.md`). Operational E2E remains a
   separate gate.
2. `attempt.test.ts` / `resolve-embedded-tools.test.ts` collect after
   `pnpm build:collaboration:packages`. Dist is local-only and not committed.
3. One run that never reaches `assistant_persisted` relies on TTL sweep
   (15 minutes) to emit and release state.
4. `routePrepMs` is missing if inbound and prompt-ready land on different
   `runId`s.
5. Enabling the flag adds local schema stringify on the tool set. Failure is
   swallowed and `schemaChars` becomes 0.

## In-process collector (this round)

Tests write only to `mkdtemp`. Tracked `summary.json` changes only through:

```bash
pnpm exec tsx .kiro/specs/execution-router-phase0/shadow/cli.ts collect \
  --output /tmp/phase0-shadow-candidate.json
pnpm exec tsx .kiro/specs/execution-router-phase0/shadow/cli.ts accept \
  --input /tmp/phase0-shadow-candidate.json
```

Harness sidecar numbers (`recall=1`, `TTFT=15`, `promptTokens=12`,
`firstToolSuccess=1`) are `metricsKind: harness_calculation`. They are not a
real operational performance baseline. See `shadow/perf-report.md`.

## Next-phase entry (do not start now)

Do not enable Skill Top-K, Tool Top-K, DAG, or `ORCHESTRATION_LIVE_INVOKE`.

Phase 1 entry is **blocked**. Main-chain wiring E2E is accepted.
A Shadow Router may be designed only after the remaining gate is accepted:

1. Real operational performance baseline

Even then, do not prune Skill or Tool sets. Do not start routing from
harness calculation values.
