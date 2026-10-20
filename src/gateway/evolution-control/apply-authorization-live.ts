import fs from "node:fs/promises";
import { loadConfig } from "../../config/config.js";
import type { AuthorizationGrant } from "../../diagnosis/delegation.js";
import { resolveLegacyAgentId } from "../agent-registry/legacy-resolver.js";
import { findPrimaryOwnerBinding } from "../agent-registry/ownership.js";
import { loadAgentRegistryStore } from "../agent-registry/store.js";
import { resolvePlatformAuthConfig } from "../platform-auth/config.js";
import type { PlatformAuthStore } from "../platform-auth/store-types.js";
import { loadPlatformAuthStore } from "../platform-auth/store.js";
import {
  applyTargetId,
  type EvolutionApplyActor,
  type EvolutionApplyAuthPorts,
  type EvolutionApplyGrant,
  type EvolutionApplyObject,
} from "./apply-authorization.js";
import { resolveDelegationStorePath } from "./delegation-service.js";

function membershipUserId(store: PlatformAuthStore, membershipId: string): string | null {
  const membership = store.memberships[membershipId];
  return membership?.userId?.trim() || null;
}

async function readGrants(): Promise<AuthorizationGrant[]> {
  try {
    const raw = await fs.readFile(resolveDelegationStorePath(), "utf8");
    const parsed = JSON.parse(raw) as { grants?: Record<string, AuthorizationGrant> };
    return Object.values(parsed.grants ?? {});
  } catch {
    return [];
  }
}

function toApplyGrant(grant: AuthorizationGrant): EvolutionApplyGrant | null {
  const granteeUserId = grant.grantee.principal.principalId?.trim();
  const tenantId = grant.targetTenant?.trim() || grant.targetScope.tenantId?.trim() || "";
  const targetId = grant.targetScope.targetId?.trim() || "";
  if (!granteeUserId || !tenantId || !targetId || grant.status !== "APPROVED") {
    return null;
  }
  return {
    tenantId,
    targetId,
    actions: grant.allowedActions,
    expiresAt: grant.expiresAt,
    status: "APPROVED",
    granteeUserId,
  };
}

/** Live ports. Missing registry, membership, or grant fails closed. */
export function createLiveEvolutionApplyAuthPorts(): EvolutionApplyAuthPorts {
  return {
    async resolveActor(client) {
      const sessionKind = client.sessionKind;
      const userId = client.platformUserId?.trim() || "";
      if (!sessionKind || !userId) {
        return null;
      }
      if (sessionKind === "platform-admin" || sessionKind === "platform-super-admin") {
        const actor: EvolutionApplyActor = {
          sessionKind,
          membershipRole: null,
          tenantId: null,
          userId,
        };
        return actor;
      }
      if (sessionKind !== "enterprise-admin" && sessionKind !== "member") {
        return null;
      }
      const membershipId = client.sessionMembershipId?.trim();
      const enterpriseId = client.sessionEnterpriseId?.trim();
      if (!membershipId || !enterpriseId) {
        return null;
      }
      try {
        const authConfig = resolvePlatformAuthConfig(loadConfig().gateway?.auth?.trustedProxy);
        if (!authConfig?.enabled) {
          return null;
        }
        const store = await loadPlatformAuthStore(authConfig);
        const membership = store.memberships[membershipId];
        if (
          !membership ||
          membership.userId !== userId ||
          membership.enterpriseId !== enterpriseId
        ) {
          return null;
        }
        if (membership.membershipRole !== sessionKind) {
          return null;
        }
        return {
          sessionKind,
          membershipRole: membership.membershipRole,
          tenantId: membership.enterpriseId,
          userId,
        };
      } catch {
        return null;
      }
    },
    async resolveObject(proposal) {
      const tenantId = proposal.tenantScope?.trim() || "";
      if (!tenantId || proposal.target.domain !== "agent") {
        return null;
      }
      const agentId = proposal.target.agentId.trim();
      try {
        const authConfig = resolvePlatformAuthConfig(loadConfig().gateway?.auth?.trustedProxy);
        const store = authConfig?.enabled ? await loadPlatformAuthStore(authConfig) : null;
        const registry = await loadAgentRegistryStore();
        const resolved = resolveLegacyAgentId({
          store: registry,
          enterpriseId: tenantId,
          legacyAgentId: agentId,
        });
        if (resolved.kind !== "resolved" || resolved.ref.enterpriseId !== tenantId) {
          return null;
        }
        const primary = findPrimaryOwnerBinding(registry, resolved.ref);
        if (!primary) {
          return null;
        }
        const object: EvolutionApplyObject = {
          tenantId,
          targetId: applyTargetId(proposal),
          objectKind: "enterprise",
          ownerUserId: null,
        };
        if (primary.ownerType === "membership") {
          const ownerUserId = store ? membershipUserId(store, primary.ownerId) : null;
          if (!ownerUserId) {
            return null;
          }
          object.objectKind = "member";
          object.ownerUserId = ownerUserId;
        } else if (primary.ownerType !== "seat") {
          return null;
        }
        return object;
      } catch {
        return null;
      }
    },
    async resolveGrant(input) {
      const needed = input.action === "verify" ? "verify" : input.scope;
      const grants = await readGrants();
      for (const row of grants) {
        const grant = toApplyGrant(row);
        if (!grant || grant.granteeUserId !== input.actor.userId) {
          continue;
        }
        if (grant.tenantId !== input.object.tenantId) {
          continue;
        }
        if (
          !grant.actions.includes(needed) &&
          !(input.action === "apply" && grant.actions.includes("apply"))
        ) {
          continue;
        }
        return grant;
      }
      return null;
    },
  };
}
