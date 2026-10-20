# Enterprise pending control contracts

Status: the methods below are registered, with the refusals called out in each section.
Tenant pause and tenant resume are out of scope and are not proposed here.

Registered:

- `enterprise.diagnosis.approval.decide`
- `enterprise.security.mfa.enroll`
- `enterprise.security.sessions.list`
- `enterprise.security.sessions.revoke`
- `enterprise.access.roles.create`
- `enterprise.access.permissions.commit`
- `enterprise.security.session-policy.set`
- `enterprise.security.ip-allowlist.set`
- `enterprise.security.audit.export`
- `enterprise.mesh.asset-budget.set` (agent only; group stays `spend_not_metered`)
- `enterprise.mesh.asset.pause`

| Method                                   | Priority | Effect                                                                                                                                                                                              |
| ---------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enterprise.mesh.asset.pause`            | P0       | Writes a pause record that `authorizeCommercialRun` reads before subscription. Agent pause covers every commercial run of that agent. Group pause covers runs that pass the collaboration group id. |
| `enterprise.access.roles.create`         | P1       | Stores a custom role whose only enforceable permission is `usage:budget`. Unknown ids are `unknown_permission` and write nothing.                                                                   |
| `enterprise.access.permissions.commit`   | P1       | Member grants add `usage:budget` on `resolveBillingScope` for non-admins. Enterprise-admin and builtin roles are refused.                                                                           |
| `enterprise.security.session-policy.set` | P1       | Idle timeout deletes the login session on the next cookie read or gateway RPC.                                                                                                                      |
| `enterprise.security.ip-allowlist.set`   | P1       | Login, session read, and gateway RPC share one client IP resolver and enforce the list.                                                                                                             |
| `enterprise.security.audit.export`       | P1       | Exports the per-tenant security audit file. Download checks the session tenant again.                                                                                                               |
| `enterprise.mesh.asset-budget.set`       | P1       | Agent limits are summed from that agent's usage in the current cycle and block the run gate. Group writes return `spend_not_metered`.                                                               |

Diagnosis approve/deny and open Daibai follow `enterprise.diagnosis.approval.decide` below. That section matches platform draft #633. It replaces `diagnosis.authorizations.decide` and `diagnosis.conversations.open`.

Inventory date: 2026-10-12, baseline `origin/main` including #640 and #641. This revision lands the seven controls above. Group per-object budget stays refused.

## Already wired (do not re-propose)

| Surface                     | Behavior                                    | Existing call                                                                                                                                                         |
| --------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings, channels          | Status, probe, save, enable, remove         | `channels.status`, `config.get`, `config.set`                                                                                                                         |
| Settings, channels          | Clear saved secrets for one account         | `channels.logout` with `tenantId`. Response must be `scope=tenant`, `runtimeStopped=false`, `cleared=true`. A global logout or a stopped runtime is shown as failure. |
| Settings, models            | Provider create, rotate, delete, seat grant | `enterprise-model-provider.*`, `enterprise-model-grant.grantBatch`                                                                                                    |
| Settings, usage budget page | Tenant monthly budget                       | `budget.get`, `budget.set` (`monthlyLimitCents`, `alertThreshold`, `controls`)                                                                                        |
| Diagnosis report chips      | Hand off one report action                  | `diagnosis.action.dispatch` via `onRunConversationAction`                                                                                                             |
| Settings, security          | Change the signed-in admin password         | Existing password-change route                                                                                                                                        |
| Data capability approvals   | Approve or reject a data request            | Existing data-capability gateway client                                                                                                                               |

## Rejected wirings

These methods exist and must not be called for the controls below.

| Control                                         | Method that looks close                       | Why it is the wrong call                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Diagnosis grant approve or deny                 | `diagnosis.action.dispatch`                   | Needs `title`, `agentPrompt`, `targetAgentId`, `targetSessionKey`. It starts a conversation action. It does not change grant status.                                                                                                                                                                                        |
| Diagnosis grant approve or deny                 | `diagnosis.issues.advance`                    | Ops issue queue. `confirm` / `prescribe` / `apply` stay closed. It does not take `grantId`.                                                                                                                                                                                                                                 |
| Diagnosis grant approve or deny                 | `evolution.delegation.approve`                | Evolution delegation grant, not a diagnosis consult grant.                                                                                                                                                                                                                                                                  |
| Diagnosis grant approve or deny, or open Daibai | `enterprise-data.governance-approvals.decide` | Data-governance ledger. Categories are `source_onboarding`, `data_access`, `capability_exposure`, `identity_binding`. Decision words are `approved` / `rejected`, keyed by an existing `approvalId`. It does not take `grantId`, `signalId`, or `caseId`. Draft #633 rejects this mapping for the platform buttons as well. |
| Open Daibai from a signal                       | `user.daibai.ask` / `user.daibai.execute`     | Steward turn. The diagnosis row only has `signalId`, `caseId`, `targetRef`, `tenantId`. No session key.                                                                                                                                                                                                                     |
| Open Daibai from a signal                       | `sessions.resolve`                            | Resolves a session key, not a signal id. Report rows expose `sessionKeyHash` only.                                                                                                                                                                                                                                          |
| New role or permission commit                   | Membership `enterprise-admin` vs `member`     | Not a custom role catalog. The settings matrix is a browser draft.                                                                                                                                                                                                                                                          |
| Security 2FA enable                             | `POST` platform MFA policy                    | Super-admin only. Field is `requireMfaForPlatformAdmins`. Enrollment happens at login when that policy is on.                                                                                                                                                                                                               |
| Audit export                                    | `fabric.audit.query`                          | Platform tool-execution audit. Not login, key, or permission audit for the enterprise admin.                                                                                                                                                                                                                                |
| Active sessions / sign out all                  | `sessions.list`                               | Chat sessions, not login sessions.                                                                                                                                                                                                                                                                                          |
| Per-object budget limit                         | `budget.set`                                  | One monthly limit for the whole enterprise. Mesh cards must not call it.                                                                                                                                                                                                                                                    |
| Per-object pause                                | Tenant pause                                  | Not an enterprise control, and no agent or group pause RPC was found.                                                                                                                                                                                                                                                       |

## Proposed methods

Shared rules:

- Tenant id comes from the authenticated enterprise membership. Ignore a conflicting client `tenantId` except where the method already requires it to match.
- Permission: caller session kind is `enterprise-admin` for that tenant. Gateway scope is listed per method.
- Idempotency key is required on writes. Replaying the same key and the same body returns the original result. Same key with a different body returns `idempotency_conflict`.
- Transport errors use gateway `errorShape`: `INVALID_REQUEST`, `UNAUTHORIZED` (or `forbidden`), `UNAVAILABLE`.
- Domain refusals respond `ok: true` with `{ ok: false, reason }` so the UI can show a failure without a fake success toast. `enterprise.diagnosis.approval.decide` is the exception: it uses `status: "recorded" | "refused"` so it matches the platform approvals envelope.

### enterprise.diagnosis.approval.decide

Status: implemented for the enterprise method. `platform.diagnosis.approval.decide` is still not registered. `server-methods-list` exposes only `enterprise.diagnosis.approval.decide`, under `operator.approvals`. The handler also rejects a caller whose scopes do not include `operator.approvals`, including a session that only has `operator.admin`, because the shared scope check treats admin as a superset.

This section replaces the earlier names `diagnosis.authorizations.decide` and `diagnosis.conversations.open`. Those two names are not the enterprise path. Open Daibai is not an `operator.read` lookup.

#633 landed the platform diagnosis buttons still disabled and proposed `platform.diagnosis.approval.decide` for grant approve/deny, report export, and open Daibai. That platform method is not registered. Enterprise uses the same ledger contract under `enterprise.diagnosis.approval.decide`. Request subjects, decision words, response envelope, reason codes, and idempotency match. Only the session domain and the tenant boundary differ.

Do not register a second protocol. When a handler is added, both names write the same approval row shape and apply an effect only after that row exists. `operator.admin` does not replace `operator.approvals`. An employee token is `UNAUTHORIZED`. A platform session must not call the enterprise method, and an enterprise session must not call the platform method.

`report-export` stays on the platform method only. The enterprise diagnosis surface has no export button. This round does not add that subject.

Scope: `operator.approvals`, plus enterprise-admin membership for the tenant. Tenant id comes from that membership. A client `tenantId` is checked, not trusted.

Request:

- `schemaVersion`: `1`
- `idempotencyKey`: string, required. #633's request omitted this field. Both method names must require it before either is implemented.
- `subject`:
  - `{ kind: "authorization", grantId: string }`
  - `{ kind: "conversation", signalId?: string, caseId?: string, targetRef?: { targetType: string, targetId: string, tenantId: string | null } }`
- `decision`: `approve` or `deny` (same words as the platform draft, not `approved` / `rejected`)
- `reason`: string or null

UI mapping:

- Approve / deny reads `pendingApprovals[].grantId` and sends `subject.kind = "authorization"`. `refresh: "p6_p7"` stays a local UI token from `createAuthorizationDecisionRefresh`. It is not a request field.
- Open Daibai copies `signalId`, `caseId`, and `targetRef` from the conversation entry and sends `subject.kind = "conversation"` with `decision: "approve"`. The button is an open, not a deny. At least one of `signalId` or `caseId` is required. `targetRef` alone is `subject_incomplete` and writes nothing. The enterprise row may forward `targetRef`, but it is not a sufficient key.

Recorded response (ledger row written, then effect):

- `approvalId`: string
- `subjectKind`: `authorization` or `conversation`
- `decision`: `approve` or `deny`
- `status`: `recorded`
- `grantId`: string or null
- `effect`:
  - `{ type: "grant", grantId: string, grantStatus: "APPROVED" | "DENIED" }`
  - `{ type: "conversation", opened: true, sessionKey: string }`
  - `{ type: "none", reason: string }`

The UI shows success only when `status` is `recorded` and the effect matches the request: grant effect `grantId` equals the requested id and `grantStatus` is `APPROVED` or `DENIED` for that decision; conversation effect has `opened: true` and a non-empty `sessionKey`. Then the grant view refreshes P6/P7 locally. A deny on a conversation subject returns `effect.type = "none"` and no session key.

Refused response (nothing written, no grant change, no session):

- `status`: `refused`
- `reason`: one of `grant_not_found`, `grant_not_pending`, `approver_role_mismatch`, `tenant_mismatch`, `idempotency_conflict`, `conversation_not_found`, `session_key_unavailable`, `subject_incomplete`
- `effect`: `{ type: "none", reason }` with the same code
- no `approvalId`

Transport failures use gateway `errorShape`: `INVALID_REQUEST`, `UNAUTHORIZED`, `UNAVAILABLE`. They are not `status: "recorded"`.

Same `idempotencyKey` and the same canonical body return the original recorded response. The same key with a different body returns `idempotency_conflict` and does not write a second row.

Tenant and approver boundary:

- Authorization: the grant must be `REQUESTED` and `approverRole` must be `enterprise` (the split already used in `buildAuthorizations`). `approverRole: "platform"` is `approver_role_mismatch`. `targetTenant` must equal the membership tenant, or the call is `tenant_mismatch`.
- Conversation: `tenantId` on the entry and `targetRef.tenantId`, when set, must equal the membership tenant. A foreign tenant id is `tenant_mismatch`.
- Platform draft #633 may still be cross-tenant. That open question does not apply here. This method never decides another tenant's grant.

Order, same as #633:

1. The button collects `grantId` or the conversation entry. It does not call `diagnosis.issues.advance`, `diagnosis.action.dispatch`, `user.daibai.ask`, `sessions.resolve`, or `enterprise-data.governance-approvals.decide`.
2. The gateway checks `operator.approvals`, enterprise-admin membership, and the tenant.
3. It writes one approval row (`approvalId`, subject, decision, actor, time, reason).
4. Only after that row exists does it apply the effect. A grant effect sets that `grantId` to `APPROVED` or `DENIED`. A conversation approve resolves or opens the Daibai session and returns `sessionKey`. If that session effect cannot be produced, the call is refused and the approval row is not kept. Failure has no side effect. The effect must not be implemented by calling `user.daibai.ask` or `diagnosis.action.dispatch` first.

The enterprise diagnosis panel passes approve, deny, and open handlers only while the gateway client is connected. A row with no `signalId` and no `caseId` stays disabled. An empty pending list says the grant cannot be decided. The panel shows success only when `status` is `recorded` and the effect matches the request. A recorded conversation effect opens that `sessionKey` in the chat tab and does not call `user.daibai.ask`. A refusal or a mismatched effect is shown as failure.

### enterprise.access.roles.create

Status: registered. The server catalog is only `usage:budget`. Any other id returns `unknown_permission` and writes nothing. Builtin names `viewer`, `operator`, and `admin` return `name_taken`. A created role does not change auth until `permissions.commit` grants it to a non-admin member. The role list in the browser still shows only the three builtin roles.

Scope: `operator.write`, plus enterprise-admin membership.

Request:

- `name`: string, 1 to 64 chars
- `permissionIds`: string array, subset of the server catalog (not the UI-only list)
- `idempotencyKey`: string, required

Response:

- `ok`: boolean
- `roleId`: string
- `reason`: `name_taken`, `unknown_permission`, `catalog_closed`, `idempotency_conflict`

`catalog_closed` is not returned while `usage:budget` is enforceable. Builtin `viewer`, `operator`, and `admin` stay fixed.

### enterprise.access.permissions.commit

Status: registered. A member grant that includes `usage:budget` is read by `resolveBillingScope` and therefore by `budget.set`. Enterprise-admin callers of this method are not themselves changed. Committing onto an enterprise-admin user returns `membership_role_fixed` and writes nothing. Committing onto `viewer`, `operator`, or `admin` returns `builtin_role_fixed`. A custom role commit updates that role and any member grant whose `roleId` matches. Unknown permission ids reject the whole write.

Scope: `operator.write`, plus enterprise-admin membership.

Request:

- `targetKind`: `role` or `member`
- `targetKey`: role id or user id
- `permissionIds`: string array
- `idempotencyKey`: string, required

Response:

- `ok`: boolean
- `revision`: string
- `reason`: `unknown_target`, `unknown_permission`, `high_risk_confirmation_required`, `idempotency_conflict`, `builtin_role_fixed`, `membership_role_fixed`

High-risk ids must be repeated in `confirmedHighRiskPermissionIds` or the method returns `high_risk_confirmation_required` and writes nothing. `usage:budget` is high risk. Permissions outside the server catalog are `unknown_permission`.

### enterprise.security.mfa.enroll

Status: registered. Gateway scope bucket is `operator.write` (`operator.admin` substitutes, which is how an enterprise-admin session is classified). The actor is the signed-in enterprise admin. This does not call the platform MFA policy route.

A `start` writes a pending TOTP row in the existing MFA store and returns `otpAuthUrl` and `recoveryCodes`. `confirm` activates that row. A pending row older than 10 minutes returns `enrollment_expired` and revokes the pending secret so the code cannot be used later. After `enabled: true`, only a platform login on `admin.openbot.love` (or a local `/platform` path, `sessionDomain=platform`) requires a code. Employee public home (`www.openbot.love` and `openbot.love`) and enterprise login (`biz.openbot.love/enterprise/login`) succeed without that code. A platform target posted from those hosts is a surface mismatch, not an authenticator challenge. Users who are not enabled are unchanged: the platform policy still forces first enrollment only on a platform entry.

Scope: the signed-in user only. Not the platform super-admin policy route.

Request:

- `action`: `start` or `confirm`
- `code`: string, required for `confirm`
- `idempotencyKey`: string, required

Response:

- `ok`: boolean
- `otpAuthUrl` and `recoveryCodes` on `start` only
- `enabled`: boolean
- `reason`: `already_enabled`, `code_invalid`, `enrollment_expired`

### enterprise.security.session-policy.set

Status: registered. The value is stored per tenant. Cookie session reads and gateway RPCs that still carry the login cookie compare `lastActivityAt` (or `updatedAt` when the clock was never set) with this timeout, delete the session when it is idle, and bump `lastActivityAt` at most once a minute. Websockets that cannot be tied to a login cookie are not idle-checked. Absolute TTL is unchanged. Missing policy means no idle check.

Scope: `operator.write`, enterprise-admin.

Request:

- `idleTimeoutMinutes`: integer, 5 to 1440
- `idempotencyKey`: string, required

Response:

- `ok`: boolean
- `idleTimeoutMinutes`: number
- `reason`: `out_of_range`, `idempotency_conflict`

### enterprise.security.ip-allowlist.set

Status: registered. Login and HTTP session reads use `resolveClientIp` in `src/gateway/net.ts`: the socket address, unless that peer is listed in `gateway.trustedProxies`, in which case the first untrusted `X-Forwarded-For` hop (or `X-Real-IP` only when `gateway.allowRealIpFallback` is true). Gateway RPC enforcement uses the handshake client IP already computed by that same function. Spoofed forwarded headers from an untrusted socket are ignored. A local direct websocket often has no reported client IP; saving a non-empty allowlist from that connection returns `would_lock_out_caller` and writes nothing. An empty list clears the allowlist. A missing caller IP with a non-empty list is a lockout. Enforcement denies login before the session cookie is set, and denies later cookie reads and gateway RPCs without deleting the session. Unreadable policy fails closed for those checks.

Scope: `operator.write`, enterprise-admin.

Request:

- `cidrs`: string array, max 50
- `idempotencyKey`: string, required

Response:

- `ok`: boolean
- `cidrs`: string array
- `reason`: `cidr_invalid`, `would_lock_out_caller`, `idempotency_conflict`

`would_lock_out_caller` writes nothing.

### enterprise.security.sessions.list

Status: registered. `limit` defaults to 50 and must be an integer from 1 to 200.

`lastSeenAt` is `lastActivityAt` when a cookie read or gateway RPC has bumped it, otherwise the session row `updatedAt`. The bump is throttled to once a minute. This is the idle clock used by `session-policy.set`.

Scope: `operator.read`, enterprise-admin.

Request:

- `limit`: integer, optional, default 50

Response:

- `sessions`: array of `{ sessionId, userId, createdAt, lastSeenAt, current }`
- These are login sessions, not `sessions.list` chat sessions.

### enterprise.security.sessions.revoke

Status: registered. Revoke deletes the platform-auth login session row, the same effect as logout on the next request that reads the cookie. An already-open websocket is not force-closed by this method. If the caller session cannot be resolved from the upgrade cookie, the call returns `current_session_protected` and deletes nothing. `sessionIds` and `allExceptCurrent` are mutually exclusive. `limit` is not a field here.

Scope: `operator.write`, enterprise-admin.

Request:

- `sessionIds`: string array, or `allExceptCurrent`: true. Send one of these, not both.
- `includeCurrent`: boolean, optional. Required to revoke the caller session.
- `idempotencyKey`: string, required

Response:

- `ok`: boolean
- `revoked`: string array
- `reason`: `current_session_protected`, `session_not_found`, `idempotency_conflict`

Revoke must not drop the caller session unless a separate `includeCurrent: true` is set. The security page "全部下线" calls `allExceptCurrent: true` without `includeCurrent` while the gateway client is connected. It shows the revoked count only when `ok` is true. A refusal stays on the row as a failure.

### enterprise.security.audit.export

Status: registered. Events are appended to `audit/enterprise-security/<tenantId>.jsonl`. The handler does not read `platform-auth-login.jsonl`. A span longer than 31 days, or more than 5000 events in range, returns `range_too_wide` and does not write a partial export. `downloadPath` is a GET under the platform-auth base. The download loads the session cookie and returns 403 when the session enterprise is not the export tenant.

Scope: `operator.read`, enterprise-admin.

Request:

- `from`: ISO time
- `to`: ISO time
- `format`: `json` or `csv`
- `idempotencyKey`: string, required

Response:

- `ok`: boolean
- `exportId`: string
- `downloadPath`: string, or `reason`: `range_too_wide`, `export_unavailable`

Do not point this at `fabric.audit.query`.

### enterprise.mesh.asset-budget.set

Status: registered for `assetType: "agent"`. The limit is stored per agent and `authorizeCommercialRun` sums `costCentsForRecord` for that agent in the current subscription cycle. `monthlyLimitCents: 0` denies new runs. Missing price data on existing usage fails closed. `assetType: "group"` returns `spend_not_metered` and writes nothing, because usage rows have no group id. This method does not call `budget.set`. The mesh badge stays derived from usage.

Scope: `operator.write`, plus `usage:budget`.

Request:

- `assetType`: `agent` or `group`
- `assetId`: string
- `monthlyLimitCents`: integer, >= 0
- `idempotencyKey`: string, required

Response:

- `ok`: boolean
- `budget`: object
- `reason`: `asset_not_found`, `tenant_mismatch`, `idempotency_conflict`, `spend_not_metered`

This is not `budget.set`. Group budget stays refused until usage rows carry a collaboration group id and the recorder writes it.

### enterprise.mesh.asset.pause

Status: registered. `operator.admin` does not substitute for `operator.approvals`. A pause record is checked inside `authorizeCommercialRun` after tenant lifecycle and before subscription. Agent pause applies to every commercial run of that agent, including supervisor, CLI, and cron paths that pass `agentId`. Group pause applies only when the run passes the collaboration group id (followup `run.groupId` and an explicit `CollaborationGroupId` on the main turn). Runs that omit the group id are not stopped by a group pause. The mesh governance badge stays derived. The UI must say the run gate changed. Lookup failures are transport `UNAVAILABLE`, not `asset_not_found`. A corrupt control file fails closed for that enterprise.

Scope: `operator.approvals`, enterprise-admin.

Request:

- `assetType`: `agent` or `group`
- `assetId`: string
- `action`: `pause` or `resume`
- `reason`: string, required
- `idempotencyKey`: string, required

Response:

- `ok`: boolean
- `governanceStatus`: `paused` or `normal`
- `reason`: `asset_not_found`, `already_in_state`, `tenant_mismatch`, `idempotency_conflict`

This is not tenant pause or tenant resume. Repeating the same action returns `already_in_state` with `ok: false` and does not write again.
