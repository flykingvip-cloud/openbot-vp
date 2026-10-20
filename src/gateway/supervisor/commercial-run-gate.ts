/**
 * Supervisor / Workflow worker 商业运行闸口（Wave 5）。
 */

import { loadConfig } from "../../config/config.js";
import {
  releaseEnterpriseAgentRun,
  tryAcquireEnterpriseAgentRun,
} from "../billing/agent-run-governance.js";
import {
  resolveSupervisorTenantCommercialCapacity,
  type SupervisorTenantCommercialCapacity,
} from "./tenant-commercial-capacity.js";

export class SupervisorCommercialRunDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupervisorCommercialRunDeniedError";
  }
}

/** @returns true when a commercial slot was acquired and must be released. */
export async function acquireSupervisorCommercialRun(input: {
  runId: string;
  agentId?: string;
  enterpriseId?: string;
}): Promise<boolean> {
  const cfg = loadConfig();
  const enterpriseId = input.enterpriseId?.trim();
  const slot = await tryAcquireEnterpriseAgentRun({
    runId: input.runId,
    agentId: input.agentId,
    enterpriseId,
    // Managed-tenant model entitlement: pass authoritative enterpriseId as hint so
    // missing agent/seat mapping hard-denies instead of personal fail-open.
    modelGateInput: {
      cfg,
      ...(input.agentId?.trim() ? { agentId: input.agentId.trim() } : {}),
      ...(enterpriseId ? { enterpriseIdHint: enterpriseId } : {}),
    },
  });
  if (slot.skipped) {
    return false;
  }
  if (!slot.acquired) {
    throw new SupervisorCommercialRunDeniedError(slot.message);
  }
  return true;
}

export async function releaseSupervisorCommercialRun(runId: string): Promise<void> {
  await releaseEnterpriseAgentRun(runId);
}

export async function assertSupervisorTenantCommercialCapacity(
  enterpriseId: string,
  opts?: Parameters<typeof resolveSupervisorTenantCommercialCapacity>[1],
): Promise<SupervisorTenantCommercialCapacity> {
  const capacity = await resolveSupervisorTenantCommercialCapacity(enterpriseId, opts);
  if (!capacity.allowed) {
    throw new SupervisorCommercialRunDeniedError(capacity.reason ?? "租户 AI 同时工作能力已满");
  }
  return capacity;
}
