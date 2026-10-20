# Platform diagnosis approvals wiring

Status: `platform.diagnosis.approval.decide` is registered. The enterprise sibling
`enterprise.diagnosis.approval.decide` is registered separately (#638) and is not
called by this method. Aligns to the frozen enterprise
contract on PR #634 (`enterprise.diagnosis.approval.decide` in
`docs/design/contracts/enterprise-pending-control-contracts-2026-10-11.md`).
Same ledger, sibling method name. Merge gate for diagnosis claims on PR #633.
Platform buttons enable only when the connected gateway advertises this method
and the session has `operator.approvals` plus `platform-admin` or
`platform-super-admin`.

Surfaces:

- Platform UI: `ui/src/ui/ports/platform/diagnosis/platform-diagnosis-surface.ts`
- Host: `ui/src/ui/ports/diagnosis/diagnosis-panel.ts` passes approve, deny,
  open Daibai, and export handlers when the method and scopes are present.
- Shared projection: `src/diagnosis/visualization.ts` (`buildAuthorizations`,
  `createAuthorizationDecisionRefresh`)
- Enterprise twin: `ui/src/ui/ports/enterprise/diagnosis/enterprise-diagnosis-surface.ts`

## Method

`platform.diagnosis.approval.decide`

Parallel of `enterprise.diagnosis.approval.decide`. One approvals ledger.
Both names write the same approval-row shape and apply an effect only after
that row exists. Do not register a second protocol.

Not this method, and not registered:

- `platform.diagnosis.report.export`
- `platform.diagnosis.conversation.open`
- `diagnosis.authorizations.decide`
- `diagnosis.conversations.open`

Open Daibai is `subject.kind = "conversation"` with `decision: "approve"` on
this method. It is not a separate open RPC and not an `operator.read` lookup.

`platform.diagnosis.approval.decide` is registered from the diagnosis-approval
pack. `enterprise.diagnosis.approval.decide` is registered from the
enterprise-diagnosis-approval pack and writes the tenant ledger in
`src/diagnosis/approval-ledger.ts`. Platform decide stays a parallel
implementation with the same recorded response shape, plus platform-only
`report-export`. Neither method calls the other.
`diagnosis.approval.decide` is not a third name.

## Request

- `schemaVersion`: `1`
- `idempotencyKey`: string, required
- `subject`:
  - `{ kind: "authorization", grantId: string }`
  - `{ kind: "conversation", signalId?: string, caseId?: string, targetRef?: { targetType: string, targetId: string, tenantId: string | null } }`
  - `{ kind: "report-export", reportId: string, redactionProfile: "administrator" | "user" }` — platform method only
- `decision`: `approve` | `deny`
- `reason`: string or null

`report-export` is not on the enterprise method. The enterprise diagnosis
surface has no export button this round (#634). Enterprise callers that send
`kind: "report-export"` are `subject_incomplete` on the enterprise name.
The platform method accepts it on the same ledger.

UI mapping:

- Approve / deny reads `pendingApprovals[].grantId` and sends
  `subject.kind = "authorization"`. `refresh: "p6_p7"` is the local token from
  `createAuthorizationDecisionRefresh`. It is not a request field.
- Open Daibai copies `signalId`, `caseId`, and optional `targetRef` from the
  conversation entry and sends `subject.kind = "conversation"` with
  `decision: "approve"`. The button is an approve, not a deny. At least one of
  `signalId` or `caseId` is required. `targetRef` alone is `subject_incomplete`
  and writes nothing.
- Export report sends `subject.kind = "report-export"` with `decision: "approve"`
  and the server-known `reportId`. The view-model string
  `exportCompositeDiagnosisReportJson` is the local serializer name in
  `src/diagnosis/report-validate.ts`. It is not a `reportId` and not a gateway
  method. A deny on this subject returns `effect.type = "none"` and no body.

## Response

Recorded (approval row written, then effect):

- `approvalId`: string
- `subjectKind`: `authorization` | `conversation` | `report-export`
- `decision`: `approve` | `deny`
- `status`: `recorded`
- `grantId`: string or null
- `effect`:
  - `{ type: "grant", grantId: string, grantStatus: "APPROVED" | "DENIED" }`
  - `{ type: "conversation", opened: true, sessionKey: string }`
  - `{ type: "export", filename: string, mediaType: "application/json", body: string }`
  - `{ type: "none", reason: string }`

`effect.type = "export"` exists only on the platform method.
Enterprise `subjectKind` stays `authorization` | `conversation`.

Success gate: the UI shows success only when `status` is `recorded` and the
effect matches the request.

- Grant: `effect.grantId` equals the requested `grantId`, and `grantStatus` is
  `APPROVED` for `approve` or `DENIED` for `deny`. Then refresh P6/P7 locally.
- Conversation approve: `opened: true` and a non-empty `sessionKey`.
- Conversation deny: `effect.type = "none"` and no session key.
- Report export approve: `effect.type = "export"` and a non-empty `body`.
- Report export deny: `effect.type = "none"` and no body.

Refused (nothing written, no grant change, no session, no export body):

- `status`: `refused`
- `reason`: `grant_not_found` | `grant_not_pending` | `approver_role_mismatch` | `tenant_mismatch` | `idempotency_conflict` | `conversation_not_found` | `session_key_unavailable` | `subject_incomplete` | `report_not_found` | `export_unavailable`
- `effect`: `{ type: "none", reason }` with the same code
- no `approvalId`

`report_not_found` and `export_unavailable` are platform-only additions for
the export subject. The enterprise union does not include them this round.

Transport failures use gateway `errorShape`: `INVALID_REQUEST`, `UNAUTHORIZED`,
`UNAVAILABLE`. They are not `status: "recorded"`.

## Idempotency

`idempotencyKey` is required before either sibling method is implemented.
The same key and the same canonical body return the original recorded
response. The same key with a different body returns `idempotency_conflict`
and does not write a second row.

## Order

1. The button collects `grantId`, the conversation entry, or the report id.
   It does not call `diagnosis.issues.advance`, `diagnosis.action.dispatch`,
   `user.daibai.ask`, `sessions.resolve`, or
   `enterprise-data.governance-approvals.decide`.
2. The gateway checks `operator.approvals` and platform-admin session kind
   (below). An enterprise session is rejected. An employee token is
   `UNAUTHORIZED`.
3. It writes one approval row: `approvalId`, subject, decision, actor, time,
   `reason`. `status` on that row is the recorded response.
4. Only after that row exists does it apply the effect. A grant effect sets
   that `grantId` to `APPROVED` or `DENIED`. A conversation approve opens the
   Daibai session and returns `sessionKey`. A report-export approve serializes
   the stored report and returns `body`. If the effect cannot be produced
   (session open failure, missing report, serialize failure), the call is
   refused and the approval row is not kept. Failure has no side effect.
   The effect must not be implemented by calling `user.daibai.ask`,
   `diagnosis.action.dispatch`, or `sessions.resolve` first. The browser must
   not call `exportCompositeDiagnosisReportJson` on the view model.

## State machine

Grant effect uses the existing delegation transitions in
`src/diagnosis/delegation.ts` (`assertTransition`):

| From        | Command   | To         |
| ----------- | --------- | ---------- |
| `REQUESTED` | `approve` | `APPROVED` |
| `REQUESTED` | `deny`    | `DENIED`   |

Any other grant edge is `grant_not_pending` and writes nothing.
`DENIED`, `EXPIRED`, `REVOKED`, `CONSUMED` are terminal.
`buildAuthorizations` hides those plus `SUSPENDED`. Pending rows are
`REQUESTED` only. UI words stay `approve` | `deny`, not `approved` | `rejected`.

Conversation and report-export do not change a grant status. They still write
the approval row first, then the effect. A conversation approve does not
require a prior `APPROVED` grant click. Approve and open are the same decide
call with different subjects.

## Permissions

Exact existing strings:

| Check                 | String                                                          | Where it already exists                                                                                      |
| --------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Gateway scope         | `operator.approvals`                                            | `APPROVALS_SCOPE` in `src/gateway/method-scopes.ts`                                                          |
| Platform session kind | `platform-admin` or `platform-super-admin`                      | `GatewayWsClient.sessionKind` in `src/gateway/server/ws-types.ts`                                            |
| Session domain        | `platform`                                                      | `deriveSessionDomain` maps both kinds above to `"platform"` in `src/gateway/platform-auth/session-domain.ts` |
| Enterprise parallel   | session kind `enterprise-admin` plus scope `operator.approvals` | #634; domain `"enterprise"` from the same `deriveSessionDomain`                                              |

`operator.admin` (`ADMIN_SCOPE`) does not substitute. Do not reuse
`resolveCallerGovernanceTenant`: that helper sets `isPlatformAdmin` from
`operator.admin` (`clientHasOperatorAdminScope` in
`src/gateway/server-methods/operator-access.ts`). This method must not.

Cross-session is forbidden. A platform session must not call
`enterprise.diagnosis.approval.decide`. An enterprise session must not call
`platform.diagnosis.approval.decide`. When the method is registered, add it to
`METHOD_REQUIRED_DOMAIN` with required domain `"platform"`.

Approver and tenant boundary:

- Authorization: the grant must be `REQUESTED` and `approverRole` must be
  `platform` (the split in `buildAuthorizations`). `approverRole: "enterprise"`
  is `approver_role_mismatch`.
- Enterprise decides only its membership tenant. Platform pending rows are the
  platform-approver set and may span tenants already visible to that platform
  session. A client-supplied tenant id is not trusted. Export's tenant filter
  is still open (below) and does not change the ledger order.
- Conversation: `targetRef` alone is `subject_incomplete`.

## Rejected stand-ins

| Call                                                | Why it is wrong                                                                                                                                                                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `diagnosis.action.dispatch`                         | Starts a prompt (`title`, `agentPrompt`, `targetAgentId`, `targetSessionKey`). Scope `operator.write`. Enterprise report chips use it via `onRunConversationAction`. It does not change grant status and is not Open Daibai. |
| `diagnosis.issues.advance`                          | Ops issue queue. Does not take `grantId`.                                                                                                                                                                                    |
| `diagnosis.self-evolution.confirm`                  | Evolution confirm. Not this ledger.                                                                                                                                                                                          |
| `diagnosis.reports.query` / `diagnosis.reports.get` | Read the projection. Not approve, deny, export, or open.                                                                                                                                                                     |
| `evolution.delegation.approve`                      | Working-DNA grant. Approver role is forced to `enterprise`.                                                                                                                                                                  |
| `user.daibai.ask` / `user.daibai.execute`           | Steward turn. The row has no session key.                                                                                                                                                                                    |
| `sessions.resolve`                                  | Resolves a session key, not a `signalId` or `caseId`.                                                                                                                                                                        |
| `enterprise-data.governance-approvals.decide`       | Data-governance ledger. `approvalId` plus `approved` / `rejected`. Not `grantId`.                                                                                                                                            |
| `exec.approval.*` / `localFiles.approval.*`         | Other products on `operator.approvals`.                                                                                                                                                                                      |
| `exportCompositeDiagnosisReportJson`                | In-process serializer. Not a gateway method.                                                                                                                                                                                 |

## Current UI

`openbot-diagnosis-panel` passes approve, deny, open Daibai, and export
handlers only when the gateway advertises `platform.diagnosis.approval.decide`,
the socket is connected, scopes include `operator.approvals`, and the session
kind is `platform-admin` or `platform-super-admin`. Those handlers confirm,
then call this method. Success is shown only when `status` is `recorded` and
the effect matches. The contract-gap note stays when those handlers are
absent, so a disconnected or under-scoped session still renders the buttons
disabled.

Enterprise parity: same approve/deny payload shape and the same disabled
state when the handler is absent. Enterprise confirms before its own handler.
Enterprise has no export button and does not receive these platform handlers.
Enterprise Open Daibai calls `enterprise.diagnosis.approval.decide` only.

## Wiring checklist

1. This document and the #633 description. No method registration. No
   handlers. Diagnosis buttons stay disabled. Single-row binding wiring in
   #633 stays. Do not merge on diagnosis claims.
2. Gateway, together with the enterprise sibling, after this contract:
   - Register `platform.diagnosis.approval.decide` only.
   - Same row shape as `enterprise.diagnosis.approval.decide`.
   - Scope `operator.approvals`. Session kind `platform-admin` or
     `platform-super-admin`. Domain `platform`.
   - `idempotencyKey` required. Same key and body replay the original.
     Different body is `idempotency_conflict`.
   - Write the approval row, then the effect. Session-open or export failure
     refuses the call and drops the row.
   - Tests: employee `UNAUTHORIZED`; enterprise session rejected;
     `operator.admin` without `operator.approvals` rejected;
     `REQUESTED` to `APPROVED` / `DENIED`; non-pending grant refused with no
     row; conversation without `signalId` and `caseId` is
     `subject_incomplete`; conversation approve returns `sessionKey` only
     when `status` is `recorded`; export subject rejected on the enterprise
     method; export body absent when status is `refused`.
3. UI, only after that method is on the connected gateway:
   - Pass handlers from `openbot-diagnosis-panel`.
   - Enable a button only when connected, scope includes `operator.approvals`,
     and session kind is `platform-admin` or `platform-super-admin`.
   - Confirm, then call the method. Success only when `status` is `recorded`
     and the effect matches. Then refresh P6/P7.
   - Remove the contract-gap note only when those handlers are real callers.
4. Leave tenant pause, `agent-runtime.governance.fix`, rate-limit / fallback,
   and batch binding disabled.

## Still open

Not decided by #634:

- Whether platform report export must take an explicit tenant filter, or may
  include every tenant already in that platform report.
- Routing-priority threshold for primary bindings (`100` / `50` is what #633
  already wires).
- Whether tenant pause drains in-flight agents.
- Whether batch binding is a product or single-row only.
- QPS / daily-cap units and whether fallback is a global policy.
