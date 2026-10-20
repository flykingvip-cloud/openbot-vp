# OpenBot CogniWeave Memory Engine v2 Implementation Plan

> **Status:** Team-review revision — **implementation baseline v1.2** | Revised: 2026-07-16  
> **Canonical copy:** `openbot-rc` (this file). Product repo `openbot` keeps a byte-synced mirror.  
> **Scope:** OpenBot local runtime, managed SaaS, enterprise asset governance, standalone `@cogniweave/sdk`  
> **Related design:**
>
> - [Data Space model](./openbot-data-space-model-v1-2026-07-10.md)
> - [SaaS tenant data architecture](./openbot-saas-tenant-data-architecture.md)
> - [Tenant context propagation](./tenant-context-propagation-plan-2026-07-11.md)
> - Knowledge RAG / Space Unification (boundary: [section 4.4](#44-boundary-with-knowledge-systems))  
>   **Principles:** Incremental evolution of the current canonical runtime; **no second memory system**; **no next Phase until Gate passes**.

---

## 0. Revision history

### 0.1 v1.0 to v1.1 (feasibility review)

Honest maturity tiers, State Dir vs Data Root split, stable checksum metadata whitelist, Knowledge boundary, SLA tiers, distillation defaults, dual-source injection sketch, sprint sizing, pre-spec checklist.

### 0.2 v1.1 to v1.2 (team static review — blocking items)

| Finding                                                        | v1.2 response                                                                                                                                                   |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Block]** P0 op-key depended on P3 `MemorySubject`           | Add **CW2-P0-00**: immutable `MemoryPartitionKeyV1`; full tenant/seat ACL stays P3. Separate **`operationKeyVersion`** from DB **`schemaVersion`**.             |
| **[Block]** Forget/Purge multi-source Atom semantics undefined | Add **CW2-P1-00**: normalized **`source_object_links`**; unlink → recompute → tombstone only when no live sources remain.                                       |
| **[High]** Data Space migration crash recovery incomplete      | P1: durable migration state machine, cutover point, write freeze, binary compat matrix, roll-forward / reverse-replay protocol.                                 |
| **[High]** Outbox exported with `.meta`                        | Portable vs non-portable split; outbox/cursors/leases **never** in export; reset on restore.                                                                    |
| **[High, pre-P5 block]** Cloud auth / anti-replay missing      | P5 Gate requires authn, tenant binding, device identity, server-side subject, signatures, idempotency, rate limit, KMS/residency; cross-tenant false allow = 0. |
| **[Med]** Dual-source suppresses Markdown too early            | Atom suppresses Markdown only when active + full provenance + Admission + coverage thresholds met.                                                              |
| **[Med]** Maturity/SLA optimistic                              | SQLite = durable MVP until P0/P1; add recovery time, write amplification, journal/atom ratio, growth and compact size caps.                                     |
| **[Low]** Mintlify anchors / trailers                          | Phase titles use ASCII hyphens; commit messages include Task/Agent trailers where process requires.                                                             |

**Formal conclusion after v1.2:** Direction and sequencing remain correct. This document is the **implementation baseline for starting P0 spec**. P2–P6 detail may evolve; **P0 must not wait** on them once CW2-P0-00 contracts are accepted.

---

## 1. Purpose

Convert CogniWeave Memory Engine v2 product intent into an executable engineering plan for **spec intake**.

Keep and harden:

| Capability            | Primary path (openbot-rc)                                                         |
| --------------------- | --------------------------------------------------------------------------------- |
| Session / file ingest | `src/memory/cogniweave-manager.ts`                                                |
| Runtime search entry  | `getMemorySearchManager().search()` via `src/memory/search-manager.ts`            |
| Canonical metadata    | `@cogniweave/sdk` + default `stateDir/cogniweave/canonical.sqlite`                |
| Domain objects        | `EventSkeleton`, `MemoryAtom`, `EvidenceRecord`, `RelationRecord`, `WriteJournal` |
| Scope (today)         | `workspaceId` + `projectId` + `agentId` + `visibility: private\|shared`           |
| SDK surface           | models / runtime / adapters / REST / CLI                                          |

This plan defines: phase order, contracts, red lines, migration, gates, rollback, task packs, and pre-spec checklist.

---

## 2. Hard principles

1. **Local-first.** Raw chats, files, tool outputs, and enterprise materials stay on user- or enterprise-controlled data planes by default.
2. **Do not rebuild atoms.** Extend claim/trigger/applicability/provenance/versioning/conflict/metrics. Never collapse to `type + content`.
3. **Cloud is not Phase 0.** Idempotency, non-growing recovery, Forget closure, and portable canonical come first.
4. **Cloud Intelligence = governed minimal projection.** Not a raw replica; not agent runtime identity authority.
5. **Enterprise memory reuses seat ownership / transfer class / AccessPolicy.** No parallel ownership system.
6. **Local retrieval works offline.** Cloud pulls into a local mirror first.
7. **Security filters before ranking.** Tenant → Principal → Ownership/ACL → Privacy → Lifecycle → Applicability → Rank.
8. **Three scores stay separate.** Admission / Retrieval / Promotion ([section 7.4](#74-three-independent-scores)).
9. **Operation identity is stable across ACL upgrades.** Partition keys and operation keys must not churn when P3 subjects land.
10. **Portable export never includes delivery queues.** Outbox, device cursors, and claim leases are device-local runtime state.

### 2.1 Phase order (gates are serial)

```text
P0 Reliability
  -> P1 Data Sovereignty
    -> P2 Memory Domain v2
      -> P3 Enterprise Scope (full MemorySubject + seat ACL)
        -> P4 Retrieval Engine
          -> P5 Cloud Intelligence Sync
            -> P6 Governance UI
```

P0 includes a **minimal immutable partition identity** ([CW2-P0-00](#51-cw2-p0-00-memorypartitionkeyv1-and-operation-key-contract)).  
P1 includes **multi-source link semantics** ([CW2-P1-00](#61-cw2-p1-00-source_object_links-and-forgetpurge)).  
P3 upgrades **authorization**, not operation-key shape.

### 2.2 Effort band (single squad, planning only)

| Phase     | Band                | Notes                                                  |
| --------- | ------------------- | ------------------------------------------------------ |
| P0        | 2–3 weeks           | Includes CW2-P0-00 + real history DB soak              |
| P1        | 2.5–3.5 weeks       | Includes CW2-P1-00 + migration FSM                     |
| P2        | 1.5–2 weeks         | Additive fields + policy registry                      |
| P3        | 2–3 weeks           | TenantContext + seat bridge                            |
| P4        | 2–4 weeks           | Embeddings maturity dependent                          |
| P5        | 3–5 weeks           | Only after P0–P3 gates green                           |
| P6        | 2–3 weeks           | After P1/P2 semantics stable                           |
| **Total** | **~1.5–3 quarters** | Tasks may parallelize inside a phase; **gates do not** |

---

## 3. Baseline (code-verified)

### 3.1 Maturity (honest)

| Capability                     | Today                                        | Maturity label                                                                                                                 |
| ------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| SDK domain model               | Full typed models + engine API               | **Strong baseline**                                                                                                            |
| Local SQLite canonical         | Durable writes/transactions/journal          | **Durable MVP** — **not** single-node production until P0/P1 gates (no migration ladder, no Forget closure, unstable recovery) |
| OpenBot bridge                 | File/session → writeBack → search            | **Usable MVP**                                                                                                                 |
| private / shared mapping       | group/space → shared heuristics              | **Usable**                                                                                                                     |
| Object dedup                   | `event_key` UNIQUE, `dedup_key`              | **Partial** (objects merge; **ops not idempotent**)                                                                            |
| Postgres / Neo4j / pgvector    | Adapter skeletons                            | **Prototype**                                                                                                                  |
| Embedded graph/vector          | `backend: "memory"`                          | **Non-durable derived**                                                                                                        |
| Real vector search             | sync/rebuild only; evidence = tokens         | **Not implemented**                                                                                                            |
| LLM distillation               | Hard-off in OpenBot                          | **Product closed**                                                                                                             |
| Schema migrations              | Writes `schema_version=1` only               | **Missing ladder**                                                                                                             |
| Forget → canonical             | File unlink only                             | **Broken loop**                                                                                                                |
| Export includes canonical      | Store under stateDir                         | **Broken sovereignty**                                                                                                         |
| tenant / user / seat subject   | Not on Scope                                 | **Missing (P3 ACL)**                                                                                                           |
| seat ownership wired to memory | Control plane exists; memory engine does not | **Not wired**                                                                                                                  |
| outbox / promotion / tombstone | Absent                                       | **Missing (P5)**                                                                                                               |

### 3.2 Confirmed gaps by phase

| Gap                                                    | Impact                                     | Phase                  |
| ------------------------------------------------------ | ------------------------------------------ | ---------------------- |
| No immutable partition key for ops                     | P3 subject migration would rewrite op keys | **P0-00**              |
| `operationKey` not versioned separately from DB schema | Schema bump creates new ops for same input | **P0-00**              |
| Snapshot restore via full `writeBack`                  | Journal explosion                          | **P0**                 |
| Unstable metadata in checksum (`syncReason`)           | Event key churn                            | **P0**                 |
| Multi-source Atom delete undefined                     | Cascade false-delete / residual content    | **P1-00**              |
| Forget does not touch canonical                        | Product promise fails                      | **P1**                 |
| Migration state in process memory only                 | Crash mid-cutover unsafe                   | **P1**                 |
| `.meta` fully exported                                 | Would ship outbox after restore            | **P1 export boundary** |
| No Cloud auth / anti-replay contract                   | Cannot open commercial sync                | **P5 gate**            |

### 3.3 Observed write amplification (dev sample)

- ~2.8k unique events vs ~180k ingestion / completed journals (~**65×** op inflation)
- ~165 MB completed journal payload
- Some event keys recorded >1000 times

Object layer is partly idempotent; **operation log and recovery paths are not**.

### 3.4 Data-plane split

```text
State Dir (~/.openbot/)                 Data Root (data.root)
├── cogniweave/canonical.sqlite         ├── agents/<id>/memory/   ← Forget today
├── cogniweave/scopes/*.json            ├── conversations/archive/
└── config / credentials / sessions     ├── shared/knowledge/
                                        └── .meta/ (export today may recurse all)
```

Target: portable canonical under `data.root/.meta/cogniweave/`; **non-portable runtime** (outbox, leases, device cursors) under state dir or an explicit **non-export** subtree.

---

## 4. Target architecture

### 4.1 Runtime flow

```text
User Request
  -> Agent Runtime
    -> Working Context
      -> Local Memory Query
        -> ACL / partition / lifecycle first
        -> Canonical + FTS + Vector + Graph candidates
          -> Merge / Rerank / Diversity / Conflict
            -> Context budget
              -> Explainable injection
                -> LLM Response

Experience path:
Capture -> Distill (rule | optional LLM)
  -> Admission
    -> Consolidation / dedup
      -> Canonical commit + WRITE journal
        -> Derived update (rebuildable)
          -> Promotion (optional)
            -> Outbox enqueue (same local txn, non-portable)
              -> Cloud Intelligence
                -> Async pull -> Local Intelligence Mirror
```

### 4.2 Storage layout (target)

```text
Data Space (data.root)                          # portable with export filters
├── .meta/
│   └── cogniweave/
│       ├── canonical.sqlite                    # portable truth
│       ├── migrations/
│       ├── backups/
│       └── EXPORT_MANIFEST.json                # lists portable paths
├── agents/<agentId>/memory/
├── memory/personal/
├── shared/knowledge/                           # Knowledge materials, not CW authority
└── cache/cogniweave/                           # rebuildable; default not exported

State Dir / device-local (NOT portable)         # never in Data Space export
├── cogniweave/
│   ├── outbox/                                 # delivery queue
│   ├── device-cursors/
│   ├── claim-leases/
│   └── runtime-locks/
```

| Layer                                                          | Portable export    | Cloud               |
| -------------------------------------------------------------- | ------------------ | ------------------- |
| Runtime sessions / working context                             | Optional / limited | **No**              |
| Source archive                                                 | Yes                | **No**              |
| Canonical (objects, source links, tombstones, consent records) | **Yes**            | Min projection only |
| Derived indexes                                                | Default **no**     | **No**              |
| Outbox / device cursors / claim leases                         | **Never**          | N/A (rebuilt)       |
| Cloud Intelligence                                             | Cloud-side export  | Already there       |

### 4.3 local vs managed

- **local:** canonical on device Data Root.
- **managed:** server-provisioned roots/partitions.
- **managed ≠ sync raw local corpus to cloud.**
- Cloud Intelligence Sync is optional and independently gated.

### 4.4 Boundary with Knowledge systems

| Dimension | CogniWeave                                   | Knowledge Universe / RAG             |
| --------- | -------------------------------------------- | ------------------------------------ |
| Nature    | Distilled **agent intelligence state**       | **Materials** ingest and governance  |
| Objects   | preference, constraint, decision_rule, skill | docs, chunks, connectors             |
| Authority | canonical.sqlite                             | knowledge index / space              |
| Delete    | Forget/Purge + recompute via source links    | unbind sources / document governance |
| Injection | short, explainable, disableable              | task-scoped material evidence        |

### 4.5 Dual-source injection (v1.2 tightened)

Markdown and atoms may coexist during migration.

**Suppress full Markdown injection only if all hold:**

1. Atom `state.status === "active"` (not tentative/conflicted/deprecated/tombstoned).
2. Provenance complete: ≥1 live `source_object_link` to evidence/event, not orphaned.
3. Atom passed **Admission** at write time (or revalidated on read against current policy).
4. **Coverage threshold:** claim/trigger coverage of the source segment ≥ product threshold (default: structured fields non-empty and content length ratio or explicit `coverageScore ≥ 0.6` — exact metric fixed in P2-02, default conservative).
5. No open `CONFLICTS_WITH` without user resolution for that scope.

**Otherwise:** keep a **budgeted Markdown / evidence fallback** (snippet caps), and treat atom as optional enrichment — never as sole truth.

When multiple atoms cover one source: prefer higher stability + confirmation; still do not drop Markdown until coverage rules pass.

---

## 5. Phase 0 — Reliability

### 5.1 CW2-P0-00: MemoryPartitionKeyV1 and operation key contract

#### Why (blocking finding)

P3 `MemorySubject` (tenant/seat/user) must not rewrite historical `writeOperationKey`s.  
DB `schemaVersion` upgrades must not rewrite keys either.

#### MemoryPartitionKeyV1 (immutable for the life of a local store)

```ts
/**
 * Stable partition of canonical data for operation identity.
 * ACL-rich MemorySubject is P3 and MUST NOT be substituted into this key.
 */
interface MemoryPartitionKeyV1 {
  /** Contract version for this key shape; start at 1 and never reuse meanings. */
  partitionKeyVersion: 1;
  /**
   * Local installation / data-root instance id.
   * Generated once per Data Root (or stateDir until P1 migrate) and persisted.
   * Not equal to SaaS tenantId.
   */
  dataPlaneId: string;
  /**
   * Scope fingerprint from today's Scope fields only:
   * workspaceId | projectId | agentId | visibility
   * Normalized with stable serialization rules (trimmed, ordered).
   */
  scopeFingerprint: string;
}
```

Rules:

- `dataPlaneId` is **random durable** (UUID), stored next to canonical (`meta.data_plane_id`).
- On Data Space move, `dataPlaneId` **moves with the portable canonical** (same id after restore on a new machine for that data plane).
- P3 adds `MemorySubject` for **authorization and listing**, not for rewriting `MemoryPartitionKeyV1`.
- Optional later mapping table: `subject_binding(partition_key, subject)` without changing op keys.

#### Operation key (separate versioning)

```text
writeOperationKey = hash(
  operationKeyVersion,     # e.g. "opk/1" — independent of DB schemaVersion
  partitionKeyVersion,     # 1
  dataPlaneId,
  scopeFingerprint,
  sourceType,
  sourceLocator,           # stable path or session+turn locator
  contentChecksum          # whitelist only — see below
)
```

| Version field                                 | Purpose                       | When it changes                                                               |
| --------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| `schemaVersion` / `schema_migrations.version` | Physical tables, columns      | Migrations                                                                    |
| `operationKeyVersion`                         | Meaning of op-key hash inputs | **Only** when op-key contract intentionally breaks; requires dual-read window |
| `partitionKeyVersion`                         | Meaning of partition fields   | Extremely rare; never for P3 ACL                                              |

**Invariant:** Bumping SQLite/Postgres schema **must not** change `operationKeyVersion`.

#### Stable contentChecksum whitelist

**Allowed metadata:**

- normalized `openbotPath`
- `openbotSessionKey` (if any)
- `openbotSource` enum
- explicit `contentRevision` (if product-defined)

**Forbidden (non-exhaustive):**

- `syncReason` (`snapshot-restore`, `watcher`, …)
- timestamps, hostnames, request ids, diagnostics

Implement `stableMetadataForChecksum()` in `packages/cogniweave-sdk/src/keys.ts`.

#### Storage

- Unique constraint on `writeOperationKey` (ingestions or `write_operations` table).
- Completed identical op → return existing result.
- `forceRebuild` only rebuilds derived; no new WRITE journal.
- Journal kinds: `WRITE` | `REBUILD` | `REPAIR` | `DELETE` | `SYNC`.
- Concurrency: DB uniqueness, not process maps.

**Acceptance (P0-00 + P0-01):**

- Same input ×100 → one WRITE op.
- Changing only `syncReason` → no new event/atom/WRITE.
- Simulated P3 subject annotation does **not** change `writeOperationKey`.
- Schema migration that only adds columns does **not** change keys.

### 5.2 P0-01 Write operation idempotency

Implement uniqueness and short-circuit using the P0-00 contract.

Primary touch points:

- `packages/cogniweave-sdk/src/keys.ts`
- `packages/cogniweave-sdk/src/runtime/in-memory-engine.ts`
- `packages/cogniweave-sdk/src/adapters/local-metadata.ts`
- `packages/cogniweave-sdk/src/adapters/postgres-metadata.ts`
- `src/memory/cogniweave-manager.ts`

### 5.3 P0-02 Restart recovery

**Forbidden:** snapshot restore that re-`writeBack`s every document.

```text
Load scope manifest (locators + object ids)
  -> Load canonical objects for partition/scope
    -> Rebuild graph/vector/FTS from canonical
      -> Restore path ↔ evidence bindings via source_object_links (after P1-00; until then keep path maps but no WRITE replay)
```

Snapshot may store locators, checksums, source types, session digests, object ids, updatedAt.  
Snapshot must **not** store full transcript/body.

**Acceptance:** 100 restarts → WRITE/ingestion counts flat; orphan sources detectable; derived fully rebuildable.

### 5.4 P0-03 Journal retention and maintenance

- Keep FAILED / DERIVED_OUT_OF_SYNC until resolved.
- COMPLETED: retain recent ops or immutable audit summaries.
- Compact: backup → integrity_check → transactional delete → vacuum.
- CLI: doctor / journal stats / compact --dry-run / store backup|verify.

**Ops SLOs (add to soak):**

| Metric                                          | Target (local durable MVP after P0)                              |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| Restart recovery wall time (10k atoms, warm FS) | p95 &lt; 5s load+bind (no full re-ingest)                        |
| WRITE amplification (steady state)              | journal WRITE rows / distinct content ops → **1.0** under replay |
| journal rows / atom rows (healthy)              | bounded; compact brings COMPLETED history under configured cap   |
| DB growth under 24h soak (idle restarts)        | ~0 net WRITE growth                                              |
| Post-compact size                               | ≤ configured ratio of pre-compact (document measured baseline)   |

### Gate P0

- [x] CW2-P0-00 contracts tested (partition + opKeyVersion ≠ schemaVersion) — `keys.test.ts`
- [x] Restart does not grow WRITE ops — `in-memory-engine.recovery.test.ts` (recover×100)
- [x] Journal compactable with integrity — `compactJournals` + CLI compact/doctor
- [x] Whitelist prevents event explosion — `stableMetadataForChecksum` + write-op short-circuit
- [x] Ops SLO soak (local) — `in-memory-engine.ops-slo.test.ts` (CI scaled; full 10k via `COGNIWEAVE_SLO_SOAK_ATOMS`)

---

## 6. Phase 1 — Data sovereignty and lifecycle

### 6.1 CW2-P1-00: source_object_links and Forget/Purge

#### Why (blocking finding)

Atoms **merge** multiple events/evidence (`helpers.ts` consolidation).  
`SourceBinding` holding only id arrays + cascade-delete is **unsafe**: deleting one source would kill multi-source atoms or leave undeletable residue if only crude tombstones are used.

#### Normalized links (canonical)

```ts
interface SourceObjectLink {
  id: string;
  sourceBindingId: string;
  objectType: "event" | "atom" | "evidence" | "relation" | "entity" | "scenario" | "problem";
  objectId: string;
  /**
   * Role of this source for the object, e.g. primary_evidence | supporting | derived_from.
   */
  linkRole: string;
  createdAt: string;
  /** Soft unlink time; hard purge may remove row after grace. */
  unlinkedAt?: string;
}
```

`SourceBinding` remains the source-level record (locator, checksum, status).  
**All** object membership is via `source_object_links`, not only denormalized id arrays (arrays may be cached views).

#### Forget / Purge algorithm (normative)

```text
forgetSource(sourceBindingId):
  1. Mark SourceBinding status = forgotten (or archived per product).
  2. For each live SourceObjectLink for that binding:
       unlink (set unlinkedAt) — do NOT hard-delete objects yet.
  3. Collect affected object ids (esp. atoms, evidence, events).
  4. For each affected Evidence/Event:
       if no remaining live links -> tombstone or purge per policy.
  5. For each affected Atom:
       recomputeProvenance(atom):
         liveLinks = links where unlinkedAt is null
         if liveLinks empty:
           tombstoneAtom (Forget) or purgeAtom (Purge)
         else:
           refresh provenance.evidenceRefs / sourceEventIds from live links
           re-run consolidation status (may stay active; confidence may drop)
           clear tombstone if previously soft-deleted incorrectly
  6. Rebuild derived indexes for affected ids (delete vectors for tombstoned).
  7. Enqueue cloud deletion tombstones only for objects that became fully dead (P5).
```

**Cascade delete of an atom because one source died is forbidden** while other live links exist.

#### Purge vs Forget

|                                 | Forget                                    | Purge                             |
| ------------------------------- | ----------------------------------------- | --------------------------------- |
| Source                          | archive or delete per policy              | physical delete                   |
| Objects with other live sources | **recompute, keep**                       | **recompute, keep**               |
| Objects with zero live sources  | tombstone (searchable=no, audit retained) | hard delete or minimal audit stub |
| Derived                         | remove from active retrieval              | remove                            |
| Cloud                           | deletion tombstone for dead objects only  | force delete                      |

### 6.2 P1-01 SourceBinding contracts

```ts
interface SourceBinding {
  id: string;
  partition: MemoryPartitionKeyV1; // not P3 MemorySubject
  scope: Scope; // today's Scope until P3 extends fields additively
  sourceType: SourceType;
  sourceLocator: string;
  sourceChecksum: string;
  status: "active" | "archived" | "forgotten" | "purged";
  createdAt: string;
  updatedAt: string;
}
```

Lifecycle API:

```ts
archiveSource / forgetSource / purgeSource;
tombstoneAtom / purgeScope / exportScope / reconcileSources;
```

`src/data/memory-lifecycle.ts` **must** call SDK lifecycle; file `unlink` alone is insufficient.

### 6.3 P1-02 Canonical into Data Space + durable migration FSM

#### Migration state machine (durable, not in-memory only)

Persist under portable meta, e.g. `.meta/cogniweave/migration_state.json` **and** a row in canonical when available:

```text
states:
  idle
  planned
  freeze_writes
  snapshot_copy
  integrity_check
  schema_migrate
  shadow_verify
  cutover_ready
  cutover_switched
  observe
  completed
  failed_rollback
  failed_needs_manual
```

Each transition: timestamp, operator/process id, checksums of src/dst, error.

#### Write freeze

- From `freeze_writes` until `cutover_switched` or `failed_rollback`: reject or queue new writeBack.
- Document max freeze duration and user-visible behavior.

#### Cutover point

Single atomic config switch: store resolver points to new path.  
Record `previousStorePath` + `newStorePath` + `cutoverAt` in durable state.

#### Crash recovery

| Crash during                           | Recovery                                                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| before cutover                         | Resume or rollback to idle using durable state; old store remains authority                                                 |
| after cutover, before observe complete | **Roll-forward** preferred (repair new store); if new store corrupt, **switch-back** using previousStorePath if still valid |
| after completed                        | Old store read-only backup until retention elapses                                                                          |

#### Binary / schema compat matrix (required artifact in P1)

| Component         | Old binary + old DB | Old binary + new DB                  | New binary + old DB   | New binary + new DB |
| ----------------- | ------------------- | ------------------------------------ | --------------------- | ------------------- |
| Gateway / OpenBot | supported           | **must fail closed or auto-migrate** | supported (read path) | supported           |
| SDK               | same                | same                                 | same                  | same                |

Document exact fail-closed errors. No silent dual-meaning schemas.

#### Rollback protocol

1. **Pre-cutover:** always safe → delete incomplete dst, state → idle.
2. **Post-cutover switch-back:** only if `previousStorePath` integrity_check passes and no un-replayable WRITE ops unique to new store; if new store accepted writes, **prefer roll-forward** or replay op log from new → old (protocol must be specified in P1 spec: append-only WRITE journals with portable op keys).
3. Catch paths in `src/data/migration-engine.ts` **must restore prior config** on failure (today they do not — fix is in scope).

### 6.4 P1-03 Export / import boundary (portable vs runtime)

| Include in Data Space export              | Exclude / reset on restore             |
| ----------------------------------------- | -------------------------------------- |
| `canonical.sqlite` (or portable snapshot) | outbox / delivery queue                |
| source bindings + source_object_links     | device cursors                         |
| tombstones, consent records, partition id | claim leases, runtime locks            |
| migration_state (optional, sanitized)     | local absolute paths outside data root |

Implement **subdirectory denylist** in `migration-bundle` / `data-export` (today `.meta` is recursive — fix required).  
On restore: **reset** outbox and leases; do **not** replay stale sync deletes against cloud until device re-binds with fresh cursor.

### Gate P1

- [x] CW2-P1-00 multi-source forget tests (shared atom survives single-source forget)
- [x] Forget/Purge closed on canonical + derived (`memory-lifecycle.ts` → SDK; indexed paths only)
- [x] Durable migration FSM + crash tests — **P1-02c** freeze/rollback/roll-forward/switch-back
- [x] Export excludes outbox; restore does not double-fire sync — **P1-03 denylist + restore reset**
- [x] Failed cutover restores old config — **P1-02c** pre-cutover rollback + switch-back → legacy authority
- [x] Real Postgres migration drill — **P1-04** Local→Postgres + recover (`postgres-migration-drill.test.ts`)

---

## 7. Phase 2 — Memory Domain v2

### 7.1 No simplified atom model

Forbidden: replace atom with `{ type, content }`.

### 7.2 Additive fields

`MemoryGovernanceMetrics`, `MemoryLifecycleMetadata`, `MemoryPrivacyMetadata` as in v1.1.  
Defaults: `privacyLevel=private`, `syncEligibility=blocked`.

### 7.3 Type policy registry

Each atom type registers: payload schema, stability, retention, promotion default, confirmation requirement, conflict resolution.

### 7.4 Three independent scores

| Score     | Decision                         |
| --------- | -------------------------------- |
| Admission | Enter long-term canonical?       |
| Retrieval | Inject for this task?            |
| Promotion | Eligible for Cloud Intelligence? |

No single formula for all three. Weights calibrated on labeled sets; until then configurable heuristics + explain debug only (no “probability” claims in UI).

### 7.5 Distillation

| Mode                  | Default                                    |
| --------------------- | ------------------------------------------ |
| Rule                  | **On**                                     |
| LLM distill / framing | **Off** (flag + budget + fallback to rule) |

### 7.6 Identity boundary

Runtime agent identity and seat position identity are **not** writable by CogniWeave.  
Cloud `agent_profile` may hold behavioral preferences only.

### Gate P2

- [x] Compatible additive schema
- [x] Score paths separated
- [x] Identity boundary tests
- [x] Coverage metric used by dual-source injection defined

---

## 8. Phase 3 — Enterprise scope and ACL

### 8.1 MemorySubject (authorization plane)

```ts
interface MemorySubject {
  tenantId: string; // from authenticated TenantContext only
  ownerType: "user" | "agent" | "seat" | "space" | "team" | "organization";
  ownerId: string;
}
```

**Does not replace `MemoryPartitionKeyV1`.**  
Bind subjects to partitions/scopes via mapping tables; **op keys unchanged**.

### 8.2 OpenBot mapping

| Scenario                    | ownerType    | scopeType    |
| --------------------------- | ------------ | ------------ |
| Cross-agent user preference | user         | personal     |
| Agent private experience    | agent        | agent        |
| Seat asset memory           | seat         | seat         |
| Collaboration space         | space        | space        |
| Team knowledge              | team         | team         |
| Org norms                   | organization | organization |

Unknown local tenant → local sentinel; never invent enterprise tenant.

### 8.3 Authz order

```text
Tenant -> Principal -> Ownership/AccessPolicy -> Privacy -> Lifecycle -> Applicability -> Rank
```

### 8.4 Seat succession

Reuse transfer classes: `inheritable` | `review_required` | `private`.  
Handover changes access subject only; no canonical copy; provenance preserved.

### Gate P3

- [x] Cross-tenant false allow = 0
- [x] Cross-user private false allow = 0
- [x] Succession does not leak private
- [x] No parallel ownership system
- [x] Op keys stable across subject binding

---

## 9. Phase 4 — Retrieval engine v2

### 9.1 Pipeline

ACL/lifecycle first; then FTS | Vector | Graph; merge; rerank; conflict/diversity; budget; explain.

### 9.2 Contracts

```ts
queryAtoms / queryEvidence / listRelationsByNode;
VectorStore.search / VectorStore.delete;
```

Production paths must not full-scan `listAtoms()`.

### 9.3 Performance and ops SLOs

| Scenario                             | Target                                 |
| ------------------------------------ | -------------------------------------- |
| Local SQLite hot ≤10k atoms FTS+meta | p95 &lt; 100ms, p99 &lt; 200ms         |
| Local cold or local embedding        | p95 &lt; 300ms (separate baseline)     |
| Managed Postgres same scale          | p95 &lt; 150ms (pool/network separate) |
| Scope/ACL false allow                | **0**                                  |
| Deleted/tombstoned recall            | **0**                                  |
| Restart recovery (no re-ingest)      | per P0 table                           |
| Steady-state WRITE amp               | ~1.0                                   |
| journal/atom ratio                   | under compact policy caps              |
| DB growth (idle restart soak)        | ~0 WRITE growth                        |

### Gate P4

- [x] Security metrics before latency
- [x] Explainable atom + safe evidence locator
- [x] No unauthorized/deleted candidates

---

## 10. Phase 5 — Cloud Intelligence Sync

**Start only after Gates P0–P3 green; P4 at least ACL-safe query.**

### 10.1 Ports

`PromotionPolicy`, `SyncOutbox` (device-local), `CloudIntelligenceClient` push/pull/delete.

### 10.2 Transactional outbox

Canonical commit + promotion decision + outbox row in **one local transaction**.  
Network async; never block agent response.

### 10.3 Envelope denylist

No transcript/document/tool raw text, evidence snippets, credentials, unapproved sensitive data, or long reversible summaries.

### 10.4 Promotion defaults

New memory private + blocked; explicit approve; auto-promote only low-sensitivity allowlist; revoke → deletion tombstone; enterprise policy can only tighten.

### 10.5 Conflict

Tombstone wins; user confirm &gt; model; enterprise policy &gt; personal inference but not over private; preferences keep conditions; revision + ETag; no blind LWW.

### 10.6 Local mirror

```text
Cloud -> Async Pull -> Local Intelligence Mirror -> Local Retrieval
```

Offline uses last good mirror + freshness flag.

**P5-03 landed (SDK + manager):** `CloudIntelligenceClient.pull` + `LocalIntelligenceMirror` / `pullIntoMirror` under `{stateDir}/cogniweave/mirror/`（export denylist 路径）；freshness `fresh|stale|never_synced`；tombstone wins；失败 pull 保留 last-good 并标 stale。Manager 经 `cogniweave-cloud-sync-drain` 异步接线（`memory.cogniweave.cloudSync` 默认关闭；InMemory stub client）；真 HTTP CloudIntelligenceClient 仍待。

### 10.7 Production cloud contract (pre-P5 blocking)

Commercial Cloud Intelligence **must** specify and Gate-test:

| Control                  | Requirement                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------ |
| Authentication           | Service credentials / user session; no anonymous push/pull                           |
| Tenant binding           | Server derives tenant from auth; **ignore client-supplied tenant/subject for authz** |
| Device identity          | Registered device id; bind to outbox cursor namespace                                |
| Request integrity        | Signed requests and/or mTLS; **anti-replay** (nonce/timestamp window)                |
| Server idempotency       | Idempotency keys on push/delete; safe retries                                        |
| Rate limiting            | Per tenant and per device                                                            |
| KMS / encryption         | At rest and in transit standards per deployment                                      |
| Data residency           | Region pinning where product requires                                                |
| Cross-tenant false allow | **0** on push, pull, delete, and metadata probes (counts/timing)                     |

Gate P5 content checks alone are **insufficient** without this section.

### Gate P5

- [x] Payload audit: no raw source content
- [x] Offline / retry / reorder / tombstone — **P5-02 InMemory/File outbox + drain backoff + delete_tombstone**（真 HTTP / reorder soak 仍待）
- [x] Consent revoke → verifiable cloud delete — **P5-02 revoke→delete_tombstone + InMemory client tombstone**（生产 cloud 验真仍待）
- [x] **Authn, tenant binding, anti-replay, server idempotency, rate limit tests green** — **P5-02 InMemoryCloudIntelligenceClient**（真 HTTP 仍待）
- [x] Cross-tenant false allow = 0 for all cloud APIs — **P5-02 claimedTenantId / push-delete tenant gate**（生产 API 面仍待）

---

## 11. Phase 6 — Governance UI

User: what was remembered, why, which bot/seat/space, sync/share flags, edit/confirm/disable/forget/purge/export.

Hide: journals, table names, embedding params, vector backends, queue internals, graph plumbing.

Admin: org-owned scopes only; never employee private content.

### Gate P6

- [x] User can complete view/delete loop — **P6-01** 个人设置→记忆中心 + `data.memory.list`/`forget` + `atoms[]` atom 级 DTO（`forgetAtom` 仍待）
- [x] Admin cannot read private employee memory — **P6-02** enterprise session 禁 `data.memory.*` + `agents.files.get/set` MEMORY.md 跨员工拒绝 + overview 仅 org-scope 元数据
- [x] No implementation leakage in default UI — **P6-01/02** 用户端无 store 细节；管理端无 private/正文

---

## 12. Schema migrations

```text
schema_migrations(version, name, checksum, applied_at)
```

Each migration: idempotent or ordered; SQLite+Postgres; tests; backup/restore; **canonical recoverable without graph/vector**.

### Order

1. `operationKeyVersion` storage + `write_operations` uniqueness + `dataPlaneId`
2. `source_object_links` (+ backfill from legacy id arrays)
3. lifecycle / tombstone fields
4. subject **binding** tables (P3; does not rewrite op keys)
5. privacy / consent
6. portable export denylist + migration_state
7. (device-local) outbox tables in state dir
8. retrieval usage / feedback

---

## 13. Release and rollback

### Flags

```text
memory.cogniweave.schemaV2
memory.cogniweave.lifecycleV2
memory.cogniweave.retrievalV2
memory.cogniweave.cloudSync
memory.cogniweave.llmDistill   # default false
```

### Stages

Shadow migrate → shadow read → canonical cutover → promotion observe → limited sync → GA (local-first default).

### Forbidden

- In-place schema without backup
- Mixing schema + cloud + retrieval rewrite in one PR
- Dropping deletion tombstones on rollback
- Using raw transcript as cloud recovery shortcut
- Exporting outbox / replaying foreign device queues

---

## 14. Testing matrix (summary)

- SDK: op-key stability across schema bumps and subject annotations; multi-source forget; migration FSM crash; export denylist.
- OpenBot: restart growth=0; Forget E2E; seat isolation (P3); cloud down still retrieves.
- Security: tenant isolation including timing; employee tokens blocked from org admin; envelope hygiene.
- Performance/ops: SLOs in P0 and P4 tables; 100 restarts; 24h soak; compact consistency.

---

## 15. Task pack

| Task ID       | Work                                                     | Depends      | Ship alone |
| ------------- | -------------------------------------------------------- | ------------ | ---------- |
| **CW2-P0-00** | **MemoryPartitionKeyV1 + operationKeyVersion contract**  | —            | Yes        |
| CW2-P0-01     | Write op idempotency + metadata whitelist                | P0-00        | Yes        |
| CW2-P0-02     | Snapshot recovery from-canonical                         | P0-01        | Yes        |
| CW2-P0-03     | Journal retention/compact/doctor + ops SLOs              | P0-01        | Yes        |
| **CW2-P1-00** | **source_object_links + multi-source Forget/Purge**      | P0-01        | Yes        |
| CW2-P1-01     | SourceBinding lifecycle API                              | P1-00        | Yes        |
| CW2-P1-02     | Durable migration FSM + cutover rollback                 | P0-02, P1-01 | Yes        |
| CW2-P1-03     | Data Space migrate + **export denylist** (no outbox)     | P1-02        | Yes        |
| CW2-P2-01     | Atom v2 additive fields                                  | P1-01        | Yes        |
| CW2-P2-02     | Three scores + type registry + coverage metric           | P2-01        | Yes        |
| CW2-P3-01     | MemorySubject binding (no op-key rewrite)                | P2-01        | Yes        |
| CW2-P3-02     | Seat ownership / handover bridge                         | P3-01        | Yes        |
| CW2-P4-01     | Scope-aware metadata query                               | P3-01        | Yes        |
| CW2-P4-02     | Hybrid FTS/vector/graph retrieval                        | P4-01        | Yes        |
| CW2-P5-01     | Promotion + consent                                      | P2-02, P3-01 | Yes        |
| CW2-P5-02     | Outbox (state-dir) + Cloud client + **auth/anti-replay** | P5-01        | Yes        |
| CW2-P5-03     | Local intelligence mirror                                | P5-02, P4-02 | Yes        |
| CW2-P6-01     | Memory Center user UI                                    | P1-00, P2-01 | Yes        |
| CW2-P6-02     | Enterprise governance UI                                 | P3-02, P5-01 | Yes        |

### Sprint slice (for intake)

```text
Sprint A  CW2-P0-00 .. P0-03
Sprint B  CW2-P1-00 .. P1-03
Sprint C  CW2-P2-01 .. P2-02 + P3-01
Sprint D  CW2-P3-02
Sprint E  CW2-P4-01 .. P4-02
Sprint F  CW2-P5-01 .. P5-03   # after A–D gates
Sprint G  CW2-P6-01 .. P6-02
```

---

## 16. Phase gates (summary)

| Gate   | Must pass                                                                   |
| ------ | --------------------------------------------------------------------------- |
| **P0** | P0-00 keys stable; restart no WRITE growth; compact; ops SLOs baselined     |
| **P1** | Multi-source forget correct; FSM + rollback; export excludes outbox         |
| **P2** | Additive compat; score split; coverage for dual-source                      |
| **P3** | Tenant/user/seat ACL; false allow 0; op keys unchanged                      |
| **P4** | Security first; SLA tiers; explainability                                   |
| **P5** | No raw payloads; **auth/anti-replay/idempotency/rate limit**; false allow 0 |
| **P6** | User loop; admin non-overreach                                              |

---

## 17. Commercial readiness bar

Reliable restarts without op explosion; auditable local-first; user export/delete; enterprise seat governance; multi-tenant fail-closed; cloud = promoted min intelligence only; offline local memory; unified contracts; portable canonical migrate/repair/backup; performance on real SQLite scale.

**Definition:**

> CogniWeave is not a chat archive and not a bare vector index.  
> It is a **local-sovereignty memory engine** that distills agent experience into **explainable, forgettable, governable** intelligence, with optional cloud **minimal projections**—while runtime and seat identity remain on the OpenBot control plane.

---

## 18. Pre-spec checklist (P0 intake)

- [ ] This v1.2 document accepted as implementation baseline
- [ ] CW2-P0-00 partition/op-key contract signed off
- [ ] CW2-P1-00 multi-source delete semantics signed off (can be parallel spec after P0 starts, but design accepted)
- [ ] Knowledge vs Memory boundary accepted
- [ ] Tenant only from TenantContext
- [ ] Gates serial
- [ ] LLM distill default off
- [ ] Dual-repo: implement in openbot-rc; mirror docs to openbot

**First spec package title:**

`CW2-P0 Reliability: MemoryPartitionKeyV1, operationKeyVersion, write idempotency, snapshot recovery, journal compact`

---

## 19. Code anchors (openbot-rc)

| Area                                  | Path                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------- |
| Models                                | `packages/cogniweave-sdk/src/models.ts`                                 |
| Scope                                 | `packages/cogniweave-sdk/src/scope.ts`                                  |
| Keys / checksum                       | `packages/cogniweave-sdk/src/keys.ts`                                   |
| Engine writeBack / merge              | `packages/cogniweave-sdk/src/runtime/in-memory-engine.ts`, `helpers.ts` |
| SQLite schema                         | `packages/cogniweave-sdk/src/adapters/local-metadata.ts`                |
| OpenBot bridge                        | `src/memory/cogniweave-manager.ts`                                      |
| Search entry                          | `src/memory/search-manager.ts`                                          |
| Forget files                          | `src/data/memory-lifecycle.ts`                                          |
| Migration engine (in-memory task gap) | `src/data/migration-engine.ts`                                          |
| Export / bundle (`.meta` recurse)     | `src/data/data-export.ts`, `migration-bundle.ts`                        |
| Data Space                            | `src/config/data-space.ts`                                              |

---

## 20. Document ownership

| Property       | Value                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Canonical path | `openbot-rc/docs/design/openbot-cogniweave-memory-engine-v2-implementation-plan-2026-07-16.md` |
| Mirror path    | `openbot/docs/design/openbot-cogniweave-memory-engine-v2-implementation-plan-2026-07-16.md`    |
| Version        | **v1.2** (team-review blocking fixes)                                                          |
| Next action    | Open **CW2-P0** spec (includes CW2-P0-00)                                                      |

Edit order: **rc first, then mirror openbot** to avoid drift.
