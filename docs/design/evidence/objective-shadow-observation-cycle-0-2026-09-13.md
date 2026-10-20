# Phase 2 Objective Shadow observation cycle 0

- schema: `objective-shadow-observation/v1`
- sourceKind: `synthetic_observe_api`
- cycleStartedAt: 2026-09-13T14:37:43.776Z
- reportGeneratedAt: 2026-09-13T14:51:06.038Z
- landedSha: 16cea426e711516629e52c0522c39a7a77628655
- originMainAtReplay: 36c8a3df7f9bc16fa6a8f267430728eefae20eb7
- logCorrespondsToLandedSha: true
- logSha256: `6d512ab5518d75adeee3baec4ae063ec27f6ae8cca17639901c553b596f7de7c`
- sibling: [runtime call-site harness report](./objective-shadow-observation-cycle-0-runtime-callsite-2026-09-13.md)
- doNotMergeWith: `runtime_callsite_harness` — report separately, never as a Cycle 0 total; not `launchd_gateway`
- pr1107: [PR 1107](https://github.com/gmood2008/openbot/pull/1107)
- adminBypass: not used
- hmacHosting: macOS Keychain + `OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_HMAC_KEY_FILE`; key not in repo / JSONL / window / this report
- logPath: `~/.openbot/logs/objective-shadow.synthetic-cycle0.jsonl`
- windowPath: `~/.openbot/logs/objective-shadow.synthetic-cycle0.window.json`
- windowStatus: open for this corpus only; first write 2026-09-13T14:37:43.776Z; clock close 2026-09-20T14:37:43.776Z or N=500/ingress
- mustStop: false
- stopConditionsTriggered: none
- phase3a: not approved
- phase3b: not approved
- phase4 / phase5: not approved

## Merge / SHA binding

```text
git fetch origin
git rev-parse origin/main
# 16cea426e711516629e52c0522c39a7a77628655
git merge-base --is-ancestor 16cea426e711516629e52c0522c39a7a77628655 origin/main
# true
```

The observer ran from the landed `src/objective-shadow/**` on that SHA. Daily command:

```text
bun src/objective-shadow/observation-report.ts \
  --landed=16cea426e711516629e52c0522c39a7a77628655
```

CLI `logCorrespondsToLandedSha` stays `null` unless the operator passes an attestation; this report attests `true` from the Git commands above.

## Ingress counts

| ingress            | records | proposed generated | proposed rejected | proposed discarded |
| ------------------ | ------: | -----------------: | ----------------: | -----------------: |
| cron_isolated      |       3 |                  3 |                 0 |                  0 |
| chat               |       5 |                  1 |                 0 |                  4 |
| collaboration_turn |       1 |                  0 |                 0 |                  1 |
| subagent           |       3 |                  0 |                 0 |                  3 |
| heartbeat          |       0 |                  0 |                 0 |                  0 |
| gateway_agent      |       0 |                  0 |                 0 |                  0 |
| acp                |       0 |                  0 |                 0 |                  0 |

Window counts match: chat 5 / cron_isolated 3 / collaboration_turn 1 / subagent 3. `seenRunIdCount` = 12. `windowStopped` = false.

## Resolve status

| resolved | 6 |
| conflict | 3 |
| allowlist_rejected | 1 |
| skipped | 2 |
| out_of_scope | 0 |

Resolved = Chat Task + 3 Cron occurrences + collaboration snapshot + 1 Subagent inherit. Conflict = Chat source conflict + Subagent missing parent + Subagent session-key parent. Skipped = Chat without Task + identified tenant missing. Allowlist = Chat presented a Cron source.

## Rates and guards

- sourceConflict: 1 (0.083333)
- allowlistRejected: 1 (0.083333)
- inheritViolation: 2 (0.166667)
- redaction_dropped: 0
- hmac_key_missing: 0 (fail-closed events are not persisted; JSONL-derived count is 0 by design)
- forbiddenWriteAttempts: 0
- duplicateRunIdCount: 0
- missingRunIdCount: 0
- writesAfterWindowClose: 0
- leakCategories: none
- fabricatedIdentityFlags: none
- runtimeResultChanged: false
- coordinationWritesDetected: false
- Prompt / Completion / Ledger / Lease / Pointer / Contribution writes: none
- windowStopped: false
- windowClosedByClock: false
- windowClosedByCount: false

## Required scenario results

| #   | scenario                                       | result                                                                                                                         |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Chat with ConversationTask                     | resolved; Objective ID / revision from Task; not from runId / sessionId                                                        |
| 2   | Chat without ConversationTask                  | skipped; no fabricated Objective                                                                                               |
| 3   | Cron same job, two occurrences                 | same Objective ID / revision; distinct runId / occurrence; Objective ≠ occurrence                                              |
| 4   | Cron contract text change                      | same Objective ID; revision changed                                                                                            |
| 5   | Cron permanent jobId only, no occurrence       | ingress hook returned without writing JSONL                                                                                    |
| 6   | Collaboration round                            | `collab_deferred_phase3b`; proposed discarded; no exclusive unit                                                               |
| 7   | Subagent missing parent snapshot               | inherit_violation                                                                                                              |
| 8   | Subagent parentRunId is a session key          | parent dropped; inherit_violation                                                                                              |
| 9   | Same runId observed twice                      | second call `idempotent`, `wrote=false`; JSONL still one row                                                                   |
| 10  | flag OFF                                       | `{ enabled: false, wrote: false }`; no extra JSONL row                                                                         |
| 11  | HMAC key missing                               | `{ enabled: true, wrote: false, reason: "hmac_key_missing" }`; no extra JSONL row                                              |
| 12  | Window closed (isolated temp window, not prod) | `{ wrote: false, reason: "window_closed" }`; temp JSONL not created; production window left open                               |
| 13  | Redaction scan                                 | no tenant/group plaintext keys, email, phone, token, absolute path, prompt/goal/instruction, or HMAC key                       |
| 14  | Replay                                         | pure-function hashes equal `c1a2f9d63dcd7a34caeb40215b607424d57886e0ea21411519feafd34274757f`; runtime `replay` did not append |

Subagent inherit-ok also resolved from the parent Chat Task snapshot (`parentRunId` present). Identified-tenant-missing recorded `invalid_input` / skipped and did not fold tenant to `"local"`.

## Runtime unchanged proof

- Cycle 0 called `maybeObserveObjectiveShadow` / `observeObjectiveShadowFromIngress` only. It did not execute Chat completion, Cron isolated turn, collaboration round, or Subagent spawn.
- Worktree `git diff` on Prompt / Completion / Delivery / Ledger / the four ingress files was empty.
- After the driver exited, `OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW` and `OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_HMAC_KEY` were unset in the driver process and are unset in the operator shell.
- New files under `~/.openbot/logs/` are only `objective-shadow.jsonl` and `objective-shadow.window.json`. No Participation, persisted WorkUnitDefinition, Lease, ActiveLeasePointer, Contribution, or Ledger files were created.
- `OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/objective-shadow`: 6 files / 49 tests passed.

## Window

- Clock start: 2026-09-13T14:37:43.776Z
- Clock close: 2026-09-20T14:37:43.776Z (7×24h) or 500 records per ingress, whichever first
- Production writer remains available for later live ingress; flag is not stored in the repo. Later live writes require a fresh process-level flag + independent HMAC.
- This cycle does not close the window and does not approve Phase 3a / 3b.

This report contains counts, public SHAs, and a replay hash only.
