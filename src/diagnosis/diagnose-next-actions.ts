import type { DiagnoseGrowthAssessment } from "./diagnose-growth-assessment.js";
/**
 * Conversation-executable next steps derived from growth facts.
 * diagnosed_agent items are 1:1 session handoffs (not collaboration-group share).
 * They do not confirm prescriptions, write cron, or call user.daibai.ask/execute.
 */
import { defaultDiagnoseSessionKey } from "./diagnose-policy.js";

export type DiagnoseConversationActor = "diagnosed_agent" | "steward" | "owner";

export type DiagnoseHandoffChannel = "diagnosed_agent_session" | "steward";

export type DiagnoseConversationAction = {
  actionId: string;
  title: string;
  actor: DiagnoseConversationActor;
  actorLabel: string;
  reason: string;
  /** Text for the steward conversation (human-visible receipt / owner tasks). */
  prompt: string;
  /** Direct instruction for the diagnosed agent session. */
  agentPrompt: string;
  handoffChannel: DiagnoseHandoffChannel;
  targetAgentId: string | null;
  targetSessionKey: string | null;
};

const MAX_ACTIONS = 3;

export function buildDiagnoseConversationActions(
  growths: DiagnoseGrowthAssessment[],
): DiagnoseConversationAction[] {
  const actions: DiagnoseConversationAction[] = [];
  for (const growth of growths) {
    if (actions.length >= MAX_ACTIONS) {
      break;
    }
    const name = growth.displayName?.trim() || growth.objectLabel;
    if (growth.identity.bootstrapPending) {
      actions.push(
        action({
          kind: "bootstrap",
          growth,
          title: "完成入职引导",
          actor: "diagnosed_agent",
          reason: `${name} 的 BOOTSTRAP.md 仍在`,
          prompt: `请让${name}完成入职引导并收起 BOOTSTRAP.md。不要自行编造 IDENTITY 或 USER。`,
          agentPrompt: "请完成入职引导并收起 BOOTSTRAP.md。不要自行编造 IDENTITY 或 USER。",
        }),
      );
    }
    if (!growth.identity.identityInitialized || !growth.identity.userInitialized) {
      const fields = [
        ...(growth.identityMissingFields ?? []).map((field) => `IDENTITY.${field}`),
        ...(growth.userMissingFields ?? []).map((field) => `USER.${field}`),
      ];
      actions.push(
        action({
          kind: "identity",
          growth,
          title: "补身份字段",
          actor: "owner",
          reason: fields.length > 0 ? `未确认：${fields.join("、")}` : "身份或主人字段未齐",
          prompt: `请向主人收集${name}未确认字段${fields.length > 0 ? `：${fields.join("、")}` : ""}。不要自行编造 IDENTITY 或 USER。收集后写入对应字段。`,
          agentPrompt: `请向主人收集未确认字段${fields.length > 0 ? `：${fields.join("、")}` : ""}。不要自行编造 IDENTITY 或 USER。收集后写入对应字段。`,
        }),
      );
    }
    if (growth.memoryJudgedMissing) {
      actions.push(
        action({
          kind: "memory",
          growth,
          title: "补当日记忆",
          actor: "diagnosed_agent",
          reason: "本窗有活动但记忆未落盘",
          prompt: `请让${name}把今日已完成、可核对的工作要点写入 memory/ 当日文件。不要复制聊天正文，不要等待我再派新任务。`,
          agentPrompt:
            "请把今日已完成、可核对的工作要点写入 memory/ 当日文件。不要复制聊天正文，不要等待再派新任务。",
        }),
      );
    }
    if (growth.unused.length > 0) {
      const unused = growth.unused.slice(0, 4);
      actions.push(
        action({
          kind: "practice",
          growth,
          title: "练未观察技能",
          actor: "diagnosed_agent",
          reason: `本窗未观察到 ${unused.join("、")}`,
          prompt: `请让${name}用已安装技能 ${unused.join("、")} 做一次本窗可核对的练习。只记录技能名与结果，不安装新技能，不编造数据。完成后把可核对要点写入 memory/ 当日文件。`,
          agentPrompt: `请用已安装技能 ${unused.join("、")} 做一次本窗可核对的练习。只记录技能名与结果，不安装新技能，不编造数据。完成后把可核对要点写入 memory/ 当日文件。`,
        }),
      );
    }
    if (growth.unstable.length > 0) {
      const unstable = growth.unstable.slice(0, 4);
      actions.push(
        action({
          kind: "review",
          growth,
          title: "复盘失败技能",
          actor: "diagnosed_agent",
          reason: `近窗失败或超时：${unstable.join("、")}`,
          prompt: `请让${name}复盘近窗失败或超时的技能 ${unstable.join("、")}，写出下一步可执行改进。不要安装新技能。`,
          agentPrompt: `请复盘近窗失败或超时的技能 ${unstable.join("、")}，写出下一步可执行改进。不要安装新技能。`,
        }),
      );
    }
  }
  return actions.slice(0, MAX_ACTIONS);
}

function action(input: {
  kind: string;
  growth: DiagnoseGrowthAssessment;
  title: string;
  actor: DiagnoseConversationActor;
  reason: string;
  prompt: string;
  agentPrompt: string;
}): DiagnoseConversationAction {
  const name = input.growth.displayName?.trim() || input.growth.objectLabel;
  const target = resolveDiagnoseHandoffTarget(input.growth, input.actor);
  return {
    actionId: `act:${input.kind}:${input.growth.agentId || input.growth.groupId || "target"}`,
    title: input.title,
    actor: input.actor,
    actorLabel: actorLabel(input.actor, name),
    reason: input.reason,
    prompt: input.prompt,
    agentPrompt: input.agentPrompt,
    handoffChannel: target.handoffChannel,
    targetAgentId: target.targetAgentId,
    targetSessionKey: target.targetSessionKey,
  };
}

export function resolveDiagnoseHandoffTarget(
  growth: Pick<DiagnoseGrowthAssessment, "agentId" | "groupId">,
  actor: DiagnoseConversationActor,
): {
  handoffChannel: DiagnoseHandoffChannel;
  targetAgentId: string | null;
  targetSessionKey: string | null;
} {
  const agentId = growth.agentId?.trim() || "";
  const groupId = growth.groupId?.trim() || "";
  if (actor !== "diagnosed_agent" || groupId || !agentId || agentId === "main") {
    return {
      handoffChannel: "steward",
      targetAgentId: agentId || null,
      targetSessionKey: null,
    };
  }
  return {
    handoffChannel: "diagnosed_agent_session",
    targetAgentId: agentId,
    targetSessionKey: defaultDiagnoseSessionKey(agentId),
  };
}

function actorLabel(actor: DiagnoseConversationActor, name: string): string {
  if (actor === "diagnosed_agent") {
    return `被诊断数字人（${name}）`;
  }
  if (actor === "steward") {
    return "大白管家";
  }
  return "主人（大白代为收集）";
}
