import { randomUUID } from "node:crypto";

/**
 * tenant-import ID remap planner (SaaS tenant data architecture §10.1, acceptance SAAS-D-07).
 *
 * Produces a deterministic mapping from source ids to target-tenant ids so a package's control
 * plane and user data spaces can be rewritten consistently on import. Policy per §10:
 *  - tenantId: forced to the manifest `target.targetTenantId`.
 *  - userId: OQ-3 default A — merge by email into an existing account when present, else new uuid.
 *  - seat / group / knowledgeBase / identity ids: always new uuid (legacy id kept as the map key).
 *  - agentId: keep the semantic id (e.g. `main`); on collision with an existing target agent,
 *    suffix `-imported` (then `-imported-2`, …) so imports never clobber a tenant's own agents.
 *
 * The planner is pure; inject `newId` for deterministic tests.
 */

export type TenantImportUserInput = {
  sourceUserId: string;
  email?: string;
};

export type IdRemapInput = {
  targetTenantId: string;
  users: TenantImportUserInput[];
  /** Lowercased email -> existing target userId (OQ-3 merge-by-email). */
  existingUsersByEmail?: Record<string, string>;
  seatIds?: string[];
  agentIds?: string[];
  /** Agent ids already present in the target tenant (collision → `-imported` suffix). */
  existingAgentIds?: string[];
  groupIds?: string[];
  knowledgeBaseIds?: string[];
  identityIds?: string[];
  /** Injectable uuid generator for deterministic tests. */
  newId?: () => string;
};

export type UserRemap = {
  targetUserId: string;
  /** True when merged into an existing account by email (OQ-3 A). */
  merged: boolean;
};

export type IdRemapPlan = {
  tenantId: string;
  /** sourceUserId -> remap result. */
  users: Record<string, UserRemap>;
  seats: Record<string, string>;
  agents: Record<string, string>;
  groups: Record<string, string>;
  knowledgeBases: Record<string, string>;
  identities: Record<string, string>;
};

/**
 * Resolve a target agent id: keep the semantic source id unless it collides with an id already
 * taken in the target tenant, in which case append `-imported` (deduping further with `-N`).
 */
export function resolveAgentId(sourceId: string, taken: Set<string>): string {
  if (!taken.has(sourceId)) {
    return sourceId;
  }
  const base = `${sourceId}-imported`;
  if (!taken.has(base)) {
    return base;
  }
  let n = 2;
  while (taken.has(`${base}-${n}`)) {
    n += 1;
  }
  return `${base}-${n}`;
}

function mapNewIds(ids: string[] | undefined, newId: () => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ids ?? []) {
    if (id && !(id in out)) {
      out[id] = newId();
    }
  }
  return out;
}

export function buildIdRemapPlan(input: IdRemapInput): IdRemapPlan {
  const newId = input.newId ?? randomUUID;
  const existingByEmail = input.existingUsersByEmail ?? {};

  const users: Record<string, UserRemap> = {};
  for (const user of input.users) {
    if (!user.sourceUserId || user.sourceUserId in users) {
      continue;
    }
    const email = user.email?.trim().toLowerCase();
    const existing = email ? existingByEmail[email] : undefined;
    users[user.sourceUserId] = existing
      ? { targetUserId: existing, merged: true }
      : { targetUserId: newId(), merged: false };
  }

  // Agents keep semantic ids; seed "taken" from the target tenant's existing agents.
  const taken = new Set<string>(input.existingAgentIds ?? []);
  const agents: Record<string, string> = {};
  for (const sourceAgentId of input.agentIds ?? []) {
    if (!sourceAgentId || sourceAgentId in agents) {
      continue;
    }
    const resolved = resolveAgentId(sourceAgentId, taken);
    agents[sourceAgentId] = resolved;
    taken.add(resolved);
  }

  return {
    tenantId: input.targetTenantId,
    users,
    seats: mapNewIds(input.seatIds, newId),
    agents,
    groups: mapNewIds(input.groupIds, newId),
    knowledgeBases: mapNewIds(input.knowledgeBaseIds, newId),
    identities: mapNewIds(input.identityIds, newId),
  };
}
