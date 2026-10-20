import type {
  BuildGroupCharterInput,
  GroupCharterDocument,
  GroupLifecycleStatus,
} from "./group-charter-types.js";
import { DEFAULT_GROUP_PROMOTION_POLICY } from "./promotion-policy.js";
import {
  createGroupFileStore,
  createWorkspaceCollaborationStores,
  normalizeStringList,
  normalizeValue,
  readGroupOperatingState,
} from "./shared.js";

export const GROUP_CHARTER_FILENAME = "governance/group-charter.json";

const DEFAULT_LOW_QUALITY_BEHAVIORS = [
  "抢答或连续占用发言位",
  "无依据附和他人观点",
  "重复已说过的内容",
  "偏离当前使命或讨论范围",
  "社交寒暄替代实质贡献",
];

const DEFAULT_COORDINATOR_RESPONSIBILITIES = [
  "组织讨论顺序与议题聚焦",
  "归纳要点并收口结论",
  "分派后续任务与跟进",
  "在需要时请求人类决策",
];

const OPERATING_PHASES: GroupCharterDocument["operatingPhases"] = [
  "explore",
  "debate",
  "decide",
  "deliver",
  "review",
];

export function normalizeGroupLifecycleStatus(value: unknown): GroupLifecycleStatus {
  const normalized = normalizeValue(typeof value === "string" ? value : undefined)?.toLowerCase();
  if (normalized === "frozen") {
    return "FROZEN";
  }
  if (normalized === "archived") {
    return "ARCHIVED";
  }
  return "ACTIVE";
}

export function buildParticipationCharterPolicy(params: {
  purpose?: string | null;
  currentMission?: string | null;
  collaborationPolicy: BuildGroupCharterInput["operatingState"]["collaborationPolicy"];
}): GroupCharterDocument["participationPolicy"] {
  const purpose = normalizeValue(params.purpose);
  const mission = normalizeValue(params.currentMission);
  const whyHere = normalizeStringList([
    purpose ? `小组定位：${purpose}` : "",
    mission ? `当前使命：${mission}` : "",
    "每位成员在此是为了推进共享使命，而非展示个人存在感。",
  ]).join(" ");

  const whenToSpeak = normalizeStringList([
    "被 @ 时必须考虑回应；无增量返回 NO_REPLY。",
    params.collaborationPolicy.mentionBotMustRespond ? "本群要求被点名给出可见回复。" : "",
    params.collaborationPolicy.openDiscussionWithoutMention
      ? "开放讨论轮次中，仅在能提供新信息、质疑或补全时可发言。"
      : "非 @ 场景下，仅在轮到你或被协调者点名时发言。",
    params.collaborationPolicy.humanStartsNewRound
      ? "新议题通常由人类发起；bot 不应自行开新回合。"
      : "",
    "当前阶段任务已完成或需要收口时，应简短总结而非继续展开。",
  ]);

  return {
    whyHere,
    whenToSpeak,
    lowQualityBehaviors: DEFAULT_LOW_QUALITY_BEHAVIORS,
  };
}

export function buildCoordinatorCharterPolicy(params: {
  coordinatorBotId?: string | null;
}): GroupCharterDocument["coordinatorPolicy"] {
  return {
    coordinatorBotId: normalizeValue(params.coordinatorBotId) ?? null,
    responsibilities: DEFAULT_COORDINATOR_RESPONSIBILITIES,
    mustNotMonopolizeSpeech: true,
  };
}

export function buildGroupCharterDocument(params: BuildGroupCharterInput): GroupCharterDocument {
  const displayName =
    normalizeValue(params.profile?.displayName) ??
    normalizeValue(params.profile?.groupCode) ??
    params.groupId;
  const purpose = normalizeValue(params.profile?.purpose);
  const currentMission =
    normalizeValue(params.profile?.currentMission) ??
    normalizeValue(params.operatingState.activeContext.currentMission);
  const lifecycleStatus = normalizeGroupLifecycleStatus(
    params.profile?.lifecycleStatus ?? params.operatingState.groupProfile.lifecycleStatus,
  );

  return {
    groupId: params.groupId,
    lifecycleStatus,
    displayName,
    purpose,
    currentMission,
    operatingPhases: OPERATING_PHASES,
    participationPolicy: buildParticipationCharterPolicy({
      purpose,
      currentMission,
      collaborationPolicy: params.operatingState.collaborationPolicy,
    }),
    coordinatorPolicy: buildCoordinatorCharterPolicy({
      coordinatorBotId: params.operatingState.governance.coordinatorBotId,
    }),
    promotionPolicy: {
      ...DEFAULT_GROUP_PROMOTION_POLICY,
      ...params.existing?.promotionPolicy,
    },
    collaborationPolicySnapshot: params.operatingState.collaborationPolicy,
    updatedAtMs: Date.now(),
    metadata: {
      origin: "group_charter_sync",
      charterVersion: (params.existing?.metadata?.charterVersion ?? 0) + 1,
    },
  };
}

export async function readGroupCharter(params: {
  fileStore: ReturnType<typeof createGroupFileStore>;
  groupId: string;
}): Promise<GroupCharterDocument | null> {
  return await params.fileStore.readGroupFile<GroupCharterDocument>({
    groupId: params.groupId,
    filename: GROUP_CHARTER_FILENAME,
  });
}

export async function writeGroupCharter(params: {
  fileStore: ReturnType<typeof createGroupFileStore>;
  groupId: string;
  charter: GroupCharterDocument;
}): Promise<void> {
  await params.fileStore.writeGroupFile({
    groupId: params.groupId,
    filename: GROUP_CHARTER_FILENAME,
    data: params.charter,
  });
}

function charterChanged(
  previous: GroupCharterDocument | null,
  next: GroupCharterDocument,
): boolean {
  if (!previous) {
    return true;
  }
  return (
    previous.lifecycleStatus !== next.lifecycleStatus ||
    previous.displayName !== next.displayName ||
    previous.purpose !== next.purpose ||
    previous.currentMission !== next.currentMission ||
    JSON.stringify(previous.participationPolicy) !== JSON.stringify(next.participationPolicy) ||
    JSON.stringify(previous.coordinatorPolicy) !== JSON.stringify(next.coordinatorPolicy) ||
    JSON.stringify(previous.promotionPolicy) !== JSON.stringify(next.promotionPolicy) ||
    JSON.stringify(previous.collaborationPolicySnapshot) !==
      JSON.stringify(next.collaborationPolicySnapshot)
  );
}

export async function syncGroupCharter(params: {
  fileStore: ReturnType<typeof createGroupFileStore>;
  groupStorage: ReturnType<typeof createWorkspaceCollaborationStores>["groupStorage"];
  groupId: string;
  operatingState: BuildGroupCharterInput["operatingState"];
}): Promise<{ charter: GroupCharterDocument; changed: boolean }> {
  const [profile, members, existing] = await Promise.all([
    params.groupStorage.readProfile(params.groupId),
    params.groupStorage.readMembers(params.groupId),
    readGroupCharter({ fileStore: params.fileStore, groupId: params.groupId }),
  ]);
  const charter = buildGroupCharterDocument({
    groupId: params.groupId,
    profile,
    members,
    operatingState: params.operatingState,
    existing,
  });
  if (charterChanged(existing, charter)) {
    await writeGroupCharter({
      fileStore: params.fileStore,
      groupId: params.groupId,
      charter,
    });
    return { charter, changed: true };
  }
  return { charter, changed: false };
}

export async function loadGroupCharterForRuntime(
  groupId: string,
): Promise<GroupCharterDocument | null> {
  const { fileStore } = createWorkspaceCollaborationStores();
  const charter = await readGroupCharter({ fileStore, groupId });
  if (charter) {
    return charter;
  }
  const operatingState = await readGroupOperatingState({ fileStore, groupId });
  if (!operatingState) {
    return null;
  }
  const { groupStorage } = createWorkspaceCollaborationStores();
  const [profile, members] = await Promise.all([
    groupStorage.readProfile(groupId),
    groupStorage.readMembers(groupId),
  ]);
  return buildGroupCharterDocument({
    groupId,
    profile,
    members,
    operatingState,
    existing: null,
  });
}

export function buildGroupCharterSystemPrompt(
  charter: GroupCharterDocument | null,
): string | undefined {
  if (!charter || charter.lifecycleStatus === "ARCHIVED") {
    return undefined;
  }
  const lines = [
    "Collaboration group charter:",
    `- Lifecycle: ${charter.lifecycleStatus}`,
    `- Group: ${charter.displayName}`,
    charter.purpose ? `- Purpose: ${charter.purpose}` : undefined,
    charter.currentMission ? `- Current mission: ${charter.currentMission}` : undefined,
    `- Participation — why here: ${charter.participationPolicy.whyHere}`,
    charter.participationPolicy.whenToSpeak.length > 0
      ? `- When to speak: ${charter.participationPolicy.whenToSpeak.join(" ")}`
      : undefined,
    charter.participationPolicy.lowQualityBehaviors.length > 0
      ? `- Avoid: ${charter.participationPolicy.lowQualityBehaviors.join("; ")}`
      : undefined,
  ];
  if (charter.coordinatorPolicy.coordinatorBotId) {
    lines.push(`- Coordinator bot: ${charter.coordinatorPolicy.coordinatorBotId}`);
    lines.push(`- Coordinator duties: ${charter.coordinatorPolicy.responsibilities.join("; ")}`);
    if (charter.coordinatorPolicy.mustNotMonopolizeSpeech) {
      lines.push("- Coordinator must organize and summarize; do not monopolize every reply slot.");
    }
  }
  if (charter.promotionPolicy.dissentEncouraged) {
    lines.push("- Dissent is encouraged when evidence supports a different conclusion.");
  }
  if (charter.lifecycleStatus === "FROZEN") {
    lines.push(
      "- Group is FROZEN: do not start new work; only respond to explicit human requests.",
    );
  }
  return lines.filter(Boolean).join("\n");
}

export function buildOperatingPhaseSystemPrompt(
  operatingState: BuildGroupCharterInput["operatingState"] | null,
): string | undefined {
  if (!operatingState) {
    return undefined;
  }
  const phase = operatingState.activeContext.currentOperatingPhase;
  const phaseGuidance: Record<string, string> = {
    explore: "Explore options and gather context before committing.",
    debate: "Debate trade-offs; challenge assumptions with evidence.",
    decide: "Converge on a decision; surface options and a recommended choice.",
    deliver: "Produce the agreed deliverable; stay execution-focused.",
    review: "Review outcomes against success criteria; note gaps and follow-ups.",
  };
  const lines = [
    "Collaboration operating phase:",
    `- Current phase: ${phase}`,
    `- Guidance: ${phaseGuidance[phase] ?? "Follow group charter and mission."}`,
    operatingState.activeContext.summary
      ? `- Active context: ${operatingState.activeContext.summary}`
      : undefined,
    operatingState.activeContext.waitingForHuman
      ? "- Waiting for human input before advancing."
      : undefined,
  ];
  return lines.filter(Boolean).join("\n");
}
