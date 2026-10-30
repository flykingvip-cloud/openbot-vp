# Memory safe-continuity acceptance

| Field | Value |
| --- | --- |
| Branch | `memory/safe-continuity-landing-v2` (from `aa446d12927b374558cf104261949552a9e81e8d`) |
| Candidate tip | `4844738ecf6291e5e27eb907c1cda7c3198a9b4e` |
| Base (PARTIAL prior) | `aa446d12927b374558cf104261949552a9e81e8d` — search flake / naming / ownership gaps |
| Gateway WIP preserved on | `memory/safe-continuity-gateway-wip` @ `89df958c` (HTTP harness + multi-process e2e + memory-core user forward) — **not** mixed into this candidate |
| Backend under test | **builtin** (default). QMD collections membership/tenant-filtered when enabled; default backend unchanged. |
| Constraints held | Did **not** flip `collaboration.learning.privateMemoryPromote` default; did **not** switch default `memory.backend` to qmd; capsule approval gates retained. |
| Test commands | See columns below. |
| Result (Asia/Shanghai) | **RPC alone 2/2 ×2**; **suite 15/15 ×2** (authz 6, index-paths 4, acceptance 3, tool-layer 2) + ownership 4/4. 2026-10-30 ~13:45 CST (Asia/Shanghai). |

## Evidence columns (mocked vs real auth)

| Column | What it exercises | Identity / auth | Command |
| --- | --- | --- | --- |
| **Tool-layer integration** | In-process `createMemorySearchTool` / `createMemoryGetTool` then `.execute()` — **not** gateway HTTP dispatch | `authenticatedUserId` + optional `governance` / explicit `securityProfile` passed into tool factories; embedding provider **mocked** via in-file hoisted `vi.mock("./embeddings.js")` (survives import-sort); membership via real `members.json` | `pnpm exec vitest run src/memory/memory-continuity-rpc.integration.test.ts` |
| **HTTP-auth boundary** | Live HTTP `/tools/invoke` against a running gateway (session → `authenticatedUserId`) | Real gateway auth entry; **not** in this candidate — preserved on `memory/safe-continuity-gateway-wip` (`memory-continuity-gateway.http.integration.test.ts`) | (deferred; do not claim tool `.execute` is HTTP) |
| **Full subprocess** | Child-process gateway continuity e2e | Real multi-process boundaries; **not** in this candidate — preserved on `memory/safe-continuity-gateway-wip` (`test/memory-continuity-gateway.e2e.test.ts`) | (deferred) |

Supporting unit/acceptance (same candidate):

```bash
pnpm exec vitest run \
  src/memory/memory-continuity-authz.test.ts \
  src/memory/memory-continuity-acceptance.test.ts \
  src/gateway/collaboration-learning/memory-index-paths.test.ts \
  src/memory/memory-continuity-rpc.integration.test.ts \
  src/memory/personal-learning-ownership.test.ts
```

## Permission sources (what is checked)

| Surface | Claim / context checked |
| --- | --- |
| Collaboration group markdown (`collaboration/<groupId>/memory/**`) | `members.json` via `assertGroupMemberAccess`. Managed: requires **explicit** trusted `securityProfile` / `profile: managed_enterprise` **and** `governance.tenantId` — tenant presence alone does **not** flip mode; managed without tenant → `managed_missing_tenant` fail-closed (empty roots, no personal fallthrough). |
| DM / personal agent memory | Separate agent workspace + index. No cross-workspace read. |
| Learning recall inject | Active-only assets. Candidate capsules never inject until approve→promote. |
| Personal approve / revoke | Trusted `PersonalLearningOwnerContext` (`ownerUserId` + `ownerAgentId`, optional tenant/securityProfile). Actor must equal ownerUserId; ownerAgentId must equal botId. Spoofed actor / cross-tenant same botId / managed-without-tenant refuse; revoke refuse leaves state unchanged. Nonempty `actorId` alone is **not** authorization. |
| QMD collab collections | Same `authorizedGroupIds` / tenant-scoped roots; missing `authorizedGroupIds` → **default deny**. |

Denial responses use reason `"not authorized"` / reasonCodes (`non_member`, `revoked_or_inactive`, `cross_tenant`, …) and **never** include file body or snippets.

## Three-column matrix (continuity loops)

| Loop / concern | Static wiring | Runtime loop | Permission isolation |
| --- | --- | --- | --- |
| **DM personal memory** | Builtin indexes `memory/**/*.md`; tool path tool-layer `.execute()`. Embedding mocks bound before manager/tool import. | Write unique marker → `sync({force})` → manager + tool search/get. On search miss, assert dumps index status / hit diagnostics (provider, files, chunks). | Second workspace misses marker. **PASS** (stable alone + suite ×2) |
| **Group collaboration memory** | `resolveMemoryContinuityAuthz` + discovery filter; tool entry passes explicit security mode. | Member sync/search/get OK. | Non-member / revoked / cross-tenant (explicit managed + other tenant governance) deny without body. **PASS** |
| **Learning approve→inject** | Personal scope `agent:<botId>` + ownership context; `privateMemoryPromote` left OFF. | Candidate → approve(+promote) → inject → revoke stops. Counterexamples: spoofed actor, cross-tenant same botId, revoke refuse unchanged. | **PASS** |

## Gap close status (this candidate vs PARTIAL)

| Gap | Status | Evidence |
| --- | --- | --- |
| **A) Positive search flake** | **CLOSED** | Root cause: alone-run loaded real embeddings (`provider:"none"`, files:0/chunks:0) and FTS-only sync skipped indexing. Fixed with in-file hoisted `vi.mock` + FTS-only chunk/FTS index path. RPC alone 2/2 ×2; suite ×2. |
| **B1) Tool ≠ gateway RPC naming** | **CLOSED** | Describe/doc: tool-layer integration; HTTP/subprocess columns separate; gateway WIP parked on `memory/safe-continuity-gateway-wip`. |
| **B2) Personal approve ownership** | **CLOSED** | `assertPersonalLearningOwnership`; tests in `personal-learning-ownership.test.ts`. |
| **B3) Managed not inferred from tenant** | **CLOSED** | Default `personal_local`; managed without tenant → `managed_missing_tenant`; tool passes explicit `securityProfile` / `accessContext`. |
| QMD default-deny | Remains closed | `memory-index-paths.test.ts` |

## Files in this candidate

| Area | Path |
| --- | --- |
| Authz (no tenant→managed inference) | `src/memory/memory-continuity-authz.ts` (+ `.test.ts`) |
| Tool-layer + miss diagnostics | `src/memory/memory-continuity-rpc.integration.test.ts` |
| Tool securityProfile wiring | `src/agents/tools/memory-tool.ts` |
| Personal ownership gates | `src/memory/personal-learning-write.ts`, `src/memory/personal-learning-ownership.test.ts` |
| Acceptance (ownership args) | `src/memory/memory-continuity-acceptance.test.ts` |
| FTS-only index path | `src/memory/manager-embedding-ops.ts`, `src/memory/manager-sync-ops.ts` |
| This doc | `docs/design/memory-continuity-acceptance.md` |

## Still-open / non-goals

- HTTP-auth boundary and full subprocess gateway evidence remain on `memory/safe-continuity-gateway-wip` until optionally rewritten onto v2 after this candidate is accepted — **do not** claim tool `.execute` is gateway RPC.
- Default `memory.backend` remains **builtin**.
- `privateMemoryPromote` remains default **OFF**.
- HTTP/subprocess columns remain deferred on gateway-wip (not in this PR).
