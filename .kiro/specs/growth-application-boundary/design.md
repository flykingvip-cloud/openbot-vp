# Design Document: Growth Application Boundary

Status: **Design active; code blocked on Phase -1 identity contract**

## 1. Current state

runner 直接调用 operational metrics store，再同步写 Growth status；RPC 直接读写 JSON，GET 会触发投影。`runId` 已存在但没有进入 Growth，异常以空 catch 静默吞掉。

## 2. Architecture

```text
Runner / RPC / Command
  -> AgentAccessContext Resolver
  -> GrowthApplicationService
       -> GrowthRepository
       -> CompletionJournal
       -> GrowthEventPublisher
```

Application service owns authorization, idempotency, correction, projection and audit semantics. Repository owns consistent persistence. Publisher only receives committed events.

## 3. Core interfaces

```ts
type GrowthEventIdentity = {
  enterpriseId: string;
  agentAssetId: string;
  eventType: GrowthEventType;
  sourceEventId: string;
};

type TerminalCompletion = GrowthEventIdentity & {
  logicalRunId: string;
  attemptId: string;
  completionEventId: string;
  outcome: "succeeded" | "failed";
  toolsTotal: number;
  toolsSucceeded: number;
  occurredAt: string;
};

interface GrowthRepository {
  recordTerminalCompletion(input: AuthorizedCompletion): Promise<GrowthWriteResult>;
  recordCorrection(input: AuthorizedCorrection): Promise<GrowthWriteResult>;
  getStatus(input: AuthorizedAgentRef): Promise<GrowthStatus | null>;
  recompute(input: AuthorizedRepairCommand): Promise<GrowthWriteResult>;
}

interface CompletionJournal {
  append(event: TerminalCompletion): Promise<JournalReceipt>;
  replay(handler: JournalReplayHandler): Promise<ReplaySummary>;
}
```

Concrete schemas and method names may change during implementation; semantics may not.

## 4. Event lifecycle

```text
logical task
  -> attempt 1 failed
  -> fallback attempt 2 succeeded
  -> one terminal completion succeeded
```

Attempt facts may be observed separately but do not update task success metrics. A terminal completion is generated only by the orchestrator after final resolution.

Correction is a new event referencing the original completion. Exact duplicate delivery is ignored; a semantically different correction is not a duplicate.

## 5. Local repository

`LocalGrowthRepository` adapts current JSON stores behind the new interface. It is intentionally single-writer and does not claim cross-process transactions. The service serializes one AgentAsset mutation and writes a recoverable local transaction record or equivalent before publishing user-visible events.

The detailed local atomicity strategy must be proven before code migration; a simple rename of two independent JSON files is not a transaction.

## 6. Query and repair

- `getStatus` reads only persisted projection.
- status initialization occurs in create/import command, not GET.
- `recompute` requires actor, reason, audit ID and projector version.
- unauthorized and missing use one external error class.

## 7. Journal behavior

Phase 1 journal is local crash-safe storage and therefore keeps the single Gateway writer restriction. It is not a second authoritative Growth repository.

Replay states:

```text
pending -> replaying -> acknowledged
                    -> retry_wait
                    -> quarantined
```

Only repository acknowledgement allows cleanup. Empty catches are prohibited.

## 8. Migration seams

Initial migration order:

1. Freeze event and authorization types.
2. Wrap existing reads in LocalGrowthRepository.
3. Make GET pure read.
4. Route explicit repair through service.
5. Generate terminal completion after fallback resolution.
6. Route writes through service and journal fallback.
7. Remove direct store writes from runner/RPC.

Existing `src/gateway/agent-growth/**` remains owned by `agent-growth-lifecycle` during extraction. New boundary code lives in `src/gateway/growth-application/**` until integration ownership is explicitly transferred.

## 9. Validation

- exact duplicate completion.
- fallback then success.
- final failure after retries.
- correction failed to succeeded and reverse.
- GET no-write snapshot.
- repository outage and replay.
- poison event quarantine.
- crash recovery and bounded reply latency.
