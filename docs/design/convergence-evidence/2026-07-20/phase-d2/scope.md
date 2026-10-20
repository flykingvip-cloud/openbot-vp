# Phase D2 — scope

**Agent:** `cursor-convergence-phase-d2`  
**Worktree:** `/Users/daniel/AI项目/openbot-convergence`  
**Branch:** `convergence/2026-07-20`  
**Start HEAD:** `8e89f4f711` (includes post-D1 monthly-usage landings by others — not modified by D2)

## Included

| ID  | Change                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | `resolveSessionStorePathForInboundMessage` + wire `auto-reply/reply/session.ts` so inbound writes use tenant store under multitenant |
| S2  | `promoteGlobalSessionEntryIfNewer` + call from `loadSessionEntryForClient` on history load                                           |
| S3  | Prefer global when tenant entry is newer but transcript empty/missing                                                                |
| S4  | Multitenant-off → global path (tested)                                                                                               |
| S5  | Membership resolve fail → fail-open global in inbound path (documented in code)                                                      |

## Sources (transplant)

| Shared SHA   | Subject                                                |
| ------------ | ------------------------------------------------------ |
| `6dd76e0fc6` | promote global transcripts + inbound tenant store path |
| `b3ad8a9138` | promote over empty newer tenant entries                |

Manual port into worktree (not whole-branch cherry-pick).

## Excluded

- D3 checkpoint / transcript thin pack
- D4 knowledge
- monthly-usage product (already on HEAD; D2 did not touch)
- method-scopes / app.ts WIP
