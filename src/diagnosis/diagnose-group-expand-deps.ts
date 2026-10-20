/**
 * Track D / M1.1 — shared factory so production diagnose callers inject
 * registry + loadGroupMembers (+ optional sessionKeyExists) into
 * executeParsedDiagnoseRequest. Does not flip any diagnosis gates.
 */
import type { OpenBotConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import { loadAgentRegistryStore } from "../gateway/agent-registry/store.js";
import type { AgentRegistryStore } from "../gateway/agent-registry/types.js";
import {
  createWorkspaceCollaborationStores,
  createWorkspaceGroupStoreFunctions,
} from "../gateway/collaboration-learning/shared.js";
import { defaultSessionExists } from "./diagnose-action-dispatch.js";
import type { ExpandMemberSource } from "./diagnose-group-member-expand.js";

export type DiagnoseGroupExpandDeps = {
  registry: AgentRegistryStore;
  loadGroupMembers: (groupId: string) => Promise<readonly ExpandMemberSource[] | null>;
  sessionKeyExists?: (agentId: string, sessionKey: string) => boolean;
};

/**
 * Preserve null vs []: I/O / parse failure → null; readable empty → [].
 * Never map null↔[].
 */
export function wrapDiagnoseGroupMembersLoader(
  load: (groupId: string) => Promise<readonly ExpandMemberSource[] | null | undefined>,
): (groupId: string) => Promise<readonly ExpandMemberSource[] | null> {
  return async (groupId) => {
    try {
      const members = await load(groupId);
      if (members == null) {
        return null;
      }
      if (Array.isArray(members)) {
        return members;
      }
      return null;
    } catch {
      return null;
    }
  };
}

/**
 * Production SoT wiring: agent registry + workspace group members.json.
 * Store init failure → loadGroupMembers always null (true unreadable, not omitted deps).
 */
export async function createDiagnoseGroupExpandDeps(
  cfg?: OpenBotConfig,
): Promise<DiagnoseGroupExpandDeps> {
  const registry = await loadAgentRegistryStore();
  let loadGroupMembers: DiagnoseGroupExpandDeps["loadGroupMembers"];
  try {
    const resolvedCfg = cfg ?? loadConfig();
    const stores = createWorkspaceCollaborationStores(resolvedCfg);
    const { loadGroupMembers: storeLoad } = createWorkspaceGroupStoreFunctions(
      stores.fileStore,
      stores.stateDir,
      stores.groupRootDir,
    );
    loadGroupMembers = wrapDiagnoseGroupMembersLoader(async (groupId) => storeLoad(groupId));
  } catch {
    loadGroupMembers = async () => null;
  }
  return {
    registry,
    loadGroupMembers,
    sessionKeyExists: defaultSessionExists,
  };
}
