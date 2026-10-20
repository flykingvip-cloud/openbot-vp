// Feature: shared-agent-identity-access-control-plane

import {
  isUniversalBuiltinAgentId,
  resolveLegacyAgentId,
} from "../agent-registry/legacy-resolver.js";
import { loadAgentRegistryStore } from "../agent-registry/store.js";
import type { AgentRegistryStore } from "../agent-registry/types.js";
import { emitAccessGovernanceAudit } from "./audit-sink.js";
import { listTenantPolicies, loadAccessPolicyStore } from "./policy-store.js";
import { buildOwnerBaselinePolicies, evaluateAgentAssetAccess } from "./policy-v2-evaluator.js";
import {
  ANY_RESOURCE,
  type AccessPermission,
  type AccessResourceType,
  type AccessSubject,
  type EnterpriseAccessPolicyV2,
} from "./policy-v2-types.js";

/**
 * Diffs what the live runtime gates grant against what the V2 evaluator would grant.
 *
 * The v1/V2 parity check compares the two *policy sets*, but the v1 `accessPolicies`
 * table has no authorization consumer: the employee workbench is gated by seat asset
 * grants, seat space grants, and ownership records. Policy parity is therefore not
 * evidence that switching to `enforce` preserves the access live traffic has today.
 * This module supplies that missing half by comparing the two granted surfaces for a
 * real, resolved actor.
 *
 * Comparing surfaces rather than shadowing each request is deliberate: a per-request
 * boolean only shows agreement on resources the runtime already offered, while a set
 * diff also exposes what enforcement would *add* (`onlyInV2`) and what it would
 * silently *remove* (`onlyInRuntime`). Both directions matter, and only one of them is
 * a security risk while the other is an availability risk.
 */

/** The permission each surface is compared under, mirroring what v1 actually granted. */
const AGENT_SURFACE_PERMISSION: AccessPermission = "agent.execute";
const SPACE_SURFACE_PERMISSION: AccessPermission = "space.read";

/**
 * Off by default. Enabling it adds a policy-store read plus an audit write to a request
 * path, which is a cost an operator opts into for a window while collecting cutover
 * evidence, not something every workbench request should pay.
 */
export function resolveRuntimeShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (
    env.OPENBOT_ACCESS_CONTROL_SHADOW_RUNTIME ??
    env.OPENCLAW_ACCESS_CONTROL_SHADOW_RUNTIME ??
    ""
  )
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true";
}

export type GrantedSurface = {
  /** Canonical `agentAssetId` values. */
  agentAssetIds: string[];
  /** v1 space ids. */
  spaceIds: string[];
};

export type V2GrantedSurface = GrantedSurface & {
  /**
   * A `*` grant makes the surface open-ended, so it cannot be enumerated and cannot be
   * diffed honestly. Recorded instead of silently producing an empty set.
   */
  wildcardAgent: boolean;
  wildcardSpace: boolean;
};

export type SurfaceDiff = {
  agreed: string[];
  /** Granted live but denied by V2: enforcement would take this access away. */
  onlyInRuntime: string[];
  /** Granted by V2 but not live: enforcement would hand out new access. */
  onlyInV2: string[];
};

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].toSorted();
}

/**
 * A stray asset carrying a universal builtin's legacy id, which existing tenants have
 * from before the model decision. Held out of the V2 surface so the comparison stays
 * correct before that data is retired, and stays correct afterwards if one reappears.
 */
function isBuiltinAsset(asset: { legacyAgentId?: string; agentSlug?: string }): boolean {
  return (
    isUniversalBuiltinAgentId(asset.legacyAgentId) || isUniversalBuiltinAgentId(asset.agentSlug)
  );
}

/**
 * Materializes the owner baseline policies for every asset in the enterprise.
 *
 * Ownership is not implicit in the evaluator: per the ADR an owner's rights are expressed
 * as `derivedFrom: "owner-baseline"` policies so the owner still passes through the
 * evaluator and stays auditable, and the one existing call site (`agents.create`) supplies
 * them exactly this way. Omitting them would understate what V2 grants and report an
 * owner's own asset as access enforcement is about to remove.
 */
function ownerBaselinePoliciesForEnterprise(params: {
  registry: AgentRegistryStore;
  enterpriseId: string;
  nowIso: string;
}): EnterpriseAccessPolicyV2[] {
  const policies: EnterpriseAccessPolicyV2[] = [];
  for (const asset of Object.values(params.registry.assets)) {
    if (asset.enterpriseId !== params.enterpriseId || isBuiltinAsset(asset)) {
      continue;
    }
    policies.push(
      ...buildOwnerBaselinePolicies({
        registry: params.registry,
        resource: { enterpriseId: params.enterpriseId, agentAssetId: asset.agentAssetId },
        nowIso: params.nowIso,
        makePolicyId: (permission) => `owner:${asset.agentAssetId}:${permission}`,
      }),
    );
  }
  return policies;
}

/**
 * Enumerates the resources V2 would allow for the given subjects.
 *
 * Candidates come from the effective policy set, but every candidate is then run through
 * the evaluator rather than trusted for being present: a policy can be revoked, carry an
 * unsatisfied condition, or be overridden by an explicit deny, and only the evaluator
 * knows that. So this is the evaluator's answer, not a policy-table projection.
 */
export function buildV2GrantedSurface(params: {
  policies: EnterpriseAccessPolicyV2[];
  registry: AgentRegistryStore;
  enterpriseId: string;
  subjects: AccessSubject[];
  nowIso?: string;
}): V2GrantedSurface {
  const agentAssetIds = new Set<string>();
  const spaceIds = new Set<string>();
  let wildcardAgent = false;
  let wildcardSpace = false;

  const effectivePolicies = [
    ...params.policies,
    ...ownerBaselinePoliciesForEnterprise({
      registry: params.registry,
      enterpriseId: params.enterpriseId,
      nowIso: params.nowIso ?? new Date().toISOString(),
    }),
  ];

  const candidates = new Map<AccessResourceType, Set<string>>([
    ["agent_asset", new Set()],
    ["space", new Set()],
  ]);
  for (const policy of effectivePolicies) {
    if (policy.enterpriseId !== params.enterpriseId || policy.revokedAt) {
      continue;
    }
    const bucket = candidates.get(policy.resourceType);
    if (!bucket) {
      continue;
    }
    if (policy.resourceId === ANY_RESOURCE) {
      if (policy.resourceType === "agent_asset") {
        wildcardAgent = true;
      } else {
        wildcardSpace = true;
      }
      continue;
    }
    if (policy.resourceType === "agent_asset") {
      // A policy left over from before the model decision may still name a builtin asset.
      const asset = params.registry.assets[policy.resourceId];
      if (asset && isBuiltinAsset(asset)) {
        continue;
      }
    }
    bucket.add(policy.resourceId);
  }

  for (const subject of params.subjects) {
    for (const resourceId of candidates.get("agent_asset") ?? []) {
      const decision = evaluateAgentAssetAccess({
        policies: effectivePolicies,
        registry: params.registry,
        subject,
        resource: { enterpriseId: params.enterpriseId, resourceType: "agent_asset", resourceId },
        permission: AGENT_SURFACE_PERMISSION,
      });
      if (decision.allowed) {
        agentAssetIds.add(resourceId);
      }
    }
    for (const resourceId of candidates.get("space") ?? []) {
      const decision = evaluateAgentAssetAccess({
        policies: effectivePolicies,
        registry: params.registry,
        subject,
        resource: { enterpriseId: params.enterpriseId, resourceType: "space", resourceId },
        permission: SPACE_SURFACE_PERMISSION,
      });
      if (decision.allowed) {
        spaceIds.add(resourceId);
      }
    }
  }

  return {
    agentAssetIds: sorted(agentAssetIds),
    spaceIds: sorted(spaceIds),
    wildcardAgent,
    wildcardSpace,
  };
}

export type RuntimeAgentSurface = {
  /** Canonical ids the runtime grants, after legacy resolution. */
  agentAssetIds: string[];
  /**
   * Legacy ids the runtime grants that the Registry cannot name. Enforcement would drop
   * these, so they are reported rather than folded into `onlyInRuntime`.
   */
  unresolvedLegacyAgentIds: string[];
  /**
   * Universal builtin ids, held out of the comparison entirely (ADR amendment 2).
   * Reported so the exclusion stays visible rather than silent.
   */
  excludedBuiltinAgentIds: string[];
};

/**
 * Maps the runtime's legacy agent ids onto canonical ids so the two surfaces are
 * comparable at all.
 *
 * A universal builtin is held out of both surfaces because it is not an enterprise asset:
 * every employee gets a private instance, so there is nothing for a policy to grant or
 * withhold. It is neither an agreement nor a divergence, and counting it as either would
 * misreport the cutover. Reported separately so the exclusion is auditable.
 */
export function resolveRuntimeAgentSurface(params: {
  registry: AgentRegistryStore;
  enterpriseId: string;
  legacyAgentIds: readonly string[];
}): RuntimeAgentSurface {
  const agentAssetIds = new Set<string>();
  const unresolved = new Set<string>();
  const excludedBuiltin = new Set<string>();
  for (const raw of params.legacyAgentIds) {
    const legacyAgentId = raw.trim();
    if (!legacyAgentId) {
      continue;
    }
    const resolution = resolveLegacyAgentId({
      store: params.registry,
      enterpriseId: params.enterpriseId,
      legacyAgentId,
    });
    if (resolution.kind === "builtin-universal") {
      excludedBuiltin.add(legacyAgentId);
      continue;
    }
    if (resolution.kind !== "resolved") {
      unresolved.add(legacyAgentId);
      continue;
    }
    agentAssetIds.add(resolution.ref.agentAssetId);
  }
  return {
    agentAssetIds: sorted(agentAssetIds),
    unresolvedLegacyAgentIds: sorted(unresolved),
    excludedBuiltinAgentIds: sorted(excludedBuiltin),
  };
}

function diffSets(runtime: readonly string[], v2: readonly string[]): SurfaceDiff {
  const runtimeSet = new Set(runtime);
  const v2Set = new Set(v2);
  return {
    agreed: sorted([...runtimeSet].filter((id) => v2Set.has(id))),
    onlyInRuntime: sorted([...runtimeSet].filter((id) => !v2Set.has(id))),
    onlyInV2: sorted([...v2Set].filter((id) => !runtimeSet.has(id))),
  };
}

export type GrantedSurfaceComparison = {
  agent: SurfaceDiff;
  space: SurfaceDiff;
  unresolvedLegacyAgentIds: string[];
  /** Universal builtins held out of the comparison; not a divergence either way. */
  excludedBuiltinAgentIds: string[];
  wildcardAgent: boolean;
  wildcardSpace: boolean;
  /** True only when enforcement would change nothing for this actor. */
  equivalent: boolean;
};

/**
 * A wildcard V2 grant never counts as equivalence: the surface is open-ended, so
 * agreement cannot be established by enumeration. An unresolved legacy id also breaks
 * equivalence, because enforcement cannot express that grant at all.
 */
export function compareGrantedSurfaces(params: {
  runtime: RuntimeAgentSurface;
  runtimeSpaceIds: readonly string[];
  v2: V2GrantedSurface;
}): GrantedSurfaceComparison {
  const agent = diffSets(params.runtime.agentAssetIds, params.v2.agentAssetIds);
  const space = diffSets(sorted(params.runtimeSpaceIds), params.v2.spaceIds);
  const equivalent =
    agent.onlyInRuntime.length === 0 &&
    agent.onlyInV2.length === 0 &&
    space.onlyInRuntime.length === 0 &&
    space.onlyInV2.length === 0 &&
    params.runtime.unresolvedLegacyAgentIds.length === 0 &&
    !params.v2.wildcardAgent &&
    !params.v2.wildcardSpace;
  return {
    agent,
    space,
    unresolvedLegacyAgentIds: params.runtime.unresolvedLegacyAgentIds,
    excludedBuiltinAgentIds: params.runtime.excludedBuiltinAgentIds,
    wildcardAgent: params.v2.wildcardAgent,
    wildcardSpace: params.v2.wildcardSpace,
    equivalent,
  };
}

const DETAIL_ID_LIMIT = 10;

/** Bounded so one actor with a large surface cannot write an unbounded audit line. */
export function summarizeIdsForAudit(ids: readonly string[]): string {
  if (ids.length === 0) {
    return "";
  }
  const head = ids.slice(0, DETAIL_ID_LIMIT).join(",");
  return ids.length > DETAIL_ID_LIMIT ? `${head},+${ids.length - DETAIL_ID_LIMIT} more` : head;
}

/** Flattens a comparison into the primitive-only shape the governance audit accepts. */
export function buildSurfaceAuditDetail(
  comparison: GrantedSurfaceComparison,
): Record<string, string | number | boolean | null> {
  return {
    equivalent: comparison.equivalent,
    agentAgreed: comparison.agent.agreed.length,
    agentOnlyInRuntime: comparison.agent.onlyInRuntime.length,
    agentOnlyInV2: comparison.agent.onlyInV2.length,
    spaceAgreed: comparison.space.agreed.length,
    spaceOnlyInRuntime: comparison.space.onlyInRuntime.length,
    spaceOnlyInV2: comparison.space.onlyInV2.length,
    unresolvedLegacyAgents: comparison.unresolvedLegacyAgentIds.length,
    excludedBuiltinAgents: comparison.excludedBuiltinAgentIds.length,
    wildcardAgent: comparison.wildcardAgent,
    wildcardSpace: comparison.wildcardSpace,
    agentOnlyInRuntimeIds: summarizeIdsForAudit(comparison.agent.onlyInRuntime),
    agentOnlyInV2Ids: summarizeIdsForAudit(comparison.agent.onlyInV2),
    spaceOnlyInRuntimeIds: summarizeIdsForAudit(comparison.space.onlyInRuntime),
    spaceOnlyInV2Ids: summarizeIdsForAudit(comparison.space.onlyInV2),
    unresolvedLegacyAgentIds: summarizeIdsForAudit(comparison.unresolvedLegacyAgentIds),
  };
}

/**
 * Runs the comparison for one resolved workbench actor and records it.
 *
 * Best effort in every direction: it returns `null` rather than throwing, and it never
 * influences the actor it was called with. A failure here must not be able to change who
 * can see what.
 *
 * Returns `null` when shadowing is disabled, when the tenant is unknown, or when no V2
 * subject can be formed. The last case is the unbound/unconfigured-platform-auth host,
 * where the actor has no membership and no seat; fabricating a subject id just to produce
 * an audit line would put an identity in the stream that does not exist.
 */
export async function recordWorkbenchSurfaceShadow(params: {
  enterpriseId: string;
  membershipId?: string | undefined;
  seatId?: string | undefined;
  legacyAgentIds: readonly string[];
  spaceIds: readonly string[];
  requestId?: string;
  enabled?: boolean;
}): Promise<GrantedSurfaceComparison | null> {
  if (!(params.enabled ?? resolveRuntimeShadowEnabled())) {
    return null;
  }
  const enterpriseId = params.enterpriseId.trim();
  if (!enterpriseId) {
    return null;
  }
  const subjects: AccessSubject[] = [];
  const membershipId = params.membershipId?.trim();
  const seatId = params.seatId?.trim();
  if (membershipId) {
    subjects.push({ subjectType: "membership", subjectId: membershipId, status: "active" });
  }
  if (seatId) {
    subjects.push({ subjectType: "seat", subjectId: seatId, status: "active" });
  }
  if (subjects.length === 0) {
    return null;
  }

  try {
    const registry = await loadAgentRegistryStore();
    const policyStore = await loadAccessPolicyStore();
    const policies = listTenantPolicies(policyStore, enterpriseId);

    const runtime = resolveRuntimeAgentSurface({
      registry,
      enterpriseId,
      legacyAgentIds: params.legacyAgentIds,
    });
    const v2 = buildV2GrantedSurface({ policies, registry, enterpriseId, subjects });
    const comparison = compareGrantedSurfaces({
      runtime,
      runtimeSpaceIds: params.spaceIds,
      v2,
    });

    const actor = membershipId
      ? ({ subjectType: "membership", subjectId: membershipId } as const)
      : ({ subjectType: "seat", subjectId: seatId as string } as const);
    await emitAccessGovernanceAudit({
      ts: new Date().toISOString(),
      ...(params.requestId ? { requestId: params.requestId } : {}),
      enterpriseId,
      action: "access.shadow-surface",
      actor,
      detail: { ...buildSurfaceAuditDetail(comparison), subjects: subjects.length },
    });
    return comparison;
  } catch (error) {
    console.warn(`[access-control] runtime surface shadow failed: ${String(error)}`);
    return null;
  }
}
