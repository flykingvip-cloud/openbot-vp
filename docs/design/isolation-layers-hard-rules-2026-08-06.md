# Isolation layers — hard rules (incident hardening)

Date: 2026-08-06  
Related:

- [agent-seat-binding-tenant-isolation-2026-08-04.md](./agent-seat-binding-tenant-isolation-2026-08-04.md)
- `src/gateway/tenant-context.ts`
- `src/gateway/employee-workbench-scope.ts`
- `src/gateway/platform-auth/seat-store-loader.ts`

## Incident summary

**Symptom:** Employee workbench AI 助手 rail showed many other users' robots; `chat.history` reported `TenantContextError: unresolved_tenant`.

**Root cause:**

1. Agent directory SoT is install-wide (`openbot.json` → `listAgentsForGateway`). Isolation depends entirely on RPC-side filtering.
2. `agents.list` historically **fail-opened** to the full roster when `resolveEmployeeWorkbenchActor` returned null.
3. Incomplete session domain correctly failed `requireTenantContext` on some paths, while list RPCs still returned install-wide data — **inconsistent fail posture**.

Production hotfixed as `agents-list-scope-r1`; source fail-closed lives in `agents.list` / `agents.runtime-health` via `resolveScopedAgentsForClient`.

## Three layers

| Layer                          | Intent                                                                                                                                                                                                                                                                                                                      | Enforcement                                                                                                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **L1 Cross-tenant**            | Authoritative `tenantId` only from platform-auth membership; MULTITENANT seat/control-plane under `tenants/<tid>/…`                                                                                                                                                                                                         | `resolveTenantContext` / `requireTenantContext`, `loadSeatAssetsStoreForTenantId`, `resolveControlPlaneStorePathForClient`                                                            |
| **L2 Same-tenant employee**    | Agents: owned ∪ seat-granted ∪ steward. Collaboration spaces/sessions: owned ∪ seat-granted ∪ **roster membership (active/paused humans)** ∪ steward. Seat/ownership remains asset binding only — see [collaboration-space-authority-convergence-2026-08-08.md](./collaboration-space-authority-convergence-2026-08-08.md). | `resolveEmployeeWorkbenchActor`, `filterAgentsForEmployeeActor`, `resolveScopedAgentsForClient`, `isCollaborationSpaceVisibleToEmployeeUser`, spaces/sessions/workbench empty-on-fail |
| **L3 Same-employee bot/group** | Object ACL on `agentId` / `sessionKey` / `groupId` — list filtering alone is insufficient. Group session visibility MUST use the same membership predicate as space list (not `seatSpaceIds` alone). Bot-owner audit read is orthogonal and write-denied.                                                                   | `isSessionVisibleToEmployeeUser`, `isAgentOwnedByEmployeeUser`, `isCollaborationSpaceVisibleToEmployeeUser`, `collectVisibleCollaborationSpaceIdsForActor`, chat/files/space gates    |

## Hard rules

1. **Personal-workbench default fail-closed.** When `isPersonalWorkbenchClient(client)` or the caller is authenticated with `sessionDomain !== "platform"`, roster/list RPCs MUST NOT fall through to install-wide data if actor/tenant resolution fails. Return empty or steward-only via `resolveScopedAgentsForClient`.
2. **Single scope entry for agent rosters.** Handlers MUST use `resolveScopedAgentsForClient(client, agents)` (or equivalent). Forbidden: `actor ? filterAgentsForEmployeeActor(...) : result.agents`.
3. **MULTITENANT bans bare global seat I/O** when `tenantId` is known. Use `loadSeatAssetsStoreForTenantId` / `saveSeatAssetsStoreForTenantId`. See seat-binding hard rules.
4. **Incomplete session domain = employee shell deny/empty.** Member login MUST carry `sessionDomain=employee|enterprise`. Missing domain must not silently serve platform-wide rosters.
5. **Object-level ACL.** Any RPC that takes `agentId` / `groupId` / `sessionKey` on personal-workbench MUST assert visibility (or ownership for mutating ops). Do not assume “caller once saw it in a list”.
6. **Group write deny when actor missing.** On personal-workbench, unresolved actor ⇒ deny collaboration group writes (align with memory-center).
7. **Tenant id from membership, not body defaults.** Forbidden: `requestedTenantId ?? sessionTenantId ?? "001"`. Unresolved tenant ⇒ error or empty, never a hardcoded default.

## RPC classification

| Class               | Examples                                                                 | Behavior when scope missing                 |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------------------- |
| `platform-unscoped` | Operator platform console without user                                   | Full install view allowed                   |
| `tenant-scoped`     | enterprise organization / seat control-plane                             | Membership tenant; MULTITENANT tenant store |
| `employee-scoped`   | `agents.list`, `sessions.list`, `spaces.list`, robot-workspace list      | Empty / steward-only                        |
| `object-ACL`        | `chat.history`, `chat.send`, `agents.files.*`, `collaboration.space.get` | Deny inaccessible keys/ids                  |

## Forbidden patterns

```ts
// Forbidden — install-wide leak
const agents = actor ? filterAgentsForEmployeeActor(result.agents, actor) : result.agents;

// Forbidden under MULTITENANT + known tenantId
await loadEnterpriseSeatAssetsStore();

// Forbidden — default tenant hint
const tenantId = requested ?? sessionTenantId ?? "001";
```

## Target state (later phases)

- **P1 Tenant Agent Catalog:** employee-visible roster = ownership ∪ seat grants ∪ steward; stop enumerating global `agents.list` then filtering.
- **P2 Scope middleware:** method registry marks `requiredScope`; enforce at gateway method entry.

## Acceptance checklist

- [x] Design doc + hard rules published
- [x] `resolveScopedAgentsForClient` shared by `agents.list` / `agents.runtime-health` / robot-workspace
- [x] `chat.history` / `chat.send` personal-workbench session visibility (+ group write deny on null actor)
- [x] `agents.files.*` personal-workbench ownership/visibility gate
- [x] `collaboration.space.get` visibility gate
- [x] `mesh.ownership.list` no default `"001"`
- [x] High-risk bare seat loads switched to tenant loader where tenantId known
- [x] Regression tests + CI static guard for forbidden patterns
- [x] Manual prod probe (2026-08-06): `openbot-gateway-rc` has `OPENBOT_MULTITENANT=1` + `OPENBOT_DATA_MODE=managed` + `OPENBOT_TENANTS_ROOT`; live `agents.list` already fail-closed (steward-only fallback). `robot.workspace.*` on the running bundle still uses `actor ? filter : result.agents` — **needs image/overlay redeploy** of this source hardening. UI pin `index-shC303vx.js`.

## Production verification (manual)

1. Member account: AI 助手 rail = own bots + steward + seat-granted only.
2. Half-login / missing `sessionDomain`: list empty or steward-only — never other users' bots.
3. Two employees in same tenant: mutual invisibility of private bots and non-shared groups.
4. Valid member session: `chat.history` no longer `unresolved_tenant` (if it still does, fix session domain issuance separately).
5. After deploying this change-set: confirm `resolveScopedAgentsForClient` / chat session ACL appear in the active `gateway-cli-*.js` (robot-workspace no longer fail-open).
