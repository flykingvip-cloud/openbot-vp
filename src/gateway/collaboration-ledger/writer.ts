import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import type { CollaborationEventKey } from "../collaboration-dispatch/collaboration-event-key.js";
import type {
  CollaborationEpisodeDecisionRecord,
  CollaborationPolicyDecisionRecord,
} from "../collaboration-dispatch/episode-decision-record.js";
import type { PolicyMigrationEvent } from "../collaboration-dispatch/policy-migration-event.js";
import { appendJsonlDurable } from "../collaboration-dispatch/round-store-io.js";
import {
  assertCollaborationRuntimeWritable,
  resolveCollaborationRuntimeFactPaths,
} from "../collaboration-dispatch/runtime-namespace.js";
import type { ParticipationDecision, ParticipationTier } from "../collaboration-dispatch/types.js";
import { recordExecutionOutcomeCapsuleSafely } from "../collaboration-learning/execution-outcome-capsule.js";
import type {
  CollaborationContextScopeRecord,
  CollaborationDispatchRecord,
  CollaborationExecutionRecord,
  CollaborationFactRecord,
  CollaborationGovernanceRecord,
  CollaborationLedgerRecord,
  CollaborationPolicyMigrationRecord,
  CollaborationQualityRecord,
} from "./types.js";

/**
 * P0.0a: legacy `<groupDir>/ledger/collaboration.jsonl` while
 * collaboration.runtimeNamespace is off; `<ns>/ledger/collaboration.jsonl`
 * (tenant-scoped, fail-closed for managed_enterprise without tenant) when on.
 */
function resolveCanonicalLedgerPath(groupId: string, tenantId?: string | null) {
  return resolveCollaborationRuntimeFactPaths({ groupId, tenantId, cfg: loadConfig() }).ledgerFile;
}

function isLedgerDecisionRecordsEnabled(cfg?: OpenBotConfig): boolean {
  return (cfg ?? loadConfig()).collaboration?.ledger?.decisionRecords === true;
}

function isHandoffContractLedgerEnabled(cfg?: OpenBotConfig): boolean {
  return (cfg ?? loadConfig()).collaboration?.task?.handoffContract === true;
}

async function appendLedgerRecord<T extends CollaborationLedgerRecord>(
  groupId: string,
  record: T,
  tenantId?: string | null,
  cfg?: OpenBotConfig,
): Promise<T> {
  const resolvedCfg = cfg ?? loadConfig();
  const resolved = resolveCollaborationRuntimeFactPaths({ groupId, tenantId, cfg: resolvedCfg });
  const ledgerPath = resolved.ledgerFile;
  assertCollaborationRuntimeWritable(ledgerPath, resolvedCfg);
  if (resolved.namespace) {
    await appendJsonlDurable(ledgerPath, record);
    return record;
  }
  await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
  await fs.appendFile(ledgerPath, `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

export async function appendCollaborationDispatchRecord(params: {
  groupId: string;
  message: string;
  decision: ParticipationDecision;
  tenantId?: string | null;
  /** P0.0b: CollaborationEventKey when policySnapshot flag is on. */
  key?: CollaborationEventKey;
}) {
  const record: CollaborationDispatchRecord = {
    kind: "dispatch",
    roundId: params.decision.roundId,
    groupId: params.groupId,
    sessionKey: params.decision.roundPlan.sessionKey,
    messagePreview: params.message.trim().slice(0, 240),
    summaryText: params.decision.roundPlan.summaryText,
    responseMode: params.decision.responseMode,
    participantAgentIds: params.decision.executionBots.map((bot) => bot.agentId),
    participantRoles: params.decision.roundPlan.participants.map((participant) => ({
      agentId: participant.agentId,
      contributionRole: participant.contributionRole,
    })),
    ...(params.decision.roundPlan.alerts?.length
      ? {
          alerts: params.decision.roundPlan.alerts.map((alert) => ({
            kind: alert.kind,
            message: alert.message,
          })),
        }
      : {}),
    recordedAtMs: Date.now(),
    ...(params.key ? { key: params.key } : {}),
  };

  return await appendLedgerRecord(params.groupId, record, params.tenantId);
}

export async function appendCollaborationExecutionRecord(params: {
  groupId: string;
  sessionKey: string;
  roundId: string;
  agentId: string;
  agentName: string;
  tier: ParticipationTier;
  status: CollaborationExecutionRecord["status"];
  contributionRole?: string;
  incrementalContribution?: boolean;
  suppressedAsDuplicate?: boolean;
  skipReason?: CollaborationExecutionRecord["skipReason"];
  latencyMs?: number;
  tenantId?: string | null;
  /** P0.0b: CollaborationEventKey when policySnapshot flag is on. */
  key?: CollaborationEventKey;
}) {
  const record: CollaborationExecutionRecord = {
    kind: "execution",
    roundId: params.roundId,
    groupId: params.groupId,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    agentName: params.agentName,
    tier: params.tier,
    status: params.status,
    ...(params.contributionRole ? { contributionRole: params.contributionRole } : {}),
    ...(params.incrementalContribution === true ? { incrementalContribution: true } : {}),
    ...(params.suppressedAsDuplicate === true ? { suppressedAsDuplicate: true } : {}),
    ...(params.skipReason ? { skipReason: params.skipReason } : {}),
    ...(typeof params.latencyMs === "number" && Number.isFinite(params.latencyMs)
      ? { latencyMs: Math.max(0, Math.round(params.latencyMs)) }
      : {}),
    recordedAtMs: Date.now(),
    ...(params.key ? { key: params.key } : {}),
  };
  const written = await appendLedgerRecord(params.groupId, record, params.tenantId);
  // 卡 X / L1 X.4：账本咽喉点旁路沉淀失败经验（fire-and-forget，不影响账本写入）。
  void recordExecutionOutcomeCapsuleSafely(record);
  return written;
}

export async function appendCollaborationGovernanceRecord(params: {
  groupId: string;
  event: CollaborationGovernanceRecord["event"];
  summary: string;
  lifecycleStatus?: CollaborationGovernanceRecord["lifecycleStatus"];
  phase?: CollaborationGovernanceRecord["phase"];
  previousPhase?: CollaborationGovernanceRecord["previousPhase"];
  tenantId?: string | null;
  /** P0.0b: CollaborationEventKey when policySnapshot flag is on. */
  key?: CollaborationEventKey;
}) {
  const record: CollaborationGovernanceRecord = {
    kind: "governance",
    groupId: params.groupId,
    event: params.event,
    summary: params.summary,
    recordedAtMs: Date.now(),
    ...(params.lifecycleStatus ? { lifecycleStatus: params.lifecycleStatus } : {}),
    ...(params.phase ? { phase: params.phase } : {}),
    ...(params.previousPhase ? { previousPhase: params.previousPhase } : {}),
    ...(params.key ? { key: params.key } : {}),
  };
  return await appendLedgerRecord(params.groupId, record, params.tenantId);
}

/**
 * P1-A2: append one PolicyMigrationEvent (kind "policy_migration"). Callers that need
 * idempotency by eventId use appendCollaborationPolicyMigrationEvents
 * (collaboration-ledger/policy-migrations.ts).
 */
export async function appendCollaborationPolicyMigrationRecord(params: {
  event: PolicyMigrationEvent;
  tenantId?: string | null;
}) {
  const record: CollaborationPolicyMigrationRecord = {
    ...params.event,
    recordedAtMs: params.event.at,
  };
  return await appendLedgerRecord(
    params.event.groupId,
    record,
    params.tenantId ?? params.event.tenantId,
  );
}

export async function appendCollaborationPromotionAuditRecord(params: {
  groupId: string;
  sourceGroupId: string;
  botId: string;
  capsuleId?: string;
  projectionId?: string;
  assetId?: string;
  promoted: boolean;
  reason: string;
  targetScope: "personal" | "group" | "tenant";
  tenantId?: string | null;
  /** P0.0b: CollaborationEventKey when policySnapshot flag is on. */
  key?: CollaborationEventKey;
}) {
  const record = {
    kind: "promotion" as const,
    groupId: params.groupId,
    sourceGroupId: params.sourceGroupId,
    botId: params.botId,
    promoted: params.promoted,
    reason: params.reason,
    targetScope: params.targetScope,
    recordedAtMs: Date.now(),
    ...(params.capsuleId ? { capsuleId: params.capsuleId } : {}),
    ...(params.projectionId ? { projectionId: params.projectionId } : {}),
    ...(params.assetId ? { assetId: params.assetId } : {}),
    ...(params.key ? { key: params.key } : {}),
  };
  return await appendLedgerRecord(params.groupId, record, params.tenantId);
}

export async function appendCollaborationContextScopeRecord(params: {
  groupId: string;
  sessionKey: string;
  roundId?: string;
  mode: string;
  confidentialityMaxLevel: string;
  allowedSources: Array<{ type: string; id: string }>;
  deniedSources: Array<{ type: string; id: string; reason: string }>;
  budgetMaxTokens: number;
  budgetMaxFiles: number;
  evidenceCount?: number;
  tenantId?: string | null;
  /** P0.0b: CollaborationEventKey when policySnapshot flag is on. */
  key?: CollaborationEventKey;
}) {
  const record: CollaborationContextScopeRecord = {
    kind: "context_scope",
    groupId: params.groupId,
    sessionKey: params.sessionKey,
    mode: params.mode,
    confidentialityMaxLevel: params.confidentialityMaxLevel,
    allowedSources: params.allowedSources,
    deniedSources: params.deniedSources,
    budgetMaxTokens: params.budgetMaxTokens,
    budgetMaxFiles: params.budgetMaxFiles,
    recordedAtMs: Date.now(),
    ...(params.roundId ? { roundId: params.roundId } : {}),
    ...(params.evidenceCount != null ? { evidenceCount: params.evidenceCount } : {}),
    ...(params.key ? { key: params.key } : {}),
  };
  return await appendLedgerRecord(params.groupId, record, params.tenantId);
}

export async function appendCollaborationQualityRecord(
  params: Omit<CollaborationQualityRecord, "kind" | "recordedAtMs"> & {
    recordedAtMs?: number;
    tenantId?: string | null;
  },
) {
  const record: CollaborationQualityRecord = {
    kind: "quality",
    groupId: params.groupId,
    event: params.event,
    outcome: params.outcome,
    recordedAtMs: params.recordedAtMs ?? Date.now(),
    ...(params.agentId ? { agentId: params.agentId } : {}),
    ...(params.roundId ? { roundId: params.roundId } : {}),
    ...(params.taskId ? { taskId: params.taskId } : {}),
    ...(params.deliverableId ? { deliverableId: params.deliverableId } : {}),
    ...(params.reviewId ? { reviewId: params.reviewId } : {}),
    ...(typeof params.latencyMs === "number" && Number.isFinite(params.latencyMs)
      ? { latencyMs: Math.max(0, Math.round(params.latencyMs)) }
      : {}),
    ...(params.artifacts?.length ? { artifacts: params.artifacts } : {}),
    ...(params.handoff ? { handoff: params.handoff } : {}),
    ...(params.reviewVerdict ? { reviewVerdict: params.reviewVerdict } : {}),
    ...(params.humanFeedback ? { humanFeedback: params.humanFeedback } : {}),
    ...(params.effectivePolicyHash ? { effectivePolicyHash: params.effectivePolicyHash } : {}),
    ...(params.key ? { key: params.key } : {}),
  };
  return await appendLedgerRecord(params.groupId, record, params.tenantId);
}

export function recordCollaborationQualityBestEffort(
  params: Omit<CollaborationQualityRecord, "kind" | "recordedAtMs"> & {
    recordedAtMs?: number;
    tenantId?: string | null;
  },
) {
  void appendCollaborationQualityRecord(params).catch(() => {
    // Ledger quality is observational. Never fail the live transition.
  });
}

/**
 * P1-B②: append one PolicyDecisionRecord v2. Flag-off is a no-op (returns null).
 * Live hot paths must not call this; `writeBeatDecisionRecords` is the entry.
 */
export async function appendCollaborationPolicyDecisionRecord(params: {
  record: CollaborationPolicyDecisionRecord;
  cfg?: OpenBotConfig;
}): Promise<CollaborationPolicyDecisionRecord | null> {
  const cfg = params.cfg ?? loadConfig();
  if (!isLedgerDecisionRecordsEnabled(cfg)) {
    return null;
  }
  return await appendLedgerRecord(
    params.record.key.groupId,
    params.record,
    params.record.key.tenantId,
    cfg,
  );
}

/**
 * P1-B②: append one EpisodeDecisionRecord. Flag-off is a no-op (returns null).
 * Live hot paths must not call this; `writeBeatDecisionRecords` is the entry.
 */
export async function appendCollaborationEpisodeDecisionRecord(params: {
  record: CollaborationEpisodeDecisionRecord;
  cfg?: OpenBotConfig;
}): Promise<CollaborationEpisodeDecisionRecord | null> {
  const cfg = params.cfg ?? loadConfig();
  if (!isLedgerDecisionRecordsEnabled(cfg)) {
    return null;
  }
  return await appendLedgerRecord(
    params.record.key.groupId,
    params.record,
    params.record.key.tenantId,
    cfg,
  );
}

/**
 * P1-B③: append one handoff fact. Flag-off is a no-op (returns null).
 * Live owner_transfer does not call this while `collaboration.task.handoffContract` is off.
 */
export async function appendCollaborationFactRecord(params: {
  record: CollaborationFactRecord;
  cfg?: OpenBotConfig;
}): Promise<CollaborationFactRecord | null> {
  const cfg = params.cfg ?? loadConfig();
  if (!isHandoffContractLedgerEnabled(cfg)) {
    return null;
  }
  return await appendLedgerRecord(
    params.record.groupId,
    params.record,
    params.record.key.tenantId,
    cfg,
  );
}

export { resolveCanonicalLedgerPath };
