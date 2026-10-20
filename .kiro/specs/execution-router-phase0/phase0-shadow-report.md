# Phase 0 Shadow acceptance

Collected after #1002 landed as `origin/main` `46cb2e0ab3`. Runtime files
match that SHA. Flag: `OPENBOT_EXECUTION_ROUTER_OBSERVATION=1`.
No Skill Top-K. No Tool Top-K. No `ORCHESTRATION_LIVE_INVOKE`.
No model invoke.

Method: a sanitized fixture set drove the production `observeChatInboundStage`,
`observeAttemptSkillPreparation`, `observeAttemptToolPreparation`,
`observeAttemptSystemPromptReady`, `applyEmbeddedCustomToolPolicy`, and
`measure*Baseline` functions. The sink is the same `finishRun` path that emits
local `chat.execution_observation`. Raw snapshots stay in `/tmp` and are not
committed.

## Counts

| Type                        | Snapshots | Terminal kind      |
| --------------------------- | --------: | ------------------ |
| plain_text_qa               |         6 | run_completed      |
| skill_dense                 |         6 | run_completed      |
| no_tools                    |         6 | run_completed      |
| single_readonly_tool        |         6 | run_completed      |
| multi_tool                  |         6 | run_completed      |
| client_tool                 |         6 | run_completed      |
| skill_prompt_truncated      |         6 | run_completed      |
| tool_policy_rejected        |         6 | run_completed      |
| missing_or_failed_terminal  |         6 | ttl/error terminal |
| concurrent_distinct_run_ids |         6 | run_completed      |

- complete `run_completed` snapshots: 54
- all collected snapshots: 60
- privacy hits: 0
- invariant findings: 0
- in-memory map after TTL sweeps: 0 (peaked at 20)

## Privacy audit

Scanned every snapshot JSON for raw session keys, Skill bodies, user text,
tool names/schema, and forbidden observation keys.

No forbidden substring or raw sessionKey found.

sessionKeyHash is SHA-256 hex slice(0,16) when a session key was supplied.

## Metric invariants

- same `runId` on envelope and all stage writes
- `constructedCount >= afterPolicyCount`
- `eligibleCount >= injectedCount`
- `exposedCount` equals the final `customToolAllowlist.length`
  (`tool_policy_rejected` = 1, `client_tool` = 2, `no_tools` = 0)
- `routePrepMs`, `ttftMs`, `totalMs` present and non-negative on complete tasks
- type 9 emits via `user_persist_error` or TTL `finishRun`, not via `assistant_persisted`
- sink + TTL returned the in-memory map to 0; no residual growth

All invariants held.

## Stop

Shadow data is for Phase 0 observation quality only. Do not start required-skill
recall, required-tool recall, Skill Top-K, Tool Top-K, DAG execution,
ConversationTask activation, or orchestration live invoke.

Status: accepted
