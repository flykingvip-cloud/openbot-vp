# S01 Stage C identity mapping

Grounded in Stage A adapters + CR2 honest production ports on `main` `1955a570d3892cdec28ca0334cb83aa37d6a1fa7` (#851 CR1 landed; #853 C1-C5 PREP on main; #857 CR2 honest ports landed):

- `src/gateway/data-governance/s01-steward-workspace-identity.ts`
- `src/gateway/data-governance/s01-authorized-tool-cwd.ts`
- Stage B shadow evaluator `src/gateway/data-governance/s01-get-reply-steward-cwd-shadow.ts` (read-only; not edited)
- `src/gateway/workspace-resolver/builders.ts` `buildWorkspaceResourceId`

**InMemory is test-only.** CR2 #857 landed honest `S01ReadOnlyDurableCatalogView` + `createProductionS01StewardRegistryPort` (not InMemory, not forged). CR1-A status `landed-via-857-honest-ports`. Still no real production receipts; `readyForStageCAccept=false`. This document does not forge adapters and does not request Stage C Accept.

## Chain (fail-closed if any hop misses)

| Step | Field                    | Source on main                                                                                                                                                                          |
| ---- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `tenantId`               | Trusted TenantContext. Not wire `tenantId` / `S01WireIdentityProbe`.                                                                                                                    |
| 2    | `employeeOwnerId`        | Verified session / PlatformAuth. Identity input `employeeOwnerId`.                                                                                                                      |
| 3    | steward agent slug       | `S01_STEWARD_SLUG = "main"`. Tenant-scoped `agentId` only. Not `resourceId` / `agentAssetId`.                                                                                           |
| 4    | `agentAssetId`           | `S01StewardRegistryPort.resolveUniqueAgentAssetId({ tenantId, agentId })`. Unique hit required. Slug must not equal asset. Factory `createInMemoryS01StewardRegistryPort` is test-only. |
| 5    | `workspaceResourceId`    | `buildWorkspaceResourceId` `user_owned` → `ws:{tenantId}:user:{employeeOwnerId}:asset:{agentAssetId}`                                                                                   |
| 6    | canonical active binding | `catalog.getResource` + `listBindingsForResource` filtered `role=canonical`. Unique. `state=active`.                                                                                    |
| 7    | authorized locator       | `binding.locator`. Absolute POSIX. No NUL. No `..`.                                                                                                                                     |
| 8    | versions                 | `resource.governanceVersion`, `binding.contentVersion`, `fencingToken { contentVersion, bindingId }`                                                                                    |

`targetIdentity` must not be null. Expected role/state are literals `canonical` / `active`.

Cwd hop (`evaluateS01AuthorizedToolCwd`): attested `S01TrustedPrincipal` + `S01MembershipPort` (not an array) + `targetIdentity` + lexical path inside locator. Success `accessMode=authorized`. Missing principal/membership/secret is CR1 `fail_closed_missing_authorization` (now on main via #851). get-reply still does not inject those ports.

## Test-only worked example (InMemory; NOT production)

From `s01-steward-workspace-identity.test.ts` / shadow tests:

| Field               | Value                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| tenantId            | `ent-456`                                                                                        |
| employeeOwnerId     | `usr-123`                                                                                        |
| stewardAgentSlug    | `main`                                                                                           |
| agentAssetId        | `asset-steward-1`                                                                                |
| workspaceResourceId | `ws:ent-456:user:usr-123:asset:asset-steward-1`                                                  |
| canonical bindingId | `ws:ent-456:user:usr-123:asset:asset-steward-1:canonical`                                        |
| role / state        | `canonical` / `active`                                                                           |
| authorized locator  | `/workspace/steward`                                                                             |
| governanceVersion   | `1`                                                                                              |
| contentVersion      | `v1`                                                                                             |
| fencingToken        | `{ contentVersion: "v1", bindingId: "ws:ent-456:user:usr-123:asset:asset-steward-1:canonical" }` |

Do not copy these ids into production Catalog.

## Production gap (CR1-A landed-via-857-honest-ports)

get-reply shadow call on main is `runS01GetReplyStewardCwdShadowFromEntry` and passes only `stewardException`, `employeeOwnerId`, `stewardAgentId`, `tenantId`, `userId`, `helperCwd`. No catalog, registry, principal, memberships, or attestation secret as call arguments. Flag default off, so production deps are not loaded. When the flag is on, FromEntry loads honest CR2 ports; steward `"main"` still fail-closes as `catalog_miss`. Production observation of `identity_and_authorization_match` is still absent (`productionReceiptsObserved=0`). This packet does not inject ports into get-reply and does not request Stage C Accept.

Item 7 `src/gateway/item7-stage-c-identity-shadow.ts` is a different workstream (C1–C5 memory index). Reused read-only. Not S01 cwd cutover.
