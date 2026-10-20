# OpenBot Capability Installation Governance Acceptance Report

Date: 2026-05-28

## Verdict

Do not accept the implementation as complete.

The team has closed several visible gaps from the rework checklist, especially around required `targetRobotId` fields, targeted runtime sync, external scan gates, and a shared enterprise submission lane. However, the implementation still does not satisfy the product and engineering completion bar in the two source plans.

The main remaining problem is not absence of code. The current state is a partial integration with several production-critical paths still backed by stub or in-memory state, and with key UX paths still routed through the wrong surface.

## Source Plans Reviewed

1. `docs/design/openbot-capability-installation-governance-r-and-d-task-breakdown-2026-05-28.md`
2. `docs/design/openbot-capability-installation-governance-rework-checklist-2026-05-28.md`

## Acceptance Matrix

| Item                                                                     | Status           | Evidence                                                                                                                                                                                         | Acceptance finding                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0-1 target robot ID is preserved                                        | Partially pass   | `ui/src/ui/ports/employee/render-model.ts:3415`, `ui/src/ui/ports/employee/render-model.ts:3651`, `src/gateway/server-methods/employee-install.ts:296`                                           | The selected robot ID is now carried into employee install requests. Product acceptance is still incomplete because the actual install buttons remain exposed as first-class actions in `My Assets`.                                                   |
| P0-2 employee install writes runtime binding                             | Partially pass   | `src/gateway/server-methods/employee-install.ts:438`                                                                                                                                             | `confirm` now calls runtime sync, but the install request and scan state still live in stub in-memory stores. This is not yet a real installation service.                                                                                             |
| P0-3 runtime sync targets the selected robot                             | Partially pass   | `src/gateway/runtime-binding-sync.ts:57`                                                                                                                                                         | The sync path targets `targetRobotId` when supplied. The fallback path still installs to an arbitrary tenant agent when no target is supplied, so callers must enforce target presence everywhere.                                                     |
| P0-4 Da Bai proxy and robot self-install use the unified install service | Fail             | `src/gateway/server-methods/agent-install-request.ts:190`                                                                                                                                        | Accepting a request directly calls `syncInstallToRuntime`. It does not create or continue an `employee-install` request and therefore bypasses the unified risk, scan, configuration, and confirmation chain.                                          |
| P0-5 enterprise platform submission requires sanitization                | Partially pass   | `src/gateway/server-methods/enterprise-capability.ts:2037`, `src/gateway/capability-install-governance-store.ts:83`                                                                              | The gate exists. The sanitization workflow itself is still seeded/static and marks all findings resolved in one operation, so this is not a production-grade sanitization workbench.                                                                   |
| P0-6 enterprise submission and platform review share one record          | Partially pass   | `src/gateway/server-methods/enterprise-capability.ts:2054`, `src/gateway/server-methods/platform-capability.ts:33`                                                                               | Enterprise and platform handlers now read/write the same in-process submission store. Because the store is in-memory, this does not yet meet durable shared data-chain expectations.                                                                   |
| P1-1 My Robots is the main installation entry                            | Fail             | `ui/src/ui/views/my-accumulation.ts:554`                                                                                                                                                         | `My Assets` still renders direct install buttons for platform, enterprise, and external sources. This conflicts with the product invariant that `My Robots` is the main installation entry and `My Assets` is the record, reuse, and upstream surface. |
| P1-2 pending configuration blocks first use                              | Partially pass   | `src/gateway/server-methods/employee-install.ts:454`                                                                                                                                             | Pending configuration attempts to disable the binding. There is no integrated proof that actual robot invocation is blocked with a pending-configuration reason and restored after configuration.                                                      |
| P1-3 governance events are produced by real install behavior             | Partially pass   | `src/gateway/server-methods/employee-install.ts:471`, `src/gateway/server-methods/enterprise-capability.ts:1760`                                                                                 | Events are now recorded and listed from a shared store. They lack durable storage and do not reliably include full enterprise, binding, and governance state traceability.                                                                             |
| P1-4 external scan result controls install decision                      | Pass with caveat | `src/gateway/server-methods/employee-install.ts:308`, `src/gateway/server-methods/employee-install.ts:412`                                                                                       | External/local installs require a scan result and re-check it during confirm. The scan record is still in-memory and keyed only by content hash, so persistence and tenant scoping remain follow-up risks.                                             |
| P1-5 platform publish reaches capability governance registry             | Partially pass   | `src/gateway/server-methods/platform-capability.ts:123`                                                                                                                                          | Publish calls `registerCapability`. The review flow still lacks complete platform actions and durable provenance.                                                                                                                                      |
| P2-1 closed-loop tests prove real cross-module state                     | Fail             | `src/gateway/server-methods/employee-install.test.ts:174`, `src/gateway/server-methods/capability-install-governance.test.ts:251`, `src/gateway/server-methods/agent-install-request.test.ts:79` | Tests are mostly handler-level and stub-state assertions. They do not prove the minimum E2E cases from the checklist, especially target runtime binding, Da Bai through unified install, and invocation blocking.                                      |
| P2-3 platform review supports all required decisions                     | Fail             | `src/gateway/server-methods/platform-capability.ts:90`, `src/gateway/server-methods/platform-capability.ts:166`                                                                                  | The platform handler supports publish and reject, but not return-for-modification or enterprise-only as first-class review outcomes.                                                                                                                   |
| P2-5 employee installation UX uses formal dialogs                        | Fail             | `ui/src/ui/ports/employee/render-model.ts:3417`, `ui/src/ui/ports/employee/render-model.ts:3434`, `ui/src/ui/ports/employee/render-model.ts:3449`                                                | The flow still uses `alert` and `confirm`, not the structured preflight, risk, configuration, and result dialogs required by the plan.                                                                                                                 |

## Critical Findings

### 1. The implementation still exposes the wrong primary installation surface

`My Assets` continues to present direct install buttons in the asset detail install tab:

- `ui/src/ui/views/my-accumulation.ts:554`
- `ui/src/ui/views/my-accumulation.ts:559`
- `ui/src/ui/views/my-accumulation.ts:565`
- `ui/src/ui/views/my-accumulation.ts:571`

This violates two agreed product decisions:

1. `My Robots` is the main employee installation entry.
2. `My Assets` is the accumulation, record, and upstream submission center.

Required rework:

Move first-class install initiation back to robot cards and robot detail. In `My Assets`, keep only secondary actions such as configure, view history, install to another robot after an explicit target robot selection, submit to enterprise, and submit as platform candidate.

Reacceptance standard:

Starting a new install from a robot card or robot detail must preserve that robot ID through `employee-install.create-request`, runtime binding, install history, and governance event records. `My Assets` must not present source-specific install buttons as the primary path.

### 2. Da Bai proxy install bypasses the unified employee install service

`agent-install.request-accept` changes request state and then directly calls runtime sync:

- `src/gateway/server-methods/agent-install-request.ts:185`
- `src/gateway/server-methods/agent-install-request.ts:190`
- `src/gateway/server-methods/agent-install-request.ts:194`

This is not the same as entering the unified employee installation workflow. It bypasses shared request creation, risk preview, external scan enforcement, configuration requirements, and the install request history model.

Required rework:

On target robot acceptance, create or resume a unified install request with source provenance indicating Da Bai proxy or robot self-install. The final binding must be traceable back to the unified install request ID.

Reacceptance standard:

Da Bai sends an install request, the target robot accepts, the unified install request advances through the same preflight/configuration/install chain as employee install, and the resulting runtime binding carries traceable request/provenance metadata.

### 3. Core governance data is still in process memory

The implementation uses process-local maps and arrays for critical state:

- `src/gateway/server-methods/employee-install.ts:104`
- `src/gateway/server-methods/employee-install.ts:115`
- `src/gateway/capability-install-governance-store.ts:36`
- `src/gateway/capability-install-governance-store.ts:130`
- `src/gateway/capability-install-governance-store.ts:223`

This means install requests, scan results, sanitization sessions, enterprise submissions, and governance events disappear on restart and cannot be treated as a reliable shared data chain.

Required rework:

Move these records into an existing durable gateway store pattern, or introduce a scoped persistent store with explicit tenant/user/robot keys. The store must be queryable by employee, target robot, enterprise admin, and platform review flows.

Reacceptance standard:

After gateway restart, install history, pending configuration, governance events, sanitization sessions, and platform submissions remain available and preserve the same IDs.

### 4. Pending configuration is not proven as a runtime block

Employee install confirm sets pending configuration and attempts to disable the binding:

- `src/gateway/server-methods/employee-install.ts:428`
- `src/gateway/server-methods/employee-install.ts:454`
- `src/gateway/server-methods/employee-install.ts:457`

This is a useful start, but the acceptance requirement is stronger: the robot must be unable to invoke the capability until configuration is complete, and users must see a clear pending-configuration reason.

Required rework:

Wire `configurationState` into runtime invocation gating and UI/runtime projections. Add an integration test that attempts invocation before and after `employee-install.apply-configuration`.

Reacceptance standard:

Before configuration, invocation fails with a pending-configuration reason. After configuration, the same binding becomes callable without changing target robot or install request identity.

### 5. Enterprise sanitization and platform submission are structurally connected but not complete

The platform submission gate is present:

- `src/gateway/server-methods/enterprise-capability.ts:2037`
- `src/gateway/capability-install-governance-store.ts:83`

The platform side reads from the shared submission store:

- `src/gateway/server-methods/platform-capability.ts:33`
- `src/gateway/server-methods/platform-capability.ts:58`

However, sanitization findings are seeded/static and confirmation resolves all findings at once:

- `src/gateway/server-methods/enterprise-capability.ts:1894`
- `src/gateway/server-methods/enterprise-capability.ts:1972`

Required rework:

Persist sanitization sessions, track each finding and replacement separately, require unresolved findings to be closed individually, generate a sanitized package artifact, and attach that artifact provenance to the platform submission.

Reacceptance standard:

Submitting without sanitization fails. Submitting with unresolved findings fails. Submitting after all findings are resolved creates a durable submission visible to platform review with sanitized package metadata.

### 6. The current tests do not prove the minimum reacceptance cases

The current tests exercise handlers, but they do not prove the system-level invariants:

- `src/gateway/server-methods/employee-install.test.ts:174` checks pending configuration response but not actual invocation blocking.
- `src/gateway/server-methods/agent-install-request.test.ts:79` checks request accept status but not unified install-service continuation.
- `src/gateway/server-methods/capability-install-governance.test.ts:251` is labeled as targeted runtime sync but does not assert a target runtime binding.

Required rework:

Add integration tests for the seven minimum scenarios in the rework checklist:

1. Install a platform capability from a specific robot card and verify target runtime binding.
2. Install external/local capability only after scan and enforce block results.
3. Install a capability requiring configuration and verify first-use blocking.
4. Send a Da Bai proxy request, accept on target robot, and verify unified install request and binding.
5. Install external capability and verify enterprise governance event.
6. Submit enterprise asset to platform only after sanitization and verify the same submission ID on platform.
7. Publish enterprise submission and verify the capability governance registry entry.

## What Can Be Credited

The following work should be retained and built on:

1. `targetRobotId` is now required in employee install RPC calls.
2. Runtime sync can target a specific runtime agent.
3. External/local installs now require a scan result and revalidate that result at confirm time.
4. Enterprise-to-platform submission now has a sanitization gate.
5. Enterprise and platform handlers now share the same submission store.
6. Platform publish attempts to register the accepted capability in the governance registry.
7. Governance events are no longer only a fixed static list.

## Required Rework Order

1. Remove primary install source buttons from `My Assets` and complete the robot-scoped install entry in `My Robots` and robot detail.
2. Replace `alert` and `confirm` with the formal install preflight, risk, configuration, and result dialogs.
3. Create a real installation service/store for install requests, scan results, configuration state, governance state, and binding provenance.
4. Route Da Bai proxy and robot self-install acceptance into that unified installation service.
5. Persist governance events, sanitization sessions, enterprise submissions, and scan results.
6. Wire pending configuration into actual runtime invocation gating.
7. Complete enterprise sanitization with per-finding resolution and sanitized package metadata.
8. Add platform review actions for return-for-modification and enterprise-only.
9. Add the seven closed-loop integration tests listed above.

## Reacceptance Gate

The implementation should only be resubmitted when all of the following are true:

1. All P0 items pass without caveats.
2. P1-1 through P1-5 pass without caveats.
3. The seven minimum closed-loop scenarios are covered by tests that verify real store state, runtime binding state, and cross-surface visibility.
4. Employee, enterprise, and platform views can display the same install or submission chain using the same durable IDs.
5. Manual QA can demonstrate robot-scoped install, Da Bai proxy install, pending-configuration blocking, enterprise governance event creation, sanitization-gated platform submission, and platform publication.
