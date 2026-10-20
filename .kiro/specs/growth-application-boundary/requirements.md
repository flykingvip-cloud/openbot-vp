# Requirements Document: Growth Application Boundary

Status: **Specification active; production implementation waits for Identity contract**

Production gate: **BLOCKED**

## Introduction

本规格把现有 runner、Growth JSON store 和 RPC 之间的直接耦合收口为同进程 `GrowthApplicationService` 与单一 `GrowthRepository`，冻结 logical run、attempt、terminal completion、correction 和 durable journal 语义。

## Scope

负责：应用服务、repository abstraction、本地 repository、事件身份、纯读查询、显式 repair、CompletionJournal 接口和本地单实例行为。

不负责：active membership、Agent Registry、统一 ACL、PostgreSQL、RLS、云资源和多实例。

## Requirements

### Requirement 1: Unified application service

1. 所有 runner、RPC、milestone、feedback、correction 和 repair 写入 SHALL 经 `GrowthApplicationService`。
2. 调用方 SHALL NOT 分别写 metrics、status 或 event。
3. 服务 SHALL 消费由共享控制面构造的 AgentRef 与 AgentAccessContext。
4. 未授权请求 SHALL 不泄漏 Agent 是否存在。

### Requirement 2: Single authoritative repository

1. 任一 enterprise 同时 SHALL 只有一个 authoritative repository。
2. 本地 Phase 1 使用 `LocalGrowthRepository`，明确仅支持单 Gateway writer。
3. PostgreSQL 切换后 SHALL 不自动回退本地写入。
4. shadow comparison SHALL 只读且不得发布用户可见事件。

### Requirement 3: Completion event contract

1. 系统 SHALL 区分 `logicalRunId`、`attemptId`、`completionEventId`。
2. fallback/retry attempt failure SHALL NOT 直接累计任务失败。
3. terminal completion SHALL 只在逻辑任务最终成功或所有 retry/fallback 耗尽后产生。
4. 精确重放 SHALL 复用稳定 `completionEventId`。
5. event identity SHALL 为 enterprise + AgentAsset + event type + source event ID。

### Requirement 4: Correction and projection

1. 错误 terminal outcome SHALL 通过 append-only correction 修正，不覆盖原事实。
2. correction SHALL 引用原 completion，携带独立 ID、actor、reason 和 audit ID。
3. projector SHALL 撤销旧贡献并应用新贡献，或从确定 checkpoint 重放。
4. metrics/status version SHALL 单调递增。

### Requirement 5: Pure reads and explicit repair

1. GET/query SHALL 不触发 status、metrics、version 或 event 写入。
2. repair/recompute SHALL 是独立 command，要求 permission、actor、reason 和 audit ID。
3. repair SHALL 明确 projector version 与是否产生 outbox event。

### Requirement 6: Bounded fail-open and durable journal

1. reply path SHALL 只在有界预算内尝试 authoritative repository。
2. 失败事件 SHALL 写入 crash-safe `CompletionJournal`，不得空 catch 静默丢弃。
3. replay SHALL 使用稳定 event identity 并由 repository 幂等。
4. poison payload SHALL quarantine，并产生指标和告警。
5. repository 与 journal 双重故障 SHALL 产生 critical telemetry 和估算丢失计数。

### Requirement 7: Compatibility

1. 本地已有 Growth status 和 operational metrics 行为 SHALL 保持兼容。
2. legacy metrics SHALL 不被伪造成逐次 observation。
3. 当前 UI payload compatibility SHALL 在 migration contract 中明确。
4. Phase 1 SHALL 不引入独立微服务。

## Exit criteria

- GET 纯读。
- terminal completion 精确重放不重复累计。
- retry/fallback attempt 不污染任务结果。
- correction 可修正且保留审计。
- repository 故障进入耐久 journal。
- 本地目标测试有可复现证据。
