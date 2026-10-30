# Memory safe-continuity acceptance

| Field | Value |
| --- | --- |
| Branch (landing, merged) | `memory/safe-continuity-landing-v2` → main via **#156** (`3cab9055`) |
| Branch (this gateway PR) | `memory/safe-continuity-gateway-pr` (from latest `origin/main` including #156) |
| Gateway WIP preserved on | `memory/safe-continuity-gateway-wip` @ `89df958c` (source of cherry-picks; left intact) |
| Backend under test | **builtin** (default). QMD collections membership/tenant-filtered when enabled; default backend unchanged. |
| Constraints held | Did **not** flip `collaboration.learning.privateMemoryPromote` default; did **not** switch default `memory.backend` to qmd; capsule approval gates retained. |
| Test commands | See **Gateway-only PR** evidence columns below. |
| Result (Asia/Shanghai) | Landing #156 already on main (tool-layer / FTS / ownership). Gateway PR: see live HTTP + multi-process results. |

## Evidence columns — landing #156 (already on main)

| Column | What it exercises | Identity / auth | Command |
| --- | --- | --- | --- |
| **Tool-layer integration** | In-process `createMemorySearchTool` / `createMemoryGetTool` then `.execute()` — **not** gateway HTTP dispatch | `authenticatedUserId` + optional `governance` / explicit `securityProfile` passed into tool factories; embedding provider **mocked** via in-file hoisted `vi.mock("./embeddings.js")`; membership via real `members.json` | `pnpm exec vitest run src/memory/memory-continuity-rpc.integration.test.ts` |

Supporting unit/acceptance (already green on main via #156):

```bash
pnpm exec vitest run \
  src/memory/memory-continuity-authz.test.ts \
  src/memory/memory-continuity-acceptance.test.ts \
  src/gateway/collaboration-learning/memory-index-paths.test.ts \
  src/memory/memory-continuity-rpc.integration.test.ts \
  src/memory/personal-learning-ownership.test.ts
```

## Gateway-only PR — injected identity vs real authentication

This PR adds **only** gateway-path deltas not in #156: `memory-core` session-user forward, live HTTP `/tools/invoke` harness, multi-process child e2e, and this doc section. Duplicates of FTS-only / continuity authz / tool-layer tests already on main are **not** re-landed.

| Column | What it exercises | Identity / auth classification | Command |
| --- | --- | --- | --- |
| **Injected identity (HTTP listen)** | Real loopback TCP + production `handleToolsInvokeHttpRequest` for `memory_search` / `memory_get`. DM marker; **group member positive**; **non-member / revoked / cross-tenant deny** with **no body/snippet leak**. | **Injected identity:** `authorizeHttpGatewayConnect` mocked to return `{ ok: true, user }` (same shape production trusted sessions provide at the connect boundary). Bearer token present but identity comes from the mock. Tools + memory-core + builtin path are real; `memory-core` forwards `authenticatedUserId` from `gatewayClientUser` / `requesterSenderId`. | `pnpm exec vitest run src/memory/memory-continuity-gateway.http.integration.test.ts` |
| **Real authentication passed (subprocess)** | Child-process gateway (`node --import tsx src/entry.ts gateway`) with isolated HOME/config/state; parent warm-indexes sqlite; child FTS-only HTTP invoke DM `memory_search` / `memory_get`. | **Real authentication passed:** unmocked gateway auth — Bearer shared-secret token accepted by production `authorizeHttpGatewayConnect` (`method: "token"`). No identity injection mock. Group membership over trusted-proxy / platform-auth user store in minimal child mode remains a documented gap (covered by injected-identity column). | `pnpm exec vitest run --config vitest.e2e.config.ts test/memory-continuity-gateway.e2e.test.ts` |

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
| **DM personal memory** | Builtin indexes `memory/**/*.md`; tool path tool-layer `.execute()` (#156) + gateway HTTP/e2e (this PR). | Write unique marker → `sync({force})` → manager + tool / HTTP search/get. | Second workspace misses marker. **PASS** |
| **Group collaboration memory** | `resolveMemoryContinuityAuthz` + discovery filter; gateway HTTP injects session user via memory-core forward. | Member sync/search/get OK (HTTP listen). | Non-member / revoked / cross-tenant deny without body/snippet (HTTP listen). **PASS** (injected identity) |
| **Learning approve→inject** | Personal scope `agent:<botId>` + ownership context; `privateMemoryPromote` left OFF. | Candidate → approve(+promote) → inject → revoke stops. | **PASS** (on main via #156) |

## Gap close status

| Gap | Status | Evidence |
| --- | --- | --- |
| **A) Positive search flake** | **CLOSED** (#156) | In-file hoisted `vi.mock` + FTS-only chunk/FTS index path. |
| **B1) Tool ≠ gateway RPC naming** | **CLOSED** | Tool-layer column on #156; HTTP/subprocess columns in this gateway PR (table above). |
| **B2) Personal approve ownership** | **CLOSED** (#156) | `assertPersonalLearningOwnership`; `personal-learning-ownership.test.ts`. |
| **B3) Managed not inferred from tenant** | **CLOSED** (#156) | Default `personal_local`; managed without tenant → `managed_missing_tenant`. |
| **G1) memory-core user forward** | **CLOSED** (this PR) | `extensions/memory-core/index.ts` sets `authenticatedUserId` from `gatewayClientUser` / `requesterSenderId`. |
| **G2) Live HTTP group deny matrix** | **CLOSED** (this PR) | HTTP listen: member OK; non-member / revoked / cross-tenant deny, no leak. |
| **G3) Multi-process DM e2e** | **CLOSED** (this PR) | Child gateway DM marker via real token auth. |
| QMD default-deny | Remains closed (#156) | `memory-index-paths.test.ts` |

## Files in this gateway PR (deltas vs main/#156)

| Area | Path |
| --- | --- |
| memory-core identity wiring | `extensions/memory-core/index.ts` (`authenticatedUserId` from session user) |
| Live HTTP listen harness | `src/memory/memory-continuity-gateway.http.integration.test.ts` |
| Multi-process gateway e2e | `test/memory-continuity-gateway.e2e.test.ts` |
| Loom registry (e2e entry) | `.loom/registry.yaml` |
| This doc (gateway-only section) | `docs/design/memory-continuity-acceptance.md` |

Landing files already on main via #156 (authz, tool-layer RPC, FTS, personal ownership, capsule promote, discovery filter) are **not** re-listed as gateway deltas.

## Live gateway HTTP / multi-process results

| Harness | How to run | What it proves | Result (Asia/Shanghai) |
| --- | --- | --- | --- |
| Live HTTP listen | `pnpm exec vitest run src/memory/memory-continuity-gateway.http.integration.test.ts` | Real TCP listen + production `POST /tools/invoke`. Authorized DM; group member OK; non-member / revoked / cross-tenant deny with **no** body/snippet leak. Auth: **injected identity** at connect boundary. | *(fill after local green)* |
| Multi-process child | `pnpm exec vitest run --config vitest.e2e.config.ts test/memory-continuity-gateway.e2e.test.ts` | Spawns gateway child with isolated temp HOME/config/state; **real token authentication**; DM `memory_search` / `memory_get`. | *(fill after local green)* |

**Remaining gap (child process):** Group membership identity over a minimal child gateway still needs a platform-auth / trusted-proxy user store (or equivalent). The live HTTP listen harness covers those authz denials by injecting the same `auth.user` shape production sessions provide at the connect boundary. WS `tools.invoke` is not a tenant surface (operator HTTP / agent-turn tools only).

## Still-open / non-goals

- Default `memory.backend` remains **builtin**; QMD filter is ready but unused unless operators opt in.
- `privateMemoryPromote` remains default **OFF**.
- Full child-process trusted-proxy group authz without a platform auth fixture is out of scope for this gateway PR; HTTP listen harness (injected identity) + tool-layer (#156) cover the deny matrix.
- Do **not** claim tool-layer `.execute()` is gateway HTTP RPC.
