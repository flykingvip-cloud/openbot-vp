import { resolveGroupCollaborationPaths } from "../collaboration-learning/collaboration-paths.js";
import { tryBuildSharedDocPromptAppendixSync } from "../collaboration-learning/shared-group-doc.js";
import type { CollabEdge } from "./collab-edge.js";
import { isCollaborationSocialCheck } from "./completion-contract.js";
import { resolveDmDecisionRoomAnchorText } from "./dm-decision-room-anchor.js";
import type { EffectiveCollaborationPolicy } from "./effective-policy.js";
import { isIntroductionFollowUpMessage } from "./group-inbound-history.js";
import { resolveParticipationLaneMentionMustRespond } from "./policy-lane-participation.js";
import {
  formatCollaborationReplyLanguageInstruction,
  type CollaborationReplyLanguage,
} from "./reply-language.js";
import { projectRuntimeFacts } from "./runtime-authority.js";
import { formatSameRoundContextForPrompt, type SameRoundContext } from "./same-round-context.js";
import { findCoordinatorBot } from "./tier1a-duty-engine.js";
import type {
  CollaborationBotTarget,
  CollaborationDispatchScope,
  ContributionRole,
  ParticipationDecision,
  ParticipationTier,
} from "./types.js";

export function buildCollaborationDiscussionTurnPrompt(params: {
  scope: CollaborationDispatchScope;
  bot: CollaborationBotTarget;
  decision: ParticipationDecision;
  participationTier: ParticipationTier;
  contributionRole?: ContributionRole;
  isWrapTurn?: boolean;
  userMessage?: string;
  sameRoundContext?: SameRoundContext;
  replyLanguage?: CollaborationReplyLanguage | null;
  dispatchRole?: "primary" | "explicit_member" | "fallback" | "supplement" | "close";
  /** Set when this turn was nominated by the primary's same-round CollabEdge. */
  collabEdge?: CollabEdge;
  /** P0.0b: injected EffectivePolicy avoids a re-compile (BP-18). */
  effective?: EffectiveCollaborationPolicy;
  /** // v1-only — P0.2 roll-call roster / brief-hint lines from hotfix-rollcall-v1. */
  v1RollCallExtraLines?: string[];
  /** Prebuilt shared-doc card; skips filesystem discovery when set. */
  sharedDocCard?: string | null;
  /** Override group workspace root for shared-doc discovery. */
  sharedDocWorkspaceRoot?: string | null;
}): string {
  const activeParticipants = params.decision.roundPlan.participants.filter(
    (entry) => entry.tier !== "wrap",
  );
  const peerNames = activeParticipants
    .filter((entry) => entry.agentId !== params.bot.agentId)
    .map((entry) => entry.displayName)
    .join("、");
  const contributionRole =
    params.contributionRole ??
    params.decision.roundPlan.participants.find(
      (participant) => participant.agentId === params.bot.agentId,
    )?.contributionRole ??
    (params.isWrapTurn ? "wrap" : "supplement");
  const lines = [
    "[协作群本轮调度]",
    `群组：${params.scope.title}`,
    `你（${params.bot.name}）已被选为本轮发言成员（职责：${contributionRole}）。`,
    `本轮模式：${params.decision.responseMode}。`,
  ];
  if (params.v1RollCallExtraLines?.length) {
    lines.push(...params.v1RollCallExtraLines);
  }
  if (peerNames && params.decision.responseMode !== "decision_to_executor") {
    lines.push(`同轮其他成员也会回复：${peerNames}。`);
  }
  if (params.decision.responseMode === "decision_to_executor") {
    lines.push("本轮为决策→执行模式：除协调确认与执行认领/交付外，其他成员默认静默。");
  } else {
    lines.push("你不是独立答题者，而是本轮协作者。");
  }
  lines.push(
    "如果前序成员已经覆盖了主要事实，请不要重复完整答案；目标是做增量贡献：补充、纠错、深化、举例或收口。",
  );
  lines.push(
    "群里可能有多位真人；请严格按聊天记录中的 sender/发言人标签区分他们，不要把不同真人说成同一个人，也不要用设备名（如 Chrome）称呼真人。",
  );
  lines.push(formatCollaborationReplyLanguageInstruction(params.replyLanguage ?? null));
  if (params.replyLanguage === "en") {
    lines.push(
      "Answer directly. The final reply must be user-facing text — do not publish Chinese chain-of-thought, role-planning, or per my role drafts. Tool availability is decided by this round's registry and group skill policy; do not assume unregistered tools exist.",
    );
  } else {
    lines.push(
      "直接作答。最终回复必须是给用户看的正文，不要输出英文思考、角色规划或 per my role。工具是否可用由本轮注册表与群技能策略决定，不要假设未注册的工具存在。",
    );
  }
  // P1-A5 ① (BP-18): mentionBotMustRespond via participation lane helper (default legacy
  // = injected effective or compile inside the composition root; no consumer recompile AST).
  const mentionMustRespond = resolveParticipationLaneMentionMustRespond({
    effective: params.effective,
    operatingState: params.scope.operatingState ?? null,
  }).mentionBotMustRespond;
  const socialMustSpeak =
    isCollaborationSocialCheck(params.userMessage) &&
    (contributionRole === "lead" ||
      params.dispatchRole === "primary" ||
      params.dispatchRole === "fallback" ||
      params.dispatchRole === "explicit_member");
  if (socialMustSpeak) {
    lines.push(
      "这是在场确认或在问能不能接任务。你必须用一两句中文直接回答，不要返回 NO_REPLY，也不要先调用工具。",
    );
  } else if (
    mentionMustRespond &&
    (params.participationTier === "mention" || contributionRole === "lead")
  ) {
    lines.push("本群要求被点名或主答给出可见回复；不要只返回 NO_REPLY 或「收到」。");
  } else if (params.collabEdge) {
    lines.push(
      "本轮主答通过协作边点名请你接手，必须给出可见回复；不要只返回 NO_REPLY 或「收到」。",
    );
  } else {
    lines.push("如果你无法提供明显新增价值，请直接返回 NO_REPLY。");
  }
  lines.push("对用户可见回复控制在 3 句以内收口；需要展开时只保留结论、依据、下一步。");
  lines.push(
    "用户说「这份」「上面的」「重新生成」「重新同步」时，目标是本会话上一份已声明成果，不要请用户再上传。",
  );
  lines.push(
    "生成的文件必须写进本机器人自己的工作区，file= 使用该工作区相对路径（含目录）。不要写到安装根目录、~/Downloads、别人的空间，也不要复制到 output/<kind>/。只声明裸文件名且没有写入字节时，预览保持未同步。",
  );
  lines.push(
    `如果本轮需要用户确认选项，且你把决策控件发到私聊（to:"dm" 或等价目标），必须同时在群里只发这一句锚点，不要把选项清单贴进群：${resolveDmDecisionRoomAnchorText(params.replyLanguage)}`,
  );
  if (params.isWrapTurn || contributionRole === "wrap") {
    lines.push(
      "你是协调者：把用户决策写入任务卡（命名/范围/资源约束），房间不要发「收到/已认领」。",
    );
    lines.push("不要 @ 其他成员重复确认，不要指派，不要展开讨论；同类确认本轮只允许你这一条。");
    lines.push("若用户意图已足够明确，可极简确认后直接让执行者接手。");
  } else if (contributionRole === "executor") {
    lines.push("你是执行者：认领写入任务卡，不要在房间发送「已认领」或进度空回执。");
    lines.push("直接进入实际执行与交付；不要重复协调者已说过的确认内容。");
    lines.push("若还没有可交付的增量，返回 NO_REPLY。");
  } else if (socialMustSpeak) {
    lines.push("直接回答用户这句，一两句即可，不要展开任务，也不要返回 NO_REPLY。");
  } else if (params.participationTier === "mention" || contributionRole === "lead") {
    lines.push(
      mentionMustRespond
        ? "用户点名了你或你承担主答职责，必须给出可见增量，不要用空回执凑数。"
        : "用户点名了你或你承担主答职责，必须考虑开口；若没有明显增量，返回 NO_REPLY。",
    );
  } else if (contributionRole === "supplement" || contributionRole === "challenge") {
    lines.push("前序成员已给出主答时，你只提供差异化补充或质疑，不要重述同一套完整答案。");
  } else {
    lines.push("请直接以你的身份回复用户消息；不要声称只有你在线，也不要代替其他成员发言。");
    if (params.userMessage && isIntroductionFollowUpMessage(params.userMessage)) {
      lines.push(
        "用户是在追问尚未介绍的成员；若你在本轮之前的群聊记录里已经做过自我介绍，请简短确认即可，不要重复长篇介绍。",
      );
    }
  }
  if (params.collabEdge) {
    lines.push(...buildCollabEdgeTargetLines(params));
  } else if (contributionRole === "lead" || params.participationTier === "mention") {
    lines.push(...buildCollabEdgeAuthoringLines(params));
  }
  if (params.sameRoundContext) {
    lines.push(formatSameRoundContextForPrompt(params.sameRoundContext));
  }
  let sharedDocCard = params.sharedDocCard ?? null;
  if (!sharedDocCard) {
    try {
      const root =
        params.sharedDocWorkspaceRoot?.trim() ||
        resolveGroupCollaborationPaths(params.scope.groupId).workspacePath;
      sharedDocCard = tryBuildSharedDocPromptAppendixSync({
        groupWorkspaceRoot: root,
        viewerAgentId: params.bot.agentId,
      });
    } catch {
      sharedDocCard = null;
    }
  }
  if (sharedDocCard) {
    lines.push(sharedDocCard);
  }
  return lines.join("\n");
}

function edgePeerRoster(scope: CollaborationDispatchScope, selfAgentId: string): string {
  return scope.bots
    .filter((bot) => bot.agentId !== selfAgentId)
    .map((bot) => `${bot.name?.trim() || bot.agentId}=${bot.agentId}`)
    .join("、");
}

/** Lead / @mentioned speaker: how to nominate same-round peers (≤2 edges, depth 1). */
function buildCollabEdgeAuthoringLines(params: {
  scope: CollaborationDispatchScope;
  bot: CollaborationBotTarget;
  effective?: EffectiveCollaborationPolicy;
}): string[] {
  const lines = [
    "主答完成后如需同轮协作，可在回复末尾附加最多 2 条深度为 1 的边（不要嵌套）：",
    "[[collab_edge:peer_ask|to=agentId|reason=…]] / [[collab_edge:challenge|to=agentId|reason=…]] / [[collab_edge:request_review|to=agentId|reason=…]] / [[collab_edge:handoff|to=agentId|reason=…|remaining=…|acceptance=…]]",
    "handoff 复用任务交接字段；challenge 在评审驱动下应保留冲突，不要被当成重复话术。",
  ];
  const roster = edgePeerRoster(params.scope, params.bot.agentId);
  if (roster) {
    lines.push(`to= 填同群成员的 agentId（也可写成员名）：${roster}。边标记不会显示在群里。`);
  }
  if (
    !findCoordinatorBot(
      projectRuntimeFacts(params.scope, { effective: params.effective }),
      params.scope.bots,
    )
  ) {
    // Round-scoped delegation only: no persistent coordinator authority is granted.
    lines.push(
      "本群未设协调者：若用户在本轮要求你组织、分派或调度其他成员，你可在正文里写清分工建议，并在末尾用 handoff 或 peer_ask 边表达同轮协作请求意图（最多 2 条）。边与正文分工是协作建议，不等于正式派工或责任已生效。",
    );
    lines.push(
      "正式任务与责任仅以服务端正式回执为准（例如 collaboration_board.discuss_to_task / activate_task 成功回执）；未收到正式回执时，不要宣称已派工或认领即生效。不要调用 organization_tasks 创建任务指派，也不要用 sessions_send 私发其他成员（本群这两条通路不可用）。",
    );
  }
  return lines;
}

/** Edge target: the primary nominated this bot in the same round. */
function buildCollabEdgeTargetLines(params: {
  scope: CollaborationDispatchScope;
  collabEdge?: CollabEdge;
}): string[] {
  const edge = params.collabEdge;
  if (!edge) {
    return [];
  }
  const fromName =
    params.scope.bots.find((bot) => bot.agentId === edge.fromAgentId)?.name?.trim() ||
    edge.fromAgentId;
  const kindLabel: Record<CollabEdge["kind"], string> = {
    peer_ask: "请教/请你补充",
    handoff: "把子任务交给你",
    challenge: "请你质疑",
    request_review: "请你评审",
  };
  const lines = [`本轮主答 ${fromName} ${kindLabel[edge.kind]}：${edge.reason}。`];
  if (edge.handoff) {
    if (edge.handoff.remainingWork && edge.handoff.remainingWork !== edge.reason) {
      lines.push(`需要你完成：${edge.handoff.remainingWork}。`);
    }
    const acceptance = edge.handoff.acceptanceCriteria.filter((item) => item !== edge.reason);
    if (acceptance.length > 0) {
      lines.push(`验收标准：${acceptance.join("；")}。`);
    }
  }
  lines.push(
    "请直接完成这部分并给出可见结果，不要返回 NO_REPLY，也不要只回「收到」；不要再发起新的 collab_edge（本轮协作深度只有 1）。",
  );
  return lines;
}

export function buildCollaborationGroupMembersLabel(scope: CollaborationDispatchScope) {
  const parts: string[] = [];
  for (const human of scope.members?.humans ?? []) {
    const status = human.status?.trim().toLowerCase();
    if (status && status !== "active" && status !== "paused") {
      continue;
    }
    const name = human.name?.trim() || human.userId?.trim();
    if (!name) {
      continue;
    }
    parts.push(`${name}（真人）`);
  }
  const botEntries = (scope.members?.bots ?? []).filter((entry) => entry.status === "active");
  if (botEntries.length > 0) {
    for (const entry of botEntries) {
      const name = entry.name?.trim() || entry.agentId;
      if (!name) {
        continue;
      }
      parts.push(`${name}（机器人）`);
    }
  } else {
    for (const bot of scope.bots) {
      const name = bot.name?.trim();
      if (!name) {
        continue;
      }
      parts.push(`${name}（机器人）`);
    }
  }
  return parts.join(", ");
}
