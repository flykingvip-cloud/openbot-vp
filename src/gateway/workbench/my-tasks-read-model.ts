/**
 * Unified "我的任务" projection — thin actor-scoped summary across the three
 * personal task lanes (cron / supervised / assigned).
 *
 * Does not replace per-lane mutate RPCs; it is a read-side contract so clients
 * (and future badge/summary UIs) can load one actor-filtered snapshot instead of
 * stitching three differently-scoped lists.
 */

import { loadCronStore, resolveCronStorePath } from "../../cron/store.js";
import {
  readManagedOrganizationTaskAssignments,
  type TaskAssignment,
} from "../../organization/task-assignment.js";
import { listTasks } from "../supervisor/store.js";
import {
  actorOwnsSupervisedTask,
  type SupervisorTaskActor,
} from "../supervisor/task-access-scope.js";
import type { SupervisedTask } from "../supervisor/types.js";

export type WorkbenchMyTaskKind = "cron" | "supervised" | "assigned";

export type WorkbenchMyTaskItem = {
  id: string;
  kind: WorkbenchMyTaskKind;
  title: string;
  status?: string;
  updatedAtMs?: number;
  /** Best-effort origin (org id / backend id / cron agent). */
  source?: string;
};

export type WorkbenchMyTasksResult = {
  totalCount: number;
  cronCount: number;
  supervisedCount: number;
  assignedCount: number;
  cronJobs: WorkbenchMyTaskItem[];
  supervisedTasks: WorkbenchMyTaskItem[];
  assignedTasks: WorkbenchMyTaskItem[];
};

export type WorkbenchMyTasksCronJob = {
  id: string;
  name?: string;
  enabled?: boolean;
  agentId?: string;
  updatedAtMs?: number;
  state?: { lastRunAtMs?: number; nextRunAtMs?: number };
  ownership?: { tenantId?: string; ownerId?: string };
};

export type WorkbenchMyTasksDeps = {
  listCronJobs: () => Promise<WorkbenchMyTasksCronJob[]>;
  listSupervisedTasks: () => Promise<SupervisedTask[]>;
  listAssignedTasks: (organizationId: string) => Promise<TaskAssignment[]>;
};

export type WorkbenchMyTasksParams = {
  userId: string;
  userEmail?: string | null;
  tenantId?: string;
  /** Seat spaces used to scan managed assignee tasks. */
  seatSpaceIds?: string[];
  /** Max items per lane (default 50). */
  limit?: number;
  deps?: Partial<WorkbenchMyTasksDeps>;
};

const DEFAULT_LIMIT = 50;

function normalizeIdentity(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function defaultDeps(): WorkbenchMyTasksDeps {
  return {
    listCronJobs: async () => {
      try {
        const store = await loadCronStore(resolveCronStorePath());
        return (store.jobs ?? []) as WorkbenchMyTasksCronJob[];
      } catch {
        return [];
      }
    },
    listSupervisedTasks: async () => {
      try {
        return await listTasks();
      } catch {
        return [];
      }
    },
    listAssignedTasks: async (organizationId) => {
      try {
        return await readManagedOrganizationTaskAssignments(organizationId);
      } catch {
        return [];
      }
    },
  };
}

function cronBelongsToActor(
  job: WorkbenchMyTasksCronJob,
  actorIdentities: Set<string>,
  actorTenantId: string,
): boolean {
  const ownerId = normalizeIdentity(job.ownership?.ownerId);
  if (!ownerId || !actorIdentities.has(ownerId)) {
    return false;
  }
  const jobTenant = normalizeIdentity(job.ownership?.tenantId);
  if (jobTenant && actorTenantId && jobTenant !== actorTenantId) {
    return false;
  }
  return true;
}

function toCronItem(job: WorkbenchMyTasksCronJob): WorkbenchMyTaskItem {
  return {
    id: `cron:${job.id}`,
    kind: "cron",
    title: job.name?.trim() || job.id,
    status: job.enabled === false ? "disabled" : "enabled",
    updatedAtMs: job.updatedAtMs ?? job.state?.lastRunAtMs ?? job.state?.nextRunAtMs,
    source: job.agentId,
  };
}

function toSupervisedItem(task: SupervisedTask): WorkbenchMyTaskItem {
  return {
    id: `supervised:${task.taskId}`,
    kind: "supervised",
    title: task.goal,
    status: task.state,
    updatedAtMs: parseTimestamp(task.updatedAt),
    source: task.worker?.backendId,
  };
}

function toAssignedItem(task: TaskAssignment): WorkbenchMyTaskItem {
  return {
    id: `assigned:${task.id}`,
    kind: "assigned",
    title: task.title,
    status: task.status,
    updatedAtMs: parseTimestamp(task.updatedAt),
    source: task.organizationId,
  };
}

function sortByRecency(items: WorkbenchMyTaskItem[]): WorkbenchMyTaskItem[] {
  return items.toSorted((left, right) => (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0));
}

/**
 * Build the unified personal my-tasks projection for one actor.
 * Empty lanes are arrays (never omitted); no actor → caller should short-circuit.
 */
export async function buildWorkbenchMyTasks(
  params: WorkbenchMyTasksParams,
): Promise<WorkbenchMyTasksResult> {
  const deps: WorkbenchMyTasksDeps = { ...defaultDeps(), ...params.deps };
  const limit =
    typeof params.limit === "number" && Number.isFinite(params.limit) && params.limit > 0
      ? Math.floor(params.limit)
      : DEFAULT_LIMIT;
  const actorIdentities = new Set(
    [params.userId, params.userEmail ?? ""]
      .map((entry) => normalizeIdentity(entry))
      .filter(Boolean),
  );
  const actorTenantId = normalizeIdentity(params.tenantId);
  const supervisorActor: SupervisorTaskActor = {
    userId: params.userId,
    userEmail: params.userEmail?.trim() ?? "",
    ...(params.tenantId?.trim() ? { tenantId: params.tenantId.trim() } : {}),
  };
  const seatSpaceIds = [
    ...new Set((params.seatSpaceIds ?? []).map((id) => id.trim()).filter(Boolean)),
  ];
  const me = normalizeIdentity(params.userId);

  const [cronJobsRaw, supervisedRaw] = await Promise.all([
    deps.listCronJobs(),
    deps.listSupervisedTasks(),
  ]);

  const cronAll = sortByRecency(
    cronJobsRaw
      .filter((job) => cronBelongsToActor(job, actorIdentities, actorTenantId))
      .map(toCronItem),
  );
  const supervisedAll = sortByRecency(
    supervisedRaw
      .filter((task) => actorOwnsSupervisedTask(task, supervisorActor))
      .map(toSupervisedItem),
  );

  const assignedById = new Map<string, TaskAssignment>();
  for (const organizationId of seatSpaceIds) {
    let assignments: TaskAssignment[] = [];
    try {
      assignments = await deps.listAssignedTasks(organizationId);
    } catch {
      assignments = [];
    }
    for (const assignment of assignments) {
      if (!assignment.assigneeUserId || normalizeIdentity(assignment.assigneeUserId) !== me) {
        continue;
      }
      assignedById.set(assignment.id, assignment);
    }
  }
  const assignedAll = sortByRecency([...assignedById.values()].map(toAssignedItem));

  return {
    totalCount: cronAll.length + supervisedAll.length + assignedAll.length,
    cronCount: cronAll.length,
    supervisedCount: supervisedAll.length,
    assignedCount: assignedAll.length,
    cronJobs: cronAll.slice(0, limit),
    supervisedTasks: supervisedAll.slice(0, limit),
    assignedTasks: assignedAll.slice(0, limit),
  };
}
