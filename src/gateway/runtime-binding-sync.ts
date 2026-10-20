import type { OpenBotConfig } from "../config/types.openbot.js";
import { maybeSeedAgentRuntimeFromPlatformState } from "./agent-runtime-seed.js";
import {
  listAgents,
  upsertBinding,
  type ConfigurationState,
  type GovernanceState,
  type TenantInstallSource,
} from "./agent-runtime-store.js";
import { findRegistryEntryBySkillKey, getRegistryEntry } from "./capability-governance-store.js";
import {
  findUserByEmail,
  loadPlatformAuthStore,
  resolvePlatformAuthConfig,
} from "./platform-auth.js";
import { findUniqueMembershipByUserId } from "./platform-auth/memberships.js";

export async function syncInstallToRuntime(params: {
  cfg: OpenBotConfig;
  userEmail: string | null | undefined;
  capabilityId: string;
  targetRobotId?: string | null;
  installRequestId?: string;
  tenantInstallSource?: TenantInstallSource;
  configurationState?: ConfigurationState;
  governanceState?: GovernanceState;
}): Promise<{
  synced: boolean;
  reason?: string;
  runtimeAgentId?: string;
  manifestId?: string;
  bindingId?: string;
}> {
  const normalizedEmail = params.userEmail?.trim().toLowerCase() ?? "";
  if (!normalizedEmail) {
    return { synced: false, reason: "missing-user" };
  }

  const trustedProxy = params.cfg.gateway?.auth?.trustedProxy;
  const platformAuthConfig = resolvePlatformAuthConfig(trustedProxy);
  if (!platformAuthConfig) {
    return { synced: false, reason: "platform-auth-disabled" };
  }

  const authStore = await loadPlatformAuthStore(platformAuthConfig);
  const user = findUserByEmail(authStore, normalizedEmail);
  if (!user) {
    return { synced: false, reason: "user-not-found" };
  }
  // Sync runs without a session, so an ambiguous owner fails closed instead of
  // syncing into whichever enterprise happens to be stored first.
  const membership = findUniqueMembershipByUserId(authStore, user.id);
  if (!membership) {
    return { synced: false, reason: "membership-not-found" };
  }

  const registryEntry =
    getRegistryEntry(params.capabilityId) ?? findRegistryEntryBySkillKey(params.capabilityId);
  if (!registryEntry) {
    return { synced: false, reason: "registry-entry-not-found" };
  }

  await maybeSeedAgentRuntimeFromPlatformState({
    cfg: params.cfg,
    trustedProxy,
  });

  // P0-3: target specific robot when targetRobotId is provided
  const targetRobotId = params.targetRobotId?.trim();
  let runtimeAgent: import("./agent-runtime-store.js").RuntimeAgent | undefined;

  if (targetRobotId) {
    const allAgents = listAgents({
      lifecycle: null,
      health: null,
      tenantId: null,
      searchQuery: "",
    });
    runtimeAgent = allAgents.find((agent) => agent.runtimeAgentId === targetRobotId);
    if (!runtimeAgent) {
      return {
        synced: false,
        reason: "target-runtime-agent-not-found",
        runtimeAgentId: targetRobotId,
      };
    }
  } else {
    const tenantAgents = listAgents({
      lifecycle: null,
      health: null,
      tenantId: membership.enterpriseId,
      searchQuery: "",
    });
    runtimeAgent =
      tenantAgents.find((agent) => agent.lifecycle === "deployed" && agent.health === "healthy") ??
      tenantAgents.find((agent) => agent.lifecycle === "deployed") ??
      tenantAgents[0];
    if (!runtimeAgent) {
      return { synced: false, reason: "runtime-agent-not-found" };
    }
  }

  const binding = upsertBinding({
    runtimeAgentId: runtimeAgent.runtimeAgentId,
    capabilityId: registryEntry.manifest.id,
    capabilityVersion: registryEntry.manifest.version,
    bindingType: "tenant-installed",
    loadStrategy: "lazy",
    routingPriority: null,
    policy: null,
    fallbackBindingId: null,
    installRequestId: params.installRequestId,
    tenantInstallSource: params.tenantInstallSource,
    configurationState: params.configurationState,
    governanceState: params.governanceState,
  });

  return {
    synced: true,
    runtimeAgentId: binding.runtimeAgentId,
    manifestId: binding.capabilityId,
    bindingId: binding.bindingId,
  };
}
