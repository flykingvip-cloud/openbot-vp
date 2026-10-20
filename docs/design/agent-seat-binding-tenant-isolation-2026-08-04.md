# Agent seat binding — tenant isolation (hard rule)

Date: 2026-08-04  
Related: [agent-registry-unified-acl-adr-2026-07-31.md](./agent-registry-unified-acl-adr-2026-07-31.md), `src/gateway/platform-auth/seat-store-loader.ts`

## Hard rules

1. **Employee-created robots bind under the caller's seat in the authoritative tenant**, not the process-global seat-assets store.
2. When shared tenant addressing is on (`data.mode=managed` **and** `OPENBOT_MULTITENANT=1|true|yes|on`), the seat-assets source of truth is:

   `tenants/<tenantId>/control-plane/seat-assets.json`

3. The process-global `~/.openbot/openbot-enterprise-seat-assets.json` is allowed **only** when shared tenant addressing is off (local / single-tenant).
4. **Read/write symmetry**: create, seat heal, employee workbench visibility, and runtime agent→seat entitlement resolution for the same `tenantId` MUST use the same store file.
5. Request-body `tenantId` / `ownerUserId` / `ownerPositionId` are intent only; authoritative enterprise comes from the verified platform-auth membership session.

## Correct path

Use the single I/O seam:

- `resolveSeatAssetsStorePathForTenantId` / `requireSeatAssetsStorePathForTenantId`
- `loadSeatAssetsStoreForTenantId` / `saveSeatAssetsStoreForTenantId`
- `bindAgentAssetToSeatForTenant` — `attachSeatManagedAsset(agent)` + execute grant + tenant-path save

`agents.create` must call `bindAgentAssetToSeatForTenant` after server-side ownership resolution (`resolveAgentCreateOwnershipForClient`), which itself must load/save the **tenant** store when healing a personal seat.

## Forbidden patterns

When `tenantId` is known and shared addressing is on:

- `await loadEnterpriseSeatAssetsStore()` with no path (bare global)
- `await saveEnterpriseSeatAssetsStore(undefined, store)` for agent or seat ownership mutations
- Writing agent bindings only to the global store while runtime proof / model gate reads the tenant store (split-brain)

Fail closed: if shared addressing is on and the tenant seat-assets path cannot be resolved, throw — do not silently fall back to global for agent ownership.

## Acceptance checklist

- [ ] `OPENBOT_MULTITENANT=1` + managed mode: `agents.create` writes an active `assetType:"agent"` binding under `tenants/<tid>/control-plane/seat-assets.json`
- [ ] Same create does **not** add that agent binding to the global seat-assets file
- [ ] `resolveAgentRunEntitlementScope({ agentId })` resolves `seatId` from the tenant store (via ownership → tenant discovery when needed)
- [ ] Employee activation / seat assignment persists seats into the tenant store
- [ ] First chat after create is not blocked solely by missing tenant ownership proof
