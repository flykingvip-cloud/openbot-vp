import fs from "node:fs";
import path from "node:path";
import type { OpenBotConfig } from "../../config/types.js";
import { resolveLegacyAgentId } from "../agent-registry/legacy-resolver.js";
import { findPrimaryOwnerBinding } from "../agent-registry/ownership.js";
import { loadAgentRegistryStore } from "../agent-registry/store.js";
import type { AgentRegistryStore } from "../agent-registry/types.js";
import { getSharedDataGovernanceCatalog } from "../data-governance/runtime-catalog.js";
import type { CatalogRecord } from "../data-governance/types.js";
import {
  canonicalizeWorkspaceLocator,
  resolveOfficialWorkspaceRoots,
} from "../data-governance/workspace-locator-canonicalization.js";
import { resolveKnowledgeSourceContext } from "../knowledge/context.js";
import { resolveSecurityProfile } from "../security-profile.js";
import type { GatewayClient } from "../server-methods/types.js";
import { buildBuiltinStewardWorkspaceResourceId } from "./builders.js";
import { isFilesystemWorkspaceLocator } from "./write-roots.js";

export type ExecutionWorkspaceOwner =
  | { kind: "user"; userId: string }
  | { kind: "position"; seatId: string }
  | { kind: "group"; groupId: string }
  | { kind: "system"; systemId: string };

export type ExecutionWorkspaceBinding = {
  resourceId: string;
  bindingId: string;
  contentVersion: string;
  rootPath: string;
  tenantId?: string;
  owner?: ExecutionWorkspaceOwner;
  lifecycleState?: string;
  bindingState?: "active" | "read_only" | "retired";
};

/** Identity must already be authenticated/admitted by the entry point.
 * This selects storage, not permission. No path derives from the chatting user.
 */
export function selectExecutionWorkspace(params: {
  tenantId: string;
  userId: string;
  agentId: string;
  groupId?: string;
  registry: AgentRegistryStore;
  records: readonly CatalogRecord[];
  operation: "read" | "write";
  stateDir?: string;
  tenantsRoot?: string;
}): ExecutionWorkspaceBinding {
  const deny = (reason: string): never => {
    throw new Error(`workspace_binding_required:${reason}`);
  };
  if (!params.tenantId.trim() || !params.userId.trim()) {
    deny("trusted_identity_missing");
  }
  let resourceId: string;
  let expectedOwner: (record: CatalogRecord) => boolean;
  if (params.groupId) {
    resourceId = `ws:${params.tenantId}:group:${params.groupId}`;
    expectedOwner = (r) =>
      r.envelope.owner.kind === "group" && r.envelope.owner.groupId === params.groupId;
  } else {
    const direct = params.registry.assets[params.agentId];
    const resolved =
      direct?.enterpriseId === params.tenantId
        ? {
            kind: "resolved" as const,
            ref: { enterpriseId: params.tenantId, agentAssetId: direct.agentAssetId },
          }
        : resolveLegacyAgentId({
            store: params.registry,
            enterpriseId: params.tenantId,
            legacyAgentId: params.agentId,
          });
    if (resolved.kind === "builtin-universal") {
      resourceId = buildBuiltinStewardWorkspaceResourceId({
        tenantId: params.tenantId,
        userId: params.userId,
      });
      expectedOwner = (r) =>
        r.envelope.owner.kind === "user" && r.envelope.owner.userId === params.userId;
    } else if (resolved.kind === "resolved") {
      if (params.registry.assets[resolved.ref.agentAssetId]?.status !== "active") {
        return deny("asset_inactive");
      }
      const owner = findPrimaryOwnerBinding(params.registry, resolved.ref);
      if (!owner) {
        return deny("owner_missing_or_ambiguous");
      }
      if (owner.ownerType === "seat") {
        resourceId = `ws:${params.tenantId}:seat:${owner.ownerId}:asset:${resolved.ref.agentAssetId}`;
        expectedOwner = (r) =>
          r.envelope.owner.kind === "position" && r.envelope.owner.seatId === owner.ownerId;
      } else {
        resourceId = `ws:${params.tenantId}:user:${params.userId}:asset:${resolved.ref.agentAssetId}`;
        expectedOwner = (r) =>
          r.envelope.owner.kind === "user" && r.envelope.owner.userId === params.userId;
      }
    } else {
      return deny(`agent_${resolved.kind}`);
    }
  }
  const rows = params.records.filter((r) => r.envelope.resourceId === resourceId);
  if (rows.length !== 1) {
    return deny("resource_missing_or_ambiguous");
  }
  const record = rows[0];
  if (record.envelope.tenantId !== params.tenantId || !expectedOwner(record)) {
    return deny("identity_mismatch");
  }
  const readable =
    record.envelope.lifecycleState === "active" ||
    (params.operation === "read" && record.envelope.lifecycleState === "read_only");
  if (!readable) {
    return deny("lifecycle_denied");
  }
  const canonical = record.bindings.filter((b) => b.role === "canonical" && b.state !== "retired");
  if (canonical.length !== 1 || canonical[0].bindingId !== record.envelope.canonicalBindingId) {
    return deny("canonical_missing_or_ambiguous");
  }
  const binding = canonical[0];
  if (binding.resourceId !== resourceId || !binding.contentVersion.trim()) {
    return deny("binding_identity_mismatch");
  }
  if (params.operation === "write" && binding.state !== "active") {
    return deny("binding_read_only");
  }
  if (
    binding.storageKind !== "filesystem" ||
    !path.isAbsolute(binding.locator) ||
    !isFilesystemWorkspaceLocator(binding.locator)
  ) {
    return deny("binding_unplaced");
  }
  // Official locator only: current STATE_DIR / TENANTS_ROOT, or the same tree
  // under a retired historical prefix. Never scan siblings, align tenants to
  // operators, mint a root, or fall back to a chatting-user directory.
  const roots = {
    stateDir: params.stateDir ?? resolveOfficialWorkspaceRoots().stateDir,
    tenantsRoot: params.tenantsRoot ?? resolveOfficialWorkspaceRoots().tenantsRoot,
  };
  const officialLocator = canonicalizeWorkspaceLocator(binding.locator, roots).locator;
  let real: string;
  try {
    real = fs.realpathSync(officialLocator);
    if (!fs.statSync(real).isDirectory()) {
      return deny("not_directory");
    }
    if (params.operation === "write" && !isWritableDirectory(real)) {
      return deny("directory_not_writable");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("workspace_binding_required:")) {
      throw error;
    }
    return deny("directory_missing");
  }
  return {
    resourceId,
    bindingId: binding.bindingId,
    contentVersion: binding.contentVersion,
    rootPath: real,
    tenantId: record.envelope.tenantId ?? params.tenantId,
    owner: record.envelope.owner,
    lifecycleState: record.envelope.lifecycleState,
    bindingState: binding.state,
  };
}

export async function resolveExecutionWorkspace(params: {
  cfg: OpenBotConfig;
  agentId: string;
  client?: GatewayClient | null;
  /** Scheduler-persisted owner identity, never model/tool arguments. */
  scheduledOwner?: { tenantId?: string; ownerId?: string };
  groupId?: string;
  operation: "read" | "write";
}): Promise<ExecutionWorkspaceBinding | null> {
  if (resolveSecurityProfile(params.cfg, process.env).profile !== "managed_enterprise") {
    return null;
  }
  const identity = params.scheduledOwner
    ? { tenantId: params.scheduledOwner.tenantId, userId: params.scheduledOwner.ownerId }
    : await resolveKnowledgeSourceContext(params.client ?? null);
  if (!identity.tenantId || !identity.userId) {
    throw new Error("workspace_binding_required:trusted_identity_missing");
  }
  const roots = resolveOfficialWorkspaceRoots();
  return selectExecutionWorkspace({
    tenantId: identity.tenantId,
    userId: identity.userId,
    agentId: params.agentId,
    groupId: params.groupId,
    operation: params.operation,
    registry: await loadAgentRegistryStore(),
    records: await getSharedDataGovernanceCatalog().list("workspace"),
    stateDir: roots.stateDir,
    tenantsRoot: roots.tenantsRoot,
  });
}

function isWritableDirectory(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
