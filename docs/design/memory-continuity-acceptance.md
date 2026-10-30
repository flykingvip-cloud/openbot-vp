# Memory safe-continuity acceptance

| Field | Value |
| --- | --- |
| Branch | `memory/safe-continuity-landing` |
| Landing commit SHA | `913efc61` (on `d632f4627a158e079dc21810fdb15e17ac440119`) |
| Backend under test | **builtin** (default). QMD not required for these loops. |
| Constraints held | Did **not** flip `collaboration.learning.privateMemoryPromote` default; did **not** switch default `memory.backend` to qmd; capsule approval gates retained; retrieved / injected / outcome_verified distinction unchanged. |
| Test command | `pnpm exec vitest run src/memory/memory-continuity-authz.test.ts src/memory/memory-continuity-acceptance.test.ts` |
| Result (Asia/Shanghai) | **7/7 passed** (2026-10-30) |

## Permission sources (what is checked)

| Surface | Claim / context checked |
| --- | --- |
| Collaboration group markdown (`collaboration/<groupId>/memory/**`) | `members.json` via `assertGroupMemberAccess` / `loadAuthoritativeGroupMembers` (active\|invited). Managed: also `governance.tenantId` → tenant-scoped groups root. |
| DM / personal agent memory | Separate agent workspace + index (`MemoryIndexManager` cache key / store path). No cross-workspace read. |
| Learning recall inject | Active-only assets (`status === undefined \| "active"`). Candidate capsules never inject until approve→promote. |

Denial responses use reason `"not authorized"` / reasonCodes (`non_member`, `revoked_or_inactive`, `cross_tenant`, …) and **never** include file body or snippets.

## Three-column matrix

| Loop / concern | Static wiring | Runtime loop | Permission isolation |
| --- | --- | --- | --- |
| **DM personal memory** | Builtin indexes `memory/**/*.md` under agent workspace; `isMemoryPath` unchanged for personal paths. | Write unique marker → `sync({force})` → `search`/`readFile` returns path + body. | Second workspace/agent index: search misses marker; `readFile` empty (no shared index). **PASS** |
| **Group collaboration memory** | Builtin `MemoryIndexManager` takes `collaborationMemoryRoots` from `resolveMemoryContinuityAuthz` → `discoverCollaborationMemoryIndexRoots({ authorizedGroupIds })`; sync uses `listCollaborationMemoryMarkdownDocs` only for those roots. | Member writes `groups/<id>/memory/*.md` → member sync/search/get OK. Delete file → force sync purges stale snippets. | Non-member: no roots / search empty / `readFile` throws `not authorized` (no body). Revoked member: `revoked_or_inactive`, no body. Cross-tenant same groupId: tenant-scoped roots, deny without leak. **PASS** |
| **Learning approve→inject** | `writePersonalLearningCandidate` / `approvePersonalLearningCandidate` / `revokePersonalLearningAsset` under scope `agent:<botId>`; group path reuses capsule governance + `promoteApprovedCapsuleIfEligible`. Recall via `buildLearningRecall` (active-only). | Candidate **not** in recall → approve (+promote) → injectable → revoke/`status:revoked` → recall empty for that asset. | Approval actor required; no silent promote; `privateMemoryPromote` left closed. **PASS** |

## Files landed (this branch)

| Area | Path |
| --- | --- |
| Authz module | `src/memory/memory-continuity-authz.ts` |
| Authz unit tests | `src/memory/memory-continuity-authz.test.ts` |
| Acceptance tests | `src/memory/memory-continuity-acceptance.test.ts` |
| Personal gated write | `src/memory/personal-learning-write.ts` |
| Discovery filter | `src/gateway/collaboration-learning/memory-index-paths.ts` |
| Builtin index/read/sync | `src/memory/manager.ts`, `src/memory/manager-sync-ops.ts`, `src/memory/internal.ts` |
| Search manager + tool | `src/memory/search-manager.ts`, `src/agents/tools/memory-tool.ts` |
| This doc | `docs/design/memory-continuity-acceptance.md` |

## Remaining gaps (non-blocking for this landing)

1. **QMD path**: `resolveCollaborationQmdCollections` / Sync still discovers all groups without membership filter when `memory.backend === "qmd"`. Builtin is the default under test; QMD authz filter is follow-up.
2. **Personal promote policy**: personal `approvePersonalLearningCandidate` depends on agent-list / promotion policy; acceptance always asserts the group approve→promote→revoke path and asserts personal candidate-not-in-recall before approve. If personal promote is denied by policy, group path still proves the gate.
3. **memory_tool end-to-end**: unit/acceptance cover manager + authz + learning helpers; full gateway tool RPC with live Item7 Stage C context is integration follow-up.
