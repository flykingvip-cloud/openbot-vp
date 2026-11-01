/**
 * Chat task card payload for a real TaskOutcome tip.
 * Missing tip, task id, agent id, or version yields nothing. The card id is
 * the tip task id; it is not a substitute invented for a missing taskId.
 */
import { resolveSessionAgentId } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import { chatTurnTaskId } from "./chat-entry.js";
import { resolveConfiguredTaskOutcomeRoot } from "./reject-result.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { TaskJudgement } from "./types.js";

export type ChatTaskUpdateTip = {
  taskId: string;
  agentId: string;
  outcomeVersion: number;
  judgement: TaskJudgement;
};

export type ChatTaskUpdateEvent = {
  type: "task_update";
  task: {
    id: string;
    title: string;
    step_current: number;
    step_total: number;
    step_name: string;
    status: "running" | "waiting" | "blocked" | "success" | "failed";
    taskId: string;
    agentId: string;
    outcomeVersion: number;
  };
};

export function readChatTurnOutcomeTip(params: {
  cfg: OpenBotConfig;
  agentId: string;
  runId: string;
  sessionKey?: string;
}): ChatTaskUpdateTip | null {
  const agentId = params.agentId.trim();
  const runId = params.runId.trim();
  if (!agentId || !runId) {
    return null;
  }
  const taskId = chatTurnTaskId({
    agentId,
    runId,
    sessionKey: params.sessionKey,
  });
  const located = resolveConfiguredTaskOutcomeRoot(params.cfg, agentId);
  if (!located.ok) {
    return null;
  }
  const store = new DurableTaskOutcomeStore(located.root);
  try {
    const tip = store.loadTask(taskId);
    if (!tip?.taskId.trim() || !Number.isInteger(tip.outcomeVersion) || tip.outcomeVersion < 1) {
      return null;
    }
    return {
      taskId: tip.taskId,
      agentId,
      outcomeVersion: tip.outcomeVersion,
      judgement: tip.taskJudgement,
    };
  } catch {
    return null;
  } finally {
    store.close();
  }
}

export function buildChatTaskUpdateEvent(
  tip: ChatTaskUpdateTip | null | undefined,
): ChatTaskUpdateEvent | null {
  const taskId = tip?.taskId.trim() ?? "";
  const agentId = tip?.agentId.trim() ?? "";
  const outcomeVersion = tip?.outcomeVersion;
  if (
    !tip ||
    !taskId ||
    !agentId ||
    typeof outcomeVersion !== "number" ||
    !Number.isInteger(outcomeVersion) ||
    outcomeVersion < 1
  ) {
    return null;
  }
  const status =
    tip.judgement === "success"
      ? "success"
      : tip.judgement === "failure" || tip.judgement === "cancelled"
        ? "failed"
        : "running";
  const stepName =
    tip.judgement === "success" ? "已完成" : tip.judgement === "failure" ? "未通过" : "进行中";
  return {
    type: "task_update",
    task: {
      id: taskId,
      title: "任务结果",
      step_current: 1,
      step_total: 1,
      step_name: stepName,
      status,
      taskId,
      agentId,
      outcomeVersion,
    },
  };
}

/** Live chat final helper. No tip, or a store that is not already there, returns null. */
export function resolveChatFinalTaskUpdate(params: {
  cfg: OpenBotConfig;
  sessionKey: string;
  runId: string;
  agentId?: string;
}): ChatTaskUpdateEvent | null {
  const sessionKey = params.sessionKey.trim();
  const runId = params.runId.trim();
  if (!sessionKey || !runId) {
    return null;
  }
  const agentId =
    params.agentId?.trim() ||
    resolveSessionAgentId({
      sessionKey,
      config: params.cfg,
    });
  if (!agentId.trim()) {
    return null;
  }
  return buildChatTaskUpdateEvent(
    readChatTurnOutcomeTip({
      cfg: params.cfg,
      agentId,
      runId,
      sessionKey,
    }),
  );
}
