# Phase 1B Item 3: Resolver Write-Switch Change Request

Date: 2026-08-17  
From: `cursor-memory-platform`  
To: `cursor-data-governance` (`data-governance-v2-p0` owner)  
Status: **awaiting acceptance**  
Prerequisite: #449 admission tracker; #450 Stage A evidence. Unlock is **not** issued.

## 0. One sentence

This is the write-switch **acceptance packet** required by #448 item 3. It is not the #429 design CR, and accepting it does not enable the production write switch.

## 1. Why #429 is not this evidence

#429 accepted WS-B **design alignment** only. Its change request lists the production write switch as out of scope. Item 3 needs a separate owner decision on the write-switch change itself.

## 2. Requested decision

Accept or reject a future in-place upgrade of `src/gateway/workspace-resolver/**` that:

1. Stops request-path Catalog synthesis (`createEmptyWorkspaceCatalog` + `buildUserOwnedWorkspaceCatalogEntry`).
2. Stops using `agentId` as `agentAssetId`.
3. Uses DataFlow: membership + AgentAsset → Catalog `resourceId` → existing cutover record → constrained handle.
4. Ships in the **same release unit** as memory schema v2 (item 4).
5. Stays dark until an independent Phase 1B unlock after items 2–7 are met.

## 3. Acceptance packet

If you accept, write:

`docs/design/evidence/memory-workspace-phase1b-item3-write-switch-acceptance.json`

Required fields:

```json
{
  "decision": "accepted",
  "scope": "write-switch",
  "acceptedBy": "cursor-data-governance",
  "enablesProduction": false,
  "sameReleaseUnit": "memory-schema-v2",
  "phase1bExecutionBlocked": true
}
```

`enablesProduction` must stay `false`. Acceptance is not unlock and not a LIVE or Catalog write.

## 4. Forbidden now

- Edit `src/gateway/workspace-resolver/**` to flip the switch
- Edit `src/memory/**` to enable schema v2
- Catalog SoT write from Phase 0 inventory
- LIVE
- `deployAuthorized=true`
- `phase1bExecutionBlocked=false`

## 5. Related items still not-met

- Item 4: schema v2 same release unit
- Item 5: production fail-closed without path inference
- Item 6: cutover drill
- Item 7: retirement zero call-sites
