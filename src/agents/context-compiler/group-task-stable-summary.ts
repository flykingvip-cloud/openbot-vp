/**
 * Stable group task summary for Context Compiler candidates.
 *
 * Expert recommendation #2: every collaboration turn should carry goal, hard
 * constraints, confirmed decisions, open context, deliverable refs, and owners
 * bound to group + task ledger (GROUP_PUBLIC memory SoT) — not only recent chat
 * or the last bot reply. When the session-bound task is no longer `active`,
 * flag-on still injects that ledger snapshot (or the most recent group task)
 * so「继续」does not lose the goal.
 *
 * Gated by collaboration.groupTaskStableSummary (default false).
 * Also OPENBOT_COLLAB_GROUP_TASK_STABLE_SUMMARY=1.
 * Does not widen Compiler windows, promote private LTM, or write private bags.
 */

import type { TaskLedgerEntry, TaskStatus } from "../../auto-reply/reply/session-continuity.js";
import type { OpenBotConfig } from "../../config/config.js";

export type StableGroupTaskBinding =
  | "bound"
  | "fallback-active"
  | "fallback-paused"
  | "fallback-recent";

export type StableGroupTaskSelection = {
  task: TaskLedgerEntry;
  binding: StableGroupTaskBinding;
};

const STATUS_RANK: Record<TaskStatus, number> = {
  active: 0,
  paused: 1,
  done: 2,
};

export function isGroupTaskStableSummaryEnabled(cfg?: OpenBotConfig | null): boolean {
  if (cfg?.collaboration?.groupTaskStableSummary === true) {
    return true;
  }
  const raw = process.env.OPENBOT_COLLAB_GROUP_TASK_STABLE_SUMMARY?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") {
    return true;
  }
  return false;
}

function sortByRecencyThenStatus(a: TaskLedgerEntry, b: TaskLedgerEntry): number {
  const byUpdated = b.updated_at.localeCompare(a.updated_at);
  if (byUpdated !== 0) {
    return byUpdated;
  }
  return (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
}

/**
 * Pick a stable group ledger task for injection.
 * Prefer the bound task regardless of status; else most recent active, then
 * paused, then any recent terminal row. Never invents a synthetic task.
 */
export function selectStableGroupTask(params: {
  tasks: readonly TaskLedgerEntry[];
  boundTaskId?: string | null;
}): StableGroupTaskSelection | undefined {
  const boundId = params.boundTaskId?.trim();
  if (boundId) {
    const bound = params.tasks.find((task) => task.id === boundId);
    if (bound) {
      return { task: bound, binding: "bound" };
    }
  }

  const sorted = [...params.tasks].toSorted(sortByRecencyThenStatus);
  const active = sorted.find((task) => task.status === "active");
  if (active) {
    return { task: active, binding: "fallback-active" };
  }
  const paused = sorted.find((task) => task.status === "paused");
  if (paused) {
    return { task: paused, binding: "fallback-paused" };
  }
  const recent = sorted[0];
  if (recent) {
    return { task: recent, binding: "fallback-recent" };
  }
  return undefined;
}

function pushSection(lines: string[], title: string, values: readonly string[]): void {
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return;
  }
  lines.push(`${title}:`);
  for (const value of cleaned) {
    lines.push(`- ${value}`);
  }
}

/**
 * Build a structured, ledger-traceable summary for group collaboration turns.
 * Fields map onto expert #2: goal, hard constraints, confirmed decisions,
 * open context, deliverable refs, owners — plus status/binding for diagnostics.
 */
export function buildStableGroupTaskSummaryText(
  task: TaskLedgerEntry,
  binding: StableGroupTaskBinding,
): string {
  const lines: string[] = [
    `Group task summary [${binding}]`,
    `Source: group-task-ledger id=${task.id} status=${task.status} group=${task.owner_id}`,
    `Goal: ${task.title}`,
  ];

  if (task.description?.trim()) {
    lines.push(`Description: ${task.description.trim()}`);
  }

  const goals = (task.project?.goals ?? []).map((goal) => goal.trim()).filter(Boolean);
  pushSection(lines, "Goals", goals);

  const constraints = (task.context.constraints ?? []).map((item) => item.trim()).filter(Boolean);
  pushSection(lines, "Hard constraints", constraints);

  const decisions = (task.decisions ?? [])
    .slice(-8)
    .map((decision) => decision.text.trim())
    .filter(Boolean);
  pushSection(lines, "Confirmed decisions", decisions);

  const openContext = (task.context.key_points ?? [])
    .map((point) => point.trim())
    .filter(Boolean)
    .slice(-8);
  pushSection(lines, "Open context", openContext);

  const deliverables = (task.artifacts ?? []).map((id) => id.trim()).filter(Boolean);
  pushSection(lines, "Deliverable refs", deliverables);

  const owners: string[] = [];
  if (task.project?.owner_human?.trim()) {
    owners.push(`human:${task.project.owner_human.trim()}`);
  }
  if (task.owner_id?.trim()) {
    owners.push(`group:${task.owner_id.trim()}`);
  }
  pushSection(lines, "Owners", owners);

  if (task.status !== "active") {
    lines.push(
      `Note: bound/recent group task is ${task.status}; injecting stable ledger snapshot so continue turns keep goal (not inventing memory).`,
    );
  }

  return lines.join("\n");
}

/** True when summary text looks like a private run bag leak (must never happen). */
export function stableSummaryLooksLikePrivateRunBag(text: string): boolean {
  return /CollaborationPrivateRunBag|"kind"\s*:\s*"private_run_bag"/i.test(text);
}
