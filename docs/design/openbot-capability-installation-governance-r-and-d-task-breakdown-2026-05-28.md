# OpenBot Capability Installation Governance R&D Task Breakdown

## Purpose

This document converts the previously agreed capability installation governance plan into an implementation-ready task breakdown for Kiro.

It is grounded in the current repository structure and follows six delivery tracks:

1. Frontend tasks
2. Gateway and RPC tasks
3. Data structure tasks
4. Test tasks
5. Delivery phases and milestones
6. Execution notes and handoff constraints

## Confirmed Product Decisions

The tasks below assume these decisions are already fixed:

1. Capability installation always lands on a target robot.
2. Robot self-install remains a first-class capability.
3. Da Bai can act as an installation proxy, but only by sending an installation request to the target robot.
4. Da Bai does not directly bind capabilities onto another robot.
5. `My Robots` is the main employee installation entry.
6. `My Assets` is the employee accumulation, record, and upstream submission center.
7. Enterprise governance is post-event by default, not pre-approval by default.
8. Enterprise-to-platform sharing requires mandatory sanitization.
9. Platform only accepts sanitized, generalized capability packages.

## Current Codebase Anchors

The implementation should build on these existing modules rather than replace them:

1. Employee workbench surface:
   `ui/src/ui/ports/employee/views/workbench-stage-module.ts`
   `ui/src/ui/ports/employee/render-model.ts`
   `ui/src/ui/ports/employee/render-model-workbench-actions.ts`
2. Employee capability domain:
   `ui/src/ui/capability/employee-capability/`
3. Enterprise capability domain:
   `ui/src/ui/capability/enterprise-capability/`
   `ui/src/ui/capability/enterprise-capability-usage-management/`
4. Runtime truth layer:
   `ui/src/ui/capability/runtime-canonical/`
   `ui/src/ui/capability/runtime-projection/`
5. Platform governance domain:
   `ui/src/ui/capability/capability-governance/`
   `ui/src/ui/ports/platform/capabilities/`
6. Gateway handlers:
   `src/gateway/server-methods/employee-capability.ts`
   `src/gateway/server-methods/enterprise-capability.ts`

## Track 1: Frontend Tasks

### 1.1 Employee UI tasks

#### FE-E1: Add robot-scoped installation entrypoints

Files:
`ui/src/ui/ports/employee/views/workbench-stage-module.ts`
`ui/src/ui/ports/employee/render-model.ts`

Tasks:

1. Add `Install Capability` action on each robot card in `My Robots`.
2. Add robot detail action group for:
   1. Install from platform marketplace
   2. Install from enterprise distribution
   3. Install from external or local source
3. Add visual badges for:
   1. Pending configuration
   2. Restricted
   3. Unverified external capability
   4. Disabled

Acceptance:

1. Employee can start installation from a specific robot.
2. No installation entrypoint is introduced as a top-level standalone action in `My Assets`.

#### FE-E2: Add employee installation flow UI package

New directory:
`ui/src/ui/capability/employee-install/`

New files:

1. `types.ts`
2. `endpoints.ts`
3. `gateway-client.ts`
4. `projection.ts`
5. `install-dialog.ts`
6. `risk-dialog.ts`
7. `configuration-dialog.ts`
8. `result-dialog.ts`

Tasks:

1. Build a robot-targeted installation confirmation dialog.
2. Build source-specific risk messaging.
3. Build installation preflight summary view:
   1. target robot
   2. capability source
   3. risk level
   4. required permissions
   5. required configuration
4. Build first-use block state for missing configuration.

Acceptance:

1. Employee sees a consistent preflight flow regardless of entry source.
2. Installation can complete into `pending configuration` rather than only `installed` or `failed`.

#### FE-E3: Add Da Bai proxy installation UX

Files:
`ui/src/ui/ports/employee/render-model-workbench-actions.ts`
Related chat action layer where capability actions are surfaced

Tasks:

1. Add a structured `proxy install request` action from Da Bai conversations.
2. Render the proxy flow as:
   1. target robot selection
   2. candidate capability review
   3. send request to robot
   4. await robot decision
3. Distinguish proxy request states:
   1. sent
   2. robot reviewing
   3. accepted
   4. rejected
   5. alternative suggested

Acceptance:

1. Da Bai can initiate an install request for another robot.
2. The UI never suggests Da Bai has directly installed the capability onto another robot.

#### FE-E4: Extend My Assets as record and accumulation center

Files:
`ui/src/ui/capability/employee-capability/types.ts`
`ui/src/ui/capability/employee-capability/projection.ts`
`ui/src/ui/views/my-accumulation.ts`

Tasks:

1. Add fields and display for:
   1. installation source
   2. bound robots
   3. configuration status
   4. governance status
   5. enterprise submission status
2. Add actions:
   1. Configure now
   2. Install to another robot
   3. Submit to enterprise
   4. Submit as platform candidate
3. Add filters:
   1. pending configuration
   2. externally sourced
   3. enterprise-reviewed
   4. platform-candidate

Acceptance:

1. `My Assets` shows install history and lifecycle.
2. `My Assets` remains a management and accumulation surface, not the only installation surface.

### 1.2 Enterprise UI tasks

#### FE-EN1: Add governance event center

Suggested new directory:
`ui/src/ui/capability/enterprise-governance-events/`

Suggested integration files:
`ui/src/ui/ports/enterprise/views/enterprise-capability-center-surface.ts`

Tasks:

1. Add enterprise view for employee capability update events.
2. Render event table columns:
   1. employee
   2. robot
   3. capability
   4. source type
   5. risk level
   6. permission profile
   7. current runtime state
   8. external verification state
3. Add enterprise governance actions:
   1. Disable
   2. Restrict by position
   3. Require review
   4. Certify into enterprise assets
   5. Escalate to sanitization for platform submission

Acceptance:

1. Enterprise admins can see post-install governance events.
2. External capability events do not expose more detail than policy allows.

#### FE-EN2: Add enterprise sanitization workbench

Suggested new directory:
`ui/src/ui/capability/enterprise-sanitization/`

Tasks:

1. Build enterprise upstream submission editor.
2. Show sanitization scan findings:
   1. company names
   2. customer data
   3. internal endpoints
   4. secrets
   5. internal KB references
   6. employee and department labels
3. Provide replacement and generalization UI.
4. Add final enterprise confirmation step before submit-to-platform.

Acceptance:

1. Enterprise admins cannot send raw enterprise capability packages directly to platform.
2. Sanitization status is visible and actionable.

### 1.3 Platform UI tasks

#### FE-P1: Extend platform governance for enterprise submissions

Files:
`ui/src/ui/capability/capability-governance/types.ts`
`ui/src/ui/ports/platform/capabilities/page.ts`
`ui/src/ui/ports/platform/render-actions.ts`

Tasks:

1. Add enterprise-origin submission lane to capability governance UI.
2. Show sanitization completeness and source provenance.
3. Add review actions:
   1. publish
   2. reject
   3. return for modification
   4. restrict to enterprise-only

Acceptance:

1. Platform operators can distinguish external marketplace proposals from enterprise upstream submissions.
2. Enterprise submissions carry sanitized-package review metadata.

## Track 2: Gateway and RPC Tasks

### 2.1 Employee installation RPC tasks

Suggested new gateway handler:
`src/gateway/server-methods/employee-install.ts`

Suggested UI endpoint file:
`ui/src/ui/capability/employee-install/endpoints.ts`

Methods to add:

1. `employee-install.list-sources`
2. `employee-install.scan-external`
3. `employee-install.preview-risk`
4. `employee-install.create-request`
5. `employee-install.confirm`
6. `employee-install.check-configuration`
7. `employee-install.apply-configuration`
8. `employee-install.history`

Tasks:

1. Add request validation schemas.
2. Add source-aware install preflight service.
3. Add risk evaluation contract.
4. Add configuration requirement check contract.

Acceptance:

1. The UI can complete end-to-end installation flows through typed RPC methods.
2. External and local installs must pass through scanning before install confirmation.

### 2.2 Cross-robot request RPC tasks

Suggested new gateway handler:
`src/gateway/server-methods/agent-install-request.ts`

Methods to add:

1. `agent-install.request-send`
2. `agent-install.request-review`
3. `agent-install.request-accept`
4. `agent-install.request-reject`
5. `agent-install.request-suggest-alternative`

Tasks:

1. Define structured payload for Da Bai proxy requests and robot self-install requests.
2. Store request status transitions.
3. Route target robot review actions back to request initiator and employee UI.

Acceptance:

1. Da Bai can send a typed request to a target robot.
2. Target robot can accept, reject, or suggest an alternative without direct binding side effects until install confirm.

### 2.3 Enterprise RPC tasks

Extend:
`src/gateway/server-methods/enterprise-capability.ts`

Methods to add:

1. `enterprise-capability.governance-events`
2. `enterprise-capability.governance-action`
3. `enterprise-capability.external-filings`
4. `enterprise-capability.sanitization-preview`
5. `enterprise-capability.sanitization-confirm`
6. `enterprise-capability.submit-to-platform`

Tasks:

1. Add governance event query and filtering.
2. Add action endpoints for restrict, disable, and review escalation.
3. Add sanitization preview contract.
4. Add enterprise upstream submission contract.

Acceptance:

1. Enterprise UI can retrieve and act on governance events.
2. Enterprise upstream requires sanitization methods before submission.

### 2.4 Platform RPC tasks

Suggested new or extended handler:
`src/gateway/server-methods/platform-capability.ts`
or extend capability governance gateway path if already centralized

Methods to add:

1. `platform-capability.enterprise-submissions`
2. `platform-capability.review-enterprise-submission`
3. `platform-capability.publish-enterprise-capability`
4. `platform-capability.reject-enterprise-capability`

Acceptance:

1. Platform can review enterprise submissions without overloading generic marketplace proposal logic.

## Track 3: Data Structure Tasks

### 3.1 Runtime canonical model extension

Files:
`ui/src/ui/capability/runtime-canonical/types.ts`
`ui/src/ui/capability/runtime-projection/projection.ts`

Tasks:

1. Keep existing `BindingType` intact for compatibility.
2. Add new source detail field for tenant-installed bindings:

```ts
type TenantInstallSource =
  | "employee-platform-market"
  | "employee-enterprise-distributed"
  | "employee-external-local"
  | "dabai-proxy-request"
  | "robot-self-install"
  | "admin-push";
```

3. Add binding-level fields:
   1. `tenantInstallSource?: TenantInstallSource`
   2. `configurationState`
   3. `governanceState`
   4. `installRequestId?`
4. Update runtime projections so enterprise and employee surfaces can use these fields without breaking existing terminology mapping.

Acceptance:

1. Existing `tenant-installed` projection keeps working.
2. New UIs can distinguish how tenant-installed happened.

### 3.2 Employee capability model extension

Files:
`ui/src/ui/capability/employee-capability/types.ts`
`ui/src/ui/capability/employee-capability/projection.ts`

Tasks:

1. Add fields:
   1. `installSource`
   2. `configurationState`
   3. `governanceState`
   4. `boundRobotIds`
   5. `installRequestHistory`
   6. `sanitizationState?`
2. Keep old fields stable where used by existing projections and tests.

Acceptance:

1. Employee accumulation can represent installed capability lifecycle precisely.

### 3.3 Installation request model

Suggested new files:
`ui/src/ui/capability/employee-install/types.ts`
`src/gateway/models/capability-install-request.ts`

Tasks:

1. Define request model for:
   1. user direct install
   2. Da Bai proxy request
   3. robot self-install
2. Define request lifecycle timestamps and actor attribution.

### 3.4 Enterprise sanitization model

Suggested new files:
`src/gateway/models/enterprise-sanitization.ts`
`ui/src/ui/capability/enterprise-sanitization/types.ts`

Tasks:

1. Define sanitization state enum.
2. Define finding model.
3. Define generalized output package model.

## Track 4: Test Tasks

### 4.1 Frontend unit and property tests

Employee:

1. Add tests for employee install dialog state transitions.
2. Add tests for proxy request rendering and status updates.
3. Add tests for `My Assets` filters and badges.

Enterprise:

1. Add tests for governance event table rendering.
2. Add tests for governance actions and disabled states.
3. Add tests for sanitization findings display.

Platform:

1. Add tests for enterprise submission review lanes.
2. Add tests for publish and reject action states.

Suggested test file locations:

1. `ui/src/ui/capability/employee-install/*.test.ts`
2. `ui/src/ui/capability/enterprise-governance-events/*.test.ts`
3. `ui/src/ui/capability/enterprise-sanitization/*.test.ts`
4. `ui/src/ui/ports/platform/capabilities/*.test.ts`

### 4.2 Gateway handler tests

Files to add:

1. `src/gateway/server-methods/employee-install.test.ts`
2. `src/gateway/server-methods/agent-install-request.test.ts`
3. `src/gateway/server-methods/enterprise-capability.governance.test.ts`
4. `src/gateway/server-methods/platform-capability.test.ts`

Test coverage:

1. request validation
2. risk preflight branching
3. target robot review flow
4. enterprise governance actions
5. sanitization enforcement before submit-to-platform

### 4.3 Projection and model tests

Files to update or add:

1. `ui/src/ui/capability/runtime-canonical/__tests__/projection.property.test.ts`
2. `ui/src/ui/capability/capability-governance/normalizer.test.ts`
3. employee capability projection tests

Coverage:

1. `tenant-installed` backward compatibility
2. new install-source detail propagation
3. governance state projection
4. configuration state projection

### 4.4 End-to-end scenario tests

Suggested scenarios:

1. Employee installs platform capability onto owned robot.
2. Employee installs external capability, scan returns medium risk, install continues with warning.
3. Employee installs capability, install lands in `pending configuration`.
4. Da Bai sends install request to target robot, robot accepts, install completes.
5. Target robot rejects Da Bai suggestion and proposes alternative.
6. Enterprise sees governance event for external capability install.
7. Enterprise sanitizes asset and submits to platform.
8. Platform reviews and publishes enterprise submission.

Suggested location:
`test/integration/` or existing gateway integration test suites, depending on current test ownership patterns.

## Track 5: Delivery Phases and Milestones

### Phase 1: Employee installation foundation

Scope:

1. Runtime model extension
2. Employee install RPC
3. `My Robots` install entry
4. Install confirmation, risk, and pending configuration dialogs
5. `My Assets` record extension

Exit criteria:

1. Employee can install a capability to a target robot from all three source types.
2. Installation result can become `available`, `pending configuration`, or `restricted`.
3. `My Assets` reflects installation records.

### Phase 2: Robot self-install and Da Bai proxy

Scope:

1. Install request model and RPC
2. Robot self-install request flow
3. Da Bai proxy request flow
4. Robot review and alternative suggestion

Exit criteria:

1. Target robot can review and decide on install requests.
2. Da Bai can proxy requests without direct cross-robot binding.
3. Full traceability exists from request to installed binding.

### Phase 3: Enterprise governance center

Scope:

1. Governance event ingestion
2. Governance event UI
3. Restrict, disable, require-review actions
4. External capability filing view

Exit criteria:

1. Enterprise can see employee capability changes post-event.
2. Enterprise can control scope and runtime availability after install.

### Phase 4: Enterprise sanitization and platform submission

Scope:

1. Sanitization scanner
2. Sanitization workbench
3. Enterprise submit-to-platform flow
4. Platform enterprise-submission review lane

Exit criteria:

1. No enterprise asset can be submitted upstream without sanitization.
2. Platform can review and publish sanitized enterprise packages.

### Phase 5: Hardening and compatibility

Scope:

1. Terminology consistency checks
2. Backward compatibility validation
3. Projection and event auditing
4. Performance and UX polish

Exit criteria:

1. Existing `tenant-installed` behavior remains stable.
2. No old employee, enterprise, or platform screens regress.
3. Critical new flows have automated coverage.

## Track 6: Execution Notes for Kiro

### Guardrails

1. Do not replace the current runtime truth model. Extend it.
2. Do not move installation ownership away from the target robot.
3. Do not make `My Assets` the only installation entry.
4. Do not make Da Bai directly bind capabilities to other robots.
5. Do not bypass sanitization for enterprise upstream.
6. Do not collapse install state, configuration state, and governance state into one enum.

### Recommended implementation order

1. Data structures
2. Employee install RPC
3. Employee UI
4. Install request flow
5. Enterprise governance
6. Enterprise sanitization
7. Platform submission review
8. Hardening and tests

### Suggested PR slicing

1. PR 1: Runtime and employee capability model extensions
2. PR 2: Employee install RPC and UI base flow
3. PR 3: Da Bai proxy and robot self-install request flow
4. PR 4: Enterprise governance event center
5. PR 5: Enterprise sanitization workbench
6. PR 6: Platform enterprise submission review
7. PR 7: Tests, polish, compatibility cleanup

## Handoff Summary

Kiro should treat this document as the implementation task map for the capability installation governance initiative.

The most important architectural invariant is:

Capability installation is always robot-scoped, while decision support may come from the employee, the robot itself, or Da Bai as proxy.
