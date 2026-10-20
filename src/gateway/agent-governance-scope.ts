import { isBuiltinStewardAgent } from "../agents/builtin-steward/identity.js";
import {
  isAgentOwnedByEmployeeUser,
  type EmployeeWorkbenchActor,
} from "./employee-workbench-scope.js";
import type { OwnershipRecord } from "./ownership-store.js";
import type { QueryScope } from "./scope-attribution.js";
import type { GatewayAgentRow } from "./session-utils.js";

function isActiveTenantAgent(
  agentId: string,
  tenantId: string,
  ownershipRecords: readonly OwnershipRecord[],
): boolean {
  return ownershipRecords.some(
    (record) =>
      record.tenantId === tenantId &&
      record.subjectKind === "agent" &&
      record.subjectId === agentId &&
      record.bindingStatus !== "revoked",
  );
}

export function isAgentVisibleToGovernanceScope(params: {
  agent: GatewayAgentRow;
  scope: QueryScope;
  employeeActor?: EmployeeWorkbenchActor | null;
  ownershipRecords: readonly OwnershipRecord[];
}): boolean {
  if (params.scope.kind === "platform") {
    return true;
  }
  if (params.scope.kind === "tenant") {
    return (
      !isBuiltinStewardAgent(params.agent.id) &&
      isActiveTenantAgent(params.agent.id, params.scope.tenantId, params.ownershipRecords)
    );
  }
  return Boolean(
    params.employeeActor && isAgentOwnedByEmployeeUser(params.agent, params.employeeActor),
  );
}

export function filterAgentsForGovernanceScope(params: {
  agents: GatewayAgentRow[];
  scope: QueryScope;
  employeeActor?: EmployeeWorkbenchActor | null;
  ownershipRecords: readonly OwnershipRecord[];
}): GatewayAgentRow[] {
  if (params.scope.kind === "self") {
    // The employee's builtin supervisor remains visible in their workbench even
    // though it is not an employee-owned worker asset.
    return params.agents.filter(
      (agent) =>
        isBuiltinStewardAgent(agent.id) || isAgentVisibleToGovernanceScope({ ...params, agent }),
    );
  }
  return params.agents.filter((agent) => isAgentVisibleToGovernanceScope({ ...params, agent }));
}
