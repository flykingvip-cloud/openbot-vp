import type { OpenBotConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import { truncateUtf16Safe } from "../../utils.js";
import {
  getTaskContext,
  listTaskContexts,
  resolveTaskContextScope,
  updateTaskContext,
} from "./task-context-store.js";

const CORRECTION_MARKERS =
  /(搞错|理解错|走偏|偏了|不对|不是这个|你错|弄错|搞混|跑偏|理解有误|方向错)/u;

const GOAL_LEAD_MARKERS =
  /(?:要让|应该是|目标是|真正(?:的)?(?:目标)?是|请(?:让|改为|改成|通过)|必须(?:让|通过)|需要(?:让|通过)|调用(?:这个|该)?)/u;

export type GoalCorrectionMutation = {
  goal: string;
  title: string;
};

function normalizeGoalText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function buildTitleFromGoal(goal: string): string {
  const compact = goal.replace(/\s+/gu, " ").trim();
  if (!compact) {
    return "User corrected goal";
  }
  const firstSentence = compact.split(/[。！？!?；;]/u)[0]?.trim() ?? compact;
  return truncateUtf16Safe(firstSentence, 120);
}

/**
 * Detect high-confidence user goal corrections (zh/en). Returns null when uncertain.
 */
export function extractGoalCorrectionMutation(text: string): GoalCorrectionMutation | null {
  const normalized = normalizeGoalText(text);
  if (!normalized || normalized.length < 6) {
    return null;
  }
  const hasCorrection = CORRECTION_MARKERS.test(normalized);
  const hasGoalLead = GOAL_LEAD_MARKERS.test(normalized);
  if (!hasCorrection && !hasGoalLead) {
    return null;
  }
  const goal = truncateUtf16Safe(normalized, 800);
  return {
    goal,
    title: buildTitleFromGoal(goal),
  };
}

export async function buildActivePrimaryObjectivePrompt(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  agentId: string;
  sessionKey?: string;
  sessionEntry?: SessionEntry;
}): Promise<string | undefined> {
  const scope = resolveTaskContextScope({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    sessionEntry: params.sessionEntry,
  });
  const taskFilter = params.sessionEntry?.taskContextId?.trim();
  if (!taskFilter) {
    return undefined;
  }
  const activeTasks = (await listTaskContexts(scope))
    .filter((task) => task.status === "active" && task.id === taskFilter)
    .toSorted((a, b) => b.updated_at.localeCompare(a.updated_at));
  const primaryTask = activeTasks[0];
  if (!primaryTask) {
    return undefined;
  }
  const correctionPoint = [...primaryTask.context.key_points]
    .toReversed()
    .find((point) => point.startsWith("User correction (authoritative):"));
  const primaryObjective =
    correctionPoint?.replace(/^User correction \(authoritative\):\s*/u, "").trim() ||
    primaryTask.description?.trim() ||
    primaryTask.context.key_points.at(-1)?.trim();
  if (!primaryObjective) {
    return undefined;
  }
  return ["Bound workspace task context (not ConversationTask identity):", primaryObjective].join(
    "\n",
  );
}

export async function applyGoalCorrectionMutation(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  agentId: string;
  sessionKey?: string;
  sessionEntry?: SessionEntry;
  text: string;
  sourceMessageId: string;
}): Promise<"updated" | null> {
  const mutation = extractGoalCorrectionMutation(params.text);
  const sourceMessageId = params.sourceMessageId.trim();
  if (!mutation || !sourceMessageId) {
    return null;
  }
  const boundTaskId = params.sessionEntry?.taskContextId?.trim();
  if (!boundTaskId) {
    return null;
  }
  const scope = resolveTaskContextScope({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    sessionEntry: params.sessionEntry,
  });
  const correctionPoint = `User correction (authoritative): ${mutation.goal}`;
  const existing = await getTaskContext(scope, boundTaskId);
  const priorPoints = existing?.context.key_points ?? [];
  const updated = await updateTaskContext({
    scope,
    taskId: boundTaskId,
    patch: {
      title: mutation.title,
      description: mutation.goal,
      status: "active",
      context: {
        key_points: [...priorPoints, correctionPoint].slice(-12),
        constraints: ["Follow the latest user correction over earlier plan drift."],
      },
    },
  });
  return updated ? "updated" : null;
}
