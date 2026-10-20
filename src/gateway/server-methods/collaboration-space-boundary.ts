/**
 * collaboration.space.* — Employee collaboration-group command surface (Phase 3).
 *
 * Spec: docs/design/robot-workspace-and-mesh-boundary-plan-2026-08-02.md §4 / §7.2 / §7.5
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FinalDecisionPolicy } from "@openbot/collaboration-core";
import { resolveStateDir } from "../../config/paths.js";
import { readJsonFileWithFallback } from "../../plugin-sdk/json-store.js";
import { normalizeAgentId, parseAgentSessionKey } from "../../routing/session-key.js";
import { withSpaceEffectivePolicy } from "../collaboration-dispatch/policy-lane-presentation.js";
import {
  listGatewayCollaborationSpaces,
  updateGatewayCollaborationSpaceMembers,
} from "../collaboration-learning.js";
import {
  createWorkspaceCollaborationStores,
  readGroupOperatingState,
  resolveSessionGroupId,
  writeGroupOperatingState,
} from "../collaboration-learning/shared.js";
import type { GatewayCollaborationSpaceSnapshot } from "../collaboration-learning/snapshot-types.js";
import {
  isCollaborationSpaceVisibleToEmployeeUser,
  requiresEmployeeAssetScope,
  resolveCollaborationSpaceMutateDenial,
  resolveEmployeeWorkbenchActor,
} from "../employee-workbench-scope.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { stringValue } from "../records.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function trimString(value: unknown): string | null {
  return stringValue(value);
}

function narrowFinalDecisionPolicy(value: unknown): FinalDecisionPolicy | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const rec = value as {
    mode?: unknown;
    defaultFinalDeciderRole?: unknown;
    allowAgentPublishProposal?: unknown;
  };
  if (rec.mode !== "human_required" && rec.mode !== "delegated_low_risk") {
    return undefined;
  }
  return {
    mode: rec.mode,
    defaultFinalDeciderRole: rec.defaultFinalDeciderRole === "admin" ? "admin" : "owner",
    allowAgentPublishProposal: rec.allowAgentPublishProposal === true,
  };
}

function rosterFromSpace(space: GatewayCollaborationSpaceSnapshot) {
  return {
    members: {
      humans: (space.members?.humans ?? [])
        .filter((entry) => trimString(entry.status) !== "invited")
        .map((entry) => ({
          userId: entry.userId,
          ...(trimString(entry.name) ? { name: trimString(entry.name)! } : {}),
        })),
      bots: (space.members?.bots ?? [])
        .filter((entry) => trimString(entry.status) !== "invited")
        .map((entry) => ({
          agentId: entry.agentId,
          ...(trimString(entry.name) ? { name: trimString(entry.name)! } : {}),
        })),
    },
    invites: {
      humans: (space.invites?.humans ?? []).map((entry) => ({
        userId: entry.userId,
        ...(trimString(entry.name) ? { name: trimString(entry.name)! } : {}),
      })),
      bots: (space.invites?.bots ?? []).map((entry) => ({
        agentId: entry.agentId,
        ...(trimString(entry.name) ? { name: trimString(entry.name)! } : {}),
      })),
    },
  };
}

async function findSpaceByGroupId(groupId: string) {
  const listed = await listGatewayCollaborationSpaces();
  return (listed.spaces ?? []).find((entry) => {
    const id = trimString(entry.groupId) || trimString(entry.id);
    return id === groupId;
  });
}

async function denyIfCannotMutateSpace(params: {
  client: unknown;
  groupId: string;
  respond: RespondFn;
}): Promise<boolean> {
  const denial = await resolveCollaborationSpaceMutateDenial({
    client: params.client as Parameters<typeof resolveCollaborationSpaceMutateDenial>[0]["client"],
    groupId: params.groupId,
  });
  if (!denial) {
    return false;
  }
  params.respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, denial));
  return true;
}

function computeContributionFromSessionShare(
  memberSessionCount: number,
  totalSessions: number,
): number | null {
  if (
    !Number.isFinite(memberSessionCount) ||
    !Number.isFinite(totalSessions) ||
    totalSessions <= 0
  ) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round((memberSessionCount / totalSessions) * 100)));
}

function roleWeightForContribution(params: {
  governanceRole: string | null | undefined;
  isCoordinator?: boolean;
}): number {
  switch (params.governanceRole) {
    case "owner":
      return 100;
    case "admin":
      return 80;
    default:
      return params.isCoordinator ? 70 : 40;
  }
}

function recencyScoreForContribution(lastActiveAt: number | null | undefined, now = Date.now()) {
  if (typeof lastActiveAt !== "number" || !Number.isFinite(lastActiveAt) || lastActiveAt <= 0) {
    return 0;
  }
  const ageDays = Math.max(0, (now - lastActiveAt) / (24 * 60 * 60 * 1000));
  if (ageDays <= 7) {
    return 100;
  }
  if (ageDays <= 30) {
    return 70;
  }
  if (ageDays <= 90) {
    return 40;
  }
  return 10;
}

/** Independent contributionScore (v2): 0.5 session + 0.3 recency + 0.2 role. */
function computeContributionScoreV2(params: {
  sessionShare: number | null;
  lastActiveAt: number | null;
  governanceRole?: string | null;
  isCoordinator?: boolean;
  now?: number;
}): number | null {
  if (params.sessionShare == null && params.lastActiveAt == null && !params.governanceRole) {
    return null;
  }
  const sessionShare = params.sessionShare ?? 0;
  const recency = recencyScoreForContribution(params.lastActiveAt, params.now);
  const role = roleWeightForContribution({
    governanceRole: params.governanceRole,
    isCoordinator: params.isCoordinator,
  });
  return Math.max(0, Math.min(100, Math.round(0.5 * sessionShare + 0.3 * recency + 0.2 * role)));
}

function governanceRoleLabel(role: string | null | undefined): string | null {
  switch (role) {
    case "owner":
      return "群主";
    case "admin":
      return "管理员";
    case "member":
      return "成员";
    case "observer":
      return "观察者";
    default:
      return trimString(role);
  }
}

function collaborationRoleLabel(role: string | null | undefined): string | null {
  switch (role) {
    case "coordinator":
      return "协调";
    case "final_decider":
      return "拍板";
    case "decision_advisor":
      return "决策顾问";
    case "contributor":
      return "贡献者";
    case "reviewer":
      return "评审";
    case "observer":
      return "观察";
    default:
      return trimString(role);
  }
}

type SessionStats = {
  total: number;
  byMemberId: Map<string, number>;
  lastActiveByMemberId: Map<string, number>;
};

async function collectGroupMemberSessionStats(groupId: string): Promise<SessionStats> {
  const stats: SessionStats = {
    total: 0,
    byMemberId: new Map(),
    lastActiveByMemberId: new Map(),
  };
  const agentsRoot = path.join(resolveStateDir(process.env, os.homedir), "agents");
  let agentEntries: Array<{ name: string; isDirectory: () => boolean }> = [];
  try {
    agentEntries = await fs.readdir(agentsRoot, { withFileTypes: true });
  } catch {
    return stats;
  }

  await Promise.all(
    agentEntries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const sessionsPath = path.join(agentsRoot, entry.name, "sessions", "sessions.json");
        const { value } = await readJsonFileWithFallback<Record<string, Record<string, unknown>>>(
          sessionsPath,
          {},
        );
        if (!value || typeof value !== "object") {
          return;
        }
        for (const [key, session] of Object.entries(value)) {
          const resolvedGroupId =
            resolveSessionGroupId(session as Parameters<typeof resolveSessionGroupId>[0]) ||
            (key.startsWith("space:") ? key.slice("space:".length).trim() : null) ||
            (key.match(/:space:([^:]+)$/)?.[1]?.trim() ?? null);
          if (!resolvedGroupId || resolvedGroupId !== groupId) {
            continue;
          }
          stats.total += 1;
          const updatedAt =
            typeof session.updatedAt === "number" && Number.isFinite(session.updatedAt)
              ? session.updatedAt
              : 0;
          const parsed = parseAgentSessionKey(key);
          let memberId: string | null = null;
          if (parsed?.agentId) {
            memberId = normalizeAgentId(parsed.agentId);
          } else if (key.startsWith("space:")) {
            memberId = null; // attributed to owner later
          }
          if (memberId) {
            stats.byMemberId.set(memberId, (stats.byMemberId.get(memberId) ?? 0) + 1);
            const prev = stats.lastActiveByMemberId.get(memberId) ?? 0;
            if (updatedAt > prev) {
              stats.lastActiveByMemberId.set(memberId, updatedAt);
            }
          } else {
            // space alias / unattributed — bucket under __space__
            stats.byMemberId.set("__space__", (stats.byMemberId.get("__space__") ?? 0) + 1);
          }
        }
      }),
  );
  return stats;
}

async function buildGroupProjection(
  space: GatewayCollaborationSpaceSnapshot,
  archivedGroupIds: ReadonlySet<string>,
) {
  const groupId = trimString(space.groupId) || trimString(space.id) || "unknown";
  const sessionKey = trimString(space.id) || groupId;
  const coordinatorBotId =
    trimString(space.operatingState?.governance?.coordinatorBotId) ||
    trimString(space.coordinatorBotId);
  const archived = archivedGroupIds.has(groupId);
  const ownerUserId = trimString(space.ownerUserId);
  const adminUserIds = new Set(
    (space.operatingState?.governance?.adminUserIds ?? [])
      .map((entry) => trimString(entry))
      .filter((entry): entry is string => Boolean(entry)),
  );
  const roleMap = new Map(
    (space.operatingState?.memberRoleMap ?? []).map((entry) => [
      trimString(entry.memberId) || "",
      entry,
    ]),
  );
  const sessionStats = await collectGroupMemberSessionStats(groupId);
  if (ownerUserId && (sessionStats.byMemberId.get("__space__") ?? 0) > 0) {
    const spaceCount = sessionStats.byMemberId.get("__space__") ?? 0;
    sessionStats.byMemberId.set(
      ownerUserId,
      (sessionStats.byMemberId.get(ownerUserId) ?? 0) + spaceCount,
    );
    sessionStats.byMemberId.delete("__space__");
  }

  const ownerLabelFromMap = [...roleMap.values()].find(
    (entry) =>
      entry.governanceRole === "owner" && entry.memberKind !== "bot" && trimString(entry.label),
  );
  const coordinatorBotLabel =
    (space.members?.bots ?? []).find((entry) => trimString(entry.agentId) === coordinatorBotId)
      ?.name ?? null;

  const humans = (space.members?.humans ?? [])
    .filter((entry) => trimString(entry.status) !== "invited")
    .map((entry) => {
      const memberId = trimString(entry.userId) || "unknown";
      const role = roleMap.get(memberId);
      const governanceRole =
        role?.governanceRole ||
        (memberId === ownerUserId ? "owner" : adminUserIds.has(memberId) ? "admin" : "member");
      const identity = governanceRoleLabel(governanceRole);
      const duty = collaborationRoleLabel(role?.collaborationRole ?? null);
      const contributionSessionShare = computeContributionFromSessionShare(
        sessionStats.byMemberId.get(memberId) ?? 0,
        sessionStats.total,
      );
      const lastActiveAt = sessionStats.lastActiveByMemberId.get(memberId) ?? null;
      const contribution = computeContributionScoreV2({
        sessionShare: contributionSessionShare,
        lastActiveAt,
        governanceRole,
      });
      return {
        memberId,
        kind: "human" as const,
        name: trimString(entry.name) || memberId,
        identity,
        duty,
        contribution,
        contributionSessionShare,
        lastActiveAt,
      };
    });

  const bots = (space.members?.bots ?? [])
    .filter((entry) => trimString(entry.status) !== "invited")
    .map((entry) => {
      const memberId = normalizeAgentId(trimString(entry.agentId) || "unknown");
      const role = roleMap.get(memberId) || roleMap.get(trimString(entry.agentId) || "");
      const isCoordinator = memberId === coordinatorBotId;
      const identity =
        governanceRoleLabel(role?.governanceRole) || (isCoordinator ? "协调机器人" : "机器人成员");
      const duty =
        collaborationRoleLabel(role?.collaborationRole ?? null) ||
        (isCoordinator ? "协调" : null) ||
        trimString(entry.currentTask);
      const contributionSessionShare = computeContributionFromSessionShare(
        sessionStats.byMemberId.get(memberId) ?? 0,
        sessionStats.total,
      );
      const presenceMs = (() => {
        const raw = trimString(entry.lastActiveAt);
        if (!raw) {
          return null;
        }
        const parsed = Date.parse(raw);
        return Number.isFinite(parsed) ? parsed : null;
      })();
      const lastActiveAt = presenceMs ?? sessionStats.lastActiveByMemberId.get(memberId) ?? null;
      const contribution = computeContributionScoreV2({
        sessionShare: contributionSessionShare,
        lastActiveAt,
        governanceRole: role?.governanceRole ?? null,
        isCoordinator,
      });
      return {
        memberId,
        kind: "bot" as const,
        name: trimString(entry.name) || memberId,
        identity,
        duty,
        contribution,
        contributionSessionShare,
        lastActiveAt,
      };
    });

  const policy = space.operatingState?.collaborationPolicy;
  const systemInstructions = (space.systemInstructions ?? [])
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);

  return {
    basic: {
      groupId,
      sessionKey,
      title: trimString(space.title) || groupId,
      avatar: null as string | null,
      positioning: trimString(space.purpose),
      lifecycleStatus: archived ? "archived" : "active",
      ownerUserId,
      ownerLabel:
        trimString(ownerLabelFromMap?.label) ||
        trimString(
          (space.members?.humans ?? []).find((entry) => trimString(entry.userId) === ownerUserId)
            ?.name,
        ) ||
        ownerUserId,
      coordinatorBotId,
      coordinatorBotLabel: trimString(coordinatorBotLabel),
    },
    mission: {
      purpose: trimString(space.purpose),
      currentMission: trimString(space.currentMission),
      successCriteria: (space.successCriteria ?? []).filter(
        (entry): entry is string => typeof entry === "string" && Boolean(entry.trim()),
      ),
    },
    members: [...humans, ...bots],
    rules: {
      openDiscussion: policy?.openDiscussionWithoutMention ?? null,
      maxVisibleBotRepliesPerRound: policy?.maxVisibleBotRepliesPerRound ?? null,
      confidentialityTier: trimString(space.confidentialityTier),
      learningStrategy: systemInstructions[0] ?? null,
      sharingStrategy: systemInstructions[1] ?? null,
      collaborationMode: trimString(space.collaborationMode),
      archived,
    },
    phase: 3,
    blocksComplete: {
      basic: true,
      mission: true,
      members: true,
      rules: true,
    },
  };
}

async function resolveActorLabel(client: unknown): Promise<string | undefined> {
  const actor = await resolveEmployeeWorkbenchActor(client as never);
  return actor?.userId?.trim() || undefined;
}

export const collaborationSpaceBoundaryHandlers: GatewayRequestHandlers = {
  "collaboration.space.get": async ({ params, respond, client }) => {
    const groupId = trimString((params as { groupId?: unknown } | null)?.groupId);
    const sessionKey = trimString((params as { sessionKey?: unknown } | null)?.sessionKey);
    if (!groupId && !sessionKey) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "collaboration.space.get requires groupId or sessionKey",
        ),
      );
      return;
    }
    const listed = await listGatewayCollaborationSpaces();
    const spaces = listed.spaces ?? [];
    const archivedGroupIds = new Set(listed.archivedGroupIds ?? []);
    const space = spaces.find((entry) => {
      const id = trimString(entry.groupId) || trimString(entry.id);
      const key = trimString(entry.id);
      return (groupId && id === groupId) || (sessionKey && key === sessionKey);
    });
    if (!space) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "unknown collaboration space"),
      );
      return;
    }
    if (requiresEmployeeAssetScope(client)) {
      const actor = await resolveEmployeeWorkbenchActor(client);
      if (!actor || !isCollaborationSpaceVisibleToEmployeeUser(space, actor)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "you do not have permission to access this collaboration space",
          ),
        );
        return;
      }
    }
    const group = await buildGroupProjection(space, archivedGroupIds);
    // P1-A5 ⑤ (BP-20): server-compiled frozen EffectivePolicy + provenance for this group.
    const { effectivePolicy } = withSpaceEffectivePolicy(space);
    respond(
      true,
      { group: { ...group, ...(effectivePolicy ? { effectivePolicy } : {}) } },
      undefined,
    );
  },

  "collaboration.space.updateBasic": async ({ params, respond, client }) => {
    const input = (params ?? {}) as {
      groupId?: unknown;
      title?: unknown;
      avatar?: unknown;
      visibilityScope?: unknown;
      coordinatorBotId?: unknown;
    };
    const groupId = trimString(input.groupId);
    if (!groupId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "collaboration.space.updateBasic requires groupId"),
      );
      return;
    }
    if (await denyIfCannotMutateSpace({ client, groupId, respond })) {
      return;
    }
    try {
      const space = await findSpaceByGroupId(groupId);
      if (!space) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "unknown collaboration space"),
        );
        return;
      }
      const actor = await resolveActorLabel(client);
      const roster = rosterFromSpace(space);
      await updateGatewayCollaborationSpaceMembers({
        groupId,
        ...roster,
        ...(actor ? { actor } : {}),
        ...(trimString(input.title) ? { title: trimString(input.title)! } : {}),
        ...(trimString(input.avatar) ? { avatar: trimString(input.avatar)! } : {}),
        ...(trimString(input.visibilityScope)
          ? { visibilityScope: trimString(input.visibilityScope)! }
          : {}),
        ...("coordinatorBotId" in input
          ? { coordinatorBotId: trimString(input.coordinatorBotId) ?? "" }
          : {}),
      });
      respond(true, { ok: true, groupId }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, error instanceof Error ? error.message : String(error)),
      );
    }
  },

  "collaboration.space.updateMission": async ({ params, respond, client }) => {
    const input = (params ?? {}) as {
      groupId?: unknown;
      purpose?: unknown;
      currentMission?: unknown;
      successCriteria?: unknown;
    };
    const groupId = trimString(input.groupId);
    if (!groupId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "collaboration.space.updateMission requires groupId",
        ),
      );
      return;
    }
    if (await denyIfCannotMutateSpace({ client, groupId, respond })) {
      return;
    }
    try {
      const space = await findSpaceByGroupId(groupId);
      if (!space) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "unknown collaboration space"),
        );
        return;
      }
      const actor = await resolveActorLabel(client);
      const roster = rosterFromSpace(space);
      const successCriteria = Array.isArray(input.successCriteria)
        ? input.successCriteria
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean)
        : undefined;
      await updateGatewayCollaborationSpaceMembers({
        groupId,
        ...roster,
        ...(actor ? { actor } : {}),
        ...(typeof input.purpose === "string" ? { purpose: input.purpose } : {}),
        ...(typeof input.currentMission === "string"
          ? { currentMission: input.currentMission }
          : {}),
        ...(successCriteria ? { successCriteria } : {}),
      });
      respond(true, { ok: true, groupId }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, error instanceof Error ? error.message : String(error)),
      );
    }
  },

  "collaboration.space.updateRules": async ({ params, respond, client }) => {
    const input = (params ?? {}) as {
      groupId?: unknown;
      collaborationMode?: unknown;
      confidentialityTier?: unknown;
      systemInstructions?: unknown;
      finalDecisionPolicy?: unknown;
      openDiscussionWithoutMention?: unknown;
      maxVisibleBotRepliesPerRound?: unknown;
      replyLanguage?: unknown;
    };
    const groupId = trimString(input.groupId);
    if (!groupId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "collaboration.space.updateRules requires groupId"),
      );
      return;
    }
    if (await denyIfCannotMutateSpace({ client, groupId, respond })) {
      return;
    }
    try {
      const space = await findSpaceByGroupId(groupId);
      if (!space) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "unknown collaboration space"),
        );
        return;
      }
      const actor = await resolveActorLabel(client);
      const roster = rosterFromSpace(space);
      const systemInstructions = Array.isArray(input.systemInstructions)
        ? input.systemInstructions
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean)
        : undefined;
      const finalDecisionPolicy = narrowFinalDecisionPolicy(input.finalDecisionPolicy);
      await updateGatewayCollaborationSpaceMembers({
        groupId,
        ...roster,
        ...(actor ? { actor } : {}),
        ...(trimString(input.collaborationMode)
          ? { collaborationMode: trimString(input.collaborationMode)! }
          : {}),
        ...(trimString(input.confidentialityTier)
          ? { confidentialityTier: trimString(input.confidentialityTier)! }
          : {}),
        ...(systemInstructions ? { systemInstructions } : {}),
        ...(finalDecisionPolicy ? { finalDecisionPolicy } : {}),
      });
      const wantsOpenDiscussion = typeof input.openDiscussionWithoutMention === "boolean";
      const wantsMaxVisible =
        typeof input.maxVisibleBotRepliesPerRound === "number" &&
        Number.isFinite(input.maxVisibleBotRepliesPerRound);
      const replyLanguage =
        input.replyLanguage === "zh" ||
        input.replyLanguage === "en" ||
        input.replyLanguage === "inherit"
          ? input.replyLanguage
          : undefined;
      const wantsReplyLanguage = replyLanguage !== undefined;
      if (wantsOpenDiscussion || wantsMaxVisible || wantsReplyLanguage) {
        const { fileStore } = createWorkspaceCollaborationStores();
        const operatingState = await readGroupOperatingState({ fileStore, groupId });
        if (operatingState) {
          const prev = operatingState.collaborationPolicy ?? {
            humanStartsNewRound: true,
            mentionBotMustRespond: false,
            mentionHumanNotifiesOnly: true,
            openDiscussionWithoutMention: false,
            maxVisibleBotRepliesPerRound: 5,
            replyLanguage: "zh",
            botMaySelfAdvanceWithoutHuman: false,
            entersWaitingForHumanAfterVisibleTurnsExhausted: true,
          };
          const maxVisible = wantsMaxVisible
            ? Math.max(1, Math.min(50, Math.round(input.maxVisibleBotRepliesPerRound as number)))
            : prev.maxVisibleBotRepliesPerRound;
          await writeGroupOperatingState({
            fileStore,
            groupId,
            state: {
              ...operatingState,
              collaborationPolicy: {
                ...prev,
                ...(wantsOpenDiscussion
                  ? { openDiscussionWithoutMention: input.openDiscussionWithoutMention as boolean }
                  : {}),
                ...(wantsReplyLanguage ? { replyLanguage } : {}),
                maxVisibleBotRepliesPerRound: maxVisible,
              },
            },
          });
        }
      }
      respond(true, { ok: true, groupId }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, error instanceof Error ? error.message : String(error)),
      );
    }
  },
};
