# Phase 2 Objective Shadow observation cycle 0 — runtime call-site

- schema: `objective-shadow-observation/v1`
- sourceKind: `runtime_callsite_harness` (not `synthetic_observe_api`, not `launchd_gateway`)
- cycleStartedAt: 2026-09-13T14:50:56.566Z
- reportGeneratedAt: 2026-09-13T14:51:06.042Z
- landedSha: 16cea426e711516629e52c0522c39a7a77628655
- originMainAtReplay: 36c8a3df7f9bc16fa6a8f267430728eefae20eb7
- logCorrespondsToLandedSha: true
- logSha256: `fa8fd96e497a1d6e629a7e53f5a8f400c12ce86aaacbfb1fe27add586033bdee`
- sibling: [synthetic observe-API report](./objective-shadow-observation-cycle-0-2026-09-13.md)
- doNotMergeWith: `synthetic_observe_api` — report separately, never as a Cycle 0 total
- windowStatus: open for this corpus only; first write 2026-09-13T14:50:56.566Z; clock close 2026-09-20T14:50:56.566Z or N=500/ingress
- mustStop: false
- phase3a / phase3b / phase4 / phase5: not approved

## HMAC hosting (no key material)

| 项                  | 值                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Secret manager      | macOS Keychain `openbot.objective-shadow.hmac` / `OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_HMAC_KEY` |
| Materialized inject | `~/.openbot/secrets/objective-shadow-hmac` mode `0600`                                          |
| Process inject      | `OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_HMAC_KEY_FILE`                                             |
| Recovery            | `scripts/dev/objective-shadow-hmac-inject.sh check` → `ok` after a new process                  |
| Continuity proof    | Chat and Subagent inherit share tenantHash `0df3e8fc4780fdf9` across separate vitest processes  |
| Not stored in       | repo, JSONL, window state, this report                                                          |

Inline env still wins over the key file. Missing, empty, symlink, non-regular, non-owner, or mode wider than `0600` (`mode & 0o077 !== 0`) is fail-closed.

This corpus proves the four production functions are reachable under a stubbed harness. It does **not** prove live Gateway traffic.

## What this corpus is

Each record was produced by the production function, not `maybeObserveObjectiveShadow` directly:

| ingress            | function                    | file                                                  |
| ------------------ | --------------------------- | ----------------------------------------------------- |
| chat               | `runPreparedReply`          | `src/auto-reply/reply/get-reply-run.ts`               |
| cron_isolated      | `runCronIsolatedAgentTurn`  | `src/cron/isolated-agent/run.ts`                      |
| collaboration_turn | `executeCollaborationRound` | `src/gateway/collaboration-dispatch/round-runtime.ts` |
| subagent           | `spawnSubagentDirect`       | `src/agents/subagent-spawn.ts`                        |

Agent / model / gateway side effects were stubbed after the observe hook so Prompt, Completion, Delivery, Ledger, Lease, Pointer, Contribution, and Participation were not written.

## What this corpus is not

The running LaunchAgent `ai.openbot.gateway` still executes `/Users/daniel/AI项目/openbot/dist/index.js` at `620c767fb1c47fa9e8206eee1b190165ecfeb1ff` (before PR 1107). This observation did **not** mutate that plist or restart that process. `launchd_gateway` records remain absent.

## CLI

```text
bun src/objective-shadow/observation-report.ts \
  --landed=16cea426e711516629e52c0522c39a7a77628655 \
  --log="$HOME/.openbot/logs/objective-shadow-evidence/objective-shadow.runtime-callsite.jsonl"
```

## Ingress counts

| ingress            | records | proposed generated | proposed rejected | proposed discarded |
| ------------------ | ------: | -----------------: | ----------------: | -----------------: |
| cron_isolated      |       2 |                  2 |                 0 |                  0 |
| chat               |       1 |                  1 |                 0 |                  0 |
| collaboration_turn |       1 |                  0 |                 0 |                  1 |
| subagent           |       2 |                  0 |                 0 |                  2 |

Resolve: resolved 4 / conflict 1 / skipped 1. `forbiddenWriteAttempts = 0`. `duplicateRunIdCount = 0`. leakCategories none. fabricatedIdentityFlags none.

## Per-record check

| runId                            | ingress            | Objective ID / revision                | tenantHash         | groupHash          | proposed                                               |
| -------------------------------- | ------------------ | -------------------------------------- | ------------------ | ------------------ | ------------------------------------------------------ |
| `run-chat-1`                     | chat               | ConversationTask `ctask_a8889b4a…` / 5 | `0df3e8fc4780fdf9` | —                  | generated exclusive (not persisted)                    |
| `occ-tick-1`                     | cron_isolated      | `cron-obj:test-job` / 143115561029034  | `d13a9d3a164da0cd` | —                  | generated; occurrence ≠ job id                         |
| `occ-tick-2`                     | cron_isolated      | same Objective ID / revision           | `d13a9d3a164da0cd` | —                  | generated; different occurrence                        |
| `round-shadow`                   | collaboration_turn | none                                   | `118d5459eb48c6f6` | `36c562c1bc427a7d` | discarded `collab_deferred_phase3b`; 0 exclusive units |
| `agent:main:subagent:51ef8551-…` | subagent           | none                                   | `ef4e78e096e49aa9` | —                  | inherit_violation (session-key parent dropped)         |
| `agent:main:subagent:386edbcb-…` | subagent           | inherited `ctask_a8889b4a…` / 5        | `0df3e8fc4780fdf9` | —                  | discarded `inherit_only`; parentRunId `run-chat-1`     |

Chat Objective is the Task key, not `run-chat-1` / `session-chat-1`. Cron Objective is not the occurrence or permanent job id. Collaboration did not mint a single-chat exclusive unit.

## Synthetic corpus (separate file)

Do not merge with the rows above.

- kind: `synthetic_observe_api`
- path: `~/.openbot/logs/objective-shadow.synthetic-cycle0.jsonl`
- sha256: `6d512ab5518d75adeee3baec4ae063ec27f6ae8cca17639901c553b596f7de7c`
- records: 12
- firstWriteAt: 2026-09-13T14:37:43.776Z

Machine index: `docs/design/evidence/objective-shadow-observation-cycle-0-manifest-2026-09-13.json`.

This report contains hashed identifiers, public SHAs, and counts only.
