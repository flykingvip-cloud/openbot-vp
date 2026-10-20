# Requirements Document

## Introduction

This feature turns the B-plan capability management infrastructure into a platform-grade **Capability Center**. It is delivered in two phases inside a single spec so the runtime and product layers stay consistent, but the phases can land independently:

- **Phase 1 — Governance Runtime** (Requirements 1–20). Wires the Platform Capabilities page to the gateway so proposal approve/reject/promote/revoke/deprecate/retire actions persist to `~/.openclaw/governance/proposals.json` and `registry.json`; adds non-blocking invocation telemetry into `metrics.json` and surfaces it in the view model; enforces SKILL_PACK_STANDARD_V1 L0–L3 admission gates at `submitProposal` time. Preserves the optimistic facade so the UI renders immediately, with explicit pending and failed states on persistence errors.
- **Phase 2 — Capability Center** (Requirements 21–35). Adds the product layer that platform administrators actually operate: a consolidated **Capability Asset** view model, a **Governance Issue Engine** that turns metrics into actionable findings, a richer **Distribution Policy** (tenant / plan / beta / approval / region), a **Capability Detail** runtime (metrics + tenants + lifecycle + routing + failures + rollout + proposal history), and an **IA upgrade** from `{catalog, installed, discovery, distribution, health}` to `{overview, assets, intake, distribution, usage&health, governance}`. Metrics stop being a passive dashboard: they feed admission, lifecycle, distribution, and the issue engine.
- **Phase 3 — Capability Intelligence** is out of scope for this spec. A `Recommendation Engine`, auto-governance actions, routing intelligence, and tenant-aware distribution intelligence are deferred.

All three phases stay on JSON file storage for this iteration; no DB dependency is introduced. Existing controls on the Platform Capabilities page remain reachable. The IA upgrade (Requirement 31) is additive — Phase 1 ships on the current 5-tab page; the new 6-section IA only becomes the default once Phase 2 completes and backward-compat URLs keep working.

## Glossary

### Phase 1 terms

- **Governance_Runtime**: The end-to-end subsystem composed of the UI controller, gateway handlers, governance store, metrics store, and pack admission gate. Refers to the whole feature when a requirement is cross-cutting.
- **Governance_Client**: UI-side controller (new module under `ui/src/ui/controllers/`) that wraps `client.request("capabilities.governance.*", …)` RPCs and reconciles responses with the `CapabilityGovernanceViewState` facade.
- **Governance_Facade**: Existing optimistic-update layer at `ui/src/ui/capability/capability-governance/facade.ts`. Holds proposal/registry overrides keyed by id.
- **Governance_Store**: Existing JSON-file store at `src/gateway/capability-governance-store.ts`, backed by `~/.openclaw/governance/proposals.json` and `~/.openclaw/governance/registry.json`.
- **Metrics_Store**: New JSON-file store (to be added) at `~/.openclaw/governance/metrics.json`, aggregating per-capability invocation counters.
- **Metrics_Emitter**: New non-blocking emission path invoked from the tool-use flow in `src/auto-reply/reply/*` when a capability (skill or tool) is invoked.
- **Pack_Admission_Gate**: New admission-gate function invoked inside `capabilities.governance.submitProposal` when `manifest.kind === "pack"`. Classifies the pack into L0/L1/L2/L3 and either accepts, flags, or rejects.
- **Gateway_Handler**: Existing handler group in `src/gateway/server-methods/capability-governance.ts`. Handlers are registered under the method prefix `capabilities.governance.*`.
- **Discovery_Dispatcher**: Existing module at `ui/src/ui/capability/capability-governance/discovery/dispatcher.ts`. Runs registered adapters (npm, GitHub topic) and currently inserts proposals into the in-memory snapshot.
- **Admin_Operator**: Operator session authenticated with `operator.admin` scope.
- **Read_Operator**: Operator session authenticated with `operator.read` scope only.
- **Capability_Invocation**: A single execution of a registered capability (skill invocation, tool call, pack step) that has a resolvable `skillKey` or `capabilityId`.
- **Pack_Level**: Classification tier L0–L3 per SKILL_PACK_STANDARD_V1: L0 forbidden, L1 lightweight, L2 standard, L3 core.
- **Pending_Action**: A UI-side action whose gateway RPC has been dispatched but not yet confirmed.
- **Failed_Action**: A UI-side action whose gateway RPC returned an error.

### Phase 2 terms

- **Capability_Asset**: The operator-facing projection of one capability. Merges `CapabilityManifest` (source of truth for identity/contract) with `CapabilityRegistryEntry.distribution` (scope + default), lifecycle state, and the `CapabilityInvocationMetric` for the same `capabilityId`. Holds an additional `taxonomy` (kind × domain tags such as `coding`, `retrieval`, `image`, `browser`, `workflow`), explicit `owner` and `lastAuditedAt` metadata, a signature flag, and a denormalized health summary (error rate, p95, total invocations). It is a **view-model**, not a new storage layer.
- **Capability_Asset_Store**: A read-only aggregator (not a new JSON file) that joins `proposals.json`, `registry.json`, and `metrics.json` on demand. Gateway method `capabilities.governance.listAssets` returns `Capability_Asset[]`. No independent persistence; the three underlying stores remain the source of truth.
- **Governance_Issue**: A machine-generated finding about one `capabilityId` (or the platform itself) with `{ id, category, severity, rationale, evidence, suggestedAction, createdAt, firstObservedAt, acknowledgedBy?, acknowledgedAt? }`. Categories include `high_error_rate`, `low_adoption`, `unused_capability`, `high_cost_low_value`, `fallback_spam`, `missing_owner`, `review_overdue`, `deprecated_but_active`, `unsigned_external`, `orphaned_proposal`.
- **Issue_Engine**: The deterministic evaluator that, on each refresh, scans the asset set and emits `Governance_Issue[]`. It reads `Metrics_Store`, `Governance_Store`, and `Capability_Asset`; it does not write to them. It lives in `src/gateway/capability-governance-issues.ts`.
- **Distribution_Policy_V2**: Superset of Phase 1 `DistributionScope`. Fields: `tenantIds?`, `channelIds?`, `agentIds?`, `planIds?` (pricing tiers), `regionIds?` (geo/compliance), `restrictedToRoles?`, `beta: boolean`, `requiresApproval: boolean`, `defaultEnabled: boolean`, `rolloutStage: "off" | "canary" | "staged" | "ga"`, `updatedAt`, `updatedBy?`. Backward compatible: Phase 1 fields stay in the same shape.
- **Capability_Detail**: A gateway-rendered detail payload for one `capabilityId`, used by the Capability Detail page. Fields: `{ asset, proposalHistory[], lifecycleEvents[], distribution, recentFailures[], tenantUsage[], routingBindings[] }`. Gateway method `capabilities.governance.getDetail`.
- **Capability_Center_IA**: The post-Phase-2 information architecture on the Platform Capabilities page: six sections — `overview`, `assets`, `intake`, `distribution`, `usageHealth`, `governance`. Replaces the 5-tab `{catalog, installed, discovery, distribution, health}` layout. Deep links to old tabs must redirect to the matching new section.
- **Metrics_Bindings**: The contract that ties metrics into admission / lifecycle / distribution decisions. Not a new module; a set of named functions exposed by `Issue_Engine` and consumed by `Pack_Admission_Gate` and the UI (e.g. `shouldSuggestDeprecation(capabilityId): Issue | null`, `shouldBlockPromotion(manifestId): Issue | null`).

## Requirements

## Phase 1 — Governance Runtime

### Requirement 1: Proposals list flows from gateway into view state

**User Story:** As a platform admin, I want the Platform Capabilities discovery tab to display proposals persisted on the gateway, so that I see the same list any other operator sees.

#### Acceptance Criteria

1. WHEN the Platform Capabilities page is mounted, THE Governance_Client SHALL issue `capabilities.governance.listProposals` and merge the returned proposals into `CapabilityGovernanceViewState` before rendering the discovery tab.
2. WHEN the `capabilities.governance.listProposals` response is received, THE Governance_Client SHALL replace the proposals derived by the normalizer with the gateway-returned proposals for any `proposalId` present in both sets.
3. WHEN the user clicks the discovery-tab refresh button, THE Governance_Client SHALL re-issue `capabilities.governance.listProposals` and update the view state.
4. IF the `capabilities.governance.listProposals` RPC returns an error, THEN THE Governance_Client SHALL preserve the previous snapshot, set a discovery-tab error message derived from the RPC error, and emit a retry affordance.
5. WHERE the operator session carries only `operator.read`, THE Governance_Runtime SHALL still allow `capabilities.governance.listProposals` to succeed.

### Requirement 2: Registry list flows from gateway into view state

**User Story:** As a platform admin, I want the catalog, installed, distribution, and health tabs to reflect the persisted registry, so that lifecycle and distribution changes are visible across sessions.

#### Acceptance Criteria

1. WHEN the Platform Capabilities page is mounted, THE Governance_Client SHALL issue `capabilities.governance.listRegistry` and merge returned entries into `CapabilityGovernanceViewState`.
2. WHEN a registry entry is returned by `capabilities.governance.listRegistry`, THE Governance_Client SHALL prefer the gateway entry over the normalizer-derived entry when both reference the same `manifest.id`.
3. WHEN the user switches between catalog, installed, distribution, and health tabs, THE Governance_Runtime SHALL render using the merged snapshot without re-issuing the RPC.
4. IF `capabilities.governance.listRegistry` returns an error, THEN THE Governance_Client SHALL preserve the previous snapshot, surface the error on the affected tabs, and keep the normalizer-derived entries visible.

### Requirement 3: Approve proposal persists through gateway

**User Story:** As a platform admin, I want the approve button to persist the approval, so that the proposal moves into the registry across operator sessions.

#### Acceptance Criteria

1. WHEN the admin clicks approve on a proposal, THE Governance_Client SHALL apply an optimistic `approved` override via the Governance_Facade and mark the action as a Pending_Action.
2. WHEN the optimistic override is applied, THE Governance_Client SHALL dispatch `capabilities.governance.approveProposal` with `{ proposalId, reviewerId, note? }`.
3. WHEN `capabilities.governance.approveProposal` returns success, THE Governance_Client SHALL clear the Pending_Action marker, replace the facade override with the authoritative proposal and registry entry from the response, and re-issue `capabilities.governance.listRegistry`.
4. IF `capabilities.governance.approveProposal` returns an error, THEN THE Governance_Client SHALL convert the Pending_Action into a Failed_Action that keeps the optimistic override visible, tags it with a failure reason, and exposes a retry affordance.
5. WHERE the operator session lacks `operator.admin`, THE Gateway_Handler SHALL reject `capabilities.governance.approveProposal` with `INVALID_REQUEST` or the configured authorization error code without mutating the Governance_Store.

### Requirement 4: Reject proposal persists through gateway

**User Story:** As a platform admin, I want the reject button to persist the rejection with a note, so that audit trails survive restarts.

#### Acceptance Criteria

1. WHEN the admin clicks reject on a proposal, THE Governance_Client SHALL apply an optimistic `rejected` override with the supplied note via the Governance_Facade and mark the action as a Pending_Action.
2. WHEN the optimistic override is applied, THE Governance_Client SHALL dispatch `capabilities.governance.rejectProposal` with `{ proposalId, reviewerId, note }`.
3. WHEN `capabilities.governance.rejectProposal` returns success, THE Governance_Client SHALL clear the Pending_Action marker and replace the facade override with the authoritative proposal from the response.
4. IF `capabilities.governance.rejectProposal` returns an error, THEN THE Governance_Client SHALL convert the Pending_Action into a Failed_Action that keeps the optimistic `rejected` state visible with the failure reason.

### Requirement 5: Promote and revoke distribution persist through gateway

**User Story:** As a platform admin, I want promote and revoke distribution to persist on the gateway, so that tenant scoping survives restarts.

#### Acceptance Criteria

1. WHEN the admin triggers promote on a registry entry, THE Governance_Client SHALL apply an optimistic distribution override with the new scope and `defaultEnabled = true`, then dispatch `capabilities.governance.updateDistribution` with `{ manifestId, scope, defaultEnabled: true, updatedBy }`.
2. WHEN the admin triggers revoke on a registry entry, THE Governance_Client SHALL apply an optimistic distribution override with empty scope and `defaultEnabled = false`, then dispatch `capabilities.governance.updateDistribution` with `{ manifestId, scope: {}, defaultEnabled: false, updatedBy }`.
3. WHEN `capabilities.governance.updateDistribution` returns success, THE Governance_Client SHALL replace the facade override with the authoritative entry from the response.
4. IF `capabilities.governance.updateDistribution` returns an error, THEN THE Governance_Client SHALL convert the Pending_Action into a Failed_Action, keep the optimistic override visible, and record the error reason.

### Requirement 6: Deprecate and retire persist through gateway

**User Story:** As a platform admin, I want deprecate and retire to persist, so that lifecycle state is consistent across sessions.

#### Acceptance Criteria

1. WHEN the admin triggers deprecate on a registry entry, THE Governance_Client SHALL apply an optimistic `lifecycleState = deprecated` override and dispatch `capabilities.governance.updateLifecycle` with `{ manifestId, state: "deprecated" }`.
2. WHEN the admin triggers retire on a registry entry, THE Governance_Client SHALL apply an optimistic `lifecycleState = retired` override and dispatch `capabilities.governance.updateLifecycle` with `{ manifestId, state: "retired" }`.
3. WHEN `capabilities.governance.updateLifecycle` returns success, THE Governance_Client SHALL replace the facade override with the authoritative entry from the response.
4. IF `capabilities.governance.updateLifecycle` returns an error, THEN THE Governance_Client SHALL convert the Pending_Action into a Failed_Action and keep the optimistic override visible with a failure reason.

### Requirement 7: Pending and failed action states are visible in the UI

**User Story:** As a platform operator, I want pending and failed governance actions to be distinguishable in the UI, so that I do not assume a change was persisted when it was not.

#### Acceptance Criteria

1. WHILE a governance action is a Pending_Action, THE Governance_Runtime SHALL render a pending indicator on the affected proposal or registry card and disable re-triggering the same action on that card.
2. WHILE a governance action is a Failed_Action, THE Governance_Runtime SHALL render a failed indicator on the affected card, display the failure reason text, and re-enable the action control for retry.
3. WHEN a retry of a Failed_Action succeeds, THE Governance_Runtime SHALL clear the failed indicator and render the authoritative state.
4. IF the UI unmounts while Pending_Actions exist, THEN THE Governance_Client SHALL await in-flight RPCs and apply their authoritative results to the stored view state before releasing resources.

### Requirement 8: Multi-operator snapshot freshness

**User Story:** As a platform admin working with other operators, I want the snapshot to reflect changes made by peers, so that two operators do not clobber each other.

#### Acceptance Criteria

1. WHEN any gateway write RPC in `capabilities.governance.*` returns success, THE Governance_Client SHALL re-issue `capabilities.governance.listProposals` and `capabilities.governance.listRegistry` within 500 ms of receiving the response.
2. WHEN two concurrent write RPCs target the same `proposalId` or `manifestId`, THE Governance_Store SHALL serialize the writes and produce a final state equal to the later-written payload.
3. IF a refresh RPC returns a state that contradicts a local optimistic override, THEN THE Governance_Client SHALL discard the override and render the gateway state.

### Requirement 9: Discovery dispatcher submits proposals through gateway

**User Story:** As a platform admin, I want discovery-run proposals to persist on the gateway, so that found capabilities survive a reload.

#### Acceptance Criteria

1. WHEN the admin clicks the discovery refresh action, THE Discovery_Dispatcher SHALL run registered adapters and, for each returned proposal, dispatch `capabilities.governance.submitProposal` with `{ proposalId, manifest, findings, submittedBy }`.
2. WHEN all `submitProposal` RPCs complete, THE Governance_Client SHALL re-issue `capabilities.governance.listProposals` and update the discovery tab.
3. IF any `submitProposal` RPC fails, THEN THE Governance_Client SHALL record the failure against the proposal, continue dispatching remaining proposals, and surface an aggregated discovery error summary.
4. WHERE a proposal returned by an adapter matches an existing `proposalId` in the Governance_Store, THE Governance_Store SHALL replace the stored proposal with the newly submitted proposal without altering prior `reviewer` metadata unless the adapter provides one.

### Requirement 10: Parser round-trip for capability manifests

**User Story:** As a platform developer, I want capability manifests to survive a write-then-read round trip through the JSON store, so that persisted state does not drift from the in-memory model.

#### Acceptance Criteria

1. THE Governance_Store SHALL serialize every `GovernanceProposal` and `GovernanceRegistryEntry` to JSON using `JSON.stringify` with stable key ordering for known fields.
2. THE Governance_Store SHALL parse JSON files using `JSON.parse` and return typed `GovernanceProposal` and `GovernanceRegistryEntry` values.
3. FOR ALL valid in-memory proposals, writing the proposal through `submitProposal` then reading via `listProposals` SHALL return a proposal deep-equal to the input except for fields overwritten by the store (`submittedAt` when unset).
4. FOR ALL valid in-memory registry entries, writing the entry through `registerCapability` or `updateRegistryDistribution` then reading via `listRegistry` SHALL return an entry deep-equal to the last-written entry except for store-managed fields (`createdAt`, `updatedAt`).
5. IF the JSON file is malformed, THEN THE Governance_Store SHALL return an empty list and emit a warning log without throwing.

### Requirement 11: Non-blocking invocation telemetry emission

**User Story:** As a platform operator, I want capability invocations to be counted without slowing the tool-use path, so that telemetry cannot stall agent responses.

#### Acceptance Criteria

1. WHEN a Capability_Invocation begins on the tool-use path, THE Metrics_Emitter SHALL record `{ skillKey, capabilityId?, startedAt }` via a non-blocking call that returns control to the caller within 1 ms of invocation.
2. WHEN a Capability_Invocation completes, THE Metrics_Emitter SHALL record `{ skillKey, capabilityId?, endedAt, outcome: "success" | "error", latencyMs, costUnits? }` asynchronously without awaiting.
3. IF the emitted event references a `skillKey` that is not present in the registry or report, THEN THE Metrics_Emitter SHALL record the event against that key anyway without raising an error.
4. IF the Metrics_Store write fails, THEN THE Metrics_Emitter SHALL swallow the error, log a warning, and continue operating.

### Requirement 12: Metrics aggregation and persistence

**User Story:** As a platform admin, I want aggregate metrics to be persisted so that invocation counts, error rates, p95 latency, and cost are visible across restarts.

#### Acceptance Criteria

1. THE Metrics_Store SHALL persist aggregated metrics to `~/.openclaw/governance/metrics.json` using the schema `{ capabilityId, invocationCount, errorCount, p95LatencyMs, costTotal, periodStart, periodEnd }`.
2. WHEN a Metrics_Emitter event is processed, THE Metrics_Store SHALL increment `invocationCount` for the matched `capabilityId` and, if the outcome is `error`, SHALL increment `errorCount`.
3. WHEN a latency sample arrives, THE Metrics_Store SHALL update the rolling `p95LatencyMs` value using a bounded sample buffer of at most 512 samples per `capabilityId`.
4. WHEN a cost sample arrives, THE Metrics_Store SHALL add the cost delta to `costTotal` for the matched `capabilityId`.
5. WHILE no events have been recorded for a `capabilityId`, THE Metrics_Store SHALL omit that `capabilityId` from `metrics.json` rather than emitting zero-valued placeholders.

### Requirement 13: Metrics surfaced in view model

**User Story:** As a platform admin, I want invocation metrics visible alongside each capability, so that I can spot unhealthy capabilities.

#### Acceptance Criteria

1. THE Governance_Runtime SHALL expose a `capabilities.governance.listMetrics` gateway method returning `CapabilityInvocationMetric[]` under `operator.read` scope.
2. WHEN the Platform Capabilities page is mounted, THE Governance_Client SHALL issue `capabilities.governance.listMetrics` and populate `CapabilityGovernanceSnapshot.metrics`.
3. WHEN a registry card is rendered, THE Governance_Runtime SHALL display `invocationCount`, `errorCount`, and `p95LatencyMs` derived from the matching metric when a metric exists for that `capabilityId`.
4. WHERE no metric exists for a `capabilityId`, THE Governance_Runtime SHALL render a neutral placeholder instead of an error.

### Requirement 14: Pack admission gate rejects L0 packs

**User Story:** As a platform admin, I want L0 pack proposals to be rejected at submission, so that the registry cannot contain forbidden packs.

#### Acceptance Criteria

1. WHEN a proposal with `manifest.kind === "pack"` is submitted and the Pack_Admission_Gate classifies it as L0, THE Gateway_Handler SHALL reject `capabilities.governance.submitProposal` with an error code describing the admission failure and SHALL NOT write the proposal to the Governance_Store.
2. THE Pack_Admission_Gate SHALL classify a pack as L0 when the pack manifest declares a single skill with a pure linear control flow.
3. IF the L0 classification is emitted, THEN the returned error payload SHALL include `{ level: "L0", reason, manifestId }` to aid the caller.

### Requirement 15: Pack admission gate flags L1 packs for review

**User Story:** As a platform admin, I want L1 pack proposals to be held for review, so that lightweight packs receive architectural review before activation.

#### Acceptance Criteria

1. WHEN a proposal with `manifest.kind === "pack"` is submitted and the Pack_Admission_Gate classifies it as L1, THE Gateway_Handler SHALL persist the proposal with `status: "under_review"` and SHALL attach a `SecurityFinding` of category `overbroad_scope` or a dedicated `needs_architecture_review` category with severity `medium`.
2. THE Pack_Admission_Gate SHALL classify a pack as L1 when the pack manifest declares 2 to 4 skills without the L2 structural requirements.

### Requirement 16: Pack admission gate accepts L2 packs

**User Story:** As a platform admin, I want L2 pack proposals to follow the normal approval flow, so that standard packs do not face extra friction.

#### Acceptance Criteria

1. WHEN a proposal with `manifest.kind === "pack"` is submitted and the Pack_Admission_Gate classifies it as L2, THE Gateway_Handler SHALL persist the proposal with `status: "proposed"` and SHALL NOT attach admission findings.
2. THE Pack_Admission_Gate SHALL classify a pack as L2 when the pack manifest declares 3 or more atomic skills, a non-linear control flow, and independent per-skill metrics.

### Requirement 17: Pack admission gate requires explicit sign-off for L3 packs

**User Story:** As a platform admin, I want L3 pack proposals to require an explicit sign-off, so that core packs cannot be promoted without acknowledgment of risk.

#### Acceptance Criteria

1. WHEN a proposal with `manifest.kind === "pack"` is submitted and the Pack_Admission_Gate classifies it as L3, THE Gateway_Handler SHALL persist the proposal with `status: "under_review"` and SHALL attach a `SecurityFinding` of category `needs_explicit_signoff` with severity `high`.
2. WHEN an admin invokes `capabilities.governance.approveProposal` on an L3 proposal without the parameter `{ packSignoff: true }`, THE Gateway_Handler SHALL reject the request with an error describing the missing sign-off and SHALL NOT transition the proposal or register the manifest.
3. WHEN an admin invokes `capabilities.governance.approveProposal` on an L3 proposal with `{ packSignoff: true }` and a non-empty `note`, THE Gateway_Handler SHALL approve the proposal and register the manifest.
4. THE Pack_Admission_Gate SHALL classify a pack as L3 when the pack manifest declares strong governance metadata, an atomic rollback procedure, a risk-tier annotation, and an SLA field.

### Requirement 18: Pack admission gate is deterministic and idempotent

**User Story:** As a platform developer, I want the pack admission classification to be deterministic, so that repeated submissions of the same manifest do not oscillate between levels.

#### Acceptance Criteria

1. FOR ALL pack manifests, classifying the same manifest twice SHALL return the same `Pack_Level`.
2. WHEN a pack manifest is modified such that one classification input changes, THE Pack_Admission_Gate SHALL recompute the level from the current manifest fields without reading prior state.
3. IF any classification input field is missing from the manifest, THEN THE Pack_Admission_Gate SHALL default to L1 and attach a `needs_architecture_review` finding.

### Requirement 19: Authorization boundaries are enforced per method

**User Story:** As a platform operator with read-only scope, I want write RPCs to be rejected, so that I cannot accidentally mutate the registry.

#### Acceptance Criteria

1. WHEN a client with only `operator.read` invokes `capabilities.governance.listProposals` or `capabilities.governance.listRegistry` or `capabilities.governance.listMetrics`, THE Gateway_Handler SHALL allow the call and return the current state.
2. IF a client without `operator.admin` invokes `capabilities.governance.submitProposal`, `approveProposal`, `rejectProposal`, `updateLifecycle`, or `updateDistribution`, THEN THE Governance_Runtime SHALL reject the call via the scope middleware before the handler runs.
3. THE Governance_Runtime SHALL keep the scope registration for `capabilities.governance.*` methods consistent with `src/gateway/method-scopes.ts`, with list methods under `READ_SCOPE` and write methods under `ADMIN_SCOPE`.

### Requirement 20: Backward compatibility with existing UI surfaces

**User Story:** As a platform operator, I want the existing Platform Capabilities page and its five tabs to keep working, so that wiring to the gateway does not regress the UX.

#### Acceptance Criteria

1. THE Governance_Runtime SHALL preserve the existing tab set `{ catalog, installed, discovery, distribution, health }` on the Platform Capabilities page.
2. THE Governance_Runtime SHALL preserve the approve, reject, promote, revoke, deprecate, and retire controls in their current locations.
3. WHEN the gateway is disconnected at page-mount time, THE Governance_Client SHALL render the normalizer-derived snapshot and display a banner indicating that governance state is local-only.
4. WHERE the gateway reconnects during an active session, THE Governance_Client SHALL issue list RPCs and reconcile the snapshot without requiring a page reload.

## Phase 2 — Capability Center

### Requirement 21: Capability Asset view model aggregates manifest, registry, metrics, and distribution

**User Story:** As a platform admin, I want a single `CapabilityAssetView` per capability so that I can see identity, source, lifecycle, distribution, risk, health, cost, and owner together without cross-referencing three stores.

#### Acceptance Criteria

1. THE Governance_Runtime SHALL expose a `capabilities.governance.listAssets` gateway method under `operator.read` scope returning `CapabilityAsset[]`.
2. THE Capability_Asset_Store SHALL join `Governance_Store` registry entries, matching `Governance_Store` proposals, and `Metrics_Store` aggregates on `capabilityId` (falling back to `skillKey` when the metric was recorded without a `capabilityId`).
3. EACH `CapabilityAsset` returned by `listAssets` SHALL include the fields `{ capabilityId, name, description, kind, taxonomy, source, riskLevel, signatureStatus, lifecycleState, owner?, lastAuditedAt?, distribution, health: { invocationCount, errorCount, errorRate, p95LatencyMs, costTotal, costPerInvocation } | null, activeTenantCount, pendingProposalId? }`.
4. WHERE no metric exists for a `capabilityId`, THE Capability_Asset_Store SHALL return `health: null` rather than zero-valued placeholders.
5. WHERE the manifest lacks an `owner` field, THE Capability_Asset_Store SHALL emit `owner: undefined` and the Issue_Engine SHALL raise a `missing_owner` issue (see Requirement 23).
6. THE Capability_Asset_Store SHALL be a pure read-aggregator: it MUST NOT create a fourth JSON file and MUST NOT write back to any underlying store.
7. WHEN any write RPC in `capabilities.governance.*` succeeds, THE Governance_Client SHALL invalidate cached asset data and re-issue `capabilities.governance.listAssets` within 500 ms.
8. WHERE Phase 1 view models still render (registry cards, discovery cards), THE Governance_Client SHALL continue to derive them from the same snapshot so Phase 1 screens keep working while Phase 2 adds the assets surface.

### Requirement 22: Capability Detail runtime serves deep-drilldown data

**User Story:** As a platform admin, I want a Capability Detail drawer or page to show metrics, tenants, lifecycle events, routing bindings, recent failures, rollout status, and proposal history for one capability so that I can make governance decisions with full context.

#### Acceptance Criteria

1. THE Governance_Runtime SHALL expose a `capabilities.governance.getDetail` gateway method under `operator.read` scope accepting `{ capabilityId }`.
2. THE detail payload returned by `getDetail` SHALL include `{ asset, proposalHistory: GovernanceProposal[], lifecycleEvents: LifecycleEvent[], distribution: DistributionPolicyV2, recentFailures: MetricsFailureSample[], tenantUsage: TenantUsageRow[], routingBindings: RoutingBinding[] }`.
3. WHEN `recentFailures` is requested, THE Metrics_Store SHALL retain up to 20 most-recent error samples per `capabilityId` with `{ atMs, outcome: "error", errorCode?, errorMessageHash, latencyMs }` (message itself hashed to keep the file small and PII-safe); older samples SHALL roll off on a FIFO basis.
4. WHEN `tenantUsage` is requested, THE Metrics_Store SHALL group aggregated counters by `tenantId` (when the telemetry event carried one) and return the top-10 tenants by `invocationCount` for the capability.
5. IF `capabilityId` is unknown to the Governance_Store, THEN `getDetail` SHALL return an `INVALID_REQUEST` error without touching storage.
6. WHERE the UI opens detail while a Pending_Action or Failed_Action exists for the same `capabilityId`, THE Governance_Client SHALL render the pending/failed indicator inside the detail view using the same facade state rule as list views.

### Requirement 23: Governance issue engine turns metrics into findings

**User Story:** As a platform admin, I want the platform to raise explicit governance issues (high error rate, low adoption, deprecated-but-active, etc.) so that I see what needs attention instead of staring at raw metrics.

#### Acceptance Criteria

1. THE Governance_Runtime SHALL expose a `capabilities.governance.listIssues` gateway method under `operator.read` scope returning `GovernanceIssue[]` with optional filters `{ severity?, category?, capabilityId? }`.
2. THE Issue_Engine SHALL deterministically emit issues from the following rules, each keyed to a category:
   - `high_error_rate`: `errorRate > 0.05` and `invocationCount >= 20` — severity `high`.
   - `fallback_spam`: more than 30% of invocations for a capability triggered a downstream fallback (field `fallbackCount / invocationCount`) — severity `medium`.
   - `low_adoption`: `activeTenantCount === 0` and lifecycle `active` for `> 30 days` — severity `low`.
   - `unused_capability`: `invocationCount === 0` over a 30-day rolling window and lifecycle `active` — severity `low`.
   - `high_cost_low_value`: `costTotal > configured threshold` and `invocationCount < configured threshold` — severity `medium`.
   - `missing_owner`: `asset.owner` is empty — severity `low` (degrades to `medium` once lifecycle is `active`).
   - `review_overdue`: `asset.lastAuditedAt` older than 180 days and lifecycle not `retired` — severity `low`.
   - `deprecated_but_active`: `lifecycleState === "deprecated"` but `invocationCount > 0` in last 7 days — severity `high`.
   - `unsigned_external`: `source.trustTier === "external"` and `signatureStatus !== "verified"` — severity `medium`.
   - `orphaned_proposal`: proposal with `status === "under_review"` older than 14 days without a reviewer — severity `medium`.
3. EACH emitted issue SHALL carry `{ id, category, severity, capabilityId?, proposalId?, rationale, evidence, suggestedAction, createdAt, firstObservedAt }`, where `evidence` is a strictly-typed struct (counts, ratios, timestamps) and never raw tool output.
4. THE Issue_Engine SHALL be deterministic: given the same inputs from `Governance_Store` and `Metrics_Store`, it SHALL return the same issue set in the same order.
5. WHEN an admin calls `capabilities.governance.acknowledgeIssue` with `{ issueId, reviewerId, note? }` under `operator.admin` scope, THE Governance_Runtime SHALL persist the acknowledgement in `~/.openclaw/governance/issues-ack.json` keyed by `issueId` with `{ reviewerId, acknowledgedAt, note }`, and `listIssues` SHALL return the acknowledgement alongside the issue so the UI can suppress or defer it.
6. WHERE an issue references an acknowledgement older than 30 days, THE Issue_Engine SHALL surface the issue again with a `resurfaced: true` flag and `firstObservedAt` pointing to the original first observation.
7. THE Issue_Engine SHALL NOT mutate metrics, proposals, or registry entries. It reads and emits only.

### Requirement 24: Metrics bindings drive lifecycle and admission decisions

**User Story:** As a platform admin, I want the runtime to use metrics when making lifecycle and admission decisions so that governance is not just a dashboard.

#### Acceptance Criteria

1. WHEN `capabilities.governance.approveProposal` is invoked and the proposal targets an L2 pack whose matching `capabilityId` already has a `high_error_rate` or `fallback_spam` issue from the Issue_Engine, THE Gateway_Handler SHALL require `{ packSignoff: true }` to proceed; otherwise it SHALL reject with an error that names the issue.
2. WHEN `capabilities.governance.updateLifecycle` is invoked with target state `active` and the manifest has an open `unsigned_external` issue, THE Gateway_Handler SHALL reject the transition and require the caller to first resolve the signature or acknowledge the issue.
3. WHEN `capabilities.governance.updateDistribution` is invoked to broaden scope (from tenant-scoped to `defaultEnabled: true` across all tenants) on a capability carrying a `high_error_rate` issue, THE Gateway_Handler SHALL require `{ overrideUnhealthy: true }` and record the override in the distribution `updatedBy` metadata as `"<reviewerId> (override:unhealthy)"`.
4. THE Issue_Engine SHALL expose the pure predicates `shouldBlockPromotion(manifestId)`, `shouldBlockLifecycleActivation(manifestId)`, and `shouldWarnScopeBroadening(manifestId)` used by the handlers above. They SHALL be testable in isolation without gateway I/O.
5. WHERE no issue matches, THE Gateway_Handler SHALL behave exactly as Phase 1 specified (Requirements 5, 6, 14–17 still hold).

### Requirement 25: Distribution Policy V2 supersets Phase 1 scope

**User Story:** As a platform admin, I want distribution to be policy-based (tenants, plans, regions, roles, beta, approval-required, rollout stage) so that it matches real multi-tenant, multi-region, tiered-pricing deployments.

#### Acceptance Criteria

1. THE Governance_Store SHALL serialize distribution as a `DistributionPolicyV2` shape with the fields listed in the Glossary. The existing fields `{ capabilityId, scope, defaultEnabled, updatedAt, updatedBy? }` SHALL remain at the same JSON keys so Phase 1 reads continue to parse.
2. WHEN `capabilities.governance.updateDistribution` is invoked with any combination of `{ scope, planIds?, regionIds?, restrictedToRoles?, beta?, requiresApproval?, defaultEnabled?, rolloutStage? }`, THE Gateway_Handler SHALL merge the provided fields into the current policy and preserve unspecified fields.
3. WHEN `rolloutStage` transitions from `off` → `canary` → `staged` → `ga` in order, THE Gateway_Handler SHALL accept the transition; any other direction (e.g. `ga` → `off`, `staged` → `canary`) SHALL require `{ rolloutOverride: true }`.
4. IF `beta` is `true` and `rolloutStage !== "ga"`, THEN the asset SHALL be treated as beta in the view model (`CapabilityAsset.beta = true`) and the UI SHALL render a beta badge; `ga` beta is a contradiction and the handler SHALL reject with `INVALID_REQUEST`.
5. WHERE `requiresApproval` is `true`, THE Governance_Runtime SHALL require tenant-side consumption to enter a separate approval flow (out of scope for this spec) but the flag SHALL be persisted and returned by `listAssets` so downstream tooling can act on it.
6. THE field `restrictedToRoles?: string[]` SHALL be enforced at access-check time on the tenant side; for this spec the platform SHALL only persist it. No role enforcement is implemented on invocation in Phase 2.
7. Phase 1 callers that supply only `{ scope, defaultEnabled }` SHALL keep working: the handler SHALL fill `rolloutStage = "ga"` and leave all other V2 fields unset.

### Requirement 26: Discovery metadata includes owner, taxonomy, signature hints

**User Story:** As a platform admin, I want discovered proposals to arrive with owner and taxonomy hints so that I can triage the pool without reopening each package.

#### Acceptance Criteria

1. WHEN the npm adapter produces a proposal, THE adapter SHALL populate `manifest.owner` from the npm package `author`/`maintainers` field when available, and `manifest.taxonomy` from the package keywords matching the known taxonomy set (`coding`, `retrieval`, `image`, `browser`, `workflow`, `messaging`, `storage`, `other`).
2. WHEN the GitHub Topic adapter produces a proposal, THE adapter SHALL populate `manifest.owner` from the repository `owner.login`, and `manifest.taxonomy` from repository topics intersected with the known taxonomy set.
3. WHEN either adapter finds a signature or provenance attestation, THE adapter SHALL set `manifest.signatureStatus` to `"verified" | "unsigned" | "unknown"`; defaults to `"unknown"`.
4. THE `SecurityFinding` typosquat heuristic (Phase 1) SHALL continue to fire regardless of the new metadata fields.
5. IF an adapter cannot populate `owner` or `taxonomy`, THEN it SHALL leave the field `undefined` rather than inventing a placeholder.

### Requirement 27: Overview section surfaces KPIs and alerts

**User Story:** As a platform admin, I want an overview landing that tells me capability count, top-used, unhealthy, pending review, and governance alerts so that I get situational awareness in one glance.

#### Acceptance Criteria

1. THE Governance_Runtime SHALL expose a `capabilities.governance.getOverview` gateway method under `operator.read` scope returning `{ totals: { total, active, pendingReview, deprecated, retired }, topUsed: AssetSummary[5], unhealthy: AssetSummary[5], pendingReview: ProposalSummary[5], alerts: { critical, high, medium, low } }`.
2. `topUsed` SHALL be ranked by `invocationCount` descending across the last 30 days; `unhealthy` SHALL be ranked by `errorRate` descending among assets with `invocationCount >= 20`.
3. THE Overview SHALL aggregate alert counts from `listIssues` grouped by severity; this aggregation SHALL match `listIssues` counts exactly for the same point-in-time read.
4. WHERE no metrics exist, the Overview SHALL return empty arrays for `topUsed` and `unhealthy` instead of raising an error.

### Requirement 28: Usage analytics gateway method

**User Story:** As a platform admin, I want per-tenant, per-task-type, per-pack usage analytics so that I can reason about adoption patterns.

#### Acceptance Criteria

1. THE Governance_Runtime SHALL expose a `capabilities.governance.getUsageAnalytics` gateway method under `operator.read` scope accepting `{ dimension: "capability" | "tenant" | "taxonomy" | "pack", windowDays?: 7 | 30 | 90 }`.
2. WHEN `dimension === "capability"`, THE method SHALL return per-capability `{ capabilityId, invocationCount, errorCount, activeTenantCount, costTotal, trendCountsByDay[] }`.
3. WHEN `dimension === "tenant"`, THE method SHALL return per-tenant `{ tenantId, topCapabilities[5], totalCost, errorRate }`.
4. WHEN `dimension === "taxonomy"`, THE method SHALL return per-taxonomy `{ taxonomy, capabilityCount, invocationCount }`.
5. WHEN `dimension === "pack"`, THE method SHALL return per-pack `{ packId, invocationCount, adoptionCount, fallbackRate }` where a fallback is counted when a pack step invoked a declared fallback capability.
6. IF telemetry lacks the requested dimension (e.g. no `tenantId` attached), THEN the method SHALL return an empty list and SHALL NOT fabricate zero-row placeholders.
7. THE method SHALL complete within 1 second on a metrics file of up to 10 000 capabilityIds on a typical developer laptop; otherwise the response SHALL include `truncated: true` and cap entries at 500.

### Requirement 29: Owner and audit metadata are writable

**User Story:** As a platform admin, I want to set `owner` and `lastAuditedAt` on a capability so that the issue engine can reliably flag missing owners and overdue reviews.

#### Acceptance Criteria

1. THE Governance_Runtime SHALL expose a `capabilities.governance.updateOwnership` gateway method under `operator.admin` scope accepting `{ manifestId, owner?, lastAuditedAt? }`.
2. WHEN called with `owner`, THE Gateway_Handler SHALL persist it in the registry entry’s `manifest.owner` field.
3. WHEN called with `lastAuditedAt`, THE Gateway_Handler SHALL persist it as an ISO-8601 timestamp string and emit a lifecycle event of kind `audited` with `{ actor, at }`.
4. IF neither field is provided, THEN the handler SHALL reject with `INVALID_REQUEST`.
5. WHEN ownership changes, THE Issue_Engine SHALL remove any active `missing_owner` issue for that `capabilityId` on the next refresh (no manual acknowledgement required).

### Requirement 30: Audit log for governance writes

**User Story:** As a platform admin, I want every governance write to produce an audit entry so that I can trace who approved, rejected, deprecated, or retargeted a capability.

#### Acceptance Criteria

1. THE Governance_Runtime SHALL maintain an append-only audit log at `~/.openclaw/governance/audit.log` (JSON Lines) containing `{ atMs, actor, method, params: { targetId, fields }, outcome: "ok" | "error", errorCode? }`.
2. WHEN any of `submitProposal`, `approveProposal`, `rejectProposal`, `updateLifecycle`, `updateDistribution`, `updateOwnership`, `acknowledgeIssue` succeeds or fails, THE Gateway_Handler SHALL append one line to the audit log.
3. THE audit line SHALL exclude secrets; any fields whose manifest schema marks them as sensitive (`apiKey`, `env.*_TOKEN`, `env.*_SECRET`) SHALL be replaced by `"[redacted]"` before writing.
4. THE Governance_Runtime SHALL expose a `capabilities.governance.tailAudit` gateway method under `operator.read` scope accepting `{ limit?: number, sinceMs?: number, methodFilter?: string }` returning the last N entries in reverse chronological order.
5. IF the audit log file cannot be written, THEN the gateway handler SHALL still return the underlying RPC result (write success MUST NOT depend on audit write success), and the Governance_Runtime SHALL log a warning.

### Requirement 31: Capability Center IA upgrade with deep-link compatibility

**User Story:** As a platform admin, I want the Platform Capabilities page to be organized as a Capability Center so that the information architecture matches how I work rather than how the data is stored.

#### Acceptance Criteria

1. THE Platform Capabilities page SHALL, once Phase 2 ships, render six sections in order: `overview`, `assets`, `intake`, `distribution`, `usageHealth`, `governance`.
2. EACH section SHALL map to the data sources as follows:
   - `overview` ← `getOverview`
   - `assets` ← `listAssets` (filterable by `kind`, `taxonomy`, `lifecycleState`, `owner`, `search`)
   - `intake` ← `listProposals` with admission-gate annotations plus discovery controls
   - `distribution` ← `listAssets` projected onto tenants × assets; write path `updateDistribution`
   - `usageHealth` ← `getUsageAnalytics` + `listIssues` filtered to health categories
   - `governance` ← `listIssues` + `tailAudit` + `updateOwnership` + `acknowledgeIssue`
3. DEEP-LINK compatibility: URLs referencing the Phase 1 tabs `#platform-capabilities:catalog`, `:installed`, `:discovery`, `:distribution`, `:health` SHALL redirect to `:assets`, `:assets`, `:intake`, `:distribution`, `:usageHealth` respectively, preserving any `?filter=` parameters.
4. ALL Phase 1 action controls (approve, reject, promote, revoke, deprecate, retire) SHALL remain reachable from the new IA: approve/reject in `intake`; promote/revoke in `distribution`; deprecate/retire in `governance` (and also accessible from the asset detail drawer in `assets`).
5. THE new IA SHALL be feature-flagged behind `OPENBOT_CAPABILITY_CENTER=1` (or config flag `platform.capabilityCenter.enabled`) until Phase 2 is stable; when the flag is off, the Phase 1 5-tab layout SHALL render unchanged.

### Requirement 32: Accessibility and Read-Operator parity on the new surfaces

**User Story:** As a read-only operator, I want to open the Capability Center and see the same state the admin sees, minus the write controls, so that I can triage issues without edit rights.

#### Acceptance Criteria

1. WHERE the operator session carries only `operator.read`, THE Governance_Client SHALL render all read-only sections (overview, assets list, detail drawer, intake list, distribution matrix view, usage/health, governance issue list, audit tail).
2. WHERE the operator session carries only `operator.read`, THE Governance_Client SHALL disable or hide controls that dispatch admin-scope RPCs and render a tooltip explaining the scope gap.
3. THE new surfaces SHALL maintain the existing keyboard navigation and ARIA roles present on the Phase 1 tabs (`role="tablist"`, `role="tab"`, `aria-selected`) and extend them to the six new sections.
4. Color coding for severity (`low`, `medium`, `high`, `critical`) SHALL meet WCAG 2.1 AA contrast when combined with the existing palette; when this cannot be verified automatically, the design task SHALL document the manual color check.

### Requirement 33: Admission gate and metrics bindings are unit-testable in isolation

**User Story:** As a platform developer, I want admission-gate and metrics-binding logic to be pure functions so that I can exercise them with property-based tests without spinning up a gateway.

#### Acceptance Criteria

1. THE Pack_Admission_Gate SHALL be exported as a pure function `classifyPack(manifest): PackClassification` from `src/gateway/capability-governance-admission.ts`, with no file I/O.
2. THE Issue_Engine predicates (`shouldBlockPromotion`, `shouldBlockLifecycleActivation`, `shouldWarnScopeBroadening`) SHALL accept the relevant subset of `{ metrics, proposal, registryEntry, existingIssues }` as parameters and return a boolean + optional `Issue`; they SHALL not read JSON files directly.
3. THE `Capability_Asset_Store` join SHALL be exported as a pure function `buildAssets({ proposals, registry, metrics }): CapabilityAsset[]` with no I/O; the gateway handler is a thin wrapper that loads the three stores and calls this.
4. Unit tests SHALL exist for each of the functions in 33.1–33.3, seeded from generators that mirror the Phase 1 types.

### Requirement 34: Performance budget for list endpoints

**User Story:** As a platform admin, I want list endpoints to feel instant on real fleets so that the Capability Center stays usable at scale.

#### Acceptance Criteria

1. `listAssets` SHALL complete within 300 ms on a fleet with 500 registered capabilities and 5 000 metric aggregates on a developer laptop; failures SHALL be logged with the observed duration.
2. `listIssues` SHALL complete within 500 ms on the same fleet size and SHALL support result caps: a `limit?: number` parameter capped at 500 with `{ total, truncated }` in the response.
3. `getUsageAnalytics` SHALL complete within 1 s per Requirement 28.7.
4. THE Metrics_Store SHALL be loaded lazily per-request with an in-memory cache invalidated on write; cache hits SHALL complete in under 50 ms.

### Requirement 35: Phase 2 surfaces preserve Phase 1 correctness

**User Story:** As a platform developer, I want Phase 2 additions to leave Phase 1 guarantees intact so that we can land Phase 2 incrementally without regressing Phase 1.

#### Acceptance Criteria

1. ALL Phase 1 requirements (1–20) SHALL continue to pass their acceptance criteria after Phase 2 ships.
2. ALL Phase 1 correctness properties (P1–P15) SHALL continue to hold on the store and admission gate under Phase 2 wiring.
3. WHERE Phase 2 adds fields to an existing JSON file (e.g. `DistributionPolicyV2` fields in `registry.json`), the Phase 1 reader SHALL ignore unknown fields without erroring.
4. WHERE Phase 2 introduces a new file (`issues-ack.json`, `audit.log`), its absence SHALL NOT break Phase 1 code paths.

## Correctness Properties for Property-Based Testing

This section captures properties to be covered by property-based tests. They are not additional acceptance criteria; they are restatements of the testable behavior above in a form suitable for generators.

### Round-trip properties

- P1 (Requirement 10): FOR ALL generated `GovernanceProposal` values, `listProposals` after `submitProposal(p)` contains a proposal deep-equal to `p` modulo store-managed fields.
- P2 (Requirement 10): FOR ALL generated `GovernanceRegistryEntry` values, `listRegistry` after `registerCapability(entry.manifest, entry.proposalId)` contains an entry whose `manifest` is deep-equal to the input manifest.
- P3 (Requirement 10): FOR ALL generated proposals, `JSON.parse(JSON.stringify(p))` round-trips to a value deep-equal to `p`.

### Idempotence properties

- P4 (Requirement 8, 18): FOR ALL proposals, invoking `approveAndRegister(p.proposalId, reviewer)` twice produces the same final registry state as invoking it once (no duplicate registry entries).
- P5 (Requirement 18): FOR ALL pack manifests `m`, `classifyPack(m) === classifyPack(m)` and `classifyPack(deepClone(m)) === classifyPack(m)`.
- P6 (Requirement 12): FOR ALL event sequences `E`, applying `E` twice in sequence yields an aggregate whose `invocationCount` equals twice the invocation count after applying `E` once, and `errorCount` equals twice the error count.

### Metamorphic properties

- P7 (Requirement 8): FOR ALL proposal ids, given two sequential updates `updateProposalStatus(id, s1)` then `updateProposalStatus(id, s2)`, the final status equals `s2`.
- P8 (Requirement 18): FOR ALL pack manifests `m`, if `m'` is derived from `m` by dropping a classification input, then `classifyPack(m') === "L1"`.

### Invariant properties

- P9 (Requirement 11, 12): FOR ALL event sequences, `errorCount <= invocationCount` holds after aggregation.
- P10 (Requirement 12): FOR ALL event sequences, `p95LatencyMs` is either `null` (no samples) or within `[min(sample), max(sample)]` of the bounded sample buffer.
- P11 (Requirement 19): FOR ALL method names under `capabilities.governance.*`, the result of `resolveRequiredOperatorScopeForMethod(method)` equals either `READ_SCOPE` (for list methods) or `ADMIN_SCOPE` (for write methods).

### Error condition properties

- P12 (Requirement 10): FOR ALL malformed JSON blobs, `listProposals()` returns `[]` and does not throw.
- P13 (Requirement 3, 4, 5, 6): FOR ALL invalid `proposalId` values, write RPCs return an error shape without mutating the store.
- P14 (Requirement 14): FOR ALL L0 pack manifests, `submitProposal` returns an error and `listProposals()` does not contain the proposal.
- P15 (Requirement 17): FOR ALL L3 pack manifests, `approveProposal` without `{ packSignoff: true }` returns an error and the proposal status is unchanged.

### Phase 2 properties

#### Asset aggregation properties

- P16 (Requirement 21): FOR ALL `(proposals, registry, metrics)` triples, `buildAssets(proposals, registry, metrics).length <= registry.length + proposals.length` (no phantom assets).
- P17 (Requirement 21): FOR ALL registry entries `e`, `buildAssets(…)` contains exactly one asset with `capabilityId === e.manifest.id`.
- P18 (Requirement 21): FOR ALL assets `a` where `metrics` contains a matching entry `m`, `a.health.invocationCount === m.invocationCount` and `a.health.errorCount === m.errorCount`.

#### Issue engine properties

- P19 (Requirement 23): FOR ALL `(assets, metrics)` inputs, the Issue_Engine is deterministic: `listIssues(input) === listIssues(deepClone(input))`.
- P20 (Requirement 23): FOR ALL assets with `errorRate <= 0.05`, the Issue_Engine SHALL NOT emit a `high_error_rate` issue for that asset.
- P21 (Requirement 23): FOR ALL assets with `lifecycleState === "deprecated"` and `invocationCount > 0` in the last 7 days, the Issue_Engine SHALL emit a `deprecated_but_active` issue.
- P22 (Requirement 23): FOR ALL acknowledged issues older than 30 days, the Issue_Engine SHALL resurface them with `resurfaced: true`.

#### Distribution policy properties

- P23 (Requirement 25): FOR ALL `DistributionPolicyV2` values, writing via `updateDistribution` then reading via `listRegistry` SHALL return a policy whose Phase 1 fields (`scope`, `defaultEnabled`) are preserved.
- P24 (Requirement 25): FOR ALL rollout transitions, `off → canary → staged → ga` are accepted; any reverse direction without `rolloutOverride: true` is rejected.
- P25 (Requirement 25): FOR ALL policies where `beta === true` and `rolloutStage === "ga"`, `updateDistribution` SHALL reject with `INVALID_REQUEST`.

#### Metrics binding properties

- P26 (Requirement 24): FOR ALL proposals targeting a pack with an active `high_error_rate` issue, `approveProposal` without `{ packSignoff: true }` SHALL return an error.
- P27 (Requirement 24): FOR ALL registry entries with an active `unsigned_external` issue, `updateLifecycle(manifestId, "active")` SHALL return an error.
- P28 (Requirement 24): WHERE no issue matches, the handler SHALL behave identically to Phase 1 (P4 still holds).

#### Audit log properties

- P29 (Requirement 30): FOR ALL successful governance writes, the audit log SHALL contain exactly one new line whose `method` matches the invoked RPC.
- P30 (Requirement 30): FOR ALL audit lines, no field value SHALL contain a raw secret (any value matching `/(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL)=/i` in the params SHALL be `"[redacted]"`).

#### Performance invariant properties

- P31 (Requirement 34): FOR ALL generated datasets of 500 registry entries + 5000 metrics, `buildAssets` completes in under 300 ms (wall-clock, single-threaded).

#### Backward compatibility properties

- P32 (Requirement 35): FOR ALL Phase 1 test fixtures, Phase 2 code paths SHALL produce outputs that satisfy P1–P15 unchanged.
- P33 (Requirement 35): FOR ALL `registry.json` files written by Phase 1, Phase 2 readers SHALL parse them without error (unknown-field tolerance).
