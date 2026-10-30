# Memory safe-continuity acceptance

| Field | Value |
| --- | --- |
| Branch | `memory/safe-continuity-landing` |
| Landing commit SHA | `913efc61` (on `d632f4627a158e079dc21810fdb15e17ac440119`); continuity gap-close commits follow on this branch |
| Backend under test | **builtin** (default). QMD collections are membership/tenant-filtered when enabled; default backend unchanged. |
| Constraints held | Did **not** flip `collaboration.learning.privateMemoryPromote` default; did **not** switch default `memory.backend` to qmd; capsule approval gates retained; retrieved / injected / outcome_verified distinction unchanged. |
| Test commands | `pnpm exec vitest run src/memory/memory-continuity-authz.test.ts src/memory/memory-continuity-acceptance.test.ts src/gateway/collaboration-learning/memory-index-paths.test.ts src/memory/memory-continuity-rpc.integration.test.ts` |
| Result (Asia/Shanghai) | **13/13 passed** (2026-10-30 ~12:32 CST, re-run twice) — authz 4, index-paths/QMD 4, acceptance 3, RPC integration 2. RPC file must import `embedding.test-mocks` before `memory-tool`. |

## Permission sources (what is checked)

| Surface | Claim / context checked |
| --- | --- |
| Collaboration group markdown (`collaboration/<groupId>/memory/**`) | `members.json` via `assertGroupMemberAccess` / `loadAuthoritativeGroupMembers` (active\|invited). Managed: also `governance.tenantId` → tenant-scoped groups root. |
| DM / personal agent memory | Separate agent workspace + index (`MemoryIndexManager` cache key / store path). No cross-workspace read. |
| Learning recall inject | Active-only assets (`status === undefined \| "active"`). Candidate capsules never inject until approve→promote. |
| QMD collab collections | Same `authorizedGroupIds` / tenant-scoped roots as builtin via `resolveCollaborationQmdCollections(Sync)`. Missing `authorizedGroupIds` → **default deny** (no all-groups dump). |

Denial responses use reason `"not authorized"` / reasonCodes (`non_member`, `revoked_or_inactive`, `cross_tenant`, …) and **never** include file body or snippets.

## Three-column matrix

| Loop / concern | Static wiring | Runtime loop | Permission isolation |
| --- | --- | --- | --- |
| **DM personal memory** | Builtin indexes `memory/**/*.md` under agent workspace; `isMemoryPath` unchanged for personal paths. Tool path: `createMemorySearchTool` / `createMemoryGetTool`. | Write unique marker → `sync({force})` → manager + `memory_search`/`memory_get` return path + body. | Second workspace/agent index: search misses marker; `readFile` empty (no shared index). **PASS** |
| **Group collaboration memory** | Builtin `MemoryIndexManager` takes `collaborationMemoryRoots` from `resolveMemoryContinuityAuthz` → `discoverCollaborationMemoryIndexRoots({ authorizedGroupIds })`; sync uses `listCollaborationMemoryMarkdownDocs` only for those roots. QMD: same filter on collection resolve. | Member writes `groups/<id>/memory/*.md` → member sync/search/get OK (manager + tool RPC). Delete file → force sync purges stale snippets. | Non-member: no roots / search empty / get `not authorized` (no body). Revoked: `revoked_or_inactive`, no body. Cross-tenant same groupId: tenant-scoped roots / governance TenantContext, deny without leak. **PASS** |
| **Learning approve→inject** | `writePersonalLearningCandidate` / `approvePersonalLearningCandidate` / `revokePersonalLearningAsset` under scope `agent:<botId>`; personal promote skips group charter policy and uses `targetBotId` from `agent:` scope. Group path reuses capsule governance + `promoteApprovedCapsuleIfEligible`. Recall via `buildLearningRecall` (active-only). | Candidate **not** in recall → approve (+promote) → injectable → revoke → recall empty. Acceptance hard-asserts **personal** post-approve inject and revoke-stops-inject (not only group). | Approval actor required; no silent promote; `privateMemoryPromote` left closed (default OFF). **PASS** |

## Gap close status (this follow-up)

| Gap | Status | Evidence |
| --- | --- | --- |
| **1) QMD membership/tenant filter** | **CLOSED** | `resolveCollaborationQmdCollections` / Sync take `authorizedGroupIds` (default deny if omitted). `backend-config.ts` + `search-manager.ts` pass authz. Vitest: `memory-index-paths.test.ts` (authorized build, default-deny, non-member exclude, cross-tenant managed). |
| **2) Personal approve→promote reliability** | **CLOSED** | Personal scope: `targetBotId` from `agent:<botId>`; skip group promotion policy. Acceptance asserts personal candidate → approve → inject → revoke stops inject. `privateMemoryPromote` default remains OFF. |
| **3) Full gateway memory_tool RPC integration** | **CLOSED** | `src/memory/memory-continuity-rpc.integration.test.ts` exercises real `createMemorySearchTool` / `createMemoryGetTool` with membership + Item7 Stage C governance (TenantContext). Covers authorized DM, authorized group member, non-member / revoked / cross-tenant forbidden without body/snippet. |

## Files landed (this branch)

| Area | Path |
| --- | --- |
| Authz module | `src/memory/memory-continuity-authz.ts` |
| Authz unit tests | `src/memory/memory-continuity-authz.test.ts` |
| Acceptance tests | `src/memory/memory-continuity-acceptance.test.ts` |
| RPC / tool integration | `src/memory/memory-continuity-rpc.integration.test.ts` |
| Personal gated write | `src/memory/personal-learning-write.ts` |
| Capsule promote (personal) | `src/gateway/collaboration-learning/capsule-promotion.ts`, `capsule-governance.ts` |
| Discovery filter (builtin + QMD) | `src/gateway/collaboration-learning/memory-index-paths.ts` (+ `.test.ts`) |
| Backend / search wiring | `src/memory/backend-config.ts`, `src/memory/search-manager.ts` |
| Builtin index/read/sync | `src/memory/manager.ts`, `src/memory/manager-sync-ops.ts`, `src/memory/internal.ts` |
| Search manager + tool | `src/memory/search-manager.ts`, `src/agents/tools/memory-tool.ts` |
| This doc | `docs/design/memory-continuity-acceptance.md` |

## Still-open / non-goals

- Live multi-process gateway HTTP/WS harness against a running server is not required; tool-layer RPC path matches production `memory_search` / `memory_get` invocation.
- Default `memory.backend` remains **builtin**; QMD filter is ready but unused unless operators opt in.
- `privateMemoryPromote` remains default **OFF**.
