import {
  isCollaborationGroupRuntimeSession,
  resolveCollaborationGroupIdForRun,
} from "../../agent-runtime/command/index.js";
export {
  shouldUseCollaborationRuntimeAssembly,
  isCollaborationGroupRuntimeSession,
  resolveCollaborationGroupIdForRun,
} from "../../agent-runtime/command/index.js";
import {
  assembleCollaborationMember,
  renderCollaborationMission,
} from "../../agent-runtime/context/index.js";
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
  return renderCollaborationMission(resolvedProfile ?? sessionEntry?.collaborationGroupProfile);
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
  // Current-turn work must never pick a claimant's unrelated persisted step.
  // Keep the original durable guard for actual long-task and internal wake turns.
  const deliveryTurn =
    groupId &&
    params.sessionCtx.CollaborationExecutionLifecycle !== "turn" &&
    (params.sessionCtx.CollaborationExecutionLifecycle !== "long_task" ||
      Boolean(params.sessionCtx.CollaborationExecutionTaskId))
      ? await resolveDeliveryExecTurn({
          cfg: params.cfg,
          groupId,
          agentId: deliveryAgentId,
          tenantId: params.sessionCtx.CollaborationTenantId,
          taskId: params.sessionCtx.CollaborationExecutionTaskId,
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

  return assembleCollaborationMember({
    operationalIdentity: operationalIdentityPrompt,
    charter: groupCharterPrompt,
    mission: groupMissionPrompt,
    delivery: deliveryExecPrompt,
    phase: operatingPhasePrompt,
    groupContext: groupChatContext,
    groupIntro,
    continuity: sessionContinuityPrompt,
    capabilities: collaborationCapabilityPrompt,
    groupSystemPrompt,
    inboundMetadata: inboundMetaPrompt,
  });
}
