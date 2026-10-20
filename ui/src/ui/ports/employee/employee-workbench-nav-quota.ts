import { isBuiltinStewardAgent } from "../../builtin-steward-selection.ts";
import type { GatewayAgentRow } from "../../types.ts";

/**
 * Max creatable AI assistants in the employee nav (excludes steward / 大白).
 * Position seat packages may still bind up to `ENTERPRISE_POSITION_AGENT_ASSET_LIMIT` (5)
 * on the gateway; this nav create-cap is intentionally 4 so 大白 + 4 bots stay within a
 * five-slot mental model without double-counting the steward.
 */
export const EMPLOYEE_WORKBENCH_AGENT_NAV_LIMIT = 4;

/** Max collaboration groups the actor may create (joined peer-owned groups do not count). */
export const EMPLOYEE_WORKBENCH_COLLABORATION_SPACE_NAV_LIMIT = 5;

export type EmployeeWorkbenchNavQuotaSpace = {
  ownerUserId?: string | null;
};

export type EmployeeWorkbenchNavQuota = {
  agentCount: number;
  agentLimit: number;
  canAddAgent: boolean;
  /** Count of spaces owned/created by the actor (not total visible nav rows). */
  spaceCount: number;
  spaceLimit: number;
  canAddSpace: boolean;
};

/** Steward nav seed id (`daibai`) is not a creatable seat asset; exclude it from the create-cap. */
export function isEmployeeWorkbenchQuotaExemptAgentId(agentId: string): boolean {
  const trimmed = agentId.trim();
  if (!trimmed) {
    return false;
  }
  return isBuiltinStewardAgent(trimmed) || trimmed.toLowerCase() === "daibai";
}

export function countEmployeeWorkbenchNavAgents(
  agents: readonly Pick<GatewayAgentRow, "id">[],
): number {
  return agents.filter((agent) => !isEmployeeWorkbenchQuotaExemptAgentId(agent.id)).length;
}

function normalizeIdentity(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

/** True when the space owner matches any actor identity (userId / email / handle). */
export function isEmployeeWorkbenchOwnedSpace(
  space: EmployeeWorkbenchNavQuotaSpace,
  actorIdentities: ReadonlySet<string>,
): boolean {
  const owner = normalizeIdentity(space.ownerUserId);
  return Boolean(owner && actorIdentities.has(owner));
}

export function countEmployeeWorkbenchOwnedSpaces(
  spaces: readonly EmployeeWorkbenchNavQuotaSpace[],
  actorIdentities: ReadonlySet<string>,
): number {
  return spaces.filter((space) => isEmployeeWorkbenchOwnedSpace(space, actorIdentities)).length;
}

export function resolveEmployeeWorkbenchNavQuota(params: {
  agents: readonly Pick<GatewayAgentRow, "id">[];
  spaces: readonly EmployeeWorkbenchNavQuotaSpace[];
  /**
   * When provided, only spaces owned by the actor count toward `canAddSpace`.
   * Joined peer-created groups remain visible in nav but do not consume create quota.
   */
  actorIdentities: ReadonlySet<string>;
  agentLimit?: number;
  spaceLimit?: number;
  /** Platform admins may exceed the per-seat robot create-cap. */
  bypassAgentLimit?: boolean;
  bypassSpaceLimit?: boolean;
}): EmployeeWorkbenchNavQuota {
  const agentLimit = params.agentLimit ?? EMPLOYEE_WORKBENCH_AGENT_NAV_LIMIT;
  const spaceLimit = params.spaceLimit ?? EMPLOYEE_WORKBENCH_COLLABORATION_SPACE_NAV_LIMIT;
  const agentCount = countEmployeeWorkbenchNavAgents(params.agents);
  const spaceCount = countEmployeeWorkbenchOwnedSpaces(params.spaces, params.actorIdentities);
  return {
    agentCount,
    agentLimit,
    canAddAgent: Boolean(params.bypassAgentLimit) || agentLimit <= 0 || agentCount < agentLimit,
    spaceCount,
    spaceLimit,
    canAddSpace: Boolean(params.bypassSpaceLimit) || spaceLimit <= 0 || spaceCount < spaceLimit,
  };
}
