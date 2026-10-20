/**
 * Agent Run 并发治理：委托 authorizeCommercialRun() 统一商业闸口。
 */

import type {
  EmployeeModelGateInput,
  EmployeeModelGateResult,
} from "../model-entitlement/employee-model-gate.js";
import { authorizeCommercialRun, releaseCommercialRunSlot } from "./authorize-commercial-run.js";
import type { ConstraintReason } from "./constraint-engine.js";

export { resolveEnterpriseIdForAgentRun } from "./resolve-enterprise-id-for-agent-run.js";

type CommercialDenyReason =
  | ConstraintReason
  | "BUDGET_EXCEEDED"
  | "MODEL_GATE_DENIED"
  | "NO_SUBSCRIPTION"
  | "OVER_ALLOCATED"
  | "SEAT_CONCURRENCY_LIMIT_EXCEEDED"
  | "CONCURRENCY_QUEUE_TIMEOUT"
  | "TENANT_EXPIRED"
  | "TENANT_SUSPENDED"
  | "ASSET_PAUSED"
  | "ASSET_BUDGET_EXCEEDED";

export type AcquireAgentRunResult =
  | {
      acquired: true;
      enterpriseId: string;
      skipped: false;
      authorizationDecisionId?: string;
      subscriptionId?: string;
      subscriptionSnapshotId?: string;
      planId?: string;
      planVersionId?: string;
      modelGate?: EmployeeModelGateResult;
    }
  | { acquired: false; skipped: true }
  | { acquired: false; skipped: false; reason: CommercialDenyReason; message: string };

export async function tryAcquireEnterpriseAgentRun(input: {
  runId: string;
  agentId?: string;
  botId?: string;
  /** employee chat 等已解析租户；优先于 agentId 归属解析。 */
  enterpriseId?: string;
  /** Collaboration group id. Omit channel/session keys that are not mesh groups. */
  groupId?: string;
  modelGateInput?: EmployeeModelGateInput;
}): Promise<AcquireAgentRunResult> {
  const auth = await authorizeCommercialRun({
    runId: input.runId,
    agentId: input.agentId,
    botId: input.botId,
    enterpriseId: input.enterpriseId,
    action: "agent_run",
    ...(input.groupId ? { groupId: input.groupId } : {}),
    ...(input.modelGateInput ? { modelGateInput: input.modelGateInput } : {}),
  });

  if (auth.skipped) {
    return { acquired: false, skipped: true };
  }
  if (!auth.allowed) {
    return {
      acquired: false,
      skipped: false,
      reason: auth.reason,
      message: auth.message,
    };
  }
  return {
    acquired: true,
    enterpriseId: auth.enterpriseId,
    skipped: false,
    authorizationDecisionId: auth.authorizationDecisionId,
    subscriptionId: auth.subscriptionId,
    subscriptionSnapshotId: auth.subscriptionSnapshotId,
    planId: auth.planId,
    planVersionId: auth.planVersionId,
    ...(auth.modelGate ? { modelGate: auth.modelGate } : {}),
  };
}

export async function releaseEnterpriseAgentRun(runId: string): Promise<void> {
  await releaseCommercialRunSlot(runId);
}

export async function checkEnterpriseBotCreate(
  enterpriseId: string,
): Promise<{ allowed: true } | { allowed: false; reason: CommercialDenyReason; message: string }> {
  const auth = await authorizeCommercialRun({
    enterpriseId,
    action: "bot_create",
  });
  if (auth.skipped) {
    return { allowed: true };
  }
  if (!auth.allowed) {
    return { allowed: false, reason: auth.reason, message: auth.message };
  }
  return { allowed: true };
}
