# Design Document: PostgreSQL Growth Migration and SRE

Status: **Design only; implementation BLOCKED**

## 1. Dependencies

```text
Shared Agent Identity/Access Control Plane
        |                         |
        v                         v
Growth Application Boundary ---> PostgreSQL Migration and SRE
```

No schema or cloud resource is created until both upstream contracts are approved.

## 2. Logical data model

Control-plane tables are owned by the identity specification. Growth owns conceptual tables:

```text
growth_observation
growth_metrics
growth_status
growth_projection_checkpoint
growth_outbox
legacy_metrics_baseline
legacy_growth_snapshot
growth_import_epoch
growth_quarantine
```

These names are not approved DDL.

Every Agent row carries `enterprise_id + agent_asset_id`. Composite foreign keys prevent cross-enterprise links.

## 3. Write transaction

```text
BEGIN
  validate scoped database role and SET LOCAL enterprise
  insert observation if exact event identity is new
  lock or atomically update metrics
  project status with projector_version
  append outbox record
COMMIT
```

A duplicate exact event returns the existing projection without reapplying counters. A correction is a distinct event and updates projection in the same transaction.

## 4. RLS and role model

Roles:

- application ingest/query.
- projector/repair.
- migration/import.
- outbox relay.
- break-glass.

RLS uses transaction-local enterprise context set only after validating AgentAccessContext. Composite constraints remain mandatory even with RLS.

## 5. Shared journal and outbox

The shared journal covers failure before a Growth transaction is accepted. The transactional outbox covers publication after acceptance.

```text
repository unavailable -> shared journal -> replay -> Growth transaction
Growth transaction -> outbox -> relay -> tenant-aware fanout
```

Neither component may silently discard events. Journal acknowledgement follows repository acknowledgement. Outbox acknowledgement follows downstream publication policy.

## 6. Baseline migration

Manifest fields:

```text
enterprise_id
legacy_agent_id
agent_asset_id
source_paths
source_checksum
import_epoch
projector_version
```

Import creates baseline and snapshot records, not synthetic per-run observations. Ambiguous mappings enter quarantine.

## 7. Canary and cutover

1. Dry-run mapping and checksum.
2. Import one Agent baseline.
3. Reconcile counters and status.
4. Switch that Agent to PostgreSQL single writer.
5. Observe approved canary window.
6. Expand within one enterprise, then tenant-by-tenant.
7. Evaluate multi-instance only after all control/data/event state is externalized.

## 8. Rollback

Application binary rollback does not imply repository rollback. PostgreSQL remains authoritative unless reverse replay of every cutover-window event has been rehearsed and approved.

No request may automatically fall back to local writes. Old JSON is read-only evidence during the reconciliation window.

## 9. Observability

Required dashboards and alerts:

- ingest success/latency and duplicate/correction rates.
- journal append, backlog, oldest age, replay and quarantine.
- transaction latency, lock contention and hot Agent distribution.
- projection drift and projector versions.
- outbox lag, retry and dead-letter.
- RLS denials and context mismatch without unbounded tenant labels.
- backup freshness, restore rehearsal and estimated data loss.

## 10. Open production decisions

The implementation design must assign numeric values and owners for SLO、RPO、RTO、reply budget、backlog limits、retention、PITR、cohort threshold and incident severity. Until approved, production remains blocked.
