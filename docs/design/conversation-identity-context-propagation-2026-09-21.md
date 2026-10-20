# Conversation Identity Context Propagation — Before / After

Date: 2026-09-21

Task: `conversation-identity-context-convergence`
Agent: `cursor-identity-context`

Scope: trace the trusted request identity of an authenticated employee turn from webchat
ingress to Seat-bound enterprise tool execution, prove where it is lost, then converge every
layer onto one canonical `ExecutionIdentityContext`.

This document is the WP0 (before) and WP6 (after) evidence artifact. It records only field
presence and the code site that copies or drops a field. It contains no credentials, tokens,
or personal identifiers.

## Legend

- `present` — the layer holds the field in a typed slot and can read it.
- `copied` — the layer forwards the field to the next layer.
- `DROPPED` — the layer holds an upstream value but the next hop has no slot for it.
- `n/a` — the field is not meaningful at this layer.
- `rebuilt` — the layer reconstructs the value from a different source instead of receiving it.

## Before state (commit `4dae2f60b1db11444df9e8c8a33e5717f903c2c1`)

| Layer (file)                                                                           | user         | platformUserId | sessionDomain             | enterpriseId                                         | membershipId                                 | seatId                  | agentId                   | sessionKey | collaborationGroupId | collab owner entitlement  |
| -------------------------------------------------------------------------------------- | ------------ | -------------- | ------------------------- | ---------------------------------------------------- | -------------------------------------------- | ----------------------- | ------------------------- | ---------- | -------------------- | ------------------------- |
| `chat.send` (`src/gateway/server-methods/chat.ts:4351`)                                | present      | present        | present                   | present                                              | present                                      | n/a                     | n/a                       | present    | present              | present                   |
| `MsgContext` (`src/auto-reply/templating.ts:149`)                                      | present      | present        | present                   | present                                              | present                                      | n/a                     | n/a                       | present    | present              | present                   |
| `get-reply` (`src/auto-reply/reply/get-reply.ts:143`)                                  | present      | present        | present                   | present                                              | present                                      | n/a                     | present                   | present    | present              | present                   |
| `get-reply-run` catalog client (`get-reply-run.ts:649`)                                | present      | present        | present                   | present                                              | present                                      | n/a                     | present                   | present    | present              | present                   |
| `get-reply-run` -> prompt listing (`get-reply-run.ts:961`)                             | copied       | copied         | copied                    | **DROPPED**                                          | **DROPPED**                                  | n/a                     | copied                    | copied     | n/a                  | n/a                       |
| `get-reply-run` -> `followupRun.run` (`get-reply-run.ts:1245`)                         | copied       | copied         | copied                    | **DROPPED**                                          | **DROPPED**                                  | n/a                     | copied                    | copied     | copied               | n/a                       |
| `queue/types.ts` `FollowupRun.run` (`queue/types.ts:52`)                               | present      | present        | present                   | absent                                               | absent                                       | n/a                     | present                   | present    | present              | n/a                       |
| `agent-runner-execution` (`agent-runner-execution.ts:292`)                             | copied       | copied         | copied                    | absent                                               | absent                                       | n/a                     | copied                    | copied     | copied               | present (model gate only) |
| `followup-runner` (`followup-runner.ts:272`)                                           | copied       | copied         | copied                    | absent                                               | absent                                       | n/a                     | copied                    | copied     | copied               | absent                    |
| `pi-embedded-runner` params (`run/params.ts:70`)                                       | present      | present        | present                   | absent                                               | absent                                       | n/a                     | present                   | present    | n/a                  | n/a                       |
| `pi-embedded-runner` attempt (`run/attempt.ts:1068`)                                   | copied       | copied         | copied                    | absent                                               | absent                                       | n/a                     | copied                    | copied     | n/a                  | n/a                       |
| `pi-tools` (`src/agents/pi-tools.ts:285`, `:593`)                                      | copied       | copied         | copied                    | absent                                               | absent                                       | n/a                     | copied                    | copied     | n/a                  | n/a                       |
| `openclaw-tools` (`src/agents/openclaw-tools.ts:84`, `:225`)                           | copied       | copied         | copied                    | absent                                               | absent                                       | n/a                     | copied                    | copied     | n/a                  | n/a                       |
| `operational-identity-tool` (`tools/operational-identity-tool.ts:61`, `:138`)          | present      | present        | present                   | absent                                               | absent                                       | n/a                     | present (from sessionKey) | present    | n/a                  | n/a                       |
| `reply-gateway-client` (`gateway/knowledge/reply-gateway-client.ts:3`)                 | supported    | supported      | supported                 | **supported but never supplied by the tool**         | **supported but never supplied by the tool** | n/a                     | n/a                       | n/a        | n/a                  | n/a                       |
| `enterprise-operational-identity-runtime` scope (`:200`)                               | reads client | reads client   | reads client              | absent on client                                     | absent on client                             | rebuilt from seat store | from param                | n/a        | n/a                  | n/a                       |
| `enterprise-data-seat-context` (`enterprise-data/enterprise-data-seat-context.ts:216`) | reads client | reads client   | reads client (store path) | **rebuilt via `findMembershipByUserId` first-match** | **never validated**                          | rebuilt                 | n/a                       | n/a        | n/a                  | n/a                       |

### Confirmed break points

1. **Tool construction boundary is the first hard loss.**
   `createOperationalIdentityTool()` (`src/agents/tools/operational-identity-tool.ts:135-141`) declares only
   `gatewayClientUser`, `gatewayClientSessionDomain`, `gatewayClientPlatformUserId`. Its private
   `resolveGatewayClient()` (`:61-71`) calls `buildKnowledgeReplyGatewayClient()` with exactly those three,
   even though that helper already accepts `gatewayClientSessionEnterpriseId` and
   `gatewayClientSessionMembershipId` (`src/gateway/knowledge/reply-gateway-client.ts:3-8`). The enterprise
   and membership IDs known at `get-reply-run.ts:655-656` cannot physically reach the tool.

2. **Queue / follow-up state has no slot for the lost fields.**
   `FollowupRun["run"]` (`src/auto-reply/reply/queue/types.ts:52-54`) stores only the same three scalars, so
   even a fixed direct turn would drop enterprise/membership on the next queued or follow-up run.

3. **An invalid employee context silently degrades to enrollment fallback.**
   `resolveOperationalIdentityRuntimeScope()` (`src/gateway/enterprise-operational-identity-runtime.ts:200-231`)
   wraps the entire authenticated-employee resolution in `try { … } catch { /* fall through */ }`. Any failure —
   unresolved tenant, missing membership, wrong tenant, suspended user, store path error — lands on
   `resolveScopeFromUniqueAgentEnrollment()`. When enrollment is not unique the function returns `null` and
   every distinct cause collapses into one untyped `null`.

4. **`null` scope is rendered as a single opaque code.**
   `createOperationalIdentityTool` maps a `null`/failed scope to the literal string `"NO_SEAT_CONTEXT"`
   (`:199`) and the message "Active enterprise seat context is required for operational identity access."
   (`enterprise-operational-identity-runtime.ts:477`). The reply contains no indication of which binding was
   missing, which is why a model receiving it invented "process environment variables are empty, therefore
   the user is not logged in".

5. **Membership is never revalidated on the enterprise path.**
   `resolveTrustedEnterpriseDataExecutionContext()` (`src/gateway/enterprise-data/enterprise-data-seat-context.ts:236`)
   selects membership with the legacy first-match `findMembershipByUserId()` and checks neither
   `user.status` nor enterprise lifecycle, while the authoritative resolver
   `resolveAuthoritativeEnterpriseScope()` (`src/gateway/platform-auth/active-membership-scope.ts:104`) already
   implements pinned-pair revalidation, suspension, ambiguity, and tenant-mismatch handling. Dropping
   `membershipId` is what prevents the authoritative resolver from being usable here.

### Captured failing-boundary evidence (WP0, before any production change)

Probe: `src/auto-reply/reply/execution-identity-propagation.test.ts` constructs
`operational_identity` with the full authenticated-employee turn identity and captures the
`GatewayClient` the tool hands to the enterprise runtime.

Runtime assertion failure at `4dae2f60b1db11444df9e8c8a33e5717f903c2c1`:

```text
FAIL src/auto-reply/reply/execution-identity-propagation.test.ts
  > forwards the authenticated employee tenant and membership to the runtime client
AssertionError: expected undefined to be '001'
  - Expected: "001"
  + Received: undefined
  at expect(client?.sessionEnterpriseId).toBe("001")
```

Type-level confirmation from `pnpm tsgo` at the same commit (the option did not exist at either
boundary, so the loss is structural, not a runtime condition):

```text
error TS2353: 'gatewayClientSessionEnterpriseId' does not exist in type
  '{ … }' (createOpenClawTools options)
error TS2353: 'gatewayClientSessionEnterpriseId' does not exist in type
  '{ agentSessionKey?; requesterAgentIdOverride?; gatewayClientUser?;
     gatewayClientSessionDomain?; gatewayClientPlatformUserId? }'
  (createOperationalIdentityTool options)
```

`client.user` and `client.platformUserId` asserted successfully in the same run, which isolates
the loss to exactly `enterpriseId` and `membershipId` rather than to the whole identity.

### Environment variables are not an identity source (before and after)

`TENANT`, `USER`, `AGENT`, `SESSION`, `CHANNEL` are not read for request identity anywhere on this
path. Their emptiness in the agent process is expected and unrelated to login state: request identity
arrives on the authenticated WebSocket client (`params.client`) and is frozen onto `MsgContext`.
`OPENBOT_DATA_MODE` / `OPENBOT_MULTITENANT` select deployment addressing mode only
(`src/gateway/tenant-context.ts:286`), never the active employee.

## After state

| Layer (file)                                         | user    | platformUserId | sessionDomain | enterpriseId | membershipId               | seatId                   | agentId      | sessionKey | collaborationGroupId | collab owner entitlement             |
| ---------------------------------------------------- | ------- | -------------- | ------------- | ------------ | -------------------------- | ------------------------ | ------------ | ---------- | -------------------- | ------------------------------------ |
| `chat.send`                                          | present | present        | present       | present      | present                    | n/a                      | n/a          | present    | present              | present                              |
| `MsgContext`                                         | present | present        | present       | present      | present                    | n/a                      | n/a          | present    | present              | present                              |
| `get-reply-run` -> `ExecutionIdentityContext`        | copied  | copied         | copied        | copied       | copied                     | n/a                      | copied       | copied     | copied               | copied (separate field)              |
| `queue/types.ts` `FollowupRun.run.executionIdentity` | copied  | copied         | copied        | copied       | copied                     | n/a                      | copied       | copied     | copied               | copied (separate field)              |
| `agent-runner-execution`                             | copied  | copied         | copied        | copied       | copied                     | n/a                      | copied       | copied     | copied               | copied (separate field)              |
| `followup-runner`                                    | copied  | copied         | copied        | copied       | copied                     | n/a                      | copied       | copied     | copied               | copied (separate field)              |
| `pi-embedded-runner` params / attempt                | copied  | copied         | copied        | copied       | copied                     | n/a                      | copied       | copied     | copied               | copied (separate field)              |
| `pi-embedded-runner` `run.ts` → attempt payload      | copied  | copied         | copied        | copied       | copied                     | n/a                      | copied       | copied     | n/a                  | n/a                                  |
| `pi-tools` / `openclaw-tools`                        | copied  | copied         | copied        | copied       | copied                     | n/a                      | copied       | copied     | copied               | copied (separate field)              |
| `operational-identity-tool`                          | copied  | copied         | copied        | copied       | copied                     | n/a                      | copied       | copied     | copied               | copied (separate field)              |
| `reply-gateway-client`                               | copied  | copied         | copied        | copied       | copied                     | n/a                      | n/a          | n/a        | n/a                  | n/a                                  |
| `enterprise-operational-identity-runtime` scope      | copied  | copied         | copied        | copied       | **used to pin membership** | resolved authoritatively | from context | n/a        | n/a                  | consumed as explicit precedence tier |

### After-state precedence and denial codes

`resolveOperationalIdentityRuntimeScopeDecision()` replaces the untyped `null` with a discriminated result.

Precedence:

1. valid authenticated employee context (`source: "employee"`);
2. explicit collaboration owner entitlement (`source: "collaboration-owner"`);
3. unique enrolled-agent context for non-interactive execution (`source: "enrollment"`);
4. typed denial.

Tier 3 is reachable only when no employee identity was presented at all. A presented-but-invalid
employee identity fails closed with its own code.

| Code                       | Meaning                                                                          |
| -------------------------- | -------------------------------------------------------------------------------- |
| `IDENTITY_CONTEXT_MISSING` | no authenticated employee identity and no enrolled agent to fall back to         |
| `TENANT_CONTEXT_MISSING`   | employee identity present, no tenant could be bound                              |
| `MEMBERSHIP_INVALID`       | membership unknown, half-bound, inactive, or the account/enterprise is suspended |
| `TENANT_MISMATCH`          | presented membership or requested tenant disagrees with the authoritative tenant |
| `NO_CURRENT_SEAT`          | employee resolved, tenant resolved, no active seat binding                       |
| `AGENT_NOT_ENROLLED`       | seat resolved, requested agent is not assigned/enrolled                          |
| `ENROLLMENT_AMBIGUOUS`     | background enrollment fallback resolved more than one tenant/employee            |
| `IDENTITY_ACTION_DENIED`   | seat/agent/action denied by enterprise identity policy (unchanged)               |

## WP6 live receipt (redacted)

Date: 2026-09-21. Agent: `cursor-identity-context`.

No emails, tokens, join URLs, cookies, or raw ids are recorded. Ids are `sha256` truncated
to 12 hex characters.

### Round 1 — store-direct (not the Codex webchat gate)

An earlier probe froze `ExecutionIdentityContext` in-process against `~/.openbot` stores
and called the tool directly. That is not authenticated Control UI / webchat `chat.send`.
Do not treat Round 1 as WP6 acceptance.

### Round 2 — authenticated Control UI webchat `chat.send`

Launchd `ai.openbot.gateway` was switched from `openbot-diagnosis-platform/dist` to this
checkout's `dist/index.js` (`healthz` live). Proof used an unexpired employee
`openbot_platform_session` cookie (HTTP `/__openbot/platform-auth/session` returned
pinned membership + enterprise), a Node `ws` client as `openbot-control-ui` /
`mode=webchat` with gateway token + that cookie, then `chat.send` to
`agent:main:employee:<userId>`.

Cookie session: `domain=employee`, membership and tenant pins present (hashed below).
`chat.send` started. The embedded agent called `operational_identity` on that employee
session key. Environment identity variables were not read. `NO_SEAT_CONTEXT` /
`SEAT_AGENT_REQUIRED` were not returned.

| Step                               | Result                                                                                  | source       | tenantId              | seatId                | agentId               |
| ---------------------------------- | --------------------------------------------------------------------------------------- | ------------ | --------------------- | --------------------- | --------------------- |
| Cookie `/session` probe            | HTTP 200; membership + enterprise pins present                                          | n/a          | `sha256:7a3e6b16cb75` | n/a                   | n/a                   |
| WS connect + `chat.send`           | `connectOk`, `chatStarted`; sessionKey kind `employee`                                  | n/a          | n/a                   | n/a                   | n/a                   |
| `operational_identity` `list`      | `ok: true`, 3 identities (`wechat-official`, `github-org`, `tencent-meeting`)           | `enrollment` | `sha256:7a3e6b16cb75` | `sha256:0880a3565d06` | `sha256:0d6e4079e367` |
| Tencent Meeting `list_meetings`    | `ok: true`, `executed: true`, `meetingInfoList[]:0`                                     | enrollment   | `sha256:7a3e6b16cb75` | `sha256:0880a3565d06` | `sha256:0d6e4079e367` |
| Tencent Meeting `get_meeting`      | skipped: live list returned zero meetings, so no `meetingId`                            | n/a          | n/a                   | n/a                   | n/a                   |
| Tencent Meeting `schedule_meeting` | skipped on this webchat turn: list was empty and a reversible schedule was not required | n/a          | n/a                   | n/a                   | n/a                   |

### Remaining gap after Round 2

The Codex gate is the webchat surface, and that surface did run. The scope source was
`enrollment`, not `employee`. Unique enrollment of `agentId=main` resolved the same
tenant/seat hashes as Round 1, so tools succeeded, but `hasPinnedEmployeeSessionContext`
was false at `operational_identity` time. Cookie pins existed on the HTTP session and
the session key was the employee steward key, yet the tool client still took Tier 3.

Root cause: `runEmbeddedPiAgent` (`src/agents/pi-embedded-runner/run.ts`) reconstructed
the `runEmbeddedAttempt` payload without `executionIdentity` or the gateway client pin
fields. Params and attempt already accepted the canonical object; the orchestrator
dropped it, so tools only saw `agentId` from the session key and used unique enrollment.

### Round 3 — same webchat path after forwarding the frozen identity

After forwarding `executionIdentity` + tenant/membership scalars from `run.ts` into
`runEmbeddedAttempt`, `tsdown` rebuilt `dist/`, and launchd `ai.openbot.gateway` was
restarted onto that dist. The same Control UI + cookie + `chat.send` path was repeated.

| Step                            | Result                                                                        | source     | tenantId              | seatId                | agentId               |
| ------------------------------- | ----------------------------------------------------------------------------- | ---------- | --------------------- | --------------------- | --------------------- |
| `operational_identity` `list`   | `ok: true`, 3 identities (`wechat-official`, `github-org`, `tencent-meeting`) | `employee` | `sha256:7a3e6b16cb75` | `sha256:0880a3565d06` | `sha256:0d6e4079e367` |
| Tencent Meeting `list_meetings` | `ok: true`, `executed: true`, `meetingInfoList[]:0`                           | employee   | `sha256:7a3e6b16cb75` | `sha256:0880a3565d06` | `sha256:0d6e4079e367` |

`NO_SEAT_CONTEXT` / `SEAT_AGENT_REQUIRED` were not returned. Environment identity
variables were not read. Tenant/seat/agent hashes match Round 2; only the source
tier changed from enrollment to employee.

### Round 4 — execution-system inherit (not a single hop / not a single robot)

The Round 3 `run.ts` field list fixed the live webchat symptom for whichever
`agentId` used `runEmbeddedPiAgent`, but reconstructing identity by hand-listing
scalars is how the pin drops again on the next new runner. The execution system
now has one inherit operator:

- `inheritExecutionIdentityRunFields` in `src/gateway/execution-identity-context.ts`
- Reconstruct hops (attempt, compact, queue, follow-up, inline tools, CLI `agent`,
  HTTP `/tools/invoke`) must spread that result.
- Spawned children cannot use Control UI cookies (they call `agent` as a local
  CLI client). They inherit the already-frozen parent object in-process via
  `stageSpawnExecutionIdentity` / `takeStagedSpawnExecutionIdentity`, never via
  model-controlled RPC params.
- Unpinned cron / unique enrollment remains the intended fallback when no
  authenticated pin pair was presented.

### Round 5 — final write-path verification

Round 2 still records the skipped `schedule_meeting` and `get_meeting` rows.
Those rows stay as the 2026-09-21 webchat history.

On 2026-09-24 an employee platform session called `POST /tools/invoke`.
That entry is not Control UI webchat. The list immediately before each write
returned `source: employee`. Enrollment was not used. Process environment
identity variables were not used.

| Step               | Result                                                                                                                                                         | source                            | tenant                | seat                  | agent                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------- | --------------------- | --------------------- |
| `schedule_meeting` | `executed: true` at `2026-09-23T21:34:45.729Z`, HTTP 200. No invitees were sent. The tool wrapper has no notification parameter. Execution id was not retained | employee, from the preceding list | `sha256:7a3e6b16cb75` | `sha256:5aa016917fc8` | `sha256:0d6e4079e367` |
| `cancel_meeting`   | `executed: true` at `2026-09-23T22:13:22.423Z`, HTTP 200. Meeting id hash `sha256:07eaf24edcc7`. Same tenant, seat, and agent hashes as the schedule row       | employee, from the preceding list | `sha256:7a3e6b16cb75` | `sha256:5aa016917fc8` | `sha256:0d6e4079e367` |
| post-cancel list   | that test subject remaining 0                                                                                                                                  | employee                          | same hashes           | same hashes           | same hashes           |

The seat hash differs from Round 3. This write did not reuse the Round 3 webchat seat.
Subject fingerprint is `sha256:ad1b70fcb0bc`. LIVE at evidence time was
`f1c7efece96d68375bf4b7fb57e77908fedfdd6c`. The four named identity commits are
not ancestors of that LIVE SHA. Structured fields are in
`docs/design/evidence/conversation-identity-final-runtime-acceptance-2026-09-24.json`.
