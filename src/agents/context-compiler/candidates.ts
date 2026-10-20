import {
  buildTaskSummaryText,
  getTaskContext,
  listTaskContexts,
  resolveTaskContextScope,
} from "../../auto-reply/reply/task-context-store.js";
import type { OpenBotConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import {
  buildStableGroupTaskSummaryText,
  isGroupTaskStableSummaryEnabled,
  selectStableGroupTask,
} from "./group-task-stable-summary.js";
import type { ContextCandidates } from "./types.js";
import { readUserProfileEntries } from "./user-profile-store.js";

export type LoadContextCandidatesParams = {
  cfg?: OpenBotConfig;
  workspaceDir: string;
  agentId: string;
  sessionKey?: string;
  sessionEntry?: SessionEntry;
};

/**
 * Assembler-owned: load Context *candidates*.
 * The compiler is the only component allowed to admit them into model context.
 */
export async function loadContextCandidates(
  params: LoadContextCandidatesParams,
): Promise<ContextCandidates> {
  const [userProfile, task] = await Promise.all([
    readUserProfileEntries(params.workspaceDir),
    loadTaskCandidate(params),
  ]);
  return {
    userProfile,
    task,
    memory: "",
    evidence: "",
  };
}

async function loadTaskCandidate(params: LoadContextCandidatesParams): Promise<string> {
  if (!params.cfg) {
    return "";
  }
  const scope = resolveTaskContextScope({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    sessionEntry: params.sessionEntry,
  });
  const taskFilter = params.sessionEntry?.taskContextId?.trim();
  const stableEnabled = isGroupTaskStableSummaryEnabled(params.cfg);

  // Group + flag-on: keep a ledger-traceable summary even when the bound /
  // recent task is no longer active. Personal (agent) scope stays active-only.
  if (stableEnabled && scope.scope === "group") {
    const tasks = await listTaskContexts(scope);
    const selected = selectStableGroupTask({ tasks, boundTaskId: taskFilter });
    if (!selected) {
      return "";
    }
    return buildStableGroupTaskSummaryText(selected.task, selected.binding);
  }

  if (taskFilter) {
    const task = await getTaskContext(scope, taskFilter);
    // Sprint-1 / flag-off: bound taskContextId must still be active to inject.
    if (!task || task.status !== "active") {
      return "";
    }
    return buildTaskSummaryText(task);
  }
  const tasks = (await listTaskContexts(scope))
    .filter((task) => task.status === "active")
    .toSorted((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 1);
  return tasks[0] ? buildTaskSummaryText(tasks[0]) : "";
}
