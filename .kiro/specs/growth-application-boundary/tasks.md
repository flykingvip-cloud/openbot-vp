# Implementation Plan: Growth Application Boundary

## Overview

本计划建立本地 Growth 应用边界。Identity/Access contract 冻结前只允许设计和独立类型工作；不得绕过 Phase -1 自建身份或 ACL。

## Agents

- `kiro-growth-pipeline` · role: owner · scope: Growth application/repository boundary 新模块 · paths: `.kiro/specs/growth-application-boundary/**`, `src/gateway/growth-application/**` · since: 2026-07-30

## Gate assessment — 2026-07-30

- **Status: `BLOCKED`。** 当前 active-membership 的本地安全切片与 multi-membership member revoke 已有定向验收，但权威 WebSocket propagation、Billing consumer、Agent Registry 和统一 ACL 尚未完成。
- 因此 `AgentAccessContext` 还不是可供 Growth 依赖的完整跨消费者权威 contract；不得在 Growth 中复制 membership 解析或另建 ACL。
- 未创建 `src/gateway/growth-application/**` 的运行时实现，未改变单 Gateway writer 限制，也未接触云资源或生产数据。
- 解锁条件：共享身份/Registry/ACL 退出门完成，Growth、Runtime、Security 书面批准到位，并能证明新边界不会绕过服务端 tenant/owner 解析。— kiro-growth-pipeline
- 2026-07-30 consumer/ownership audit：WebSocket target 与一个已完成但仍 active 的历史任务重叠；Billing target 被一个仍有未完成阶段的活跃广域任务持有，现有 Loom CLI 无单路径 transfer/release。另有 enterprise-data execution-context 的独立 first-match membership consumer。因此不得用本地 Growth 模块绕过未完成的 authoritative-context、Registry 或 ACL 消费者迁移。— kiro-growth-pipeline

## Tasks

- [x] 0. 建立规格与 Loom 归属 — kiro-growth-pipeline
  - [x] 0.1 requirements、design、tasks — kiro-growth-pipeline
  - [x] 0.2 精确认领新边界路径，避免与 agent-growth-lifecycle 重叠 — kiro-growth-pipeline

- [-] 1. Freeze contracts
  - [ ] 1.1 AgentRef 与 AgentAccessContext 消费接口
  - [ ] 1.2 logicalRunId、attemptId、completionEventId
  - [ ] 1.3 event identity 与 correction
  - [ ] 1.4 repository、journal、publisher interface
  - _Requirements: 1, 2, 3, 4, 6_

- [ ] 2. Local read boundary
  - [ ] 2.1 `LocalGrowthRepository` 读取 adapter
  - [ ] 2.2 GET 改为纯读
  - [ ] 2.3 初始化移动到 create/import command
  - [ ] 2.4 非泄漏授权错误
  - _Requirements: 1, 2, 5, 7_

- [ ] 3. Explicit repair boundary
  - [ ] 3.1 repair command actor/reason/audit ID
  - [ ] 3.2 projector version 与 event policy
  - [ ] 3.3 移除 GET 中隐式 sync
  - _Requirements: 4, 5_

- [ ] 4. Terminal completion ingestion
  - [ ] 4.1 编排器在 fallback/retry 最终结束后产生 completion
  - [ ] 4.2 repository 幂等
  - [ ] 4.3 append-only correction
  - [ ] 4.4 runner/RPC 移除直接 store 写
  - _Requirements: 1, 3, 4_

- [ ] 5. Durable local CompletionJournal
  - [ ] 5.1 crash-safe append
  - [ ] 5.2 replay/backoff/quarantine
  - [ ] 5.3 backlog 和 estimated data-loss telemetry
  - [ ] 5.4 双重故障行为
  - _Requirements: 6_

- [-] 6. Phase 1 gate
  - [x] 6.0 上游门禁评估已记录，当前保持 `BLOCKED`。— kiro-growth-pipeline
  - [ ] 6.1 定向测试和失败前/通过后证据
  - [ ] 6.2 单 authoritative repository 证明
  - [ ] 6.3 单 Gateway writer 限制保持
  - [ ] 6.4 Runtime、Security、Growth 书面批准
