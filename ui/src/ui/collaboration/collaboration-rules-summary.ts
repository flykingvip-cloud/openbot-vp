/**
 * Collaboration rules drawer (Floor Runtime v2.1 §5.5 P1-A5 ⑤ / BP-20).
 *
 * The UI no longer compiles an EffectivePolicy from an incomplete client-side input.
 * It renders the server-compiled, frozen `effectivePolicy` (effective + provenance)
 * returned with each space by collaboration.spaces.list / collaboration.space.get,
 * and never presents leaves the runtime does not execute
 * (`effectivePolicy.runtimeNotEnforced`, e.g. botMaySelfAdvanceWithoutHuman "可自推进").
 */
import type {
  EffectiveCollaborationPolicy,
  EffectivePolicyValue,
} from "../../../../src/gateway/collaboration-dispatch/effective-policy.js";
import type { CollaborationSpaceEffectivePolicyView } from "../../../../src/gateway/collaboration-dispatch/policy-lane-presentation.js";

export type CollaborationRulesEnforcement = "forced" | "scheduled" | "guidance";

export type CollaborationRulesDrawerSectionId =
  | "system"
  | "strategy"
  | "governance"
  | "roles"
  | "guidance";

export type CollaborationRulesDrawerSection = {
  id: CollaborationRulesDrawerSectionId;
  title: string;
  hint: string;
  enforcement: CollaborationRulesEnforcement;
  enforcementLabel: string;
  lines: string[];
};

const SECTION_META: Record<
  CollaborationRulesDrawerSectionId,
  Omit<CollaborationRulesDrawerSection, "lines">
> = {
  system: {
    id: "system",
    title: "系统底线",
    hint: "所有协作小组统一遵守，管理员无法关闭。",
    enforcement: "forced",
    enforcementLabel: "强制执行",
  },
  strategy: {
    id: "strategy",
    title: "本小组协作策略",
    hint: "管理员可以调整，但不能突破系统底线。",
    enforcement: "scheduled",
    enforcementLabel: "调度执行",
  },
  governance: {
    id: "governance",
    title: "任务治理",
    hint: "谁可以提案、谁拍板。最终确认已接入治理闸。",
    enforcement: "scheduled",
    enforcementLabel: "调度执行",
  },
  roles: {
    id: "roles",
    title: "成员职责",
    hint: "观察员默认可读不可写、不可执行、不可批准。",
    enforcement: "forced",
    enforcementLabel: "强制执行",
  },
  guidance: {
    id: "guidance",
    title: "自定义协作规则",
    hint: "用于补充机器人行为规范，不替代系统规则。",
    enforcement: "guidance",
    enforcementLabel: "AI 行为指导",
  },
};

function uniqueNonEmpty(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function formatPolicyScalar(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return value == null ? "" : JSON.stringify(value);
}

function formatRequestedVsEffective<T>(
  entry: Readonly<EffectivePolicyValue<T>>,
  unit?: string,
): string {
  const suffix = unit ?? "";
  if (entry.requested !== undefined && entry.requested !== entry.value) {
    return `本群设置：${formatPolicyScalar(entry.requested)}${suffix}；系统上限约束后生效：${formatPolicyScalar(entry.value)}${suffix}`;
  }
  if (entry.source === "l2") {
    return `本群设置：${formatPolicyScalar(entry.value)}${suffix}；系统生效：${formatPolicyScalar(entry.value)}${suffix}`;
  }
  return `系统默认生效：${formatPolicyScalar(entry.value)}${suffix}`;
}

function modeLabel(id: EffectiveCollaborationPolicy["strategy"]["id"]): string {
  if (id === "task_driven") {
    return "任务驱动（必须有负责人，按需补充，强调交付）";
  }
  if (id === "review_driven") {
    return "评审驱动（必须有评审者，冲突需显性保留）";
  }
  return "讨论驱动（开放参与，主责任较弱）";
}

function replyLanguageLine(view: CollaborationSpaceEffectivePolicyView): string {
  const language = view.effective.presentation.replyLanguage;
  const provenance = view.effective.provenance.segments.presentation.replyLanguage;
  if (language === "en") {
    return "本群持续使用英文回复。";
  }
  if (language === "zh") {
    return "本群持续使用中文回复。";
  }
  if (provenance.requested !== undefined && provenance.source !== "l2") {
    return `本群语言设置「${formatPolicyScalar(provenance.requested)}」无效；按用户本轮语种回复。`;
  }
  return "本群按用户本轮语种回复。";
}

export type CollaborationRulesDrawerParams = {
  /** Server-compiled frozen EffectivePolicy + provenance (BP-20). */
  effectivePolicy?: CollaborationSpaceEffectivePolicyView | null;
  /** Fallback guidance lines when the server view is absent. */
  systemInstructions?: readonly string[] | null;
};

export function buildCollaborationRulesDrawerSections(
  params: CollaborationRulesDrawerParams,
): CollaborationRulesDrawerSection[] {
  const view = params.effectivePolicy ?? null;
  const roles = uniqueNonEmpty([
    "观察员：可读，不可点名驱动执行，不可发言改任务，不可执行，不可批准。",
    "主责任人（Primary Owner）对该轮交付结果负责，不是第一个说话的人，也不等于执行者。",
    "任务交接必须填写已完成产物、剩余工作、假设、阻塞和验收条件，不能只丢聊天记录。",
  ]);
  const systemBase = [
    "仅正式成员可发言；非成员不能代发。",
    "@ 无法匹配时本轮不会派发，系统不会假装已经点名。",
    "被 @ 必须进入本轮候选；无增量可沉默。",
  ];
  const systemTail = [
    "群技能白名单为空时不施加群级限制；租户 ACL 与数字人自身能力权限仍然生效。1:1 对话不继承群白名单。",
    "已归档或已解散的小组不能继续执行。",
  ];

  if (!view) {
    // No server view (older gateway / not loaded yet): render only static system + role
    // lines. Never compile policy client-side (BP-20).
    const sectionsWithoutView: Array<[CollaborationRulesDrawerSectionId, string[]]> = [
      [
        "system",
        uniqueNonEmpty([...systemBase, "单轮可见回复有系统上限，群策略不能放宽。", ...systemTail]),
      ],
      ["strategy", ["本群生效策略由服务端下发，当前尚未获取。"]],
      ["roles", roles],
      ["guidance", uniqueNonEmpty(params.systemInstructions ?? [])],
    ];
    return sectionsWithoutView
      .map(([id, lines]) => ({ ...SECTION_META[id], lines }))
      .filter((section) => section.lines.length > 0);
  }

  const effective = view.effective;
  const notEnforced = new Set<string>(view.runtimeNotEnforced);
  const enforced = (field: string) => !notEnforced.has(field);

  const system = uniqueNonEmpty([
    ...systemBase,
    `单轮可见回复上限 ${effective.invariants.maxVisibleRepliesCeiling} 条，群策略不能放宽。`,
    ...systemTail,
  ]);

  const strategy = uniqueNonEmpty([
    `协作模式：${modeLabel(effective.strategy.id)}`,
    effective.participation.openDiscussionWithoutMention
      ? "允许未点名开放讨论；职责相关成员可主动参与。"
      : "未点名时默认只由主负责人或本轮提名主答开口。",
    effective.participation.mentionBotMustRespond ? "本群要求被点名必须给出可见回复。" : "",
    `每轮可见机器人回复：${formatRequestedVsEffective(effective.provenance.maxVisibleBotRepliesPerRound, " 条")}`,
    effective.participation.lowSignalStrategy === "all_named_confirmers"
      ? "低信号确认：具名确认人全部回应。"
      : "低信号确认默认 1 人回；需要多人确认时由本群策略打开。",
    "主责任人（Owner）对结果负责，不等于唯一执行者；补充与评审可以分开。",
    effective.strategy.deliverableRequired ? "任务模式完成前必须有已提交的关联交付物。" : "",
    effective.participation.humanStartsNewRound && enforced("participation.humanStartsNewRound")
      ? "新一轮协作默认由人类发起。"
      : "",
    effective.dispatch.coordinatorWrap
      ? "本轮结束后由协调者收口。"
      : "协调者收口默认关闭，避免多一层复述。",
    replyLanguageLine(view),
    "每人可见回复以 3 句内收口。",
  ]);

  const governance = uniqueNonEmpty([
    effective.governance.decisionMode === "delegated_low_risk"
      ? "低风险可委托推进；机器人终局发布受治理闸约束。"
      : "最终结论需要人类确认；机器人不能单独拍板。",
    effective.governance.allowAgentPublishProposal
      ? "允许机器人在委托模式下发布提案。"
      : "机器人不可发布提案。",
    effective.governance.entersWaitingForHumanAfterVisibleTurnsExhausted &&
    enforced("governance.entersWaitingForHumanAfterVisibleTurnsExhausted")
      ? "达到轮次上限后等待人类确认。"
      : "",
    // BP-20: only shown once the runtime actually executes self-advance (server drops the
    // field from runtimeNotEnforced). Today it is compiled but never executed.
    effective.governance.botMaySelfAdvanceWithoutHuman &&
    enforced("governance.botMaySelfAdvanceWithoutHuman")
      ? "机器人可在低风险场景自推进。"
      : "",
    "交付物批准/发布与任务完成受治理闸约束。",
  ]);

  const guidance = uniqueNonEmpty(
    effective.guidance.systemInstructions.length > 0
      ? effective.guidance.systemInstructions
      : (params.systemInstructions ?? []),
  );

  return (["system", "strategy", "governance", "roles", "guidance"] as const)
    .map((id) => ({
      ...SECTION_META[id],
      lines:
        id === "system"
          ? system
          : id === "strategy"
            ? strategy
            : id === "governance"
              ? governance
              : id === "roles"
                ? roles
                : guidance,
    }))
    .filter((section) => section.lines.length > 0);
}

/**
 * Flat list for export / older callers. Section order is the product order.
 * Custom instructions stay after system and strategy lines.
 */
export function buildCollaborationRulesSummary(params: CollaborationRulesDrawerParams): string[] {
  return buildCollaborationRulesDrawerSections(params).flatMap((section) => section.lines);
}

type ActiveCollaborationRulesSpace = {
  id: string;
  groupId: string | null;
  systemInstructions?: string[];
  effectivePolicy?: CollaborationSpaceEffectivePolicyView | null;
};

export function resolveActiveCollaborationRulesSections(params: {
  activeSessionKey: string;
  spaces: ActiveCollaborationRulesSpace[];
}): CollaborationRulesDrawerSection[] {
  const activeKey = params.activeSessionKey.trim();
  if (!activeKey) {
    return [];
  }
  const space = params.spaces.find(
    (entry) => entry.id.trim() === activeKey || entry.groupId?.trim() === activeKey,
  );
  if (!space) {
    return [];
  }
  return buildCollaborationRulesDrawerSections({
    effectivePolicy: space.effectivePolicy ?? null,
    systemInstructions: space.systemInstructions,
  });
}

export function resolveActiveCollaborationRulesSummary(params: {
  activeSessionKey: string;
  spaces: ActiveCollaborationRulesSpace[];
}): string[] {
  return resolveActiveCollaborationRulesSections(params).flatMap((section) => section.lines);
}
