import type { OpenBotConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import {
  buildGroupCharterSystemPrompt,
  buildOperatingPhaseSystemPrompt,
  loadGroupCharterForRuntime,
} from "../../gateway/collaboration-learning/group-charter.js";
import {
  createWorkspaceCollaborationStores,
  readGroupOperatingState,
} from "../../gateway/collaboration-learning/shared.js";
import { resolveSecurityProfile } from "../../gateway/security-profile.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";
import { resolveTrustedGroupLocator } from "../../gateway/workspace/group-locator.js";
import type { TemplateContext } from "../templating.js";
import { buildCollaborationCapabilitySystemPrompt } from "./collaboration-capability-context.js";
import { buildActiveContextSystemPrompt } from "./context-budget-assembler.js";
import { buildGroupChatContext, buildGroupIntro } from "./groups.js";
import { buildInboundMetaSystemPrompt } from "./inbound-meta.js";
import { buildOperationalIdentitySystemPrompt } from "./operational-identity-context.js";

/**
 * Group discussion turns set CollaborationRoundInvoked even when the per-bot
 * session entry omits space/groupId. Those turns still use collaboration assembly.
 */
export function shouldUseCollaborationRuntimeAssembly(params: {
  collaborationGroupId?: string | null;
  sessionEntry?: SessionEntry;
  collaborationRoundInvoked?: boolean;
}): boolean {
  const groupId = params.collaborationGroupId?.trim();
  if (params.collaborationRoundInvoked && groupId) {
    return true;
  }
  return isCollaborationGroupRuntimeSession({
    groupId,
    sessionEntry: params.sessionEntry,
  });
}

export function isCollaborationGroupRuntimeSession(params: {
  groupId?: string | null;
  sessionEntry?: SessionEntry;
}): boolean {
  const groupId = params.groupId?.trim();
  if (!groupId) {
    return false;
  }
  if (params.sessionEntry?.collaborationGroupProfile?.groupId?.trim() === groupId) {
    return true;
  }
  return (
    params.sessionEntry?.groupId?.trim() === groupId ||
    params.sessionEntry?.space?.trim() === groupId
  );
}

/** Prefer explicit CollaborationGroupId from the turn context over session-key heuristics. */
export function resolveCollaborationGroupIdForRun(params: {
  collaborationGroupId?: string | null;
  groupSessionId?: string | null;
  sessionEntry?: SessionEntry;
}): string | undefined {
  const explicit = params.collaborationGroupId?.trim();
  if (explicit) {
    return explicit;
  }
  const fromGroupKey = params.groupSessionId?.trim();
  if (fromGroupKey) {
    return fromGroupKey;
  }
  return (
    params.sessionEntry?.collaborationGroupProfile?.groupId?.trim() ||
    params.sessionEntry?.groupId?.trim() ||
    params.sessionEntry?.space?.trim() ||
    undefined
  );
}

export function resolveCollaborationRunWorkspaceDir(params: {
  cfg: OpenBotConfig;
  agentWorkspaceDir: string;
  groupId?: string | null;
  sessionEntry?: SessionEntry;
  /** Authoritative tenant id when known (preferred for managed group cwd). */
  tenantId?: string | null;
}): string {
  const explicitGroupId = params.groupId?.trim() || undefined;
  const groupId =
    explicitGroupId ||
    params.sessionEntry?.collaborationGroupProfile?.groupId?.trim() ||
    params.sessionEntry?.groupId?.trim() ||
    params.sessionEntry?.space?.trim() ||
    undefined;
  if (!groupId) {
    return params.agentWorkspaceDir;
  }
  // Explicit CollaborationGroupId is enough. Per-bot session entries on group turns
  // often omit space/groupId even though the turn is a collaboration round.
  if (
    !explicitGroupId &&
    !isCollaborationGroupRuntimeSession({ groupId, sessionEntry: params.sessionEntry })
  ) {
    return params.agentWorkspaceDir;
  }

  const profile = resolveSecurityProfile(params.cfg, process.env);
  const personalLocator = () =>
    resolveTrustedGroupLocator({
      groupId,
      tenantId: null,
      profile: "personal_local",
      cfg: params.cfg,
    });

  if (profile.profile === "managed_enterprise") {
    const tenantId = params.tenantId?.trim();
    // Align with group-file.read: managed enterprise requires trusted tenant.
    // Never fall back to personalLocator or the agent operators workspace — that
    // would make a group-scoped turn look like a personal-task success while
    // preview (tenant-scoped) refuses the same path.
    if (!tenantId) {
      throw new Error(`trusted tenant context required for collaboration group ${groupId}`);
    }
    // PR A: group formal root is the trusted managed locator even before mkdir.
    return resolveTrustedGroupLocator({
      groupId,
      tenantId,
      profile: "managed_enterprise",
      cfg: params.cfg,
    });
  }

  return personalLocator();
}

export function buildCollaborationGroupMissionPrompt(
  sessionEntry?: SessionEntry,
  resolvedProfile?: SessionEntry["collaborationGroupProfile"],
): string | undefined {
  const profile = resolvedProfile ?? sessionEntry?.collaborationGroupProfile;
  if (!profile) {
    return undefined;
  }
  const lines = ["Collaboration group context:"];
  if (profile.displayName?.trim()) {
    lines.push(`- Group: ${profile.displayName.trim()}`);
  }
  if (profile.purpose?.trim()) {
    lines.push(`- Purpose: ${profile.purpose.trim()}`);
  }
  if (profile.currentMission?.trim()) {
    lines.push(`- Current mission: ${profile.currentMission.trim()}`);
  }
  if (profile.collaborationMode?.trim()) {
    lines.push(`- Collaboration mode: ${profile.collaborationMode.trim()}`);
  }
  const criteria = (profile.successCriteria ?? []).map((entry) => entry.trim()).filter(Boolean);
  if (criteria.length > 0) {
    lines.push(`- Success criteria: ${criteria.join("; ")}`);
  }
  const instructions = (profile.systemInstructions ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (instructions.length > 0) {
    lines.push(`- Group instructions: ${instructions.join(" | ")}`);
  }
  return lines.length > 1 ? lines.join("\n") : undefined;
}

export type CollaborationRuntimeContextAssemblyParams = {
  cfg: OpenBotConfig;
  workspaceDir: string;
  /** Agent workspace that owns `.openbot/collaboration/groups` learning assets. */
  agentWorkspaceDir?: string;
  agentId: string;
  sessionKey?: string;
  sessionEntry?: SessionEntry;
  sessionCtx: TemplateContext;
  isNewSession: boolean;
  shouldInjectGroupIntro: boolean;
  defaultActivation: Parameters<typeof buildGroupIntro>[0]["defaultActivation"];
  silentToken: string;
  organizationContext?: Parameters<typeof buildGroupChatContext>[0]["organizationContext"];
  groupSystemPrompt?: string;
  inboundMessage?: string;
  isHeartbeat?: boolean;
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientPlatformUserId?: string;
};

/**
 * Frozen collaboration group context assembly order (Phase 2).
 * Implemented in existing reply modules — not a parallel orchestration layer.
 */
export async function assembleCollaborationRuntimeContextParts(
  params: CollaborationRuntimeContextAssemblyParams,
): Promise<string[]> {
  const groupId = resolveCollaborationGroupIdForRun({
    collaborationGroupId: params.sessionCtx.CollaborationGroupId,
    sessionEntry: params.sessionEntry,
  });
  const { resolveCollaborationGroupProfileForRuntime } =
    await import("../../gateway/collaboration-learning/group-runtime-profile.js");
  const resolvedGroupProfile = groupId
    ? await resolveCollaborationGroupProfileForRuntime({
        groupId,
        sessionProfile: params.sessionEntry?.collaborationGroupProfile,
      })
    : undefined;

  const [
    operatingState,
    groupCharter,
    operationalIdentityPrompt,
    collaborationCapabilityPrompt,
    sessionContinuityPrompt,
  ] = await Promise.all([
    groupId
      ? readGroupOperatingState({
          fileStore: createWorkspaceCollaborationStores(params.cfg).fileStore,
          groupId,
        })
      : Promise.resolve(null),
    groupId ? loadGroupCharterForRuntime(groupId) : Promise.resolve(null),
    params.inboundMessage && !params.isHeartbeat
      ? buildOperationalIdentitySystemPrompt({
          agentId: params.agentId,
          sessionKey: params.sessionKey ?? "",
          inboundMessage: params.inboundMessage,
          gatewayClientUser: params.gatewayClientUser,
          gatewayClientSessionDomain: params.gatewayClientSessionDomain,
          gatewayClientPlatformUserId: params.gatewayClientPlatformUserId,
        })
      : Promise.resolve(undefined),
    buildCollaborationCapabilitySystemPrompt({
      sessionEntry: params.sessionEntry,
      groupId,
      botId: params.sessionCtx.CollaborationBotAgentId ?? params.agentId,
      workspaceDir: params.agentWorkspaceDir ?? params.workspaceDir,
      cfg: params.cfg,
      groupProfile: resolvedGroupProfile,
    }),
    buildActiveContextSystemPrompt({
      cfg: params.cfg,
      workspaceDir: params.workspaceDir,
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      sessionEntry: params.sessionEntry,
      isNewSession: params.isNewSession,
    }),
  ]);

  const groupCharterPrompt = buildGroupCharterSystemPrompt(groupCharter);
  const operatingPhasePrompt = buildOperatingPhaseSystemPrompt(operatingState);

  const groupChatContext = buildGroupChatContext({
    sessionCtx: params.sessionCtx,
    organizationContext: params.organizationContext,
  });
  const groupIntro = params.shouldInjectGroupIntro
    ? buildGroupIntro({
        cfg: params.cfg,
        sessionCtx: params.sessionCtx,
        sessionEntry: params.sessionEntry,
        defaultActivation: params.defaultActivation,
        silentToken: params.silentToken,
      })
    : "";
  const groupMissionPrompt = buildCollaborationGroupMissionPrompt(
    params.sessionEntry,
    resolvedGroupProfile,
  );
  const deliveryAgentId =
    params.sessionCtx.CollaborationBotAgentId?.trim() || params.agentId.trim();
  const { resolveDeliveryExecTurn } =
    await import("../../gateway/collaboration-dispatch/delivery-exec-prompt.js");
  const deliveryTurn = groupId
    ? await resolveDeliveryExecTurn({
        cfg: params.cfg,
        groupId,
        agentId: deliveryAgentId,
        tenantId: params.sessionCtx.CollaborationTenantId,
      })
    : undefined;
  if (deliveryTurn?.sideEffect) {
    params.sessionCtx.DeliveryToolSideEffect = deliveryTurn.sideEffect;
  } else {
    delete params.sessionCtx.DeliveryToolSideEffect;
  }
  const deliveryExecPrompt = deliveryTurn?.prompt;
  const groupSystemPrompt = params.groupSystemPrompt?.trim() ?? "";
  const inboundMetaPrompt = buildInboundMetaSystemPrompt(
    params.isNewSession
      ? params.sessionCtx
      : { ...params.sessionCtx, ThreadStarterBody: undefined },
  );

  return [
    operationalIdentityPrompt,
    groupCharterPrompt,
    groupMissionPrompt,
    deliveryExecPrompt,
    operatingPhasePrompt,
    groupChatContext,
    groupIntro,
    sessionContinuityPrompt,
    collaborationCapabilityPrompt,
    groupSystemPrompt,
    inboundMetaPrompt,
  ].filter((entry): entry is string => Boolean(entry?.trim()));
}
