# P1-2 Design Checklist — Knowledge / Memory / Operational Identity

**Owner:** `cursor-data-governance`  
**Status:** Gate **Accepted**; Phase C implementation **unlocked**  
**Depends on:** `gate-p1-2.md` (Accepted), `inventory-p1-wave2.md`  
**Architecture:** `docs/design/openbot-data-governance-architecture-v2-2026-08-10.md` (§6–7, §16 P1)

## 1. Resource types & stable IDs (**frozen**)

Extend envelope `resourceType` beyond first wave (today: `workspace | agent | conversation_archive` in `types.ts`):

| Type                                   | `resourceType`                    | Stable `resourceId`                                    | Domain key(s)                                                                                            |
| -------------------------------------- | --------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **Knowledge Asset**                    | `knowledge`                       | `knowledge:{tenantOrLocal}:{docVersionOrProjectionId}` | **Document version** (`docId`+`versionId`) **or** enterprise **projection** id — **not** KB container id |
| Knowledge Base (container)             | _(not a Catalog Knowledge Asset)_ | —                                                      | KB is **scope/container** metadata on the asset / bindings only                                          |
| Knowledge index (RAG SQLite / vectors) | —                                 | —                                                      | **derived** / **cache** storage bindings only — never canonical Knowledge Asset                          |
| Memory Asset                           | `memory`                          | `memory:{tenantOrLocal}:{atomOrSourceId}`              | See §4 Memory canonical freeze                                                                           |
| Operational Identity                   | `operational_identity`            | `operational_identity:{tenantOrLocal}:{identityId}`    | User/enterprise `identityId`                                                                             |

### Knowledge grain freeze (Codex P1)

1. **Knowledge Asset** = document version **or** enterprise projection (one canonical identity per asset).
2. **KB** = scope/container (membership, visibility) — not the Catalog resource grain.
3. **Index** = `derived` / `cache` binding on the Knowledge Asset — never a second writable canonical.

Rules:

- `agentId` / path / filename are never durable identity.
- Existing domain IDs remain authoritative in domain stores; Catalog stores **projection + binding**, not a second SoT.

## 2. Envelope MVP (fail-closed required tier)

Reuse `GOVERNANCE_ENVELOPE_SCHEMA_VERSION` + required fields from first wave:

`resourceId`, `resourceType`, `schemaVersion`, `tenantId` (null only Personal Local), `owner`, `scope`, `lifecycleState`, `classification`, canonical `StorageBinding`.

Per-type extras (Catalog metadata only):

- Knowledge: `kbId?`, `docId?`, `contentClass` (fact/manual/projection), `sourceBindingRef?`
- Memory: `atomId?`, `memoryTier?`, `sourceWorkspaceResourceId?` — **no claim body**
- OI: `identityId`, `provider?`, `credentialHandleId?` (**handle ref only**), `agentAssetId?` continuity pointer

## 3. Canonical binding

- One **active writable** canonical binding per owner scope + resource.
- Knowledge: canonical = governed KB/index locator or enterprise control-plane object; skill-assets / RAG indexes may be `derived` / `cache`.
- Memory: **Managed** canonical = CogniWeave; **Personal Local** may use Markdown root when CogniWeave absent; builtin/QMD/LanceDB = `derived`/`cache`.
- OI: canonical = metadata identity record; secrets store is **never** a Catalog binding target.

## 4. Memory split + canonical freeze

| Profile                | Canonical Memory Asset                                                                                          | Derived / cache                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Managed Enterprise** | **CogniWeave** portable canonical store only                                                                    | builtin SQLite, QMD, LanceDB, workspace markdown indexes |
| **Personal Local**     | CogniWeave when present; otherwise **workspace Markdown root** (`MEMORY.md` / `memory/**`) allowed as canonical | other local indexes as derived/cache                     |

| In domain store                  | In Catalog                                                      |
| -------------------------------- | --------------------------------------------------------------- |
| Atom/claim bodies, evidence text | `resourceId`, owner/scope, lifecycle, classification            |
| Embeddings / vectors             | Binding role `derived`/`cache` — **no vectors**                 |
| Workspace `MEMORY.md` bodies     | Binding to workspace `resourceId` when Personal Local canonical |

Allowlist for Memory Catalog projection: identity keys, owner/scope refs, lifecycle, classification, canonical locator, source/derived binding refs, governanceVersion.

## 5. Operational Identity ↔ AgentAsset continuity

- Continuity manifest **references** OI `resourceId` + AgentAsset id (registry).
- Do **not** copy credentials, Persona/Capability bodies, or Working DNA text into Catalog or AgentAsset.
- Agent registry (`openbot-agent-registry.json`) remains AgentAsset SoT; Catalog adds envelope for OI and optional continuity link fields.

## 6. Write paths (fail-closed)

Candidates (after Gate ack; phased):

- Knowledge index ingest / KB mutate / enterprise projection materialize
- Memory atom promote / builtin index write when managed
- OI identity create/bind (metadata path only; secrets stay secret-store)

Deny when: Catalog unavailable, envelope invalid, ownership proof missing, wrong tenant, duplicate active canonical.

Reuse first-wave patterns: pending→active, operation markers, compensate + `recovery_required`, no hard Catalog delete before quarantine.

## 7. Inventory API

Extend `FirstWaveResourceType` → `GovernedResourceType` including the three new types.

- `dataGovernance.inventory.list|get|diagnose` accept new types.
- Tenant isolation: managed callers require exact `tenantId` (null denied) — same as first wave.
- Add `lifecycleState` filter (closes Gate A3 debt) before or with Phase C.

## 8. Diagnostics

Reuse + extend:

- `diagnoseDuplicateCanonicals`
- `diagnoseOrphanLocators` (observed Knowledge/Memory/OI locators)
- Wrong owner scope: new check comparing envelope.owner/scope vs authoritative seat/membership/AgentAsset proof

## 9. Migration

```text
inventory (inventory-p1-wave2.md classes)
  → classify owner/scope or unknown
  → create pending Catalog rows + canonical binding
  → dual-read verify
  → single-writer cutover
```

Invariants:

- Idempotent re-run (same resourceId).
- Failure: no dual write; no two active canonicals; leave `recovery_required` + receipt.
- Secrets stores (OI2/OI6) are **never** migrated into Catalog.

## 10. Non-goals

- P2 archive/restore/forget/purge/legal hold/tombstone propagation
- Storing Knowledge/Memory bodies or embeddings in Catalog
- Rewriting CogniWeave schemas / LanceDB plugin
- UI Memory Center / Knowledge Universe redesign
- Parallel second Catalog

## 11. File ownership map (intended Phase C)

| Touch                | Paths                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Yes                  | `src/gateway/data-governance/**`, `src/gateway/server-methods/data-governance*.ts`, targeted knowledge/memory/OI **registration hooks** only |
| Careful / coordinate | `src/gateway/knowledge/**`, `src/memory/cogniweave-manager.ts`, `src/gateway/*operational-identity*`, `src/gateway/agent-registry/**`        |
| Do not claim         | Architecture docs owned by Codex; unrelated UI; P2 lifecycle modules                                                                         |

## 12. Test matrix (Phase C)

```bash
# Directed P1-2 (to be added)
OPENBOT_TEST_PROFILE=low pnpm test src/gateway/data-governance/

# First-wave regression (must stay green)
OPENBOT_TEST_PROFILE=low pnpm test \
  src/gateway/data-governance/ \
  src/gateway/server-methods/data-governance.test.ts \
  src/gateway/server-methods/agents-mutate.test.ts \
  src/gateway/workspace/handler-bridge.test.ts
```

Fault injection: Catalog down, missing ownership, duplicate canonical, migration crash mid-cutover, compensate secondary failure (reuse Round 8 patterns).

## Open design decisions (resolved for Gate Repair)

1. **Knowledge grain — frozen:** Knowledge Asset = document version or enterprise projection; KB = container/scope; index = derived/cache.
2. **Memory canonical — frozen:** Managed = CogniWeave; Personal Local may use Markdown root when CogniWeave absent.
3. **A3 listability — closed in Gate Repair:** `lifecycleState` filter + `listRecoveryRequired` + receipt list/read RPCs + operator runbook.
