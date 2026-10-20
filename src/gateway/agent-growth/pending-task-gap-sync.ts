/**
 * Agent Growth OS — P1+ 多轮任务缺口刷新（持久化 synced taskGaps）。
 *
 * get-growth-status / recompute / skill install 后把 installed 进度写回 pendingTaskContext，
 * 使 growth gate 与 UI 在多轮安装后读到一致的缺口状态。
 */

import type { OpenBotConfig } from "../../config/config.js";
import { collectInstalledSkillKeys } from "./installed-skills.js";
import type { GrowthCapabilityGapView } from "./next-action.js";
import { setRobotPendingTaskContext } from "./pending-task-context.js";
import { readRobotGrowthStatus } from "./store.js";
import { taskGapsFromSuggestedKeys } from "./task-requirement-extract.js";
import type { GrowthPendingTaskContext, GrowthStatus } from "./types.js";

type PendingTaskGap = GrowthPendingTaskContext["taskGaps"][number];

/** Persisted growth JSON can omit these arrays; `.length` on the hole crashes status refresh. */
function pendingSkillKeys(pending: GrowthPendingTaskContext): string[] {
  const keys = (pending as { suggestedSkillKeys?: unknown }).suggestedSkillKeys;
  if (!Array.isArray(keys)) {
    return [];
  }
  return keys.filter((key): key is string => typeof key === "string");
}

function pendingTaskGaps(pending: GrowthPendingTaskContext): PendingTaskGap[] {
  const gaps = (pending as { taskGaps?: unknown }).taskGaps;
  if (!Array.isArray(gaps)) {
    return [];
  }
  return gaps.filter((gap): gap is PendingTaskGap => {
    if (!gap || typeof gap !== "object") {
      return false;
    }
    return typeof (gap as PendingTaskGap).key === "string";
  });
}

export function refreshPendingTaskGapViews(
  pending: GrowthPendingTaskContext,
  installedSkillKeys: Iterable<string>,
): GrowthCapabilityGapView[] {
  const taskGaps = pendingTaskGaps(pending);
  const candidates = taskGaps.map((gap) => ({
    key: gap.key,
    label: gap.label,
  }));
  const storedKeys = pendingSkillKeys(pending);
  const keys = storedKeys.length > 0 ? storedKeys : taskGaps.map((gap) => gap.key);
  return taskGapsFromSuggestedKeys({
    suggestedSkillKeys: keys,
    candidates,
    installedSkillKeys,
  });
}

export function applyRefreshedTaskGapsToPending(
  pending: GrowthPendingTaskContext,
  refreshed: GrowthCapabilityGapView[],
): GrowthPendingTaskContext {
  const taskGaps = refreshed
    .filter((gap) => gap.kind === "skill")
    .map((gap) => ({
      key: gap.key,
      label: gap.label,
      kind: "skill" as const,
      status: gap.status === "satisfied" ? ("satisfied" as const) : ("missing" as const),
    }));
  const missingKeys = taskGaps.filter((gap) => gap.status === "missing").map((gap) => gap.key);
  const storedKeys = pendingSkillKeys(pending);
  const suggestedSkillKeys =
    storedKeys.length > 0 ? storedKeys.filter((key) => missingKeys.includes(key)) : missingKeys;
  return {
    ...pending,
    suggestedSkillKeys,
    taskGaps,
  };
}

export function pendingTaskGapsChanged(
  before: GrowthPendingTaskContext,
  after: GrowthPendingTaskContext,
): boolean {
  const beforeGaps = pendingTaskGaps(before);
  const afterGaps = pendingTaskGaps(after);
  if (beforeGaps.length !== afterGaps.length) {
    return true;
  }
  for (let index = 0; index < beforeGaps.length; index += 1) {
    const left = beforeGaps[index];
    const right = afterGaps[index];
    if (!left || !right) {
      return true;
    }
    if (left.key !== right.key || left.status !== right.status) {
      return true;
    }
  }
  if (pendingSkillKeys(before).join(",") !== pendingSkillKeys(after).join(",")) {
    return true;
  }
  return false;
}

/** 读取 → 刷新 taskGaps 状态 → 有变化则持久化。 */
export async function syncRobotPendingTaskGapStatuses(
  cfg: OpenBotConfig,
  agentId: string,
  currentStatus?: GrowthStatus | null,
): Promise<GrowthStatus | null> {
  const current = currentStatus ?? (await readRobotGrowthStatus(cfg, agentId));
  const pending = current?.pendingTaskContext;
  if (!current || !pending) {
    return current;
  }
  const refreshed = refreshPendingTaskGapViews(pending, collectInstalledSkillKeys(agentId));
  const nextPending = applyRefreshedTaskGapsToPending(pending, refreshed);
  if (!pendingTaskGapsChanged(pending, nextPending)) {
    return current;
  }
  return await setRobotPendingTaskContext(cfg, agentId, nextPending);
}
