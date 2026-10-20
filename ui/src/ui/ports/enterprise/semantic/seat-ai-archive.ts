/**
 * Seat-bound AI 电子档案只读投影（纯函数）。
 * 规则集中于此；详情页经 buildSeatAiArchiveInput 适配后调用，禁止散落拼装。
 */

export type SeatAiArchivePhase = "vacant_shell" | "pending_activation" | "occupied" | "handover";

export type SeatAiArchiveSectionId =
  | "identity"
  | "digital"
  | "permissions"
  | "skills"
  | "contribution"
  | "timeline";

/** 进行中交接：进入 archive phase=handover */
export const ACTIVE_HANDOVER_STATUSES = [
  "draft",
  "asset_review",
  "pending_approval",
  "frozen",
] as const;

export type ActiveHandoverStatus = (typeof ACTIVE_HANDOVER_STATUSES)[number];

export const SEAT_AI_ARCHIVE_SECTION_WEIGHTS: Record<SeatAiArchiveSectionId, number> = {
  identity: 25,
  digital: 20,
  permissions: 15,
  skills: 15,
  contribution: 15,
  timeline: 10,
};

export const SEAT_AI_ARCHIVE_SECTION_ORDER: SeatAiArchiveSectionId[] = [
  "identity",
  "digital",
  "permissions",
  "skills",
  "contribution",
  "timeline",
];

export const SEAT_AI_ARCHIVE_SECTION_TITLES: Record<SeatAiArchiveSectionId, string> = {
  identity: "身份与入职状态",
  digital: "岗位数字人与运行时",
  permissions: "权限与能力清单",
  skills: "技能与工具图谱",
  contribution: "资产与贡献",
  timeline: "工作与衔接时间线",
};

export type SeatAiArchiveSectionState = {
  filled: boolean;
  weight: number;
  score: number;
  placeholder: string | null;
};

export type SeatAiArchivePermissionItem = {
  title: string;
  detail: string;
  badge: string;
};

export type SeatAiArchiveTimelineEvent = {
  id: string;
  label: string;
  at: string | null;
  source: "assignment" | "activation" | "bot" | "offer" | "handover" | "identity" | "usage";
};

export type SeatAiArchiveContributionBreakdown = {
  agentCount: number;
  spaceCount: number;
  memoryScopeCount: number;
  identityBindingCount: number;
  meshSessionCount: number;
  /** 可继承资产合计（启发式 + 身份绑定） */
  total: number;
};

export type SeatAiArchiveInput = {
  seatId: string;
  name: string;
  teamLabel: string;
  responsibility: string | null;
  status: string;
  seatStatus: string;
  memberUserId: string | null;
  memberDisplayLabel: string | null;
  /** 明确的成员/待激活邮箱；不得用 userId 冒充 */
  memberEmail: string | null;
  pendingEmployeeUser: string | null;
  pendingEmployeeDisplayName: string | null;
  pendingActivationExpiresAt: string | null;
  roleCode: string | null;
  aiEmployeeLabel: string;
  defaultAgentId: string | null;
  agentIds: string[];
  defaultSpaceIds: string[];
  memoryScopeIds: string[];
  botCount: number;
  groupCount: number;
  totalCost: number | null;
  totalTokens: number | null;
  sessionCount: number | null;
  runtimeLabel?: string | null;
  activityLabel?: string | null;
  lastActiveAt?: number | null;
  /** 尚无可靠日均工时源；保持 null */
  avgDailyHours?: number | null;
  offerTargetEmail?: string | null;
  offerOfferedAt?: string | null;
  offerExpiresAt?: string | null;
  handoverStatus?: string | null;
  handoverCreatedAt?: string | null;
  handoverCompletedAt?: string | null;
  botBoundAt?: string | null;
  permissionIdentities?: SeatAiArchivePermissionItem[];
  knownSkills?: string[];
  identityBindingCount?: number;
  meshSessionCount?: number;
  identityTimelineEvents?: SeatAiArchiveTimelineEvent[];
};

export type SeatAiArchiveReadModel = {
  seatId: string;
  phase: SeatAiArchivePhase;
  phaseLabel: string;
  completeness: number;
  sections: Record<SeatAiArchiveSectionId, SeatAiArchiveSectionState>;
  identity: {
    name: string;
    teamLabel: string;
    responsibility: string | null;
    memberLabel: string;
    email: string | null;
    emailDisplay: string;
    organizationStatus: string;
    seatStatus: string;
    pendingActivationExpiresAt: string | null;
    canSendActivation: boolean;
    needsEmail: boolean;
  };
  digital: {
    aiEmployeeLabel: string;
    roleCode: string | null;
    defaultAgentId: string | null;
    agentIds: string[];
    botCount: number;
    groupCount: number;
    totalCost: number | null;
    totalTokens: number | null;
    sessionCount: number | null;
    runtimeLabel: string | null;
    /** Shown when monthly usage waits on member binding. */
    usagePendingMember?: boolean;
    /** Optional attribution hint when usage is agent-scoped vs employee-scoped. */
    usageAttributionNote?: string | null;
  };
  permissions: {
    identities: SeatAiArchivePermissionItem[];
  };
  skills: {
    items: string[];
    placeholder: string;
  };
  contribution: {
    heuristicAssetCount: number;
    breakdown: SeatAiArchiveContributionBreakdown;
    placeholder: string | null;
  };
  timeline: {
    events: SeatAiArchiveTimelineEvent[];
    activityLabel: string | null;
    lastActiveAt: number | null;
    avgDailyHours: number | null;
  };
};

/** 详情行 / seatSummaries 聚合所需最小字段（由调用方从列表行 + readModel 填齐）。 */
export type SeatAiArchiveSourceRow = {
  seatId: string;
  name: string;
  teamLabel: string;
  responsibility: string | null;
  status: string;
  seatStatus: string;
  memberUserId: string | null;
  memberDisplayLabel: string | null;
  memberLabel?: string | null;
  pendingEmployeeUser?: string | null;
  pendingEmployeeDisplayName?: string | null;
  pendingActivationExpiresAt?: string | null;
  roleCode?: string | null;
  aiEmployeeLabel: string;
  defaultAgentId: string | null;
  agentIds: string[];
  defaultSpaceIds: string[];
  memoryScopeIds: string[];
  botCount: number;
  groupCount: number;
  totalCost: number | null;
  totalTokens?: number | null;
  sessionCount?: number | null;
  runtimeLabel?: string | null;
  activityLabel?: string | null;
  lastActiveAt?: number | null;
  offer?: {
    targetEmployeeUser?: string | null;
    offeredAt?: string | null;
    expiresAt?: string | null;
  } | null;
  handover?: {
    status?: string | null;
    createdAt?: string | null;
    completedAt?: string | null;
  } | null;
};

export type SeatAiArchiveReadModelSource = {
  seatSummaries: Array<{
    seatId: string;
    pendingEmployeeUser?: string | null;
    pendingEmployeeDisplayName?: string | null;
    pendingActivationExpiresAt?: string | null;
    roleCode?: string | null;
    currentEmployeeUser?: string | null;
  }>;
  seatOperationalIdentityAccess: Array<{
    seatId: string;
    identities: Array<{
      displayName: string;
      providerLabel: string;
      agentIds: string[];
      allowedActions: string[];
      status: string;
    }>;
  }>;
  memberSummaries?: Array<{
    user: string;
    displayLabel?: string | null;
  }>;
  meshAgents?: Array<{
    agentId: string;
    sessionCount: number;
    lastActiveAt: number | null;
    ownership?: { positionId?: string | null; createdAt?: string | null } | null;
  }>;
  employeeIdentityBindingRows?: Array<{
    seatId: string | null;
    updatedAt?: string | null;
  }>;
  recentIdentityBindingActivity?: Array<{
    auditEventId: string;
    kind: "bound" | "unbound";
    identityDisplayName: string;
    agentLabel: string;
    /** 仅 seatId 可靠时投影；禁止用岗位名关联 */
    seatId?: string | null;
    seatTitle?: string | null;
    createdAt: string;
  }>;
  /** 由详情页经 robot-capability.list 聚合后注入 */
  knownSkillsBySeatId?: ReadonlyMap<string, readonly string[]> | null;
};

export function isLikelyEmail(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return false;
  }
  // 轻量启发式：含 @ 且本地/域均非空；不替代服务端校验。
  const at = trimmed.indexOf("@");
  return at > 0 && at < trimmed.length - 1 && !trimmed.includes(" ");
}

export function isActiveHandoverStatus(status: string | null | undefined): boolean {
  const normalized = status?.trim() ?? "";
  return (ACTIVE_HANDOVER_STATUSES as readonly string[]).includes(normalized);
}

export function seatAiArchivePhaseLabel(phase: SeatAiArchivePhase): string {
  switch (phase) {
    case "vacant_shell":
      return "空岗壳";
    case "pending_activation":
      return "待激活";
    case "occupied":
      return "在岗";
    case "handover":
      return "交接中";
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

export function resolveSeatAiArchivePhase(input: {
  status: string;
  seatStatus: string;
  pendingEmployeeUser: string | null;
  handoverStatus?: string | null;
}): SeatAiArchivePhase {
  if (isActiveHandoverStatus(input.handoverStatus)) {
    return "handover";
  }
  // rebound / completed：不进入 handover phase；继续按 seat 主线态推导
  const terminalHandover =
    input.handoverStatus === "rebound" || input.handoverStatus === "completed";
  if (!terminalHandover && input.status === "HANDOVER") {
    // 列表仅有 HANDOVER 标签、无细粒度 status 时，保守视为进行中
    return "handover";
  }
  if (
    input.pendingEmployeeUser?.trim() ||
    input.seatStatus === "assigned" ||
    input.status === "PENDING_ACTIVATION"
  ) {
    return "pending_activation";
  }
  if (input.seatStatus === "vacant" || input.status === "VACANT") {
    return "vacant_shell";
  }
  return "occupied";
}

function resolveEmailDisplay(email: string | null): string {
  return email?.trim() ? email.trim() : "未提供";
}

function resolveKnownSkillsForSeat(
  seatId: string,
  knownSkillsBySeatId: SeatAiArchiveReadModelSource["knownSkillsBySeatId"],
): string[] {
  if (!knownSkillsBySeatId) {
    return [];
  }
  return [...(knownSkillsBySeatId.get(seatId) ?? [])];
}

function timelineAtMs(at: string | null | undefined): number {
  if (!at?.trim()) {
    return Number.NEGATIVE_INFINITY;
  }
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

function sortTimelineEvents(events: SeatAiArchiveTimelineEvent[]): SeatAiArchiveTimelineEvent[] {
  return [...events].toSorted((left, right) => timelineAtMs(right.at) - timelineAtMs(left.at));
}

function buildContributionBreakdown(input: SeatAiArchiveInput): SeatAiArchiveContributionBreakdown {
  const agentCount =
    input.agentIds.length +
    (input.defaultAgentId && !input.agentIds.includes(input.defaultAgentId) ? 1 : 0);
  const spaceCount = input.defaultSpaceIds.length;
  const memoryScopeCount = input.memoryScopeIds.length;
  const identityBindingCount = Math.max(0, input.identityBindingCount ?? 0);
  const meshSessionCount = Math.max(0, input.meshSessionCount ?? 0);
  return {
    agentCount,
    spaceCount,
    memoryScopeCount,
    identityBindingCount,
    meshSessionCount,
    total: agentCount + spaceCount + memoryScopeCount + identityBindingCount,
  };
}

function buildTimelineEvents(input: SeatAiArchiveInput): SeatAiArchiveTimelineEvent[] {
  const events: SeatAiArchiveTimelineEvent[] = [];
  if (input.pendingEmployeeUser?.trim()) {
    events.push({
      id: "assignment_pending",
      label: `已任命待激活：${input.pendingEmployeeDisplayName ?? input.pendingEmployeeUser}`,
      at: input.pendingActivationExpiresAt,
      source: "assignment",
    });
  }
  if (input.memberUserId?.trim() && input.seatStatus === "occupied") {
    events.push({
      id: "activated",
      label: `成员已激活：${input.memberDisplayLabel ?? input.memberUserId}`,
      at: null,
      source: "activation",
    });
  }
  if (input.agentIds.length > 0 || input.defaultAgentId) {
    events.push({
      id: "bots_bound",
      label: `已关联 ${input.botCount || input.agentIds.length} 个 Bot`,
      at: input.botBoundAt ?? null,
      source: "bot",
    });
  }
  if (input.offerTargetEmail?.trim()) {
    events.push({
      id: "offer_pending",
      label: `岗位绑定待确认：${input.offerTargetEmail}`,
      at: input.offerOfferedAt ?? input.offerExpiresAt ?? null,
      source: "offer",
    });
  }
  if (isActiveHandoverStatus(input.handoverStatus)) {
    events.push({
      id: "handover_active",
      label: `岗位交接中（${input.handoverStatus}）`,
      at: input.handoverCreatedAt ?? null,
      source: "handover",
    });
  } else if (input.handoverStatus === "rebound" || input.handoverStatus === "completed") {
    events.push({
      id: "handover_history",
      label: input.handoverStatus === "rebound" ? "继任绑定已完成（rebound）" : "岗位交接已完成",
      at: input.handoverCompletedAt ?? input.handoverCreatedAt ?? null,
      source: "handover",
    });
  }
  if (input.lastActiveAt != null && Number.isFinite(input.lastActiveAt)) {
    events.push({
      id: "usage_last_active",
      label: "最近岗位活跃",
      at: new Date(input.lastActiveAt).toISOString(),
      source: "usage",
    });
  }
  for (const identityEvent of input.identityTimelineEvents ?? []) {
    events.push(identityEvent);
  }
  return sortTimelineEvents(events);
}

/**
 * 从详情行 + 企业 read model 汇总档案输入（唯一适配入口）。
 */
export function buildSeatAiArchiveInput(
  row: SeatAiArchiveSourceRow,
  readModel: SeatAiArchiveReadModelSource,
): SeatAiArchiveInput {
  const seatSummary = readModel.seatSummaries.find((seat) => seat.seatId === row.seatId);
  const pendingEmployeeUser =
    row.pendingEmployeeUser?.trim() || seatSummary?.pendingEmployeeUser?.trim() || null;
  const pendingEmployeeDisplayName =
    row.pendingEmployeeDisplayName?.trim() ||
    seatSummary?.pendingEmployeeDisplayName?.trim() ||
    null;
  const pendingActivationExpiresAt =
    row.pendingActivationExpiresAt?.trim() ||
    seatSummary?.pendingActivationExpiresAt?.trim() ||
    null;
  const roleCode = row.roleCode?.trim() || seatSummary?.roleCode?.trim() || null;
  const offerEmail = row.offer?.targetEmployeeUser?.trim() || null;

  const candidateEmails = [pendingEmployeeUser, offerEmail, seatSummary?.currentEmployeeUser];
  let memberEmail: string | null = null;
  for (const candidate of candidateEmails) {
    if (isLikelyEmail(candidate)) {
      memberEmail = candidate!.trim();
      break;
    }
  }
  // occupied 成员 user 仅当像邮箱时才写入 memberEmail
  if (!memberEmail && isLikelyEmail(row.memberUserId)) {
    memberEmail = row.memberUserId!.trim();
  }

  const seatAccess = readModel.seatOperationalIdentityAccess.find(
    (entry) => entry.seatId === row.seatId,
  );

  const seatAgentIds = new Set(
    [...row.agentIds, row.defaultAgentId].filter((id): id is string => Boolean(id?.trim())),
  );
  const seatMeshAgents = (readModel.meshAgents ?? []).filter((agent) => {
    if (seatAgentIds.has(agent.agentId)) {
      return true;
    }
    return agent.ownership?.positionId === row.seatId;
  });
  const meshSessionCount = seatMeshAgents.reduce(
    (sum, agent) => sum + (agent.sessionCount || 0),
    0,
  );
  const botBoundAt =
    seatMeshAgents
      .map((agent) => agent.ownership?.createdAt?.trim() || null)
      .filter((value): value is string => Boolean(value))
      .toSorted((left, right) => timelineAtMs(left) - timelineAtMs(right))[0] ?? null;
  const meshLastActiveAt = seatMeshAgents.reduce<number | null>((latest, agent) => {
    if (agent.lastActiveAt == null) {
      return latest;
    }
    return Math.max(latest ?? 0, agent.lastActiveAt);
  }, null);

  const identityBindingCount = (readModel.employeeIdentityBindingRows ?? []).filter(
    (entry) => entry.seatId === row.seatId,
  ).length;

  const identityTimelineEvents: SeatAiArchiveTimelineEvent[] = (
    readModel.recentIdentityBindingActivity ?? []
  )
    // seatId 稳定主键；事件源若无 seatId 则暂不投影（避免按岗位名误关联）
    .filter((event) => Boolean(event.seatId?.trim()) && event.seatId!.trim() === row.seatId)
    .slice(0, 5)
    .map((event) => ({
      id: `identity_${event.auditEventId}`,
      label: `${event.kind === "bound" ? "绑定" : "解绑"}身份 ${event.identityDisplayName} → ${event.agentLabel}`,
      at: event.createdAt,
      source: "identity" as const,
    }));

  return {
    seatId: row.seatId,
    name: row.name,
    teamLabel: row.teamLabel,
    responsibility: row.responsibility,
    status: row.status,
    seatStatus: row.seatStatus,
    memberUserId: row.memberUserId,
    memberDisplayLabel: row.memberDisplayLabel,
    memberEmail,
    pendingEmployeeUser,
    pendingEmployeeDisplayName,
    pendingActivationExpiresAt,
    roleCode,
    aiEmployeeLabel: row.aiEmployeeLabel,
    defaultAgentId: row.defaultAgentId,
    agentIds: [...row.agentIds],
    defaultSpaceIds: [...row.defaultSpaceIds],
    memoryScopeIds: [...row.memoryScopeIds],
    botCount: row.botCount,
    groupCount: row.groupCount,
    totalCost: row.totalCost,
    totalTokens: row.totalTokens ?? null,
    sessionCount: row.sessionCount ?? null,
    runtimeLabel: row.runtimeLabel ?? null,
    activityLabel: row.activityLabel ?? null,
    lastActiveAt: row.lastActiveAt ?? meshLastActiveAt,
    avgDailyHours: null,
    offerTargetEmail: offerEmail,
    offerOfferedAt: row.offer?.offeredAt ?? null,
    offerExpiresAt: row.offer?.expiresAt ?? null,
    handoverStatus: row.handover?.status ?? null,
    handoverCreatedAt: row.handover?.createdAt ?? null,
    handoverCompletedAt: row.handover?.completedAt ?? null,
    botBoundAt,
    permissionIdentities:
      seatAccess?.identities.map((identity) => ({
        title: identity.displayName,
        detail: `${identity.providerLabel} · Agent: ${identity.agentIds.join(", ") || "全部"} · ${identity.allowedActions.join(", ")}`,
        badge: identity.status === "active" ? "可用" : identity.status,
      })) ?? [],
    knownSkills: resolveKnownSkillsForSeat(row.seatId, readModel.knownSkillsBySeatId),
    identityBindingCount,
    meshSessionCount,
    identityTimelineEvents,
  };
}

export function buildSeatAiArchiveReadModel(input: SeatAiArchiveInput): SeatAiArchiveReadModel {
  const phase = resolveSeatAiArchivePhase({
    status: input.status,
    seatStatus: input.seatStatus,
    pendingEmployeeUser: input.pendingEmployeeUser,
    handoverStatus: input.handoverStatus,
  });

  const email = input.memberEmail?.trim() || null;
  const memberLabel =
    input.memberDisplayLabel?.trim() ||
    input.pendingEmployeeDisplayName?.trim() ||
    input.memberUserId?.trim() ||
    "未绑定";
  const permissionIdentities = input.permissionIdentities ?? [];
  const knownSkills = input.knownSkills ?? [];
  const breakdown = buildContributionBreakdown(input);
  const timelineEvents = buildTimelineEvents(input);

  const teamOk = Boolean(input.teamLabel.trim() && input.teamLabel.trim() !== "未分组");
  const hasPerson = Boolean(
    input.memberUserId?.trim() || input.pendingEmployeeUser?.trim() || email,
  );
  const identityFilled = Boolean(input.name.trim()) && teamOk && hasPerson;
  const digitalFilled = Boolean(
    input.roleCode?.trim() || input.agentIds.length > 0 || input.defaultAgentId,
  );
  const permissionsFilled = permissionIdentities.length > 0;
  const skillsFilled = knownSkills.length > 0;
  // 贡献：可继承资产（agent/space/memory）或身份绑定 > 0；mesh sessions 不单独计分
  const contributionFilled = breakdown.total > 0;
  const timelineFilled = timelineEvents.length > 0;

  const fillFlags: Record<SeatAiArchiveSectionId, boolean> = {
    identity: identityFilled,
    digital: digitalFilled,
    permissions: permissionsFilled,
    skills: skillsFilled,
    contribution: contributionFilled,
    timeline: timelineFilled,
  };

  const placeholders: Record<SeatAiArchiveSectionId, string | null> = {
    identity: identityFilled ? null : "补全岗位名、部门与邮箱",
    digital: digitalFilled ? null : "绑定岗位 Bot 后显示",
    permissions: permissionsFilled ? null : "配置授权后显示",
    skills: skillsFilled ? null : "暂无已装技能",
    contribution: contributionFilled ? null : "绑定资产后计入",
    timeline: timelineFilled ? null : "暂无事件",
  };

  const sections = {} as Record<SeatAiArchiveSectionId, SeatAiArchiveSectionState>;
  let completeness = 0;
  for (const id of SEAT_AI_ARCHIVE_SECTION_ORDER) {
    const weight = SEAT_AI_ARCHIVE_SECTION_WEIGHTS[id];
    const filled = fillFlags[id];
    const score = filled ? weight : 0;
    completeness += score;
    sections[id] = {
      filled,
      weight,
      score,
      placeholder: placeholders[id],
    };
  }

  const activationEmail = isLikelyEmail(input.pendingEmployeeUser)
    ? input.pendingEmployeeUser!.trim()
    : null;

  return {
    seatId: input.seatId,
    phase,
    phaseLabel: seatAiArchivePhaseLabel(phase),
    completeness,
    sections,
    identity: {
      name: input.name,
      teamLabel: input.teamLabel,
      responsibility: input.responsibility,
      memberLabel,
      email,
      emailDisplay: resolveEmailDisplay(email),
      organizationStatus: input.status,
      seatStatus: input.seatStatus,
      pendingActivationExpiresAt: input.pendingActivationExpiresAt,
      canSendActivation: phase === "pending_activation" && Boolean(activationEmail),
      needsEmail: phase === "vacant_shell" || (phase === "pending_activation" && !activationEmail),
    },
    digital: {
      aiEmployeeLabel: input.aiEmployeeLabel,
      roleCode: input.roleCode,
      defaultAgentId: input.defaultAgentId,
      agentIds: [...input.agentIds],
      botCount: input.botCount,
      groupCount: input.groupCount,
      totalCost: input.totalCost,
      totalTokens: input.totalTokens,
      sessionCount: input.sessionCount,
      runtimeLabel: input.runtimeLabel ?? null,
      usagePendingMember: phase === "vacant_shell" || phase === "pending_activation",
      usageAttributionNote: null,
    },
    permissions: {
      identities: permissionIdentities,
    },
    skills: {
      items: knownSkills,
      placeholder: placeholders.skills ?? "待完善",
    },
    contribution: {
      heuristicAssetCount: breakdown.total,
      breakdown,
      placeholder: placeholders.contribution,
    },
    timeline: {
      events: timelineEvents,
      activityLabel: input.activityLabel ?? null,
      lastActiveAt: input.lastActiveAt ?? null,
      avgDailyHours: input.avgDailyHours ?? null,
    },
  };
}
