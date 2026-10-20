import { Type } from "@sinclair/typebox";
import { loadConfig } from "../../config/config.js";
import { broadcastWorkbenchSignalsInvalidate } from "../../gateway/workbench/signals-invalidate.js";
import { sendAgentTask } from "../../organization/inter-agent-bus.js";
import {
  createTaskAssignment,
  readOrganizationTaskAssignments,
  transitionTaskAssignment,
  upsertOrganizationTaskAssignment,
  writeOrganizationTaskAssignments,
  type TaskAssignment,
  type TaskAssignmentStatus,
} from "../../organization/task-assignment.js";
import { resolveWorkspaceRoot } from "../workspace-dir.js";
import { jsonResult, readStringParam, ToolAuthorizationError, ToolInputError } from "./common.js";
import type { AnyAgentTool } from "./common.js";
import { resolveAuthorizedOrganization } from "./organization-authz.js";

const OrganizationTasksToolSchema = Type.Object({
  action: Type.String({
    description: "One of: list, create, accept, start, complete, reject.",
  }),
  organizationId: Type.Optional(Type.String()),
  taskId: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  ownerAgentId: Type.Optional(Type.String()),
  notes: Type.Optional(Type.String()),
  notify: Type.Optional(Type.Boolean()),
});

function normalizeAction(
  raw: string,
): "list" | "create" | "accept" | "start" | "complete" | "reject" {
  const action = raw.trim().toLowerCase();
  if (
    action === "list" ||
    action === "create" ||
    action === "accept" ||
    action === "start" ||
    action === "complete" ||
    action === "reject"
  ) {
    return action;
  }
  throw new ToolInputError("action must be one of: list, create, accept, start, complete, reject");
}

function statusForAction(action: "accept" | "start" | "complete" | "reject"): TaskAssignmentStatus {
  if (action === "accept") {
    return "accepted";
  }
  if (action === "start") {
    return "running";
  }
  if (action === "complete") {
    return "completed";
  }
  return "rejected";
}

/** Collaboration-group (space) sessions, e.g. `agent:panda:main:space:grp-…`. */
function isCollaborationSpaceSession(sessionKey: string | undefined): boolean {
  return /(?:^|:)space:/.test(sessionKey?.trim().toLowerCase() ?? "");
}

/**
 * Actionable refusal: inside a collaboration-group round, a non-coordinator can
 * still delegate same-round sub-tasks via CollabEdge directives (≤2, depth 1).
 * This does not grant coordinator authority or create task assignments.
 */
export const COLLAB_EDGE_DELEGATION_HINT =
  "In this collaboration group round you can still delegate without coordinator rights: write the split in your visible reply and append up to 2 same-round edges, e.g. [[collab_edge:handoff|to=<member agentId or name>|reason=<sub-task>|remaining=<deliverable>|acceptance=<done when>]] or [[collab_edge:peer_ask|to=<member agentId or name>|reason=<question>]]. The round dispatches those members in this round. Do not retry organization_tasks or sessions_send, and do not ask the user to change coordinator settings for this.";

function assertCanCreate(params: {
  requesterAgentId: string;
  coordinatorAgentId?: string;
  permissions: string[];
  sessionKey?: string;
}): void {
  if (
    params.permissions.includes("assign_tasks") ||
    (params.coordinatorAgentId && params.coordinatorAgentId === params.requesterAgentId)
  ) {
    return;
  }
  const base = "Only the organization coordinator can create task assignments.";
  throw new ToolAuthorizationError(
    isCollaborationSpaceSession(params.sessionKey)
      ? `${base} ${COLLAB_EDGE_DELEGATION_HINT}`
      : base,
  );
}

function assertCanTransition(params: {
  assignment: TaskAssignment;
  requesterAgentId: string;
  coordinatorAgentId?: string;
}): void {
  if (
    params.assignment.ownerAgentId === params.requesterAgentId ||
    params.coordinatorAgentId === params.requesterAgentId
  ) {
    return;
  }
  throw new ToolAuthorizationError(
    "Only the task owner or organization coordinator can update this task.",
  );
}

export function createOrganizationTasksTool(opts?: {
  agentSessionKey?: string;
  requesterAgentIdOverride?: string;
  workspaceDir?: string;
  config?: ReturnType<typeof loadConfig>;
}): AnyAgentTool {
  return {
    label: "Organization Tasks",
    name: "organization_tasks",
    description:
      "Manage runtime organization task assignments. Use create to assign work, accept/start/complete/reject to acknowledge and update status, and list to inspect current assignments.",
    parameters: OrganizationTasksToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = normalizeAction(readStringParam(params, "action", { required: true }));
      const cfg = opts?.config ?? loadConfig();
      const workspaceDir = resolveWorkspaceRoot(opts?.workspaceDir);
      // P0-S: org scope + authority come from the runtime (target org), never from params.
      const authorized = await resolveAuthorizedOrganization({
        cfg,
        workspaceDir,
        agentSessionKey: opts?.agentSessionKey,
        requesterAgentIdOverride: opts?.requesterAgentIdOverride,
        explicitOrganizationId: readStringParam(params, "organizationId"),
      });
      const { requesterAgentId, organizationId, coordinatorAgentId } = authorized;

      if (action === "list") {
        const assignments = await readOrganizationTaskAssignments({
          cfg,
          workspaceDir,
          organizationId,
        });
        return jsonResult({
          status: "ok",
          organizationId,
          requesterAgentId,
          assignments,
        });
      }

      if (action === "create") {
        assertCanCreate({
          requesterAgentId,
          coordinatorAgentId,
          permissions: authorized.permissions,
          sessionKey: opts?.agentSessionKey,
        });
        const assignment = createTaskAssignment({
          organizationId,
          title: readStringParam(params, "title", { required: true }),
          ownerAgentId: readStringParam(params, "ownerAgentId", { required: true }),
          createdByAgentId: requesterAgentId,
          notes: readStringParam(params, "notes"),
        });
        await upsertOrganizationTaskAssignment({ cfg, workspaceDir, assignment });
        broadcastWorkbenchSignalsInvalidate({ reason: "task" });
        const shouldNotify = params.notify === true;
        const delivery = shouldNotify
          ? await sendAgentTask({
              assignment,
              sourceSessionKey: opts?.agentSessionKey,
              sourceAgentId: requesterAgentId,
            })
          : { status: "skipped" as const };
        return jsonResult({
          status: "ok",
          action,
          assignment,
          delivery,
        });
      }

      const taskId = readStringParam(params, "taskId", { required: true });
      const assignments = await readOrganizationTaskAssignments({
        cfg,
        workspaceDir,
        organizationId,
      });
      const assignment = assignments.find((entry) => entry.id === taskId);
      if (!assignment) {
        throw new ToolInputError(`Task assignment not found: ${taskId}`);
      }
      assertCanTransition({ assignment, requesterAgentId, coordinatorAgentId });
      const updated = transitionTaskAssignment(assignment, statusForAction(action), {
        notes: readStringParam(params, "notes"),
      });
      const next = assignments.map((entry) => (entry.id === updated.id ? updated : entry));
      await writeOrganizationTaskAssignments({
        cfg,
        workspaceDir,
        organizationId,
        assignments: next,
      });
      broadcastWorkbenchSignalsInvalidate({ reason: "task" });
      return jsonResult({
        status: "ok",
        action,
        assignment: updated,
      });
    },
  };
}
