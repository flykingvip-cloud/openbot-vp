# Employee-home signal cards (M1 待处理任务, M2 重要通知) + enterprise-admin notices

The change adds three deterministic gateway read-models that feed the employee-home and enterprise-overview "signal" cards, all built as pure projections over already-resolved business state (no LLM). M1 (`workbench.pending-tasks.list`) aggregates pending task-assignments, pending-governance deliverables, and pending collaboration invites, actor-scoped through `resolveEmployeeWorkbenchActor`. M2 (`workbench.notices.list`) is deliberately narrowed to the employee's own user-scoped knowledge governance, with channel/billing/install-health pushed to a separate, admin-gated `enterprise.notices.list`. The split exists to keep install-global and financial signals off the per-employee surface, which the rest of the workbench already isolates per tenant. The UI consumes the projections via `refreshWorkbenchSignals`, co-loaded with spaces and on a 45s self-cancelling timer, clearing to `null` on failure or disconnect.

Watch for: (1) **confirmed** — the cross-agent task read covers all _configured_ agents but still misses tasks written to a workspace not derived from a configured agent (ephemeral agents, `process.cwd()` write fallback); (2) **possible** — `enterprise.notices.list` inherits the shared `resolveBillingScope` local-operator fallback, which grants `isEnterpriseAdmin` to a membership-less caller that supplies a known `tenantId` in params; (3) **confirmed** — M1's pending-task count is "pending in my spaces", with no assignee filter, so it can over-count relative to "assigned to me"; (4) **confirmed** — the working tree also carries a large, unrelated enterprise-data connector refactor that should not land in the same commit.

**Recommendation — M1: ACCEPT** (the F1 under-count is fixed with real integration evidence and `ackRequired` is wired + tested; resolve the count-semantics question and document the configured-agent coverage boundary as non-blocking follow-ups). **M2: ACCEPT** (the employee/admin scope split is coherent, the employee card is governance-only and user-scoped, and the admin counterpart is admin-gated + tenant-scoped with tests; track the shared `resolveBillingScope` fallback escalation with the team). Neither concern that remains is a correctness defect in the new code; the one security caveat lives in pre-existing shared infra the admin gate depends on.

## High-level view

`buildWorkbenchNotices` and `buildEnterpriseNotices` are pure functions over resolved inputs; `buildWorkbenchPendingTasks` takes injectable deps that default to the real on-disk stores. Every scope decision lives in the RPC handlers, not the builders — so the builders are unit-testable in isolation and the handlers carry the entire security weight.

M1's headline fix is reading task-assignments across every configured agent's workspace, not just the default agent's, because writes land in the _executing_ agent's workspace. The fix iterates all configured agents plus the always-merged managed dir, deduped by id, and a real (non-mocked) filesystem test proves a non-default agent's task is picked up while a default-only read misses it. The coverage is honest but bounded: it follows the _configured_ agent list, so a write from an agent absent from config (or the `process.cwd()` fallback path) is still outside the net.

`ackRequired` is now load-bearing: ack-required pending tasks are counted separately and layered ahead of everything else before recency ordering, with a test that pins an older ack-required task ahead of a newer non-ack one.

The scope split between the employee and admin notices surfaces is coherent. The employee card sources exactly one signal — the caller's own user-scoped governance summary, via the same `withUserKnowledgeIndex` path as `knowledge.governance.summary` — and nothing install-global. The admin card carries the excluded financial and channel-offline signals and is gated explicitly on `scope.isEnterpriseAdmin`, because `requireEnterpriseScope` only resolves a tenant.

All three RPCs return an empty projection (never an unscoped, install-wide view) when the actor or tenant cannot resolve, and the handler tests assert the underlying source is never even called in that case. The one soft spot is not in this code but in the shared billing scope resolver it leans on for the admin gate.

<details>
<summary>Issues (6)</summary>

1. **Cross-agent coverage edge** (confirmed/likely) — `readTaskAssignmentsAcrossAgentWorkspaces` only iterates `cfg.agents.list`; tasks written by an agent not in config (or via the `resolveWorkspaceRoot` → `process.cwd()` fallback, or a relative configured workspace that the writer `path.resolve`s but the reader does not) are still missed and untested. Document the boundary or assert that all writers resolve through `resolveAgentWorkspaceDir`.
2. **Admin-gate fallback escalation** (possible, pre-existing/shared) — `enterprise.notices.list` trusts `scope.isEnterpriseAdmin`, but `resolveBillingScope`'s `localOperatorScope` sets that to `true` for a `params.tenantId` of a known enterprise when the caller's email resolves to no membership. Confirm with the team whether a membership-less authenticated principal can reach this RPC; the gate is solid only for callers who _have_ a membership.
3. **Pending-task count semantics** (confirmed) — M1 counts every pending assignment in the actor's seat spaces with no assignee/`ownerAgentId` filter, so the 待处理任务 card reflects "pending in my spaces", not "assigned to me". Confirm this matches product intent or add an assignee filter.
4. **Bundled unrelated changes** (confirmed) — the working tree mixes a ~36-file enterprise-data connector refactor (salesforce/postgres/http-rest adapters, connector catalog, org-targets) into the same tree. Land the signal-cards work as its own scoped commit.
5. **No integration test for the actor→read-model scoping seam** (confirmed) — handler tests mock `buildWorkbenchPendingTasks`, and the read-model test injects deps; nothing exercises a real `resolveEmployeeWorkbenchActor` feeding the real builder. Acceptable for M1/M2 unit gating, but the scoping contract is only verified in pieces.
6. **UI timer has no explicit teardown** (possible) — `startWorkbenchSignalsRefresh` self-cancels via `host.client`/`connected` guards rather than `clearTimeout`; benign, but rapid reconnects briefly spawn overlapping loops (each guarded). Fine as-is; noting for awareness.

</details>

<details>
<summary>Details</summary>

### M1: reading task-assignments across all agent workspaces (prior finding F1)

The under-count this fixes is a real read/write asymmetry. Writes go through `upsertOrganizationTaskAssignment` / `writeOrganizationTaskAssignments` with the _executing_ agent's `workspaceDir` (`organization-tasks-tool.ts:117` resolves `resolveWorkspaceRoot(opts?.workspaceDir)`; `mention-task-converter.ts:56` passes the caller's `workspaceDir`). `writeOrganizationTaskAssignments` writes only to `resolveOrganizationMemoryDir(...)` — a per-agent path unless `collaboration.defaults.workspace` is set (`task-assignment.ts:175-185`). A default-agent-only read therefore misses any task a non-default agent wrote.

`readTaskAssignmentsAcrossAgentWorkspaces` (`pending-tasks-read-model.ts:48-79`) closes this by seeding the set with `resolveDefaultAgentId(cfg)` and adding every id from `listAgentsForGateway(cfg).agents`, then reading each agent's `resolveAgentWorkspaceDir` and deduping by assignment id. `listAgentsForGateway` enumerates the configured agent list (`session-utils.ts:354-389`), so every agent declared in config is covered. `readOrganizationTaskAssignments` additionally always merges the workspace-independent managed dir `<stateDir>/spaces/<id>/memory` (`task-assignment.ts:160-173`), so that base is covered regardless of agent.

The integration test is genuine, not mocked: `pending-tasks-read-model.test.ts:191-235` writes a task into a non-default agent's real temp workspace, asserts a default-only `readOrganizationTaskAssignments` does **not** see it, then asserts `readTaskAssignmentsAcrossAgentWorkspaces` does. It uses a randomized org id so the managed dir cannot pollute the assertion. This is convincing evidence for the configured-agent case.

The residual gap is structural and acknowledged in the code comment: coverage follows `resolveAgentWorkspaceDir(cfg, agentId)` over the _configured_ agent set, while writes use `resolveWorkspaceRoot(opts.workspaceDir)`. Three ways a write escapes the read net: an agent that executed a write but is no longer (or never) in `cfg.agents.list` writes to `<stateDir>/workspace-<id>` (`agent-scope.ts:270-271`) which is never iterated; `opts.workspaceDir` empty at write time falls back to `process.cwd()` (`workspace-dir.ts:35`); and a relative configured workspace is `path.resolve`d on write but only `~`-expanded on read (`agent-scope.ts:258`), yielding divergent dirs. None of these is exercised by a test. In a deployment where every task-writing agent is a configured agent with an absolute/`~` workspace, the fix is complete; outside that, the count can still under-report.

### M1: ackRequired participates in counting and ordering (prior finding F2)

`ackRequiredCount` is the subset of `kind === "task"` items with `ackRequired === true` (`pending-tasks-read-model.ts:228-230`), and ordering layers ack-required first, then recency (`:236-243`). The test at `pending-tasks-read-model.test.ts:121-145` pins an older ack-required task ahead of a newer non-ack one and asserts `ackRequiredCount === 1`, so the field is load-bearing rather than dead. One caveat: `createTaskAssignment` defaults `ackRequired` to `true` (`task-assignment.ts:82`), so in practice most tasks fall into the ack-required band and the ordering degrades to recency within it.

### M2: employee notices scoped to governance only (prior finding M2-scope)

The employee handler sources exactly one signal: `getUserGovernanceSummary(client)` (`workbench.ts:79`), which delegates to `withUserKnowledgeIndex` (`knowledge-governance.ts`), the same per-user index path as `knowledge.governance.summary`. There is no channel, billing, or install-health read anywhere in the employee path. `buildWorkbenchNotices` folds chunk+claim conflicts into `conflictCount` and duplicate/stale/orphan into `attentionCount` (`notices-read-model.ts:78-103`) and returns empty when governance is absent. The scope rationale is documented inline (`notices-read-model.ts:55-73`): install-global and admin/financial signals would breach the per-tenant isolation the rest of the workbench enforces, so they move to the admin surface. Connection health is explicitly _not_ in this read-model — the UI renders it client-side from the websocket. The split is coherent and the employee card leaks nothing cross-tenant.

### Multi-tenant safety: empty-on-unresolved across all three RPCs (prior finding F4)

Both employee RPCs return a fixed empty payload when `resolveEmployeeWorkbenchActor` yields null (`workbench.ts:33-36`, `:71-74`), and the handler tests assert the read-model / governance source is **not** called in that case (`workbench.test.ts:111-118`, `:201-207`) — so an unresolvable session cannot fall through to an install-wide view. `resolveEmployeeWorkbenchActor` itself denies anything that is not a personal-workbench session domain, has no user email, or whose email resolves to no platform user (`employee-workbench-scope.ts:330-360`); a resolvable user with no tenant gets an actor with empty spaces and steward-only agents, which deterministically projects to zero.

`enterprise.notices.list` resolves the tenant via `requireEnterpriseScope` and then explicitly rejects non-admins — `if (!scope.isEnterpriseAdmin) respond(false, ...)` (`enterprise-notices.ts:31-39`) — which is necessary because `requireEnterpriseScope` only resolves a tenant and does not check admin (`billing-helpers.ts:44-60`). The test covers both the no-tenant path and the non-admin rejection, asserting no billing/channel source is touched in either (`enterprise-notices.test.ts:107-128`). Channel-offline scoping is tenant-correct: `resolveTenantOfflineChannels` resolves the tenant's config override and enumerates only the tenant's configured + enabled + `isConfigured` accounts (`tenant-channel-health.ts:46-91`), matching them against the gateway runtime snapshot. The runtime snapshot is gateway-global until per-tenant runtime activation (Phase 8) — the same documented caveat as `channels.status` — but scoping by configured accounts keeps a tenant from seeing channels it never configured.

The one soft spot is the admin gate's dependency on `resolveBillingScope`. Its `localOperatorScope` returns `isEnterpriseAdmin: true` (`scope.ts:74-82`) and is reached not only when platform auth is disabled, but also when auth is enabled and the caller's email resolves to no membership-with-enterpriseId, as long as `params.tenantId` names a known enterprise (`scope.ts:147-159`). A logged-in principal with no enterprise membership could therefore pass `tenantId` and receive admin-scoped notices for that tenant. This is not introduced here — every enterprise/billing handler uses the same resolver, and a caller who _does_ have a membership resolves through the authoritative path where `requestedTenantId` is ignored, so the normal enterprise population cannot cross tenants this way. Worth confirming with the team whether a membership-less authenticated principal can reach a READ_SCOPE method; the three new methods register under `READ_SCOPE` (`method-scopes.ts:360-362`), so transport-level gating is the lowest tier and the real boundary is this in-handler resolution.

### Pending-task count semantics

Section (1) of the builder adds every assignment with `status === "pending"` for each org in `seatSpaceIds`, with no filter on `ownerAgentId` or assignee (`pending-tasks-read-model.ts:163-182`). The actor is a member/owner/seat-holder of those spaces, so this is within-tenant and not a leak, but the resulting count is "pending tasks in my spaces" rather than "pending tasks assigned to me". For a card titled 待处理任务 read as a personal to-do, a shared space with many other-owned pending tasks inflates the number. Governance and invites are tighter (deliverables scoped by `userId` + `groupIds` + `visibleAgentIds`; bot invites only in seated spaces; human invites matched to actor identities), so the asymmetry is specific to task-assignments.

### Determinism (prior finding F5)

`buildWorkbenchNotices` and `buildEnterpriseNotices` are pure over resolved inputs (no I/O, no LLM); `buildWorkbenchPendingTasks` is pure given its injected deps, which default to the real stores and are overridden in tests. The full set — 28 tests across the five new files — passes locally (`OPENBOT_TEST_PROFILE=low`).

### Unrelated changes in the same tree

The working tree mixes the signal-cards work with a large enterprise-data connector refactor: new salesforce-oauth / postgres / http-rest adapters, connector catalog and credential-vault changes, org-targets store, and matching UI under `enterprise-data-capability` (~36 files, ~2271 insertions in the unstaged set). None of it belongs to M1/M2/enterprise-notices. The signal-cards files are cleanly separable (all the staged `src/gateway/workbench/*`, `server-methods/workbench*`, `server-methods/enterprise-notices*`, plus the UI seam) and should land as their own scoped commit per the repo's "avoid bundling unrelated refactors" guidance.

</details>

<details>
<summary>File map</summary>

- `src/gateway/workbench/pending-tasks-read-model.ts` — M1 builder + cross-agent workspace reader.
- `src/gateway/workbench/pending-tasks-read-model.test.ts` — M1 projection tests + real filesystem cross-agent integration test.
- `src/gateway/server-methods/workbench.ts` — `workbench.pending-tasks.list` + `workbench.notices.list`, actor-scoped, empty-on-unresolved.
- `src/gateway/server-methods/workbench.test.ts` — handler scoping tests (steward filtered, empty when no actor, governance fallback).
- `src/gateway/workbench/notices-read-model.ts` — M2 employee governance-only builder.
- `src/gateway/workbench/notices-read-model.test.ts` — M2 projection tests.
- `src/gateway/workbench/enterprise-notices-read-model.ts` — admin financial + channel-offline builder.
- `src/gateway/workbench/enterprise-notices-read-model.test.ts` — admin projection tests.
- `src/gateway/workbench/tenant-channel-health.ts` — tenant-scoped offline-channel resolver.
- `src/gateway/server-methods/enterprise-notices.ts` — `enterprise.notices.list`, admin-gated, tenant-scoped.
- `src/gateway/server-methods/enterprise-notices.test.ts` — admin gate + aggregation tests.
- `src/gateway/method-scopes.ts`, `server-methods-list.ts`, `server-methods.ts` — register the three RPCs (READ_SCOPE).
- `ui/src/ui/controllers/spaces.ts` — `refreshWorkbenchSignals` seam (co-load + clear-on-failure).
- `ui/src/ui/app-gateway.ts` — 45s self-cancelling refresh timer.
- `ui/src/ui/app-lifecycle.ts` — disconnect reset of both signal states.
- `ui/src/ui/ports/enterprise/views/enterprise-system-notices-card.ts` (+ browser test) — admin card, fails closed on rejection, additive render.
- `ui/src/ui/ports/enterprise/views/enterprise-overview-surface.ts` — embeds the admin card next to the supervisor card.
- `docs/design/employee-home-standing-duty-agents-2026-06-29.md` — design rationale + M1/M2 landing record.

Full diff: `git diff HEAD` (staged signal-cards files listed above; note the unrelated enterprise-data churn in the same tree).

</details>
