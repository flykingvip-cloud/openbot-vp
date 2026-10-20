/**
 * Track D / M1 — expand a collaboration group into 1:1 member rows.
 * Session keys are agent:<id>:main only. Never agent:*:space:<groupId>.
 * A-class prescriptions hang on member agentAssetId, not the empty group row.
 */
import type { AgentRegistryStore } from "../gateway/agent-registry/types.js";

export type GroupMemberExpandRow = {
  userId: string;
  memberKind: "human" | "bot";
  agentId: string | null;
  agentAssetId: string | null;
  /** agent:<id>:main when resolvable; never a :space: key. */
  sessionKey1to1: string | null;
  sessionKeyExists: boolean;
};

export type GroupMemberExpandResult = {
  groupId: string;
  members: GroupMemberExpandRow[];
  emptyReason?: "无成员绑定" | "members_unreadable";
};

/** Minimal member shape — CollaborationMember-compatible. */
export type ExpandMemberSource = {
  userId?: string | null;
  agentId?: string | null;
  memberKind: string;
  status?: string | null;
};

export type ExpandDiagnoseGroupMembersInput = {
  tenantId: string;
  groupId: string;
  /**
   * Return members, or null when the store is unreadable.
   * Empty array means readable but unbound.
   */
  loadMembers: (groupId: string) => Promise<readonly ExpandMemberSource[] | null>;
  registry: AgentRegistryStore;
  /** Best-effort roster probe; defaults to false when omitted. */
  sessionKeyExists?: (agentId: string, sessionKey: string) => boolean;
};

function sessionKey1to1(agentId: string | null): string | null {
  const id = agentId?.trim() ?? "";
  if (!id) {
    return null;
  }
  return `agent:${id}:main`;
}

function assetForOwner(
  registry: AgentRegistryStore,
  tenantId: string,
  ownerUserId: string,
): { agentAssetId: string; agentId: string | null } | null {
  const open = Object.values(registry.ownerBindings).filter(
    (binding) =>
      binding.enterpriseId === tenantId && binding.ownerId === ownerUserId && !binding.endedAt,
  );
  if (open.length !== 1) {
    return null;
  }
  const agentAssetId = open[0]?.agentAssetId?.trim() ?? "";
  if (!agentAssetId) {
    return null;
  }
  const asset = Object.values(registry.assets).find(
    (row) => row.enterpriseId === tenantId && row.agentAssetId === agentAssetId,
  );
  const agentId = asset?.legacyAgentId?.trim() || asset?.agentSlug?.trim() || null;
  return { agentAssetId, agentId };
}

function assetForAgentId(
  registry: AgentRegistryStore,
  tenantId: string,
  agentId: string,
): { agentAssetId: string; agentId: string } | null {
  const id = agentId.trim();
  if (!id) {
    return null;
  }
  const asset = Object.values(registry.assets).find(
    (row) =>
      row.enterpriseId === tenantId &&
      (row.legacyAgentId === id || row.agentSlug === id || row.agentAssetId === id),
  );
  if (!asset) {
    return { agentAssetId: "", agentId: id };
  }
  return { agentAssetId: asset.agentAssetId, agentId: asset.legacyAgentId?.trim() || id };
}

export async function expandDiagnoseGroupMembers(
  input: ExpandDiagnoseGroupMembersInput,
): Promise<GroupMemberExpandResult> {
  const groupId = input.groupId.trim();
  const tenantId = input.tenantId.trim();
  if (!groupId || !tenantId) {
    return { groupId: groupId || input.groupId, members: [], emptyReason: "members_unreadable" };
  }
  let loaded: readonly ExpandMemberSource[] | null;
  try {
    loaded = await input.loadMembers(groupId);
  } catch {
    return { groupId, members: [], emptyReason: "members_unreadable" };
  }
  if (loaded == null) {
    return { groupId, members: [], emptyReason: "members_unreadable" };
  }
  const active = loaded.filter((row) => {
    const status = (row.status ?? "active").toLowerCase();
    return status === "active" || status === "invited";
  });
  const members: GroupMemberExpandRow[] = [];
  for (const row of active) {
    const kind = row.memberKind === "bot" ? "bot" : row.memberKind === "human" ? "human" : null;
    if (!kind) {
      continue;
    }
    if (kind === "human") {
      const userId = row.userId?.trim() ?? "";
      if (!userId) {
        continue;
      }
      const mapped = assetForOwner(input.registry, tenantId, userId);
      const agentId = mapped?.agentId ?? null;
      const key = sessionKey1to1(agentId);
      if (key?.includes(":space:")) {
        continue;
      }
      members.push({
        userId,
        memberKind: "human",
        agentId,
        agentAssetId: mapped?.agentAssetId ?? null,
        sessionKey1to1: key,
        sessionKeyExists: Boolean(
          agentId && key && input.sessionKeyExists?.(agentId, key) === true,
        ),
      });
      continue;
    }
    const botAgentId = row.agentId?.trim() ?? "";
    const mapped = botAgentId ? assetForAgentId(input.registry, tenantId, botAgentId) : null;
    const agentId = mapped?.agentId || botAgentId || null;
    const userId = row.userId?.trim() || botAgentId || agentId || "";
    const key = sessionKey1to1(agentId);
    if (key?.includes(":space:")) {
      continue;
    }
    members.push({
      userId,
      memberKind: "bot",
      agentId,
      agentAssetId: mapped?.agentAssetId || null,
      sessionKey1to1: key,
      sessionKeyExists: Boolean(agentId && key && input.sessionKeyExists?.(agentId, key) === true),
    });
  }
  if (members.length === 0) {
    return { groupId, members: [], emptyReason: "无成员绑定" };
  }
  return { groupId, members };
}

/** Assert helper for tests and call sites — never emit space session keys. */
export function assertNoSpaceSessionKeys(result: GroupMemberExpandResult): boolean {
  return result.members.every((row) => !row.sessionKey1to1?.includes(":space:"));
}
