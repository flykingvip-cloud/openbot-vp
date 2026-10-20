# Implementation Plan: PostgreSQL Growth Migration and SRE

## Overview

本计划在共享控制面和 Growth Application Boundary 通过退出门后执行。当前只允许规格细化，禁止建表、云资源、生产写入或多实例扩展。

## Agents

- `kiro-growth-pipeline` · role: owner · scope: PostgreSQL Growth data plane、migration、SRE 与多实例门禁的新模块 · paths: `.kiro/specs/postgres-growth-migration-sre/**`, `src/gateway/growth-postgres/**`, `scripts/growth-migration/**` · since: 2026-07-30

## Gate assessment — 2026-07-30

- **Status: `BLOCKED`。** Identity/Registry/ACL 尚无完整跨消费者权威证据，Growth event/repository contract 尚未冻结，故 PostgreSQL data plane 不具备安全的 schema 或迁移前提。
- Security、Data、SRE 书面批准，以及 production SLO、RPO、RTO、retention、quarantine/rollback 策略均未提供。
- 未创建数据库、云资源、schema、migration、shared journal、outbox、canary 或多实例写路径；单 Gateway writer 约束保持不变。
- 只有在上游 Phase -1 与 Growth boundary 退出门均通过、审批与运维目标明确、且 operator 再次明确批准生产动作后，才可进入 schema 设计或任何部署步骤。— kiro-growth-pipeline
- 2026-07-30 audit：upstream 仍缺少 WebSocket authoritative-pair propagation、Billing consumer fail-closed migration、Agent Registry/ACL 和其余 first-match consumer migration；相关 runtime paths 还受活跃 Loom claim 重叠约束。没有这些证据或书面批准，不得将 PostgreSQL 规格推进为 schema、migration、云资源或多实例实现。— kiro-growth-pipeline

## Tasks

- [x] 0. 建立规格与 Loom 归属 — kiro-growth-pipeline
  - [x] 0.1 requirements、design、tasks — kiro-growth-pipeline
  - [x] 0.2 认领未来新模块路径，不触碰云资源 — kiro-growth-pipeline

- [-] 1. Upstream gate review
  - [x] 1.0 已评估并确认上游门禁未满足；保持 `BLOCKED`。— kiro-growth-pipeline
  - [ ] 1.1 Identity/Registry/ACL authoritative evidence
  - [ ] 1.2 Growth event/repository contract evidence
  - [ ] 1.3 Security、Data、SRE 批准
  - [ ] 1.4 明确 production SLO/RPO/RTO/retention
  - _Requirements: 1, 7_

- [ ] 2. PostgreSQL schema and roles
  - [ ] 2.1 observation、metrics、status、checkpoint、outbox
  - [ ] 2.2 baseline、import epoch、quarantine
  - [ ] 2.3 composite keys/foreign keys
  - [ ] 2.4 RLS and least-privilege roles
  - [ ] 2.5 expand/contract migration plan
  - _Requirements: 2, 3, 5_

- [ ] 3. Transaction repository
  - [ ] 3.1 idempotent observation insert
  - [ ] 3.2 atomic metrics/status projector
  - [ ] 3.3 correction and projector version
  - [ ] 3.4 transactional outbox
  - _Requirements: 2_

- [ ] 4. Shared journal and relay
  - [ ] 4.1 select approved shared durable facility
  - [ ] 4.2 append/replay/backoff/quarantine
  - [ ] 4.3 outbox relay and tenant-aware envelope
  - [ ] 4.4 telemetry and alerting
  - _Requirements: 4, 7, 8_

- [ ] 5. Baseline migration tooling
  - [ ] 5.1 mapping manifest and checksum
  - [ ] 5.2 baseline/snapshot idempotent import
  - [ ] 5.3 reconciliation and quarantine
  - [ ] 5.4 reverse replay rehearsal tooling
  - _Requirements: 5, 6_

- [ ] 6. Canary and tenant cutover
  - [ ] 6.1 one enterprise / one Agent canary
  - [ ] 6.2 single-writer cutover
  - [ ] 6.3 SLO observation and reconciliation
  - [ ] 6.4 tenant-by-tenant expansion
  - _Requirements: 6, 7_

- [ ] 7. Multi-instance readiness
  - [ ] 7.1 externalized identity/ACL/Growth/journal/outbox/fanout proof
  - [ ] 7.2 load、concurrency、failure-injection、RLS tests
  - [ ] 7.3 reconnect cursor and consumer idempotency
  - [ ] 7.4 governed aggregation and minimum cohort
  - [ ] 7.5 final Security/SRE release approval
  - _Requirements: 7, 8_
