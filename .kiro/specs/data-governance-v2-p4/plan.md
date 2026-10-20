# P4 Plan — Governed Placement and Sync

**Owner:** `cursor-data-governance`  
**Acceptance:** `codex-data-governance`  
**Status:** **P4 Accepted** (first-wave scope, closure `4dd0da593f`, 2026-08-18). Later adapters locked.  
**Architecture:** §12, §16 P4, §17.5 in `docs/design/openbot-data-governance-architecture-v2-2026-08-10.md`  
**Prerequisite:** P3 Accepted (`84a4165093`); Gate B Accepted (CR6 `57b2bc94a7` / pin `7009d2fe70`)

## Sequence (mandatory)

```text
P3 Accepted
  → P4 Gate (this package) → Codex Gate Accept
  → P4-a / P4-b / P4-c / P4-d  (each slice independently Accepted)
  → P4 first-wave Accepted
  → later adapters (tenant cloud / BYOS / cold archive / dedicated) — separate unlock
```

Hard rules:

- P3 Accept **does not** unlock P4 coding. **P4 Gate Accept** unlocked P4-a only.
- P4-b/c/d stay locked until the prior slice is Accepted.
- Promotion **decision** is already frozen in P3: `decideShadowPromotion`. P4 executes; it does not re-judge.
- First-wave adapters are **local** + **managed encrypted cloud** only. BYOS and other modes stay fail-closed until a later unlock.
- This Gate Accept is **planning only**. It is not P4 Accepted and not production-code acceptance.

## First wave (after Gate Accept)

| Slice | Deliverable                                                                                    |
| ----- | ---------------------------------------------------------------------------------------------- |
| P4-a  | Placement / residency policy resolver (inputs frozen in `gate-p4.md` D3)                       |
| P4-b  | Signed, tenant-bound promotion protocol + durable receipt (decision = `decideShadowPromotion`) |
| P4-c  | Local + managed encrypted cloud adapters; key / region selection                               |
| P4-d  | Export / restore across placement changes (binding change only)                                |

## Later adapters (not first wave)

Unlocked only by first-wave operational evidence + separate authorization:

- tenant managed cloud
- BYOS
- cold archive
- dedicated regional placement

## Non-goals

- Replacing or forking `decideShadowPromotion`
- Auto-admit Catalog inserts (G6 retained)
- Engine-issued P2 `requestPurge` / `forget`
- Changing `resourceId` / `agentAssetId` when placement changes
- Editing Codex-owned architecture documents
- P5 longevity coding (separate Gate; coding locked until P4 first-wave Accept)
