import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Usage } from "@earendil-works/pi-ai/compat";
import { billingEventBus } from "../../../billing/event-bus.js";
import { recordCreditUsage } from "../../../billing/record-credit-usage.js";
import { recordUsage } from "../../../billing/usage-records-store.js";
import { incrementGovernanceLlmUsageLocal } from "./governance-llm-usage-store.js";

/** Meter keys for governance background LLM (cost-budget-billing skeleton). */
export const GOVERNANCE_LLM_METER_KEYS = {
  calls: "knowledge_governance_llm_call",
  tokens: "knowledge_governance_llm_tokens",
} as const;

export const GOVERNANCE_LLM_CREDIT_POLICY_ID = "governance-conflict-analysis";

export type GovernanceLlmUsageScope = {
  kbId: string;
  enterpriseId: string | null;
  userId: string | null;
  jobId?: string;
  db?: DatabaseSync;
};

export type GovernanceLlmUsageAttribution = GovernanceLlmUsageScope & {
  modelId: string;
  provider: string;
};

export type GovernanceLlmUsageReportInput = GovernanceLlmUsageAttribution & {
  callId?: string;
  inputTokens?: number;
  outputTokens?: number;
};

export type GovernanceLlmUsageReportResult = {
  reported: boolean;
  skippedReason?: "personal_scope" | "no_enterprise";
  callRecorded: boolean;
  tokensRecorded: boolean;
  creditsCharged: number;
  creditRecorded: boolean;
  localRecorded: boolean;
};

export function extractGovernanceLlmTokenUsage(usage?: Usage): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} {
  if (!usage) {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }
  const inputTokens = Math.max(0, Math.floor(usage.input ?? 0));
  const outputTokens = Math.max(0, Math.floor(usage.output ?? 0));
  const totalTokens = Math.max(0, Math.floor(usage.totalTokens ?? inputTokens + outputTokens));
  return { inputTokens, outputTokens, totalTokens };
}

function resolveGovernanceUsageUserId(userId: string | null | undefined): string {
  const trimmed = userId?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "governance-system";
}

function resolveGovernanceModelId(provider: string, modelId: string): string {
  const model = modelId.trim();
  if (model.includes("/")) {
    return model;
  }
  const providerName = provider.trim();
  return providerName ? `${providerName}/${model}` : model;
}

function persistLocalGovernanceLlmUsage(params: {
  db?: DatabaseSync;
  kbId: string;
  inputTokens: number;
  outputTokens: number;
  creditsCharged: number;
}): boolean {
  if (!params.db) {
    return false;
  }
  incrementGovernanceLlmUsageLocal({
    db: params.db,
    kbId: params.kbId,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    creditsCharged: params.creditsCharged,
  });
  return true;
}

async function reportGovernanceMeterUsage(params: {
  enterpriseId: string;
  userId: string;
  kbId: string;
  callId: string;
  inputTokens: number;
  outputTokens: number;
  occurredAt: string;
}): Promise<{ callRecorded: boolean; tokensRecorded: boolean }> {
  let callRecorded = false;
  let tokensRecorded = false;

  const callResult = await recordUsage({
    enterpriseId: params.enterpriseId,
    userId: params.userId,
    eventId: `gov-llm:call:${params.kbId}:${params.callId}`,
    key: GOVERNANCE_LLM_METER_KEYS.calls,
    quantity: 1,
    occurredAt: params.occurredAt,
    agentId: "knowledge-governance",
    orgSeatId: null,
  });
  callRecorded = callResult.recorded;
  if (callResult.recorded) {
    await billingEventBus.publish({
      type: "usage.reported",
      enterpriseId: params.enterpriseId,
      userId: callResult.record.userId,
      eventId: callResult.record.eventId,
      key: GOVERNANCE_LLM_METER_KEYS.calls,
      quantity: 1,
      occurredAt: callResult.record.occurredAt,
      ...(callResult.record.agentId ? { agentId: callResult.record.agentId } : {}),
    });
  }

  const totalTokens =
    params.inputTokens + params.outputTokens > 0 ? params.inputTokens + params.outputTokens : 0;
  if (totalTokens > 0) {
    const tokenResult = await recordUsage({
      enterpriseId: params.enterpriseId,
      userId: params.userId,
      eventId: `gov-llm:tokens:${params.kbId}:${params.callId}`,
      key: GOVERNANCE_LLM_METER_KEYS.tokens,
      quantity: totalTokens,
      occurredAt: params.occurredAt,
      agentId: "knowledge-governance",
      orgSeatId: null,
    });
    tokensRecorded = tokenResult.recorded;
    if (tokenResult.recorded) {
      await billingEventBus.publish({
        type: "usage.reported",
        enterpriseId: params.enterpriseId,
        userId: tokenResult.record.userId,
        eventId: tokenResult.record.eventId,
        key: GOVERNANCE_LLM_METER_KEYS.tokens,
        quantity: totalTokens,
        occurredAt: tokenResult.record.occurredAt,
        ...(tokenResult.record.agentId ? { agentId: tokenResult.record.agentId } : {}),
      });
    }
  }

  return { callRecorded, tokensRecorded };
}

/**
 * Best-effort governance LLM usage reporting.
 * Personal-scope indexes update local stats only; enterprise also records credits + meters.
 */
export async function reportGovernanceLlmUsage(
  input: GovernanceLlmUsageReportInput,
): Promise<GovernanceLlmUsageReportResult> {
  const callId = input.callId?.trim() || randomUUID();
  const inputTokens = Math.max(0, Math.floor(input.inputTokens ?? 0));
  const outputTokens = Math.max(0, Math.floor(input.outputTokens ?? 0));
  const enterpriseId = input.enterpriseId?.trim();
  const userId = resolveGovernanceUsageUserId(input.userId);
  const occurredAt = new Date().toISOString();
  const modelId = resolveGovernanceModelId(input.provider, input.modelId);
  const creditTaskId = `gov-llm:${input.kbId}:${callId}`;

  if (!enterpriseId) {
    const localRecorded = persistLocalGovernanceLlmUsage({
      db: input.db,
      kbId: input.kbId,
      inputTokens,
      outputTokens,
      creditsCharged: 0,
    });
    return {
      reported: localRecorded,
      skippedReason: "personal_scope",
      callRecorded: false,
      tokensRecorded: false,
      creditsCharged: 0,
      creditRecorded: false,
      localRecorded,
    };
  }

  let callRecorded = false;
  let tokensRecorded = false;
  let creditsCharged = 0;
  let creditRecorded = false;

  try {
    const creditResult = await recordCreditUsage({
      enterpriseId,
      taskId: creditTaskId,
      modelId,
      policyId: GOVERNANCE_LLM_CREDIT_POLICY_ID,
      userId,
      agentId: "knowledge-governance",
      runId: input.jobId?.trim() || creditTaskId,
      occurredAt,
      tokenUsage:
        inputTokens > 0 || outputTokens > 0
          ? {
              ...(inputTokens > 0 ? { inputTokens } : {}),
              ...(outputTokens > 0 ? { outputTokens } : {}),
            }
          : undefined,
    });
    creditsCharged = creditResult.creditsCharged;
    creditRecorded = creditResult.recorded;

    const meterResult = await reportGovernanceMeterUsage({
      enterpriseId,
      userId,
      kbId: input.kbId,
      callId,
      inputTokens,
      outputTokens,
      occurredAt,
    });
    callRecorded = meterResult.callRecorded;
    tokensRecorded = meterResult.tokensRecorded;
  } catch {
    const localRecorded = persistLocalGovernanceLlmUsage({
      db: input.db,
      kbId: input.kbId,
      inputTokens,
      outputTokens,
      creditsCharged,
    });
    return {
      reported: localRecorded,
      callRecorded,
      tokensRecorded,
      creditsCharged,
      creditRecorded,
      localRecorded,
    };
  }

  const localRecorded = persistLocalGovernanceLlmUsage({
    db: input.db,
    kbId: input.kbId,
    inputTokens,
    outputTokens,
    creditsCharged,
  });

  return {
    reported: creditRecorded || callRecorded || tokensRecorded || localRecorded,
    callRecorded,
    tokensRecorded,
    creditsCharged,
    creditRecorded,
    localRecorded,
  };
}

export async function reportGovernanceLlmUsageBestEffort(
  input: GovernanceLlmUsageReportInput,
): Promise<void> {
  try {
    await reportGovernanceLlmUsage(input);
  } catch {
    // Billing must never break governance detection.
  }
}
