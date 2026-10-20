import {
  readManagedOrganizationTaskAssignments,
  type TaskAssignment,
  type TaskAssignmentStatus,
  transitionTaskAssignment,
  upsertManagedOrganizationTaskAssignment,
} from "../../organization/task-assignment.js";
import { resolveEmployeeWorkbenchActor } from "../employee-workbench-scope.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { looseRecordOrEmpty as asRecord } from "../records.js";
import type { GatewayRequestHandlerOptions, GatewayRequestHandlers } from "./types.js";

/**
 * Human-assignee task close-loop RPCs (Phase C4b). Meeting fan-out (C4a) writes
 * managed `TaskAssignment`s carrying `assigneeUserId`; these RPCs let the ASSIGNEE
 * accept / complete / list THEIR OWN tasks.
 *
 * Authorization is structural, not a filter we could forget: a caller may only
 * mutate a task whose `assigneeUserId` matches the resolved actor, so passing an
 * arbitrary `(organizationId, id)` can only ever resolve to the caller's own task
 * (ownership-based isolation, mirroring the M1 assignee filter). Legacy per-agent
 * tasks (no `assigneeUserId`) are never actionable here.
 */

function normalizeId(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

type HandlerCtx = GatewayRequestHandlerOptions;

export const taskHandlers: GatewayRequestHandlers = {
  "task.accept": async (ctx) => {
    await mutateOwnTask(ctx, { to: "accepted", require: "pending" });
  },

  "task.complete": async (ctx) => {
    await mutateOwnTask(ctx, { to: "completed", forbid: ["completed", "rejected"] });
  },

  "task.list": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(true, { tasks: [] });
      return;
    }
    const record = asRecord(params);
    const organizationId =
      typeof record.organizationId === "string" ? record.organizationId.trim() : "";
    const orgIds = organizationId
      ? [organizationId]
      : [...new Set((actor.seatSpaceIds ?? []).map((id) => id.trim()).filter(Boolean))];
    const me = normalizeId(actor.userId);
    const tasks: TaskAssignment[] = [];
    for (const org of orgIds) {
      let assignments: TaskAssignment[] = [];
      try {
        assignments = await readManagedOrganizationTaskAssignments(org);
      } catch {
        assignments = [];
      }
      for (const assignment of assignments) {
        // Only the actor's own assigned tasks (never legacy per-agent tasks).
        if (assignment.assigneeUserId && normalizeId(assignment.assigneeUserId) === me) {
          tasks.push(assignment);
        }
      }
    }
    respond(true, { tasks });
  },
};

/**
 * Shared accept/complete handler: resolve the actor, locate the task in its managed
 * org store, enforce assignee ownership + the allowed status guard, then transition.
 */
async function mutateOwnTask(
  ctx: HandlerCtx,
  rule: {
    to: "accepted" | "completed";
    require?: TaskAssignmentStatus;
    forbid?: TaskAssignmentStatus[];
  },
): Promise<void> {
  const { params, respond, client } = ctx;
  const actor = await resolveEmployeeWorkbenchActor(client);
  if (!actor) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no workbench actor"));
    return;
  }
  const record = asRecord(params);
  const organizationId =
    typeof record.organizationId === "string" ? record.organizationId.trim() : "";
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!organizationId || !id) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "organizationId and id are required"),
    );
    return;
  }
  try {
    const assignments = await readManagedOrganizationTaskAssignments(organizationId);
    const task = assignments.find((entry) => entry.id === id);
    if (!task) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "task not found"));
      return;
    }
    if (!task.assigneeUserId || normalizeId(task.assigneeUserId) !== normalizeId(actor.userId)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "not your task"));
      return;
    }
    if (rule.require && task.status !== rule.require) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `task is not ${rule.require}`),
      );
      return;
    }
    if (rule.forbid && rule.forbid.includes(task.status)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `task already ${task.status}`),
      );
      return;
    }
    const updated = await upsertManagedOrganizationTaskAssignment(
      transitionTaskAssignment(task, rule.to),
    );
    respond(true, { task: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to update task";
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
  }
}
