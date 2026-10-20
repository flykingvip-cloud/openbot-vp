import fs from "node:fs";
import path from "node:path";
import { resolveAgentRegistryStorePath } from "../agent-registry/store.js";
import { classifyWorkspaceDurability } from "./durability.js";
import { isPathInside, resolveContainedPath, resolveContainedRoot } from "./path-safety.js";
import type { DiscoverCandidateDescriptor, WorkspaceBindingRole } from "./types.js";

function pushCandidate(
  out: DiscoverCandidateDescriptor[],
  seen: Set<string>,
  params: Omit<DiscoverCandidateDescriptor, "durabilityClass">,
): void {
  const key = path.resolve(params.absRoot);
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  out.push({
    ...params,
    durabilityClass: classifyWorkspaceDurability(params.normalizedRootClass),
  });
}

function makeId(rootClass: string, parts: string[]): string {
  return `${rootClass}:${parts.join(":")}`;
}

function listSafeDirectories(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => !name.includes("\0") && name !== "." && name !== "..");
  } catch {
    return [];
  }
}

function bindingRoleForClass(rootClass: string): WorkspaceBindingRole {
  if (rootClass === "canvas_risk" || rootClass === "host_skill_risk") {
    return "risk_candidate";
  }
  if (rootClass === "registered_store_binding" || rootClass === "host_workspace_agent") {
    return "reader";
  }
  if (rootClass === "account_credential_dir") {
    return "unknown";
  }
  return "writer";
}

function pushExistingDir(
  out: DiscoverCandidateDescriptor[],
  seen: Set<string>,
  params: Omit<DiscoverCandidateDescriptor, "durabilityClass">,
): void {
  if (!fs.existsSync(params.absRoot) || !fs.statSync(params.absRoot).isDirectory()) {
    return;
  }
  pushCandidate(out, seen, params);
}

function discoverEmployeeIsolationRoots(
  stateDir: string,
  out: DiscoverCandidateDescriptor[],
  seen: Set<string>,
) {
  const employeesRoot = path.join(stateDir, "agents", "main", "employees");
  if (!isPathInside(stateDir, employeesRoot)) {
    return;
  }
  for (const userId of listSafeDirectories(employeesRoot)) {
    const workspace = path.join(employeesRoot, userId, "workspace");
    if (!isPathInside(stateDir, workspace)) {
      continue;
    }
    pushCandidate(out, seen, {
      candidateId: makeId("employee_isolation_root", [userId]),
      normalizedRootClass: "employee_isolation_root",
      absRoot: workspace,
      tenantRef: null,
      ownerRef: userId,
      agentId: "main",
      agentAssetId: null,
      groupId: null,
      bindingRole: bindingRoleForClass("employee_isolation_root"),
    });
  }
}

function discoverTenantUserRoots(
  stateDir: string,
  out: DiscoverCandidateDescriptor[],
  seen: Set<string>,
) {
  const tenantsRoot = path.join(stateDir, "tenants");
  if (!isPathInside(stateDir, tenantsRoot) || !fs.existsSync(tenantsRoot)) {
    return;
  }
  for (const tenantId of listSafeDirectories(tenantsRoot)) {
    const usersRoot = path.join(tenantsRoot, tenantId, "users");
    if (!isPathInside(stateDir, usersRoot)) {
      continue;
    }
    for (const userId of listSafeDirectories(usersRoot)) {
      const userBase = path.join(usersRoot, userId, "OpenBot");
      const flat = path.join(userBase, "workspace");
      if (isPathInside(stateDir, flat)) {
        pushCandidate(out, seen, {
          candidateId: makeId("data_space_flat_workspace", [tenantId, userId]),
          normalizedRootClass: "data_space_flat_workspace",
          absRoot: flat,
          tenantRef: tenantId,
          ownerRef: userId,
          agentId: null,
          agentAssetId: null,
          groupId: null,
          bindingRole: bindingRoleForClass("data_space_flat_workspace"),
        });
      }
      const agentsRoot = path.join(userBase, "agents");
      for (const agentId of listSafeDirectories(agentsRoot)) {
        const workspace = path.join(agentsRoot, agentId, "workspace");
        if (!isPathInside(stateDir, workspace)) {
          continue;
        }
        pushCandidate(out, seen, {
          candidateId: makeId("agent_workspace", [tenantId, userId, agentId]),
          normalizedRootClass: "agent_workspace",
          absRoot: workspace,
          tenantRef: tenantId,
          ownerRef: userId,
          agentId,
          agentAssetId: null,
          groupId: null,
          bindingRole: bindingRoleForClass("agent_workspace"),
        });
        const artifacts = path.join(agentsRoot, agentId, "artifacts");
        if (!isPathInside(stateDir, artifacts)) {
          continue;
        }
        pushExistingDir(out, seen, {
          candidateId: makeId("agent_artifacts", [tenantId, userId, agentId]),
          normalizedRootClass: "agent_artifacts",
          absRoot: artifacts,
          tenantRef: tenantId,
          ownerRef: userId,
          agentId,
          agentAssetId: null,
          groupId: null,
          bindingRole: bindingRoleForClass("agent_artifacts"),
        });
      }
      const memoryDir = path.join(userBase, "memory");
      if (isPathInside(stateDir, memoryDir)) {
        pushExistingDir(out, seen, {
          candidateId: makeId("account_memory", [tenantId, userId]),
          normalizedRootClass: "account_memory",
          absRoot: memoryDir,
          tenantRef: tenantId,
          ownerRef: userId,
          agentId: null,
          agentAssetId: null,
          groupId: null,
          bindingRole: bindingRoleForClass("account_memory"),
        });
      }
      const userRoot = path.join(usersRoot, userId);
      const browserDir = path.join(userRoot, "state", "browser");
      if (isPathInside(stateDir, browserDir)) {
        pushExistingDir(out, seen, {
          candidateId: makeId("account_browser_profile", [tenantId, userId]),
          normalizedRootClass: "account_browser_profile",
          absRoot: browserDir,
          tenantRef: tenantId,
          ownerRef: userId,
          agentId: null,
          agentAssetId: null,
          groupId: null,
          bindingRole: bindingRoleForClass("account_browser_profile"),
        });
      }
      const credentialAgents = path.join(userRoot, "state", "agents");
      if (isPathInside(stateDir, credentialAgents)) {
        for (const agentId of listSafeDirectories(credentialAgents)) {
          const credentialDir = path.join(credentialAgents, agentId, "agent");
          if (!isPathInside(stateDir, credentialDir)) {
            continue;
          }
          pushExistingDir(out, seen, {
            candidateId: makeId("account_credential_dir", [tenantId, userId, agentId]),
            normalizedRootClass: "account_credential_dir",
            absRoot: credentialDir,
            tenantRef: tenantId,
            ownerRef: userId,
            agentId,
            agentAssetId: null,
            groupId: null,
            bindingRole: bindingRoleForClass("account_credential_dir"),
          });
        }
      }
      const userAssetsRoot = path.join(userBase, "agent-assets");
      for (const agentAssetId of listSafeDirectories(userAssetsRoot)) {
        const assetRoot = path.join(userAssetsRoot, agentAssetId);
        if (!isPathInside(stateDir, assetRoot)) {
          continue;
        }
        pushCandidate(out, seen, {
          candidateId: makeId("agent_assets_user", [tenantId, userId, agentAssetId]),
          normalizedRootClass: "agent_assets_user",
          absRoot: assetRoot,
          tenantRef: tenantId,
          ownerRef: userId,
          agentId: null,
          agentAssetId,
          groupId: null,
          bindingRole: bindingRoleForClass("agent_assets_user"),
        });
      }
      for (const name of listSafeDirectories(userBase)) {
        if (!name.startsWith("workspace-")) {
          continue;
        }
        const agentId = name.slice("workspace-".length);
        if (!agentId) {
          continue;
        }
        const absRoot = path.join(userBase, name);
        if (!isPathInside(stateDir, absRoot)) {
          continue;
        }
        pushCandidate(out, seen, {
          candidateId: makeId("legacy_agent_workspace", [tenantId, userId, agentId]),
          normalizedRootClass: "legacy_agent_workspace",
          absRoot,
          tenantRef: tenantId,
          ownerRef: userId,
          agentId,
          agentAssetId: null,
          groupId: null,
          bindingRole: bindingRoleForClass("legacy_agent_workspace"),
        });
      }
    }
    const tenantAssetsRoot = path.join(tenantsRoot, tenantId, "agent-assets");
    for (const agentAssetId of listSafeDirectories(tenantAssetsRoot)) {
      const assetRoot = path.join(tenantAssetsRoot, agentAssetId);
      if (!isPathInside(stateDir, assetRoot)) {
        continue;
      }
      pushCandidate(out, seen, {
        candidateId: makeId("agent_assets_tenant", [tenantId, agentAssetId]),
        normalizedRootClass: "agent_assets_tenant",
        absRoot: assetRoot,
        tenantRef: tenantId,
        ownerRef: null,
        agentId: null,
        agentAssetId,
        groupId: null,
        bindingRole: bindingRoleForClass("agent_assets_tenant"),
      });
    }
  }
}

function discoverCollaborationGroups(
  stateDir: string,
  out: DiscoverCandidateDescriptor[],
  seen: Set<string>,
) {
  const groupRoots = [
    path.join(stateDir, "collaboration", "groups"),
    path.join(stateDir, "groups"),
  ];
  for (const groupRoot of groupRoots) {
    if (!isPathInside(stateDir, groupRoot)) {
      continue;
    }
    for (const groupId of listSafeDirectories(groupRoot)) {
      const groupDir = path.join(groupRoot, groupId);
      if (!isPathInside(stateDir, groupDir)) {
        continue;
      }
      pushCandidate(out, seen, {
        candidateId: makeId("collaboration_group", [groupId]),
        normalizedRootClass: "collaboration_group",
        absRoot: groupDir,
        tenantRef: null,
        ownerRef: null,
        agentId: null,
        agentAssetId: null,
        groupId,
        bindingRole: bindingRoleForClass("collaboration_group"),
      });
    }
  }
}

function discoverRiskCandidates(
  stateDir: string,
  out: DiscoverCandidateDescriptor[],
  seen: Set<string>,
) {
  for (const [suffix, rootClass] of [
    ["canvas", "canvas_risk"],
    ["skills", "host_skill_risk"],
  ] as const) {
    const absRoot = path.join(stateDir, suffix);
    if (!isPathInside(stateDir, absRoot)) {
      continue;
    }
    pushCandidate(out, seen, {
      candidateId: makeId(rootClass, ["host"]),
      normalizedRootClass: rootClass,
      absRoot,
      tenantRef: null,
      ownerRef: null,
      agentId: null,
      agentAssetId: null,
      groupId: null,
      bindingRole: "risk_candidate",
    });
  }
}

function discoverHostRetiredRoots(
  stateDir: string,
  out: DiscoverCandidateDescriptor[],
  seen: Set<string>,
) {
  for (const name of listSafeDirectories(stateDir)) {
    if (name !== "workspace" && !name.startsWith("workspace-")) {
      continue;
    }
    const absRoot = path.join(stateDir, name);
    if (!isPathInside(stateDir, absRoot)) {
      continue;
    }
    const agentId = name.startsWith("workspace-") ? name.slice("workspace-".length) : null;
    pushCandidate(out, seen, {
      candidateId: makeId("host_workspace_agent", [name]),
      normalizedRootClass: "host_workspace_agent",
      absRoot,
      tenantRef: null,
      ownerRef: null,
      agentId,
      agentAssetId: null,
      groupId: null,
      bindingRole: bindingRoleForClass("host_workspace_agent"),
    });
  }
  const cacheDir = path.join(stateDir, "cache");
  if (isPathInside(stateDir, cacheDir)) {
    pushExistingDir(out, seen, {
      candidateId: makeId("ephemeral_cache", ["host"]),
      normalizedRootClass: "ephemeral_cache",
      absRoot: cacheDir,
      tenantRef: null,
      ownerRef: null,
      agentId: null,
      agentAssetId: null,
      groupId: null,
      bindingRole: bindingRoleForClass("ephemeral_cache"),
    });
  }
}

function discoverLegacyAgentRoots(
  stateDir: string,
  out: DiscoverCandidateDescriptor[],
  seen: Set<string>,
) {
  const agentsRoot = path.join(stateDir, "agents");
  if (!isPathInside(stateDir, agentsRoot)) {
    return;
  }
  for (const agentId of listSafeDirectories(agentsRoot)) {
    if (agentId === "main") {
      continue;
    }
    const workspace = path.join(agentsRoot, agentId, "workspace");
    if (!isPathInside(stateDir, workspace)) {
      continue;
    }
    pushCandidate(out, seen, {
      candidateId: makeId("legacy_agent_workspace", ["global", agentId]),
      normalizedRootClass: "legacy_agent_workspace",
      absRoot: workspace,
      tenantRef: null,
      ownerRef: null,
      agentId,
      agentAssetId: null,
      groupId: null,
      bindingRole: bindingRoleForClass("legacy_agent_workspace"),
    });
  }
}

function discoverRegisteredStoreBinding(
  stateDir: string,
  out: DiscoverCandidateDescriptor[],
  seen: Set<string>,
): void {
  const storePath = resolveAgentRegistryStorePath();
  const storeDir = path.dirname(storePath);
  if (!isPathInside(stateDir, storeDir)) {
    return;
  }
  pushCandidate(out, seen, {
    candidateId: makeId("registered_store_binding", ["agent-registry"]),
    normalizedRootClass: "registered_store_binding",
    absRoot: storeDir,
    tenantRef: null,
    ownerRef: null,
    agentId: null,
    agentAssetId: null,
    groupId: null,
    bindingRole: "reader",
  });
}

export function discoverWorkspaceCandidates(params: {
  containmentRoot: string;
  maxCandidates: number;
}): { candidates: DiscoverCandidateDescriptor[]; truncated: boolean } {
  const stateDir = resolveContainedRoot(params.containmentRoot);
  const seen = new Set<string>();
  const out: DiscoverCandidateDescriptor[] = [];

  discoverEmployeeIsolationRoots(stateDir, out, seen);
  discoverTenantUserRoots(stateDir, out, seen);
  discoverCollaborationGroups(stateDir, out, seen);
  discoverRiskCandidates(stateDir, out, seen);
  discoverHostRetiredRoots(stateDir, out, seen);
  discoverLegacyAgentRoots(stateDir, out, seen);
  discoverRegisteredStoreBinding(stateDir, out, seen);

  out.sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  if (out.length <= params.maxCandidates) {
    return { candidates: out, truncated: false };
  }
  return { candidates: out.slice(0, params.maxCandidates), truncated: true };
}

export function resolveInventoryContainmentRoot(raw: string): string {
  const resolved = resolveContainedRoot(raw);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error("OPENBOT_STATE_DIR is not a directory");
  }
  return resolved;
}

/** Join under containment for optional sample-scoped discovery overrides in tests. */
export function resolveSampleScopedRoot(
  containmentRoot: string,
  tenantId: string,
  userId: string,
): string {
  return resolveContainedPath(containmentRoot, "tenants", tenantId, "users", userId);
}
