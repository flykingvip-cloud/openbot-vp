# P1-2 Data-Status Inventory (redacted)

**Owner:** `cursor-data-governance`  
**Status:** Phase B inventory only — descriptive; no rewrite  
**Catalog baseline:** `FirstWaveResourceType = workspace | agent | conversation_archive` only (`src/gateway/data-governance/types.ts`). Durable catalog: `{stateDir}/data-governance/catalog.json`.  
**Finding:** **No Knowledge / Memory / Operational Identity Catalog rows exist today.** Envelope rejects `resourceType: "knowledge"` (`envelope.test.ts`).

Path legend: `{CONFIG_DIR}` OpenBot config; `{stateDir}` runtime state; `{dataRoot}` Data Space root; SaaS variants via `src/gateway/tenant-store-paths.ts`.

---

## A. Knowledge-like

| ID  | Class                          | Primary modules / paths                                                               | Identity keys               | Tenant/owner       | Catalog? | Dup/orphan | Migrate?   | Keep out of Catalog        |
| --- | ------------------------------ | ------------------------------------------------------------------------------------- | --------------------------- | ------------------ | -------- | ---------- | ---------- | -------------------------- |
| K1  | KB containers                  | `{CONFIG_DIR}/knowledge/bases.json` · `src/gateway/knowledge/knowledge-base-store.ts` | `kb.id`, `ownerId`          | ownerId, tenantId? | No       | Med        | Yes        | Bodies                     |
| K2  | KB members                     | `knowledge/base-members.json` · `knowledge-base-members.ts`                           | kbId + member               | via KB             | No       | Med        | Yes        | —                          |
| K3  | RAG index SQLite               | `knowledge/index/personal\|tenant/*.db` · `kb-index*.ts`                              | docId, versionId, chunk.id  | path-scoped        | No       | **High**   | Yes (meta) | **chunk text, embeddings** |
| K4  | In-index governance            | `knowledge/governance/**`                                                             | chunk/claim ids             | via index scope    | No       | High       | Unclear    | claim text                 |
| K5  | Knowledge lineage              | `knowledge-lineage-store.ts`                                                          | lineageId, deliverableId    | partial            | No       | Med        | Yes (refs) | bodies                     |
| K6  | Source bindings                | `source-bindings.json`, folder/passive connectors                                     | binding ids, kbId           | partial            | No       | **High**   | Yes        | credentials                |
| K7  | Explicit doc metadata          | `explicit-document-metadata.json`                                                     | docId                       | weak               | No       | High       | Yes        | doc text                   |
| K8  | Deliverables                   | `deliverable-*.json` · `knowledge/deliverables/**`                                    | deliverableId               | partial            | No       | Med        | Yes        | message bodies             |
| K9  | Skill assets                   | `skill-assets/store.json` · `skill-lifecycle-store.ts`                                | skill.id, ownerUserId       | present            | No       | **High**   | Yes        | skill bodies               |
| K10 | Enterprise data plane          | `openbot-enterprise-data.json` / tenant control-plane · `enterprise-data/store.ts`    | projection/binding/feed ids | tenantId           | No       | Med        | Yes        | business rows              |
| K11 | Enterprise projection bindings | `enterprise-knowledge-projection-binding-store.ts`                                    | bindingId                   | tenantId           | No       | Med        | Yes        | content                    |
| K12 | Semantic objects               | `openbot-enterprise-semantic-objects.json`                                            | objectId                    | tenantId           | No       | Low–med    | Yes        | field values               |
| K13 | Capability governance          | `governance/registry.json`                                                            | manifest.id                 | partial            | No       | Med        | Unclear    | manifests                  |
| K14 | Pack entitlements              | `tenant-pack-entitlements.json`                                                       | tenantId→packs              | present            | No       | Low        | No         | pack defs                  |
| K15 | UX sidecars                    | recent-visits, schedules, etc.                                                        | various                     | weak               | No       | Low        | No         | —                          |
| K16 | Learning applications          | group `learning-asset-applications.json`                                              | group ids                   | partial            | No       | Med        | Unclear    | content                    |
| K17 | Org artifacts/decisions        | `{orgWorkspace}/memory/{decisions,artifacts}.json`                                    | id, organizationId          | present            | No       | Med        | Yes        | content                    |

---

## B. Memory / CogniWeave

| ID  | Class                        | Primary modules / paths                                                                      | Identity keys    | Tenant/owner  | Catalog? | Dup/orphan | Migrate?             | Keep out of Catalog    |
| --- | ---------------------------- | -------------------------------------------------------------------------------------------- | ---------------- | ------------- | -------- | ---------- | -------------------- | ---------------------- |
| M1  | CogniWeave canonical         | `{dataRoot}/.meta/cogniweave/canonical.sqlite` (+ legacy stateDir) · `cogniweave-manager.ts` | atom id; scope   | partial       | No       | **High**   | Yes (min projection) | **bodies, embeddings** |
| M2  | Scope snapshots              | `{stateDir}/cogniweave/scopes/*.json`                                                        | scope hash       | partial       | No       | High       | No                   | doc text               |
| M3  | Sync outbox                  | `{stateDir}/cogniweave/outbox/`                                                              | atomId, tenantId | present       | No       | Med        | No                   | payloads               |
| M4  | Cloud mirror                 | `{stateDir}/cogniweave/mirror/`                                                              | atomId           | present       | No       | Med        | No                   | content                |
| M5  | Device runtime trees         | `.meta/cogniweave/{outbox,cursors,leases…}`                                                  | device ids       | partial       | No       | Low        | No                   | all                    |
| M6  | Builtin memory SQLite        | `{stateDir}/memory/{agentId}.sqlite` · `memory-search.ts`                                    | agentId          | weak          | No       | **High**   | Yes (proj)           | **embeddings, chunks** |
| M7  | Workspace MEMORY.md          | `{agentWorkspace}/MEMORY.md`, `memory/**/*.md`                                               | path             | via workspace | No\*     | **High**   | Yes                  | bodies                 |
| M8  | Session-memory hooks         | dated md under workspace                                                                     | sessionKey       | partial       | No       | Med        | Unclear              | summaries              |
| M9  | QMD backend                  | `agents/{agentId}/qmd/**` · `qmd-manager.ts`                                                 | agentId          | weak          | No       | **High**   | Unclear              | index+vectors          |
| M10 | Data Space memory layout     | `{dataRoot}/memory/**`, `agents/*/memory/**` · `memory-lifecycle.ts`                         | agentId+key      | partial       | No       | **High**   | Yes                  | files                  |
| M11 | Org/space memory             | org/managed space memory dirs                                                                | organizationId   | present       | No       | Med        | Yes                  | journals               |
| M12 | Collaboration group memory   | `groups/{groupId}/memory/**`                                                                 | groupId          | present       | No       | High       | Yes                  | md bodies              |
| M13 | Conversation catalog         | `{dataRoot}/.meta/conversations/catalog.sqlite`                                              | conversationId   | partial       | No       | Med        | Yes (identity)       | transcripts            |
| M14 | LanceDB plugin               | `extensions/memory-lancedb/` (~/.openclaw/memory/lancedb)                                    | entry id         | **missing**   | No       | **High**   | Unclear              | **vectors+text**       |
| M15 | Steward support memory       | `steward-memory/{tenant}__{user}.json`                                                       | tenant+user      | present       | No       | Low        | Yes                  | prefs text             |
| M16 | Enterprise memory gov scopes | seat-assets enterprise memory APIs                                                           | scopeId, seatId  | present       | No       | Low        | Yes                  | content                |
| M17 | Memory Center projection     | in-process `memory-center-atoms.ts`                                                          | atom id          | n/a           | No       | —          | No                   | bodies                 |

\* Workspace may already have a first-wave Catalog row; memory files do not.

---

## C. Operational Identity & continuity

| ID   | Class                          | Primary modules / paths                                      | Identity keys                           | Tenant/owner  | Catalog? | Dup/orphan | Migrate?              | Keep out of Catalog |
| ---- | ------------------------------ | ------------------------------------------------------------ | --------------------------------------- | ------------- | -------- | ---------- | --------------------- | ------------------- |
| OI1  | User OI metadata               | `openbot-user-operational-identity.json` (+ SaaS user state) | identityId, ownerId, credentialHandleId | present       | No       | Med        | Yes                   | —                   |
| OI2  | User OI secrets                | `openbot-user-operational-identity-secrets.json`             | credentialHandleId                      | via handle    | No       | High       | **No**                | **entire store**    |
| OI3  | Grants / requests / usage      | embedded in OI1 store                                        | grantId, requestId                      | present       | No       | Med        | Yes                   | secret payloads     |
| OI4  | Continuations                  | OI1 `continuations`                                          | continuationId                          | present       | No       | Med        | Yes (refs)            | executionPayload    |
| OI5  | Enterprise OI                  | `openbot-enterprise-seat-assets.json` / tenant seat-assets   | identityId, tenantId                    | present       | No       | Med        | Yes                   | credentials         |
| OI6  | Enterprise OI secrets          | `openbot-enterprise-operational-identity-secrets.json`       | credentialBindingId                     | tenantId      | No       | High       | **No**                | **entire store**    |
| OI7  | Enterprise data OAuth sessions | `openbot-enterprise-data-oauth-sessions.json`                | session ids                             | partial       | No       | Med        | No                    | tokens              |
| OI8  | WeChat component tickets       | wechat ticket store                                          | ticket refs                             | weak          | No       | Low        | No                    | secrets             |
| OI9  | Agent registry (AgentAsset)    | `openbot-agent-registry.json` · `agent-registry/store.ts`    | agentAssetId, enterpriseId              | present       | No       | Med        | Yes (continuity refs) | persona bodies      |
| OI10 | Agent growth / working style   | `{agentDir}/growth-status.json`, `working-style.json`        | agentId                                 | partial       | No       | Med        | Yes (refs)            | dossier text        |
| OI11 | Workspace persona files        | SOUL.md / AGENTS.md / USER.md                                | path                                    | via workspace | Indirect | High       | Yes (refs)            | bodies              |
| OI12 | Ownership records              | `ownership-store.ts` / organization                          | record ids                              | partial       | No       | Med        | Unclear               | —                   |

---

## Cross-cutting risks (Phase C inputs)

1. **Knowledge identity fan-out:** same logical doc across K1→K3→K9→K10 without shared `resourceId`.
2. **Memory multi-index:** M7↔M6↔M1↔M9↔M14 overlap with path/agent scoping only.
3. **OI metadata vs secrets split:** Catalog may envelope OI1/OI5; never OI2/OI6.
4. **Tenant isolation debt:** many `{CONFIG_DIR}/knowledge/**` and `openbot-*` files are global single-file; managed isolation depends on resolvers not uniformly applied.
5. **Do not invent a parallel Catalog** — extend `src/gateway/data-governance/**`.

### Migration priority (suggested)

| Priority            | Classes                                          |
| ------------------- | ------------------------------------------------ |
| P0 envelope         | K1, K3 (meta), K10–K12, M1, M7, OI1, OI5, OI9    |
| P1 derived bindings | K6, K9, M6, M10–M13, OI3–OI4, OI10–OI11          |
| Exclude             | OI2, OI6–OI8, M2–M5, M14 (until policy), K14–K15 |

---

## Module map

| Domain           | Key trees                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Knowledge        | `src/gateway/knowledge/**`, `src/gateway/enterprise-data/**`, `src/gateway/skill-lifecycle-store.ts`                            |
| Memory           | `src/memory/**`, `packages/cogniweave-sdk/**`, `src/conversations/catalog/**`, `extensions/memory-lancedb/**`                   |
| OI               | `src/gateway/user-operational-identity*.ts`, `src/gateway/enterprise-operational-identity*.ts`, `src/gateway/agent-registry/**` |
| Existing Catalog | `src/gateway/data-governance/**`                                                                                                |
