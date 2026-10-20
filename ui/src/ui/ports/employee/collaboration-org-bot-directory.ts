import type { GatewayBrowserClient } from "../../gateway.ts";
import type { WorkbenchCollaborationMemberGovernanceCandidate } from "./views/workbench-types.ts";

export type CollaborationOrgBotDirectoryEntry = {
  agentId: string;
  label: string;
  ownerUserId: string | null;
  ownerLabel: string | null;
  scope: string | null;
};

function normalizeIdentity(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function isCollaborationOrgBotOwnedByActor(
  entry: Pick<CollaborationOrgBotDirectoryEntry, "agentId" | "ownerUserId">,
  actorIdentities: ReadonlySet<string>,
  ownedAgentIds?: ReadonlySet<string>,
): boolean {
  if (ownedAgentIds?.has(entry.agentId)) {
    return true;
  }
  const ownerId = normalizeIdentity(entry.ownerUserId);
  return Boolean(ownerId && actorIdentities.has(ownerId));
}

export function buildEmployeeDirectoryBotCandidates(params: {
  orgDirectory: CollaborationOrgBotDirectoryEntry[];
  directoryMembers?: Array<{
    user: string;
    displayName?: string;
    membershipRole: string;
    status?: string;
    seatTitle?: string;
  }> | null;
  currentUserId?: string | null;
  currentUserEmail?: string | null;
  ownedAgentIds: ReadonlySet<string>;
  currentBotIds: ReadonlySet<string>;
  pendingBotIds: ReadonlySet<string>;
}): WorkbenchCollaborationMemberGovernanceCandidate[] {
  const actorIdentities = new Set(
    [params.currentUserId, params.currentUserEmail]
      .map((value) => normalizeIdentity(value))
      .filter(Boolean),
  );
  const memberLabelById = new Map(
    (params.directoryMembers ?? [])
      .map((member) => {
        const userId = normalizeIdentity(member.user);
        if (!userId) {
          return null;
        }
        return [userId, member.displayName?.trim() || member.user] as const;
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry)),
  );

  return params.orgDirectory.map((entry) => {
    const ownedByActor = isCollaborationOrgBotOwnedByActor(
      entry,
      actorIdentities,
      params.ownedAgentIds,
    );
    const ownerLabel =
      (entry.ownerUserId ? memberLabelById.get(normalizeIdentity(entry.ownerUserId)) : undefined) ??
      entry.ownerLabel ??
      entry.ownerUserId ??
      "同事";
    const orgSegment = ownedByActor ? "我的机器人" : `${ownerLabel} 的机器人`;
    return {
      id: entry.agentId,
      label: entry.label,
      subtitle: ownedByActor ? undefined : `${ownerLabel} · 需主人同意`,
      kind: "bot" as const,
      actionMode: ownedByActor ? ("add" as const) : ("invite" as const),
      orgSegments: [orgSegment],
      disabled: params.currentBotIds.has(entry.agentId) || params.pendingBotIds.has(entry.agentId),
    };
  });
}

const ORG_BOT_DIRECTORY_CLIENT_TTL_MS = 30_000;

type OrgBotDirectoryClientGate = {
  inFlight?: Promise<void>;
  loadedAt?: number;
};

const orgBotDirectoryClientGates = new WeakMap<object, OrgBotDirectoryClientGate>();

/**
 * Load the org bot directory once per host, coalesce in-flight calls, and
 * skip refreshes inside a short TTL. Member-governance render paths call this
 * on every re-render; without gating that stampedes the gateway.
 */
export async function loadCollaborationOrgBotDirectory(
  state: {
    client: GatewayBrowserClient | null;
    connected: boolean;
    workbenchCollaborationOrgBotDirectory?: CollaborationOrgBotDirectoryEntry[] | null;
  },
  options?: { force?: boolean },
): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }

  const gate = orgBotDirectoryClientGates.get(state) ?? {};
  const now = Date.now();
  if (
    !options?.force &&
    gate.loadedAt &&
    now - gate.loadedAt < ORG_BOT_DIRECTORY_CLIENT_TTL_MS &&
    state.workbenchCollaborationOrgBotDirectory
  ) {
    return;
  }
  if (gate.inFlight) {
    return gate.inFlight;
  }

  const inFlightRef: { promise?: Promise<void> } = {};
  inFlightRef.promise = (async () => {
    try {
      const result = await state.client!.request<{ bots?: CollaborationOrgBotDirectoryEntry[] }>(
        "collaboration.directory.bots.list",
        {},
      );
      state.workbenchCollaborationOrgBotDirectory = result.bots ?? [];
      gate.loadedAt = Date.now();
    } catch {
      // Keep the last loaded directory when refresh fails.
    } finally {
      if (orgBotDirectoryClientGates.get(state)?.inFlight === inFlightRef.promise) {
        gate.inFlight = undefined;
        orgBotDirectoryClientGates.set(state, gate);
      }
    }
  })();

  gate.inFlight = inFlightRef.promise;
  orgBotDirectoryClientGates.set(state, gate);
  return inFlightRef.promise;
}
