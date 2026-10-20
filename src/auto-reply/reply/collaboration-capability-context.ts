import type { GroupCapabilityProfile } from "@openbot/collaboration-core";
import { buildCapabilityContext } from "@openbot/collaboration-runtime";
import type { OpenBotConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import { resolveCollaborationGroupProfileForRuntime } from "../../gateway/collaboration-learning/group-runtime-profile.js";
import { recordLearningAssetApplicationsForBotSafely } from "../../gateway/collaboration-learning/learning-asset-application-store.js";
import { resolveSessionParticipationOverlay } from "../../gateway/collaboration-learning/session-participation-overlay.js";
import {
  readPromotedCapabilitiesForBot,
  readPromotedLearningInstructionsForBot,
} from "./collaboration-learning-store.js";

function formatCapabilityList(values: string[]): string | undefined {
  if (values.length === 0) {
    return undefined;
  }
  return values.join(", ");
}

export async function buildCollaborationCapabilitySystemPrompt(params: {
  sessionEntry?: SessionEntry;
  groupId?: string;
  /** Current speaking bot — required to pick the correct overlay on shared space sessions. */
  botId?: string | null;
  workspaceDir?: string;
  cfg?: OpenBotConfig;
  groupProfile?: GroupCapabilityProfile;
}): Promise<string | undefined> {
  const sessionEntry = params.sessionEntry;
  const groupId = params.groupId?.trim() || sessionEntry?.groupId?.trim();
  const groupProfile =
    params.groupProfile ??
    (await resolveCollaborationGroupProfileForRuntime({
      groupId,
      sessionProfile: sessionEntry?.collaborationGroupProfile,
    }));

  if (!groupId || !groupProfile) {
    return undefined;
  }

  const resolvedOverlay = resolveSessionParticipationOverlay({
    field: sessionEntry?.collaborationParticipationOverlay,
    botId: params.botId,
  });
  const botId =
    params.botId?.trim() ||
    resolvedOverlay?.botId ||
    resolvedOverlay?.participationId?.split("::").at(1) ||
    "session-bot";
  const promotedCapabilities =
    params.workspaceDir && groupId && botId
      ? await readPromotedCapabilitiesForBot({
          workspaceDir: params.workspaceDir,
          groupId,
          botId,
          cfg: params.cfg,
        })
      : [];
  const promotedLearningInstructions =
    params.workspaceDir && groupId && botId
      ? await readPromotedLearningInstructionsForBot({
          workspaceDir: params.workspaceDir,
          groupId,
          botId,
          cfg: params.cfg,
        })
      : [];
  // B：本 bot 的活跃学习资产在此被"应用"进协作提示词 → fire-and-forget 记一次应用（更强 reuse 信号）。
  if (groupId && botId) {
    void recordLearningAssetApplicationsForBotSafely(groupId, botId);
  }

  const context = await buildCapabilityContext({
    botId,
    groupId,
    personalCapabilities: [
      ...new Set([
        ...(sessionEntry?.collaborationPersonalCapabilities ?? []),
        ...promotedCapabilities,
      ]),
    ],
    groupProfile,
    overlay: resolvedOverlay ?? null,
  });

  const promptLines = [
    "Collaboration capability context",
    `- Group: ${groupId}`,
    context.confidentialityTier ? `- Confidentiality: ${context.confidentialityTier}` : undefined,
    formatCapabilityList(context.capabilitySet.personal)
      ? `- Personal capabilities: ${formatCapabilityList(context.capabilitySet.personal)}`
      : undefined,
    formatCapabilityList(context.capabilitySet.group)
      ? `- Group capabilities: ${formatCapabilityList(context.capabilitySet.group)}`
      : undefined,
    formatCapabilityList(context.capabilitySet.participation)
      ? `- Participation overlay: ${formatCapabilityList(context.capabilitySet.participation)}`
      : undefined,
    formatCapabilityList(context.capabilitySet.final)
      ? `- Effective capabilities: ${formatCapabilityList(context.capabilitySet.final)}`
      : undefined,
    promotedLearningInstructions.length > 0
      ? `- Learned principles (apply in this collaboration):\n${promotedLearningInstructions.map((line) => `  - ${line}`).join("\n")}`
      : undefined,
    context.systemInstructions.length > 0
      ? `- Group instructions: ${context.systemInstructions.join(" | ")}`
      : undefined,
    context.policyFilters.length > 0
      ? `- Capability policy filters: ${context.policyFilters.join(", ")}`
      : undefined,
    "Treat group and participation context as scoped to this collaboration. Do not generalize restricted group knowledge outside this scope unless explicitly promoted.",
  ].filter(Boolean);

  return promptLines.join("\n");
}
