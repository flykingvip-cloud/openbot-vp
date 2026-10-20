# Requirements Document: PostgreSQL Growth Migration and SRE

Status: **Specification active; implementation BLOCKED by upstream gates**

## Introduction

本规格负责在共享 Identity/Agent Registry/ACL 已权威化、Growth Application Boundary 已冻结后，将 Growth 迁移到 PostgreSQL，并提供 RLS、事务投影、shared journal、outbox、baseline migration、canary、回滚和多实例 SRE 证据。

## Scope

负责：PostgreSQL schema、roles、RLS、transaction projector、outbox、shared journal、baseline import、reconciliation、quarantine、canary、SLO、容量、备份恢复、runbook 和多实例 readiness。

不负责：重新定义 Agent 身份、owner、ACL 或 Growth 事件业务语义。

## Requirements

### Requirement 1: Shared control plane gate

1. Growth production writes SHALL remain disabled until membership session、Agent Registry、owner binding 和 ACL are shared authoritative facts.
2. RLS context SHALL only derive from validated AgentAccessContext or scoped service principal.
3. Control plane and Growth data plane MAY share a release gate, but control plane cutover SHALL complete first.

### Requirement 2: Transactional data plane

1. observation、metrics、status 和 outbox SHALL commit in one transaction.
2. enterprise + AgentAsset SHALL appear in primary/unique and foreign-key boundaries.
3. exact duplicate events SHALL not double count.
4. correction and projector version SHALL be durable and replayable.
5. only committed outbox records SHALL be published.

### Requirement 3: RLS and roles

1. business tables SHALL use tenant-aware RLS plus composite constraints.
2. connection pools SHALL use transaction-scoped context such as `SET LOCAL`.
3. application、projector、migration、relay 和 break-glass SHALL use separate least-privilege roles.
4. normal application roles SHALL not bypass RLS.
5. break-glass SHALL require reason、approval、scope、expiry and audit.

### Requirement 4: Shared durable ingestion

1. cloud/multi-instance ingestion fallback SHALL use shared durable journal facilities.
2. single-host temporary files or memory queues SHALL not satisfy this requirement.
3. replay SHALL preserve event identity and rely on repository idempotency.
4. backlog、oldest age、retry、quarantine and estimated loss SHALL be observable.

### Requirement 5: Baseline migration

1. legacy accumulated metrics SHALL import as `legacy_metrics_baseline`.
2. current status SHALL import as `legacy_growth_snapshot`.
3. import SHALL preserve source checksum、import epoch and projector version.
4. import SHALL not fabricate historical observations.
5. repeated import SHALL be idempotent and reconcilable.

### Requirement 6: Canary and single writer

1. rollout SHALL start with one enterprise and one Agent.
2. cutover SHALL be tenant-by-tenant with one authoritative writer.
3. local and PostgreSQL SHALL not become dual authoritative writers.
4. application rollback SHALL keep PostgreSQL authoritative unless reverse replay is proven and separately approved.
5. quarantine SHALL isolate ambiguous mapping or invalid payloads.

### Requirement 7: SRE readiness

1. ingest/query/projection SLO、reply budget、RPO、RTO and retention SHALL be approved before production.
2. backup、PITR and restore SHALL be rehearsed.
3. failure injection SHALL cover database、journal、relay and connection context leakage.
4. alerts SHALL have severity、owner and runbook.
5. capacity SHALL model hot Agent、enterprise burst and connection pool limits.

### Requirement 8: Multi-instance and aggregation gate

1. multiple Gateway writers SHALL remain blocked until identity、ACL、Growth、journal、outbox and fanout are externalized.
2. tenant-aware fanout SHALL authorize subscribers server-side.
3. reconnect SHALL support version/cursor recovery.
4. enterprise aggregation SHALL enforce visibility、retention and minimum cohort.
5. cross-enterprise identifiable aggregation SHALL remain prohibited.

## Exit criteria

- All upstream contracts approved.
- RLS, transaction and failure-injection evidence passes.
- Baseline and canary reconcile exactly within approved semantics.
- Rollback rehearsal is complete.
- SRE and Security approve multi-instance readiness separately.
