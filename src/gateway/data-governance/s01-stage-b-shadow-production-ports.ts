/**
 * S01 Stage B: production read-only ports for get-reply shadow.
 *
 * Wraps existing Catalog / Agent Registry / platform-auth SoT.
 * Does not create a second Catalog, use InMemory as production,
 * guess unique-row bindings, or invent a steward asset id.
 * Plan A: tenant + steward slug may resolve a stable Registry agentAssetId
 * that is not equal to the slug/agentId.
 */
import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
import { resolveLegacyAgentId } from "../agent-registry/legacy-resolver.js";
import { loadAgentRegistryStore } from "../agent-registry/store.js";
import type { AgentRegistryStore } from "../agent-registry/types.js";
import { resolvePlatformAuthConfig } from "../platform-auth/config.js";
import { findUniqueMembershipByUserId } from "../platform-auth/memberships.js";
import type { PlatformAuthStore } from "../platform-auth/store-types.js";
import { loadPlatformAuthStore } from "../platform-auth/store.js";
import type { WorkspaceResourceCatalog } from "../workspace-resolver/catalog.js";
import type {
  WorkspaceBindingRecord,
  WorkspaceResourceCatalogSnapshot,
  WorkspaceResourceRecord,
} from "../workspace-resolver/types.js";
import {
  getSharedDataGovernanceCatalog,
  projectDurableWorkspaceToResolver,
} from "./runtime-catalog.js";
import {
  issueS01TrustedPrincipal,
  type S01MembershipPort,
  type S01TrustedPrincipal,
} from "./s01-authorized-tool-cwd.js";
import { S01_STEWARD_SLUG, type S01StewardRegistryPort } from "./s01-steward-workspace-identity.js";
import type { CatalogRecord } from "./types.js";

const USER_OWNED_ASSET_ID = /^ws:([^:]+):user:([^:]+):asset:(.+)$/;
const SEAT_OWNED_ASSET_ID = /^ws:([^:]+):seat:([^:]+):asset:(.+)$/;

export const S01_ATTESTATION_SECRET_ENV = [
  "OPENBOT_S01_ATTESTATION_SECRET",
  "OPENCLAW_S01_ATTESTATION_SECRET",
] as const;

export class S01ReadOnlyDurableCatalogView implements WorkspaceResourceCatalog {
  constructor(private readonly data: WorkspaceResourceCatalogSnapshot) {}

  snapshot(): WorkspaceResourceCatalogSnapshot {
    return this.data;
  }

  getResource(resourceId: string): WorkspaceResourceRecord | null {
    return this.data.resources[resourceId] ?? null;
  }

  getBinding(bindingId: string): WorkspaceBindingRecord | null {
    return this.data.bindings[bindingId] ?? null;
  }

  listBindingsForResource(resourceId: string): WorkspaceBindingRecord[] {
    return Object.values(this.data.bindings).filter((binding) => binding.resourceId === resourceId);
  }
}

function parsedAgentAssetId(resourceId: string): string | null {
  const userOwned = USER_OWNED_ASSET_ID.exec(resourceId);
  if (userOwned?.[3] && userOwned[3] !== userOwned[2]) {
    return userOwned[3];
  }
  const seatOwned = SEAT_OWNED_ASSET_ID.exec(resourceId);
  return seatOwned?.[3] ?? null;
}

function projectDurableRecordForS01(record: CatalogRecord): {
  resource: WorkspaceResourceRecord;
  bindings: WorkspaceBindingRecord[];
} | null {
  if (record.envelope.resourceType !== "workspace") {
    return null;
  }
  const projected = projectDurableWorkspaceToResolver({ record });
  const agentAssetId = parsedAgentAssetId(record.envelope.resourceId);
  const rawScope = projected.resource.ownerScope;
  if ((rawScope.kind === "user_owned" || rawScope.kind === "position_owned") && !agentAssetId) {
    return null;
  }
  const ownerScope =
    rawScope.kind === "user_owned" && agentAssetId
      ? {
          kind: "user_owned" as const,
          userId: rawScope.userId,
          agentAssetId,
          proof: {
            source: "explicit_binding" as const,
            ownerType: "user" as const,
            ownerId: rawScope.userId,
            agentAssetId,
          },
        }
      : rawScope.kind === "position_owned" && agentAssetId
        ? { kind: "position_owned" as const, seatId: rawScope.seatId, agentAssetId }
        : rawScope.kind === "group_owned"
          ? rawScope
          : rawScope.kind === "unknown"
            ? rawScope
            : rawScope;
  const lifecycleState =
    projected.resource.lifecycleState === "read_only" ||
    projected.resource.lifecycleState === "retired"
      ? projected.resource.lifecycleState
      : "active";
  return {
    resource: {
      resourceId: projected.resource.resourceId,
      resourceType: "workspace",
      tenantId: projected.resource.tenantId,
      ownerScope,
      lifecycleState,
      classification: String(projected.resource.classification),
      governanceVersion: projected.resource.governanceVersion,
    },
    bindings: projected.bindings.map((binding) => ({
      bindingId: binding.bindingId,
      resourceId: binding.resourceId,
      role: binding.role === "compatibility" ? "compatibility" : "canonical",
      locator: binding.locator,
      state:
        binding.state === "read_only"
          ? "read_only"
          : binding.state === "retired"
            ? "retired"
            : "active",
      contentVersion: binding.contentVersion,
    })),
  };
}

export function createS01ReadOnlyDurableCatalogView(
  records: readonly CatalogRecord[],
  status: "available" | "unavailable" = "available",
): S01ReadOnlyDurableCatalogView {
  const resources: Record<string, WorkspaceResourceRecord> = {};
  const bindings: Record<string, WorkspaceBindingRecord> = {};
  for (const record of records) {
    const projected = projectDurableRecordForS01(record);
    if (!projected) {
      continue;
    }
    resources[projected.resource.resourceId] = projected.resource;
    for (const binding of projected.bindings) {
      bindings[binding.bindingId] = binding;
    }
  }
  return new S01ReadOnlyDurableCatalogView({
    governanceVersion: 1,
    status,
    resources,
    bindings,
  });
}

export function resolveS01StewardAgentAssetIdFromRegistry(params: {
  store: AgentRegistryStore;
  tenantId: string;
  agentId: string;
}): string | null {
  const tenantId = params.tenantId.trim();
  const agentId = params.agentId.trim();
  if (!tenantId || !agentId) {
    return null;
  }
  if (isBuiltinStewardAgent(agentId) || agentId === S01_STEWARD_SLUG) {
    const matches = Object.values(params.store.assets).filter(
      (asset) =>
        asset.enterpriseId === tenantId &&
        asset.agentSlug === S01_STEWARD_SLUG &&
        asset.status === "active",
    );
    if (matches.length !== 1) {
      return null;
    }
    const agentAssetId = matches[0]?.agentAssetId.trim() ?? "";
    if (!agentAssetId || agentAssetId === agentId || agentAssetId === S01_STEWARD_SLUG) {
      return null;
    }
    return agentAssetId;
  }
  const resolution = resolveLegacyAgentId({
    store: params.store,
    enterpriseId: tenantId,
    legacyAgentId: agentId,
  });
  if (resolution.kind !== "resolved") {
    return null;
  }
  const agentAssetId = resolution.ref.agentAssetId.trim();
  if (!agentAssetId || agentAssetId === agentId) {
    return null;
  }
  return agentAssetId;
}

export function createProductionS01StewardRegistryPort(
  store: AgentRegistryStore,
): S01StewardRegistryPort {
  return {
    resolveUniqueAgentAssetId(input) {
      return resolveS01StewardAgentAssetIdFromRegistry({
        store,
        tenantId: input.tenantId,
        agentId: input.agentId,
      });
    },
  };
}

export function createProductionS01MembershipPort(store: PlatformAuthStore): S01MembershipPort {
  return {
    resolveMembership(userId) {
      const membership = findUniqueMembershipByUserId(store, userId);
      if (!membership?.enterpriseId) {
        return null;
      }
      return { userId: membership.userId, tenantId: membership.enterpriseId };
    },
    userHasSeat() {
      return false;
    },
    userInGroup() {
      return false;
    },
  };
}

export function readS01AttestationSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const key of S01_ATTESTATION_SECRET_ENV) {
    const raw = env[key];
    if (typeof raw === "string" && raw.trim().length > 0) {
      return raw;
    }
  }
  return null;
}

export type S01StageBShadowProductionDeps = {
  catalog: WorkspaceResourceCatalog | null;
  registry: S01StewardRegistryPort | null;
  principal: S01TrustedPrincipal | null;
  memberships: S01MembershipPort | null;
  attestationSecret?: string;
};

export async function loadS01StageBShadowProductionDeps(params: {
  tenantId?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  env?: NodeJS.ProcessEnv;
  durableWorkspaceRecords?: readonly CatalogRecord[];
  catalogUnavailable?: boolean;
  registryStore?: AgentRegistryStore;
  platformStore?: PlatformAuthStore;
}): Promise<S01StageBShadowProductionDeps> {
  let catalog: WorkspaceResourceCatalog | null = null;
  try {
    if (params.catalogUnavailable) {
      catalog = createS01ReadOnlyDurableCatalogView([], "unavailable");
    } else if (params.durableWorkspaceRecords) {
      catalog = createS01ReadOnlyDurableCatalogView(params.durableWorkspaceRecords);
    } else {
      const records = await getSharedDataGovernanceCatalog().list("workspace");
      catalog = createS01ReadOnlyDurableCatalogView(records);
    }
  } catch {
    catalog = createS01ReadOnlyDurableCatalogView([], "unavailable");
  }

  let registry: S01StewardRegistryPort | null = null;
  try {
    const store = params.registryStore ?? (await loadAgentRegistryStore());
    registry = createProductionS01StewardRegistryPort(store);
  } catch {
    registry = null;
  }

  let memberships: S01MembershipPort | null = null;
  try {
    if (params.platformStore) {
      memberships = createProductionS01MembershipPort(params.platformStore);
    } else {
      const { loadConfig } = await import("../../config/config.js");
      const authConfig = resolvePlatformAuthConfig(loadConfig().gateway?.auth?.trustedProxy);
      if (authConfig) {
        memberships = createProductionS01MembershipPort(await loadPlatformAuthStore(authConfig));
      }
    }
  } catch {
    memberships = null;
  }

  const attestationSecret = readS01AttestationSecret(params.env);
  const userId = params.userId?.trim() ?? "";
  const tenantId = params.tenantId?.trim() ?? "";
  const sessionId = params.sessionId?.trim() ?? "";
  const principal =
    userId && tenantId && sessionId && attestationSecret
      ? issueS01TrustedPrincipal({
          userId,
          tenantId,
          sessionId,
          attestationSecret,
        })
      : null;

  return {
    catalog,
    registry,
    principal,
    memberships,
    attestationSecret: attestationSecret ?? undefined,
  };
}
