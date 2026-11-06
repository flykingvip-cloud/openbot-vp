/**
 * CLI / Gateway agent 命令商业运行闸口（Wave 5）。
 */

import type { AgentCommandGovernanceEntry } from "../../commands/agent/types.js";
import { loadConfig } from "../../config/config.js";
import { isSharedTenantAddressingEnabled } from "../../config/data-space.js";
import { resolveAccountExecutionPaths } from "../../gateway/account-execution-paths.js";
import {
  releaseEnterpriseAgentRun,
  tryAcquireEnterpriseAgentRun,
} from "../../gateway/billing/agent-run-governance.js";
import { recordCommercialRunDecision } from "../../gateway/governance/adapters/commercial-run-adapter.js";
import type { EmployeeModelGateResult } from "../../gateway/model-entitlement/employee-model-gate.js";

export type AgentCommandCommercialGateResult =
  | { status: "skipped" }
  | {
      status: "acquired";
      /** Subscription facts locked at authorization time; used for credit usage attribution. */
      subscriptionId?: string;
      subscriptionSnapshotId?: string;
      planId?: string;
      planVersionId?: string;
      /**
       * Passed through unchanged from `tryAcquireEnterpriseAgentRun` (governance plan
       * v1.0 §7.3). Consumed by the agent command's model governance.
       */
      modelGate?: EmployeeModelGateResult;
      /** Commercial authorization id (billing foreign key); never reused as a gd- id. */
      authorizationDecisionId?: string;
      /** Enterprise resolved server-side by the commercial gate. */
      enterpriseId?: string;
    }
  | { status: "denied"; message: string };

export async function acquireAgentCommandCommercialRun(input: {
  runId: string;
  sessionAgentId: string;
  enterpriseId?: string;
  gatewayClientUser?: string;
  /** Current task text for per-task capability planning (P0). */
  taskText?: string;
  /** Caller's entry (`E2` ingress / `E3` CLI / `E6` subagent), stamped on the envelope only. */
  entry?: AgentCommandGovernanceEntry | "E6";
}): Promise<AgentCommandCommercialGateResult> {
  const enterpriseId = input.enterpriseId?.trim();
  const cfg = loadConfig();
  const slot = await tryAcquireEnterpriseAgentRun({
    runId: input.runId,
    agentId: input.sessionAgentId,
    enterpriseId,
    modelGateInput: {
      cfg,
      agentId: input.sessionAgentId,
      ...(enterpriseId ? { enterpriseIdHint: enterpriseId } : {}),
      ...(input.taskText !== undefined ? { taskText: input.taskText } : {}),
      // all-bot-runs (managed default) resolves seat from agentId when no employee session.
      ...(input.gatewayClientUser
        ? {
            gatewayClientUser: input.gatewayClientUser,
            gatewayClientSessionDomain: "employee" as const,
          }
        : {}),
    },
  });
  let result: AgentCommandCommercialGateResult;
  if (slot.skipped) {
    result = { status: "skipped" };
  } else if (!slot.acquired) {
    result = { status: "denied", message: slot.message };
  } else {
    result = {
      status: "acquired",
      ...(slot.enterpriseId ? { enterpriseId: slot.enterpriseId } : {}),
      ...(slot.modelGate ? { modelGate: slot.modelGate } : {}),
      ...(slot.authorizationDecisionId
        ? { authorizationDecisionId: slot.authorizationDecisionId }
        : {}),
      ...(slot.subscriptionId ? { subscriptionId: slot.subscriptionId } : {}),
      ...(slot.subscriptionSnapshotId
        ? { subscriptionSnapshotId: slot.subscriptionSnapshotId }
        : {}),
      ...(slot.planId ? { planId: slot.planId } : {}),
      ...(slot.planVersionId ? { planVersionId: slot.planVersionId } : {}),
    };
  }
  // PR-P2-1: translate the already-decided gate into a commercial-run envelope.
  // Best-effort shadow only; the gate result is unchanged.
  const tenantId =
    result.status === "acquired"
      ? (result.modelGate?.tenantId ?? result.enterpriseId ?? input.enterpriseId?.trim())
      : input.enterpriseId?.trim();
  const userId = input.gatewayClientUser?.trim();
  let dataSpaceRef: string | undefined;
  let browserNamespaceRef: string | undefined;
  if (tenantId && userId && isSharedTenantAddressingEnabled(cfg)) {
    try {
      const paths = resolveAccountExecutionPaths({
        ctx: { tenantId, userId, domain: "employee" },
        cfg,
        agentId: input.sessionAgentId,
      });
      dataSpaceRef = paths.dataSpaceRef;
      browserNamespaceRef = paths.browserNamespaceRef;
    } catch {
      // Correlation is best-effort. A path failure must not change the gate.
    }
  }
  recordCommercialRunDecision({
    gate: {
      status: result.status,
      ...(result.status === "acquired" && result.authorizationDecisionId
        ? { authorizationDecisionId: result.authorizationDecisionId }
        : {}),
      ...(result.status === "denied" ? { message: result.message } : {}),
      runId: input.runId,
      executionId: input.runId,
      runtimeLeaseId: "",
      ...(tenantId ? { tenantId } : {}),
      ...(userId ? { userId } : {}),
      ...(dataSpaceRef ? { dataSpaceRef } : {}),
      ...(browserNamespaceRef ? { browserNamespaceRef } : {}),
      subjectId: input.runId,
      ...(input.entry ? { entry: input.entry } : {}),
    },
  });
  return result;
}

export async function releaseAgentCommandCommercialRun(runId: string): Promise<void> {
  await releaseEnterpriseAgentRun(runId);
}
