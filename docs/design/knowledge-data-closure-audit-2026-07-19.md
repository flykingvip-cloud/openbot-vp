# Knowledge and Data Capability Closure Audit

Date: 2026-07-19

## Executive conclusion

The repository has a substantial and mostly coherent implementation from knowledge creation to indexed retrieval and prompt injection, and from governed enterprise-data invocation to knowledge-feed materialization. It is not yet an effective production closure end to end.

The current state is **partially closed**:

- Personal knowledge creation, KB attachment, indexing, governed retrieval, reply prompt injection, retrieval telemetry, and generation lineage are implemented and covered by focused tests.
- Enterprise data capabilities have seat authorization, scope evaluation, masking, audit, agent tool invocation, projection materialization, feed adaptation, and on-demand consumption paths.
- Four closure blockers remain: personal-object RPCs omit object-level authorization; enterprise projection access requests are process-memory-only; scheduled projection bindings have no scheduler; and the real reply-consumption integration suite is currently broken before executing any test.

## Closure matrix

| Stage                                | Evidence                                                                                                               | Result                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Personal creation/import             | `knowledge.personal.*`, `knowledge.base.create`, `knowledge.base.attach`, KB ingest/index                              | Closed at module level                           |
| Enterprise data creation             | source/action/capability/spec/binding stores and RPCs                                                                  | Closed at control-plane level                    |
| Governed live data execution         | `capability-agent-invoke-runtime.ts` -> `data-gateway.ts` -> live/mock adapter, masking and audit                      | Closed at module level                           |
| Enterprise knowledge materialization | `projection-materializer.ts` writes feed item, lineage, and supply audit                                               | Closed for manual and on-demand paths            |
| Scheduled materialization            | Binding type accepts `scheduled`, but no runtime enumerates or executes scheduled bindings                             | Not closed                                       |
| Knowledge indexing/retrieval         | KB index, hybrid retrieval, visibility resolver, governance filtering, citation counters                               | Closed at module level                           |
| Reply consumption                    | `get-reply-run.ts` builds and injects Knowledge Universe prompt context                                                | Wired, but integration gate is red               |
| Data capability consumption          | `data_capability` is registered in the standard agent tool set and invokes the governed runtime                        | Wired; focused tool-level regression test absent |
| Feedback and lineage                 | Retrieval increments chunk references; successful replies write generation lineage when evidence exists                | Closed for indexed evidence                      |
| Access-request feedback              | Capability request persists to governance approval store; enterprise projection request uses an in-memory map          | Partially closed                                 |
| Authorization isolation              | KB CRUD/search checks visibility/membership; three personal object RPCs operate by raw object id without caller checks | Not closed                                       |
| Operability                          | Several top-level knowledge paths intentionally return empty/undefined on any exception without structured telemetry   | Weak                                             |

## Findings

### P0: Personal object version and tag RPCs lack caller authorization

`knowledge.personal.versions`, `knowledge.personal.updateTags`, and `knowledge.personal.compareVersions` do not accept or resolve `client`, owner, tenant, or membership context. They operate directly on a caller-provided `objectId`. The neighboring KB handlers consistently call `authorizedKnowledgeBase`, so this is a concrete authorization gap rather than an intentional shared-object model.

Impact: any session with the corresponding generic read/write RPC scope and a discoverable personal object id can read version history/diffs or mutate tags outside object ownership boundaries.

Required closure:

1. Resolve trusted caller context in all three handlers.
2. Resolve the personal asset owner/tenant from the object id and enforce owner/admin policy.
3. Add cross-user and cross-tenant denial tests before positive tests.

### P1: Enterprise knowledge access requests disappear on restart and bypass governance approval

`knowledge.enterprise.access.request` calls `requestKnowledgeEnterpriseAccess`, which stores the request only in module-level `pendingEnterpriseRequests: Map`. It does not require an enterprise seat, validate the projection against the tenant store, persist to disk, or create a governance approval record. This differs from `knowledge.access.request`, which writes a durable `createSeatCapabilityAccessRequest` into the enterprise-data store.

Impact: the UI can report a successful pending request that administrators cannot reliably review and that vanishes on gateway restart.

Required closure: replace the in-memory path with a tenant-scoped persisted approval record, require trusted tenant and seat context, validate projection visibility/existence, and test restart recovery plus approve/deny feedback into the requesting UI.

### P1: `scheduled` projection bindings have no execution runtime

The binding contract supports multiple materialization modes, and seeded data includes a `scheduled` binding. Production code calls `runProjectionMaterialization` only from the admin RPC and the on-demand loader. The on-demand loader explicitly filters to `materializationMode === "on_demand"`; no maintenance tick, cron worker, or queue enumerates scheduled bindings.

Impact: scheduled enterprise knowledge never refreshes automatically. Freshness SLA metadata can therefore describe a guarantee the runtime does not provide.

Required closure: add a bounded, tenant-aware scheduler with due-time state, idempotency key, retry/backoff, overlap protection, persisted success/failure timestamps, and restart recovery tests.

### P1: The real reply-consumption integration gate is broken

The direct context builder test passes, but `knowledge-universe-context.reply.test.ts` fails during module loading with a Vitest mock contract error: the `../../routing/session-key.js` mock does not export `DEFAULT_ACCOUNT_ID`, required by `src/web/auth-store.ts`. No test body executes.

Impact: the highest-value assertion, that materialized enterprise knowledge is injected into an actual prepared reply, currently provides no regression protection.

Required closure: make the session-key mock partial (or include the required export), then retain assertions for prompt injection and lineage writeback through `runPreparedReply`.

### P2: Knowledge failure modes are silently indistinguishable from no knowledge

`buildKnowledgeUniversePromptContext` catches every exception and returns `undefined`; `loadKnowledgeSourceBundle` also catches broadly and falls back to personal-only data; on-demand materialization suppresses per-binding failures. These are reasonable availability fallbacks, but they expose no structured status to the reply, health endpoint, or operator metrics.

Impact: authorization resolution, index corruption, tenant-store loading, adapter failure, and a genuinely empty knowledge result all look the same to users and operators. The loop can silently stop consuming enterprise knowledge while chat remains healthy.

Required closure: preserve fallback behavior while emitting structured reason codes and counters, surface degraded source status in health/diagnostics, and add a test asserting a failed enterprise source is observable.

### P2: Agent data-capability tool lacks a focused tool-contract test

The `data_capability` tool is registered in `createOpenClawTools`, and the underlying capability runtime has seven passing tests. There is no `data-capability-tool.test.ts`, so schema validation, trusted session propagation, list/invoke JSON shape, and tool registration are not directly gated.

Required closure: add a narrow tool test plus one tool-list registration assertion. This is a coverage gap, not evidence that the runtime itself is broken.

## Verified working paths

- Personal ingest and KB mutations: 32 tests passed.
- Knowledge runtime P0/P1/P2: 13 tests passed.
- Workspace indexed search: 2 integration tests passed.
- Enterprise projection materialization and lineage/audit RPC behavior: 13 tests passed.
- Governed agent capability invocation: 7 tests passed.
- On-demand materialization, personal mutations, consumption boundary, and direct reply-context construction: 13 tests passed.

Total: 80 assertions passed across the focused audit runs. One reply-consumption suite failed at import time and ran zero tests.

## Recommended execution order

1. Close the P0 personal-object authorization boundary.
2. Replace enterprise access-request memory state with the governance approval store.
3. Implement scheduled materialization and restart recovery.
4. Repair the actual reply integration test and make it a required gate.
5. Add degradation telemetry and the data-capability tool contract test.

## Remediation status (2026-07-19 follow-up)

| Finding                                        | Status                                                   |
| ---------------------------------------------- | -------------------------------------------------------- |
| P0 personal object RPC authorization           | Done (`personal-knowledge-auth`, ownerUserId stamp)      |
| P1 durable enterprise knowledge access request | Done (governance category + request API)                 |
| P1 scheduled projection materialization        | Done (materializer + maintenance tick)                   |
| P1 reply integration suite import gate         | Done (partial session-key mock)                          |
| P2 degradation observability                   | Done (structured logs on knowledge context)              |
| P2 `data_capability` tool contract tests       | Done (`data-capability-tool.test.ts`)                    |
| Approve → visibility grant effect              | Done (`grantEnterpriseKnowledgeAccessToSeat` on approve) |
| Golden-path E2E completion gate                | Done (`knowledge-data-closure.golden-path.test.ts`)      |

The golden-path suite exercises:

- **Enterprise half**: tenant KB create → catalog seed/materialize → lineage chain → seat-visible feed → governed data capability invoke → outsider deny → access request approve/reject → Knowledge Universe prompt injection → enterprise-data store restart recovery.
- **Personal half**: ingest → keyword/FTS retrieve → generation lineage writeback → index reopen (restart).

## Re-inspection close-out (2026-07-19)

| Gap from re-inspection               | Status                                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| P1 full golden-path E2E single test  | Done — `src/gateway/knowledge/knowledge-data-closure.golden-path.test.ts`                                                          |
| P1 scheduled acceptance strength     | Done — multi-tenant tick, overlap reentry, cursor restart, interval guard (`scheduled-projection-materializer.test.ts`, 6 cases)   |
| P2 failure backoff state             | Done — `lastFailureByBindingId` + exponential `failureCountByBindingId`; cursor persisted on failure                               |
| P2 task governance / attribution     | Done — `.loom/registry.yaml` task `knowledge-data-closure-audit:grok`; tracked `.kiro/specs/knowledge-data-closure-audit/tasks.md` |
| P3 dead in-memory access-request Map | Done — removed `src/gateway/knowledge/access-request.ts` (RPCs use governance stores)                                              |

## Residual risk register

| Risk                                                                | Level     | Mitigation                                                                                | Gate                                                                                                                                                  | Status                                                                             |
| ------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A. Multi-tenant scheduled soak under real SaaS volume               | Ops       | Offline multi-tenant harness + inspect-selftest + staging inspect                         | `pnpm soak:scheduled-projection:all` (simulate+inspect-selftest); live `OPENBOT_SOAK_MODE=inspect` at MT cutover; `pnpm check:knowledge-data-closure` | **Mitigated (L2 simulate + inspect-selftest green)**; live inspect only at cutover |
| B. Personal KB retrieve + generation lineage in same golden process | Test debt | Second golden-path case                                                                   | `knowledge-data-closure.golden-path.test.ts` personal half                                                                                            | **Closed**                                                                         |
| C. Dual-gateway concurrent tick / extreme tenant fan-out            | Accept    | Overlap lock + per-tenant isolation already unit-tested; full multi-gateway soak deferred | Optional L3 at scale incident                                                                                                                         | Accepted residual                                                                  |

### Cutover procedure (risk A inspect)

1. Enable MT smoke window (`OPENBOT_MULTITENANT=1`) with seeded scheduled bindings per tenant.
2. Allow gateway maintenance ticks for ≥1 schedule interval (or force restart after first success).
3. Run:  
   `OPENBOT_SOAK_MODE=inspect OPENBOT_TENANTS_ROOT=<tenants> bash deploy/production/scripts/staging-scheduled-projection-soak.sh`
4. Require PASS on cursor presence and multi-tenant activity (or document failure-only backoff if projections error).
