/**
 * status.ts — `loom status` view model + formatter (Requirement 10.4).
 *
 * Shows, per task: lifecycle state, whether it is blocked, and each session's
 * status incl. `dead` (activity-signal timeout). Pure read; no side effects.
 */

import { DEFAULT_DEAD_THRESHOLD_MS, isSessionDead } from "./lifecycle.js";
import type { Registry, SessionStatus, TaskState } from "./registry.js";

export type SessionView = {
  id: string;
  ide: string;
  agent: string;
  status: SessionStatus;
  dead: boolean;
  /** Provisioned worktree path + branch, when this session is isolated (Provisioning). */
  worktree?: string;
  branch?: string;
};

export type TaskView = {
  id: string;
  owner: string;
  state: TaskState;
  blocked: boolean;
  pathCount: number;
  sessions: SessionView[];
};

export type StatusView = {
  tasks: TaskView[];
  landingStreamCount: number;
  totals: {
    tasks: number;
    byState: Record<string, number>;
    deadSessions: number;
  };
};

export function buildStatus(
  registry: Registry,
  now: Date = new Date(),
  thresholdMs: number = DEFAULT_DEAD_THRESHOLD_MS,
): StatusView {
  const byState: Record<string, number> = {};
  let deadSessions = 0;
  const tasks: TaskView[] = registry.tasks.map((task) => {
    byState[task.state] = (byState[task.state] ?? 0) + 1;
    const sessions: SessionView[] = task.sessions.map((session) => {
      const dead = isSessionDead(session, now, thresholdMs);
      if (dead) {
        deadSessions += 1;
      }
      const meta = session.metadata;
      const branch = typeof meta.branch === "string" ? meta.branch : undefined;
      return {
        id: session.id,
        ide: session.ide,
        agent: session.agent,
        status: session.status,
        dead,
        worktree: session.worktree,
        branch,
      };
    });
    return {
      id: task.id,
      owner: task.owner,
      state: task.state,
      blocked: task.state === "blocked",
      pathCount: task.paths.length,
      sessions,
    };
  });
  return {
    tasks,
    landingStreamCount: registry.landingStreams.length,
    totals: {
      tasks: tasks.length,
      byState,
      deadSessions,
    },
  };
}

export function formatStatus(view: StatusView): string {
  const lines: string[] = [];
  lines.push("Loom status");
  const stateSummary = Object.entries(view.totals.byState)
    .map(([state, count]) => `${state}=${count}`)
    .join(", ");
  lines.push(`- tasks: ${view.totals.tasks}${stateSummary ? ` (${stateSummary})` : ""}`);
  lines.push(`- landing streams: ${view.landingStreamCount}`);
  lines.push(`- dead sessions: ${view.totals.deadSessions}`);
  lines.push("");
  for (const task of view.tasks) {
    const flags = task.blocked ? " [BLOCKED]" : "";
    lines.push(
      `## ${task.id}  (${task.state})${flags}  owner=${task.owner}  paths=${task.pathCount}`,
    );
    for (const session of task.sessions) {
      const deadFlag = session.dead ? " ⚠ dead (no recent signal — re-attribute or abandon?)" : "";
      lines.push(
        `   - ${session.id} [${session.ide}/${session.agent}] ${session.status}${deadFlag}`,
      );
      if (session.worktree) {
        lines.push(
          `       worktree: ${session.worktree}${session.branch ? ` (${session.branch})` : ""}`,
        );
      }
    }
  }
  return lines.join("\n");
}
