/**
 * Inject a canonical workspace locator into read-only growth assessment.
 * Authority is server tenant, actor, registry agentAsset, and Catalog.
 * Client paths, session keys, and agent slugs are not a workspace path.
 *
 * Track D / M1: silent empty returns become locator_failed + code when a
 * locate was attempted; success sets locatorStatus=located.
 */
import { loadConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { findPrimaryOwnerBinding } from "../gateway/agent-registry/ownership.js";
import { loadAgentRegistryStore } from "../gateway/agent-registry/store.js";
import type { AgentRegistryStore } from "../gateway/agent-registry/types.js";
import { getSharedDataGovernanceCatalog } from "../gateway/data-governance/runtime-catalog.js";
import {
  createS01ReadOnlyDurableCatalogView,
  resolveS01StewardAgentAssetIdFromRegistry,
} from "../gateway/data-governance/s01-stage-b-shadow-production-ports.js";
import {
  findUserByEmail,
  loadPlatformAuthStore,
  normalizeEmail,
  resolvePlatformAuthConfig,
  type PlatformAuthStore,
} from "../gateway/platform-auth.js";
import { listMembershipsByUserId } from "../gateway/platform-auth/memberships.js";
import type { TenantContextDomain } from "../gateway/tenant-context.js";
import type { GroupAclEvidence } from "../gateway/workspace-ownership/types.js";
import { buildWorkspaceResourceId } from "../gateway/workspace-resolver/builders.js";
import type { WorkspaceResourceCatalog } from "../gateway/workspace-resolver/catalog.js";
import { resolveWorkspaceLocator } from "../gateway/workspace-resolver/strict-locator.js";
import type { WorkspaceResourceRecord } from "../gateway/workspace-resolver/types.js";
import {
  isExistingWorkspaceDirectory,
  resolveRobotOwnWriteRoot,
} from "../gateway/workspace-resolver/write-roots.js";
import type { DiagnoseGrowthJobRef } from "./diagnose-growth-assessment.js";
import type { GovernedGrowthRead, LocatorFailureCode } from "./diagnose-live-request.js";
import { extractDiagnoseSpaceGroupId } from "./diagnose-policy.js";

const GROWTH_READ_PURPOSE = "diagnosis.growth.read";

/** Enterprise/platform admin only. Employee domain and sender-is-owner are not enough. */
export function isDiagnosisTenantAdmin(input: {
  sessionDomain?: string | null;
  sessionKind?: string | null;
}): boolean {
  if (input.sessionDomain === "enterprise" || input.sessionDomain === "platform") {
    return true;
  }
  const kind = input.sessionKind ?? "";
  return (
    kind === "enterprise-admin" || kind === "platform-admin" || kind === "platform-super-admin"
  );
}

export type DiagnoseGrowthActor = {
  tenantId: string;
  actorUserId: string;
  tenantAdmin: boolean;
};

/**
 * Resolve the growth-read actor. Surface sessionDomain=employee is normal for
 * Da Bai chat; tenant-admin is membership or sessionKind, never sender-is-owner.
 */
export function resolveDiagnoseGrowthActor(input: {
  tenantId?: string | null;
  actorUserId?: string | null;
  sessionDomain?: string | null;
  sessionKind?: string | null;
  store?: PlatformAuthStore | null;
}): DiagnoseGrowthActor | null {
  const rawActor = input.actorUserId?.trim() ?? "";
  if (!rawActor) {
    return null;
  }
  const byId = input.store?.users?.[rawActor];
  const byEmail = input.store ? findUserByEmail(input.store, normalizeEmail(rawActor)) : undefined;
  const actorUserId = byId?.id || byEmail?.id || rawActor;
  const memberships = input.store ? listMembershipsByUserId(input.store, actorUserId) : [];
  const enterpriseIds = [
    ...new Set(memberships.map((row) => row.enterpriseId.trim()).filter(Boolean)),
  ];
  const tenantId = input.tenantId?.trim() || (enterpriseIds.length === 1 ? enterpriseIds[0] : "");
  if (!tenantId) {
    return null;
  }
  const tenantAdmin =
    isDiagnosisTenantAdmin({
      sessionDomain: input.sessionDomain,
      sessionKind: input.sessionKind,
    }) ||
    memberships.some(
      (row) => row.enterpriseId === tenantId && row.membershipRole === "enterprise-admin",
    );
  return { tenantId, actorUserId, tenantAdmin };
}

export async function loadPlatformAuthStoreForDiagnosis(): Promise<PlatformAuthStore | null> {
  try {
    const authConfig = resolvePlatformAuthConfig(loadConfig().gateway?.auth?.trustedProxy);
    if (!authConfig?.enabled) {
      return null;
    }
    return await loadPlatformAuthStore(authConfig);
  } catch {
    return null;
  }
}

export type DiagnoseGrowthLocatorInput = {
  tenantId: string;
  actorUserId: string;
  domain?: TenantContextDomain;
  locators: ReadonlyArray<{ agentId: string; sessionKey: string }>;
  registry: AgentRegistryStore;
  catalog: WorkspaceResourceCatalog;
  scopedJobs?: readonly DiagnoseGrowthJobRef[];
  groupAclById?: Readonly<Record<string, GroupAclEvidence>>;
  /** Enterprise or platform admin. Same-tenant assets need no extra grant. */
  tenantAdmin?: boolean;
  stateDir?: string;
};

export function resolveGovernedDiagnoseGrowthReads(
  input: DiagnoseGrowthLocatorInput,
): GovernedGrowthRead[] {
  const tenantId = input.tenantId.trim();
  const actorUserId = input.actorUserId.trim();
  if (!tenantId || !actorUserId) {
    return [];
  }
  return input.locators.map((locator) =>
    resolveOne({
      ...input,
      tenantId,
      actorUserId,
      locator,
    }),
  );
}

export async function loadGovernedDiagnoseGrowthReads(input: {
  tenantId: string | null;
  actorUserId: string | null;
  locators: ReadonlyArray<{ agentId: string; sessionKey: string }>;
  scopedJobs?: readonly DiagnoseGrowthJobRef[];
  registry?: AgentRegistryStore;
  catalog?: WorkspaceResourceCatalog;
  groupAclById?: Readonly<Record<string, GroupAclEvidence>>;
  tenantAdmin?: boolean;
  stateDir?: string;
}): Promise<GovernedGrowthRead[]> {
  const tenantId = input.tenantId?.trim() ?? "";
  const actorUserId = input.actorUserId?.trim() ?? "";
  if (!tenantId || !actorUserId || input.locators.length === 0) {
    return [];
  }
  try {
    const registry = input.registry ?? (await loadAgentRegistryStore());
    const catalog =
      input.catalog ??
      createS01ReadOnlyDurableCatalogView(await getSharedDataGovernanceCatalog().list("workspace"));
    return resolveGovernedDiagnoseGrowthReads({
      tenantId,
      actorUserId,
      locators: input.locators,
      registry,
      catalog,
      scopedJobs: input.scopedJobs,
      groupAclById: input.groupAclById,
      tenantAdmin: input.tenantAdmin,
      stateDir: input.stateDir,
    });
  } catch {
    return [];
  }
}

function resolveOne(
  input: DiagnoseGrowthLocatorInput & {
    locator: { agentId: string; sessionKey: string };
  },
): GovernedGrowthRead {
  const groupId = extractDiagnoseSpaceGroupId(input.locator.sessionKey);
  if (groupId) {
    return resolveGroup(input, groupId);
  }
  return resolveAgent(input);
}

function failedRead(
  base: GovernedGrowthRead,
  code: LocatorFailureCode,
  detail?: string,
): GovernedGrowthRead {
  return {
    ...base,
    locatorStatus: "locator_failed",
    locatorFailureCode: code,
    ...(detail ? { locatorFailureDetail: detail } : {}),
  };
}

function resolveAgent(
  input: DiagnoseGrowthLocatorInput & {
    locator: { agentId: string; sessionKey: string };
  },
): GovernedGrowthRead {
  const agentId = input.locator.agentId.trim();
  const base = emptyRead(input.tenantId, agentId);
  const agentAssetId = resolveS01StewardAgentAssetIdFromRegistry({
    store: input.registry,
    tenantId: input.tenantId,
    agentId,
  });
  if (!agentAssetId) {
    return { ...base, locatorStatus: "not_applicable" };
  }
  const owner = findPrimaryOwnerBinding(input.registry, {
    enterpriseId: input.tenantId,
    agentAssetId,
  });
  const targetOwnerId = owner?.ownerId?.trim() ?? "";
  const displayName = displayNameFor(input.registry, input.tenantId, agentAssetId);
  const read: GovernedGrowthRead = {
    ...base,
    agentAssetId,
    targetOwnerId,
    ...(displayName ? { displayName } : {}),
    scopedJobs: jobsFor(input.scopedJobs, input.tenantId, targetOwnerId),
  };
  const catalogUserId = userOwnedSubject(input.catalog, input.tenantId, agentAssetId);
  const ownerSelf =
    (owner?.ownerType === "membership" && owner.ownerId === input.actorUserId) ||
    catalogUserId === input.actorUserId;
  if (!(ownerSelf || input.tenantAdmin)) {
    return failedRead(read, "acl_denied", `agentId=${agentId}`);
  }
  const workspaceDir = locateTenantAssetWorkspace(input, agentAssetId, catalogUserId);
  if (workspaceDir) {
    return { ...read, workspaceDir, locatorStatus: "located" };
  }
  return failedRead(read, "resolve_failed", `agentId=${agentId}`);
}

function resolveGroup(
  input: DiagnoseGrowthLocatorInput & { locator: { agentId: string; sessionKey: string } },
  groupId: string,
): GovernedGrowthRead {
  const read: GovernedGrowthRead = {
    ...emptyRead(input.tenantId, input.locator.agentId.trim()),
    displayName: `协作小组 ${groupId}`,
  };
  const detail = `groupId=${groupId}`;
  const resourceId = buildWorkspaceResourceId({
    tenantId: input.tenantId,
    scope: { kind: "group_owned", groupId },
  });
  const resource = input.catalog.getResource(resourceId);
  if (
    !resource ||
    resource.tenantId !== input.tenantId ||
    resource.ownerScope.kind !== "group_owned" ||
    resource.ownerScope.groupId !== groupId
  ) {
    return failedRead(read, "catalog_miss", detail);
  }
  if (input.tenantAdmin) {
    const classified = classifyCanonicalLocator(input.catalog, resource.resourceId);
    if (classified.ok) {
      return { ...read, workspaceDir: classified.locator, locatorStatus: "located" };
    }
    return failedRead(read, classified.code, detail);
  }
  const acl = input.groupAclById?.[groupId];
  if (!acl) {
    return failedRead(read, "acl_unavailable", detail);
  }
  if (
    !acl.available ||
    acl.tenantId !== input.tenantId ||
    acl.groupId !== groupId ||
    !acl.memberUserIds.includes(input.actorUserId)
  ) {
    return failedRead(read, "acl_denied", detail);
  }
  const located = resolveWorkspaceLocator({
    tenantContext: {
      tenantId: input.tenantId,
      userId: input.actorUserId,
      domain: input.domain ?? "employee",
    },
    tenantId: input.tenantId,
    actor: {
      userId: input.actorUserId,
      grant: { kind: "group", subjectId: groupId, purpose: GROWTH_READ_PURPOSE },
    },
    resourceId,
    catalog: input.catalog,
    membership: { source: "platform-auth", groupAcl: acl },
  });
  if (!located.ok) {
    return failedRead(read, "resolve_failed", detail);
  }
  const workspaceDir = acceptLocator(located.handle.locator);
  if (!workspaceDir) {
    return failedRead(read, "path_rejected", detail);
  }
  return { ...read, workspaceDir, locatorStatus: "located" };
}

function emptyRead(tenantId: string, agentId: string): GovernedGrowthRead {
  return {
    agentId,
    tenantId,
    agentAssetId: "",
    targetOwnerId: "",
  };
}

function displayNameFor(
  registry: AgentRegistryStore,
  tenantId: string,
  agentAssetId: string,
): string | null {
  const asset = Object.values(registry.assets).find(
    (row) => row.enterpriseId === tenantId && row.agentAssetId === agentAssetId,
  );
  const name = asset?.displayName?.trim() ?? "";
  return name || null;
}

function jobsFor(
  jobs: readonly DiagnoseGrowthJobRef[] | undefined,
  tenantId: string,
  ownerId: string,
): DiagnoseGrowthJobRef[] {
  if (!ownerId) {
    return [];
  }
  return (jobs ?? []).filter((job) => job.tenantId === tenantId && job.ownerId === ownerId);
}

function locateUserOwned(
  input: DiagnoseGrowthLocatorInput,
  ownerId: string,
  agentAssetId: string,
): string | null {
  const resourceId = buildWorkspaceResourceId({
    tenantId: input.tenantId,
    scope: {
      kind: "user_owned",
      userId: ownerId,
      agentAssetId,
      proof: {
        source: "explicit_binding",
        ownerType: "user",
        ownerId,
        agentAssetId,
      },
    },
  });
  const located = resolveWorkspaceLocator({
    tenantContext: {
      tenantId: input.tenantId,
      userId: input.actorUserId,
      domain: input.domain ?? "employee",
    },
    tenantId: input.tenantId,
    actor: {
      userId: input.actorUserId,
      grant: { kind: "user", subjectId: input.actorUserId, purpose: GROWTH_READ_PURPOSE },
    },
    resourceId,
    agentAssetId,
    catalog: input.catalog,
  });
  return located.ok ? acceptLocator(located.handle.locator) : null;
}

function selectTenantAssetResource(
  catalog: WorkspaceResourceCatalog,
  tenantId: string,
  agentAssetId: string,
): WorkspaceResourceRecord | null {
  const matches = Object.values(catalog.snapshot().resources).filter((resource) => {
    if (resource.tenantId !== tenantId) {
      return false;
    }
    const scope = resource.ownerScope;
    return (
      (scope.kind === "user_owned" || scope.kind === "position_owned") &&
      scope.agentAssetId === agentAssetId
    );
  });
  const users = matches.filter((row) => row.ownerScope.kind === "user_owned");
  if (users.length === 1) {
    return users[0] ?? null;
  }
  if (users.length > 1) {
    return null;
  }
  const seats = matches.filter((row) => row.ownerScope.kind === "position_owned");
  return seats.length === 1 ? (seats[0] ?? null) : null;
}

function userOwnedSubject(
  catalog: WorkspaceResourceCatalog,
  tenantId: string,
  agentAssetId: string,
): string | null {
  const resource = selectTenantAssetResource(catalog, tenantId, agentAssetId);
  return resource?.ownerScope.kind === "user_owned" ? resource.ownerScope.userId : null;
}

function locateTenantAssetWorkspace(
  input: DiagnoseGrowthLocatorInput,
  agentAssetId: string,
  catalogUserId: string | null,
): string | null {
  if (catalogUserId && catalogUserId === input.actorUserId) {
    const granted = locateUserOwned(input, catalogUserId, agentAssetId);
    if (granted) {
      return granted;
    }
  }
  const resource = selectTenantAssetResource(input.catalog, input.tenantId, agentAssetId);
  if (!resource) {
    return null;
  }
  const bound = uniqueCanonicalLocator(input.catalog, resource.resourceId);
  if (bound) {
    return bound;
  }
  if (resource.ownerScope.kind !== "user_owned") {
    return null;
  }
  const asset = Object.values(input.registry.assets).find(
    (row) => row.enterpriseId === input.tenantId && row.agentAssetId === agentAssetId,
  );
  const agentId = asset?.legacyAgentId?.trim() || "";
  if (!agentId || agentId === agentAssetId) {
    return null;
  }
  const placed = resolveRobotOwnWriteRoot({
    stateDir: input.stateDir ?? resolveStateDir(),
    tenantId: input.tenantId,
    userId: resource.ownerScope.userId,
    agentId,
  });
  if (!isExistingWorkspaceDirectory(placed)) {
    return null;
  }
  return acceptLocator(placed);
}

function classifyCanonicalLocator(
  catalog: WorkspaceResourceCatalog,
  resourceId: string,
):
  | { ok: true; locator: string }
  | { ok: false; code: "canonical_missing" | "canonical_ambiguous" | "path_rejected" } {
  const bindings = catalog
    .listBindingsForResource(resourceId)
    .filter(
      (binding) =>
        binding.resourceId === resourceId &&
        binding.role === "canonical" &&
        binding.state === "active",
    );
  if (bindings.length === 0) {
    return { ok: false, code: "canonical_missing" };
  }
  if (bindings.length > 1) {
    return { ok: false, code: "canonical_ambiguous" };
  }
  const locator = acceptLocator(bindings[0]?.locator ?? "");
  if (!locator) {
    return { ok: false, code: "path_rejected" };
  }
  return { ok: true, locator };
}

function uniqueCanonicalLocator(
  catalog: WorkspaceResourceCatalog,
  resourceId: string,
): string | null {
  const classified = classifyCanonicalLocator(catalog, resourceId);
  return classified.ok ? classified.locator : null;
}

function acceptLocator(locator: string): string | null {
  if (!locator.startsWith("/") || locator.includes("\0")) {
    return null;
  }
  if (locator.split(/[/\\]/).includes("..")) {
    return null;
  }
  return locator;
}
