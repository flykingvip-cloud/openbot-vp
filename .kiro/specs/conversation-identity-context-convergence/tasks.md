# Conversation Identity Context Convergence

## Agents

- codex-acceptance · role: owner · scope: specification author and independent acceptance reviewer; no production implementation · paths: .kiro/specs/conversation-identity-context-convergence/\*\* · since: 2026-09-20
- cursor-identity-context · role: owner · scope: implementation owner; converge employee execution identity from webchat ingress to Seat-bound enterprise tools · paths: .kiro/specs/conversation-identity-context-convergence/tasks.md, docs/design/conversation-identity-context-propagation-2026-09-21.md, src/gateway/execution-identity-context.ts, src/gateway/execution-identity-context.test.ts, src/gateway/enterprise-operational-identity-runtime.ts, src/gateway/enterprise-operational-identity-runtime.scope.test.ts, src/gateway/enterprise-operational-identity-runtime.identity-context.test.ts, src/gateway/enterprise-data/enterprise-data-seat-context.ts, src/gateway/enterprise-data/enterprise-data-seat-context.session.test.ts, src/gateway/knowledge/agent-run-gateway-client.ts, src/agents/tools/operational-identity-tool.ts, src/agents/tools/operational-identity-tool.test.ts, src/agents/tools/data-capability-tool.ts, src/agents/tools/knowledge-source-tool.ts, src/agents/tools/knowledge-consume-tool.ts, src/agents/tools/meeting-tool.ts, src/agents/tools/meeting-tool.test.ts, src/agents/tools/schedule-tool.ts, src/agents/openclaw-tools.ts, src/agents/pi-tools.ts, src/agents/pi-embedded-runner/run.ts, src/agents/pi-embedded-runner/usage-reporting.test.ts, src/agents/pi-embedded-runner/run/params.ts, src/agents/pi-embedded-runner/run/attempt.ts, src/auto-reply/reply/queue/types.ts, src/auto-reply/reply/get-reply-run.ts, src/auto-reply/reply/agent-runner-execution.ts, src/auto-reply/reply/agent-runner-utils.ts, src/auto-reply/reply/agent-runner-utils.test.ts, src/auto-reply/reply/followup-runner.ts, src/auto-reply/reply/followup-runner.test.ts, src/auto-reply/reply/operational-identity-context.ts, src/auto-reply/reply/operational-identity-context.test.ts, src/auto-reply/reply/execution-identity-propagation.test.ts, src/auto-reply/reply/get-reply-inline-actions.ts · since: 2026-09-21

## Handoff to Cursor

Implementation owner: Cursor, exact stable agent handle to be chosen by the Cursor session.

Before editing production code, Cursor must:

1. read `AGENTS.md`;
2. read this specification completely;
3. read `docs/design/openbot-conversation-system-isolation-audit-2026-09-20.md`;
4. perform the repository takeover ceremony;
5. register its own Loom session and production paths;
6. regenerate the `## Agents` view if required;
7. run `bun scripts/agent-attribution.ts --fail-on-conflict` before editing.

Cursor becomes implementation owner only after registration. `codex-acceptance` remains reviewer and must not land Cursor's production changes.

## Work packages

### WP0. Baseline and call-graph proof

- [x] Record current commit SHA and dirty-tree attribution. — baseline `4dae2f60b1db11444df9e8c8a33e5717f903c2c1`; dirty tree holds only other tasks' WIP under `src/digital-employee-creation/**`, left untouched — cursor-identity-context
- [x] Trace every assignment of the five Gateway client identity fields from `chat.send` through tool construction. — cursor-identity-context
- [x] Produce a compact before-state table showing where each field survives or disappears. — `docs/design/conversation-identity-context-propagation-2026-09-21.md` — cursor-identity-context
- [x] Reproduce `NO_SEAT_CONTEXT` from an authenticated employee Daibai session with a focused failing test or captured redacted diagnostic. — `src/auto-reply/reply/execution-identity-propagation.test.ts` fails on `sessionEnterpriseId` being `undefined`; `pnpm tsgo` additionally proves the option does not exist at either boundary — cursor-identity-context
- [x] Confirm that empty process environment identity variables are expected and unrelated. — no production code on this path reads `TENANT`/`USER`/`AGENT`/`SESSION`/`CHANNEL` for request identity — cursor-identity-context

Required checkpoint: documentation/test-only commit signed by Cursor. No production changes before the failing boundary is proven.

### WP1. Canonical execution identity contract

- [x] Introduce or adopt one typed execution identity object. — `src/gateway/execution-identity-context.ts` — cursor-identity-context
- [x] Populate it only from trusted turn/Gateway context. — cursor-identity-context
- [x] Keep collaboration group owner entitlement explicit and separate. — cursor-identity-context
- [x] Add unit tests for construction from employee, enterprise, collaboration, and no-identity contexts. — `src/gateway/execution-identity-context.test.ts` — cursor-identity-context

Required checkpoint: type and contract tests green.

### WP2. Lossless direct-run propagation

- [x] Carry enterprise and membership identity through `get-reply` and direct agent execution. — cursor-identity-context
- [x] Thread the canonical object through Pi/OpenClaw tool construction. — cursor-identity-context
- [x] Forward the frozen identity from `runEmbeddedPiAgent` into `runEmbeddedAttempt`. Live WP6 `source: enrollment` was this drop. — `src/agents/pi-embedded-runner/run.ts` + usage-reporting test — cursor-identity-context
- [x] Build the restricted runtime client with all available trusted fields. — `toRestrictedGatewayClient` delegates to `buildKnowledgeReplyGatewayClient` — cursor-identity-context
- [x] Remove superseded parallel parameter plumbing where safe. — scalars kept only as transitional adapters into the canonical object — cursor-identity-context

Required checkpoint: direct employee turn reaches `operational_identity` with tenant and membership preserved.

### WP3. Queue and follow-up propagation

- [x] Extend queue/follow-up run state with the canonical identity context. — `FollowupRun.run.executionIdentity` — cursor-identity-context
- [x] Verify serialization/copying cannot drop enterprise or membership fields. — cursor-identity-context
- [x] Add a regression test where the initial turn schedules a follow-up that invokes a Seat-bound tool. — `followup-runner.test.ts` drives `createFollowupRunner`; `execution-identity-propagation.test.ts` checks canonical copy — cursor-identity-context

Required checkpoint: direct and follow-up paths produce the same scope.

### WP4. Runtime scope precedence and typed denials

- [x] Make authenticated employee context authoritative when present. — cursor-identity-context
- [x] Prevent invalid employee context from silently falling back to agent enrollment. — cursor-identity-context
- [x] Preserve unique enrollment fallback for background/enrolled-agent runs. — cursor-identity-context; cron/owner-user without pinned membership uses enrollment, not MEMBERSHIP_INVALID — cursor-identity-context
- [x] Introduce typed denial codes for the cases in requirement R5. — cursor-identity-context
- [x] Update user-facing summaries so they describe the actual missing binding and never use process environment emptiness as evidence. — cursor-identity-context

Required checkpoint: negative test matrix green.

### WP5. Cross-tool contract verification

- [x] Audit every tool receiving Gateway identity fields. — cursor-identity-context
- [x] Migrate Seat-bound enterprise tools to the canonical context. — operational_identity, meeting, data_capability, knowledge consume/source, schedule — cursor-identity-context
- [x] Confirm personal operational identity behavior remains user-scoped. — user operational identity still receives only user/platform/domain — cursor-identity-context
- [x] Confirm knowledge/data capability tools do not regress. — cursor-identity-context
- [x] Do not expand permissions or allowed actions. — cursor-identity-context

Required checkpoint: scoped operational identity, user identity, knowledge, and data capability tests green.

### WP6. End-to-end evidence

- [x] From authenticated Daibai, run enterprise identity `list` and capture redacted `tenantId`, `seatId`, and `agentId` presence. — true webchat Round 3: Control UI + cookie + `chat.send`; `list` ok; **source: employee**; hashes in design doc WP6 Round 3 — cursor-identity-context
- [x] Execute Tencent Meeting `get_meeting` or another read-only action. — same webchat turn executed `list_meetings` (`meetingInfoList` empty, so `get_meeting` had no id) — cursor-identity-context
- [ ] With explicit user confirmation in the test environment, execute a reversible/test `schedule_meeting` flow if required by acceptance. — not done on the 2026-09-21 webchat turn: that turn skipped it because the live list was empty. A later write on 2026-09-24 did execute `schedule_meeting` and `cancel_meeting` through an employee `POST /tools/invoke` session, not through Control UI webchat. The schedule tool body did not retain an execution id, and commits `9620f8f986`, `9dea6316a3`, `21cf2c0125`, and `66b886bb88` are not ancestors of LIVE. This checkbox stays open until that evidence is complete. — cursor-identity-context
- [x] `cancel_meeting` cleanup verified. — 2026-09-24 the unique test subject was cancelled on the same employee `operational_identity` path. The post-cancel meeting list no longer contains that subject. Redacted hashes are in `docs/design/evidence/conversation-identity-final-runtime-acceptance-2026-09-24.json`. This item does not close the schedule checkbox above. — cursor-identity-context
- [x] Verify the same employee and seat are used in direct and follow-up runs. — `execution-identity-propagation.test.ts` — cursor-identity-context
- [x] Verify a no-seat employee is denied with the correct typed code. — `NO_CURRENT_SEAT` in identity-context + operational-identity-tool tests — cursor-identity-context
- [x] Verify a wrong-tenant/suspended membership cannot use enrollment fallback. — identity-context tests fail closed on `TENANT_MISMATCH` / `MEMBERSHIP_INVALID` — cursor-identity-context
- [x] Verify a unique enrolled background agent still works without webchat. — identity-context + existing scope tests — cursor-identity-context
- [x] Attach redacted logs and commands; never include credentials or live personal data. — denials expose `identityPresence` booleans only — cursor-identity-context

## Mandatory tests

At minimum add or update focused tests for:

- `operational-identity-tool`
- `enterprise-operational-identity-runtime`
- `reply-gateway-client`
- direct tool option construction
- queued/follow-up identity preservation
- employee workbench webchat identity hydration
- collaboration owner entitlement precedence
- no-seat, no-tenant, inactive-membership, wrong-tenant, ambiguous-enrollment cases

Run:

```bash
OPENBOT_TEST_PROFILE=low pnpm test <focused test paths>
pnpm tsgo
pnpm build
pnpm check
bun scripts/agent-attribution.ts --fail-on-unattributed --fail-on-conflict
```

After build, inspect all `[INEFFECTIVE_DYNAMIC_IMPORT]` warnings and state whether any are newly introduced.

## Cursor delivery package

Cursor must deliver:

1. before-state propagation table;
2. after-state propagation table;
3. changed-file list grouped by architectural layer;
4. proof that no environment fallback was added;
5. direct-run and follow-up-run test evidence;
6. negative authorization matrix;
7. end-to-end redacted execution receipt;
8. remaining risks and migration debt;
9. commit SHAs with `Task:` and `Agent:` trailers;
10. PR targeting fresh `origin/main` when requested to publish.

## Codex acceptance gate

Codex will independently reject the implementation if any item below fails:

- The fix is tool-specific rather than context-wide.
- Tenant/membership fields are merely duplicated through another long scalar parameter list without a canonical context.
- Environment variables become an identity source.
- Enrollment fallback can override a present but invalid employee context.
- Direct path passes but follow-up/queue path drops context.
- Collaboration group owner entitlement changes semantics.
- Errors remain collapsed into misleading `NO_SEAT_CONTEXT` claims.
- Tests assert mocked return text without verifying the resolved scope.
- Build/type/lint or attribution gates fail.
- Runtime proof does not identify the resolved tenant/seat/agent in redacted form.

This list is the rejection gate. It is not a record that Codex has accepted the task. The bullets for mocked return text, build/type/lint, and runtime proof stay in this rejection list. They are not follow-up items.

### Follow-up. Leftover `NO_SEAT_CONTEXT` hygiene (P1)

- [x] `enterprise-operational-identity.access.resolve` defaults a missing enforcement code to `IDENTITY_ACTION_DENIED`, matching execute. — cursor-identity-context
- [x] `classifyEmployeeScopeFailure` no longer regex-maps leftover `NO_SEAT_CONTEXT` or generic message text; unknown errors fail closed to `MEMBERSHIP_INVALID`. — cursor-identity-context

Acceptance requires code review, scoped tests, build, and a fresh runtime verification. Passing tests alone is insufficient.

## Acceptance readout 2026-09-24

Recorded from a clean worktree of freshly fetched `origin/main`. This readout does not close the task and does not claim Codex acceptance.

| Item                                                                         | Value                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requested baseline                                                           | `8fa022f03ad593b2f3adb5f7e38d92a86390d983` is an ancestor of current `origin/main`, not the tip                                                                                                                   |
| fresh `origin/main`                                                          | `caf0acd5208622d559c9b499efbb4a7058a5e3e6`                                                                                                                                                                        |
| LIVE container `build-info.commit`                                           | `f1c7efece96d68375bf4b7fb57e77908fedfdd6c`                                                                                                                                                                        |
| LIVE UI SHA                                                                  | no separate UI `build-info.json` in the container; ledger seq 97 records the same SHA for gateway and UI                                                                                                          |
| release seq                                                                  | 97                                                                                                                                                                                                                |
| `delivery:check-sot --use-release-record-live`                               | allow; LIVE, ledger, release record, and ancestry of `origin/main` agree on `f1c7efece96d…`                                                                                                                       |
| `delivery:ledger:audit`                                                      | exit 30. Pre-existing seq 97 regression warning: drops `1617926868e6`. Not introduced by this readout                                                                                                             |
| Four named commits `9620f8f986` / `9dea6316a3` / `21cf2c0125` / `66b886bb88` | not git ancestors of LIVE or `origin/main`. Their implementation is inside LIVE commit `f1c7efece96d…` (`ExecutionIdentityContext`, `inheritExecutionIdentityRunFields`, and those symbols in the running `dist`) |
| Focused tests                                                                | `OPENBOT_TEST_PROFILE=low pnpm test` on the nine identity files: 9 files, 137 tests, exit 0                                                                                                                       |
| `pnpm tsgo`                                                                  | exit 0                                                                                                                                                                                                            |
| `pnpm build`                                                                 | exit 0                                                                                                                                                                                                            |
| `pnpm check`                                                                 | exit 1. First failure: `diagnosis.action.dispatch` listed in multiple scope buckets. Unrelated to identity. Not fixed here                                                                                        |
| attribution                                                                  | exit 1 only because this worktree's `pnpm install` dirtied extension `node_modules`. No identity source file is unattributed                                                                                      |
| `[INEFFECTIVE_DYNAMIC_IMPORT]`                                               | existing warnings for collaboration paths, entitlement projection, knowledge original store, and the Xiaohongshu connector. None name execution-identity files. This readout adds none                            |
| webchat `list` / `list_meetings` / `get_meeting`                             | not re-run on 2026-09-24. Prior Round 3 evidence stays in the design doc and is not a new receipt                                                                                                                 |
| `schedule_meeting` / `cancel_meeting`                                        | not executed. External write still needs a separate confirmation. WP6 schedule item stays open                                                                                                                    |

Runtime acceptance stays open until a fresh employee webchat receipt and a confirmed schedule-plus-cancel receipt exist. Do not mark those items done from this readout.

The schedule row above is the morning snapshot. It is not rewritten. The later write is in the next section.

## Final write-path verification 2026-09-24

Observed at `2026-09-23T22:34:10Z`. This section does not close the task and does not claim Codex acceptance. `production-proven` is not claimed: the four named commits are not ancestors of LIVE.

| Item                                           | Value                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fresh `origin/main`                            | `6dae88725b0ebfbdeee3c52a501fb5ac39be6028`                                                                                                                                                                                                                                                                                                                                                      |
| LIVE container `build-info.commit`             | `f1c7efece96d68375bf4b7fb57e77908fedfdd6c`                                                                                                                                                                                                                                                                                                                                                      |
| Container UI SHA                               | no second `build-info.json`. Ledger seq 97 `uiSha` equals the gateway SHA. That ledger value is not a separate container file                                                                                                                                                                                                                                                                   |
| Image tag                                      | `rc-amd64-provenance-f1c7efece9`                                                                                                                                                                                                                                                                                                                                                                |
| Image repo digest                              | `sha256:6d9204dead13eb61b24838f3245c192d9983b46f103aae40d160e0d75940e012`                                                                                                                                                                                                                                                                                                                       |
| Image revision label                           | `f1c7efece96d68375bf4b7fb57e77908fedfdd6c`                                                                                                                                                                                                                                                                                                                                                      |
| release seq                                    | 97                                                                                                                                                                                                                                                                                                                                                                                              |
| `delivery:check-sot --use-release-record-live` | allow, exit 0. `liveSource` is injected                                                                                                                                                                                                                                                                                                                                                         |
| `delivery:ledger:audit`                        | exit 30. Pre-existing seq 97 regression: drops `1617926868e6`. Ledger was not edited                                                                                                                                                                                                                                                                                                            |
| Ancestry vs LIVE                               | `9620f8f986` exit 1, `9dea6316a3` exit 1, `21cf2c0125` exit 1, `66b886bb88` exit 1                                                                                                                                                                                                                                                                                                              |
| Write entry                                    | employee platform session calling `POST /tools/invoke`. Not Control UI webchat                                                                                                                                                                                                                                                                                                                  |
| Identity source                                | `employee` on the list call immediately before each write. Not enrollment. Process environment identity was not used                                                                                                                                                                                                                                                                            |
| `schedule_meeting`                             | `executed: true` at `2026-09-23T21:34:45.729Z`. HTTP 200. Tenant `sha256:7a3e6b16cb75`, seat `sha256:5aa016917fc8`, agent `sha256:0d6e4079e367`. Session domain `employee`. Membership present. No invitees were sent. The tool wrapper has no notification parameter. Execution id was not retained. Meeting id was not on the schedule body; it was taken later from the unique subject match |
| `cancel_meeting`                               | `executed: true` at `2026-09-23T22:13:22.423Z`. Same tenant, seat, and agent hashes. Meeting id hash `sha256:07eaf24edcc7`. HTTP 200. Provider success code was not retained                                                                                                                                                                                                                    |
| Post-cancel read                               | unwrapped meeting list for that subject remaining 0. `residualMeeting` is false                                                                                                                                                                                                                                                                                                                 |
| Subject fingerprint                            | `sha256:ad1b70fcb0bc`                                                                                                                                                                                                                                                                                                                                                                           |
| Structured evidence                            | `docs/design/evidence/conversation-identity-final-runtime-acceptance-2026-09-24.json`                                                                                                                                                                                                                                                                                                           |

LIVE commit `f1c7efece96d68375bf4b7fb57e77908fedfdd6c` is an ancestor of `origin/main`. Container build-info, image revision, ledger gateway SHA, and ledger UI SHA name that same commit. The four named commit objects are still not ancestors, so they are not production-proven by ancestry.
