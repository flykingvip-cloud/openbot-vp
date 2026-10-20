import { Type } from "@sinclair/typebox";
import { loadConfig } from "../../config/config.js";
import {
  createOrganizationArtifact,
  createOrganizationDecision,
  createOrganizationOwnership,
  readOrganizationArtifacts,
  readOrganizationDecisions,
  readOrganizationOwnerships,
  upsertOrganizationArtifact,
  upsertOrganizationDecision,
  upsertOrganizationOwnership,
  type OrganizationOwnershipSubject,
} from "../../organization/shared-memory.js";
import { resolveWorkspaceRoot } from "../workspace-dir.js";
import {
  jsonResult,
  readStringParam,
  ToolAuthorizationError,
  ToolInputError,
  type AnyAgentTool,
} from "./common.js";
import {
  resolveAuthorizedOrganization,
  type AuthorizedOrganization,
} from "./organization-authz.js";

const OrganizationMemoryToolSchema = Type.Object({
  action: Type.String({
    description:
      "One of: list_decisions, record_decision, list_artifacts, record_artifact, list_ownerships, assign_owner.",
  }),
  organizationId: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  status: Type.Optional(Type.String()),
  taskId: Type.Optional(Type.String()),
  rationale: Type.Optional(Type.String()),
  notes: Type.Optional(Type.String()),
  artifactType: Type.Optional(Type.String()),
  ownerAgentId: Type.Optional(Type.String()),
  uri: Type.Optional(Type.String()),
  subjectType: Type.Optional(Type.String()),
  subjectId: Type.Optional(Type.String()),
});

type OrganizationMemoryAction =
  | "list_decisions"
  | "record_decision"
  | "list_artifacts"
  | "record_artifact"
  | "list_ownerships"
  | "assign_owner";

function normalizeAction(raw: string): OrganizationMemoryAction {
  const action = raw.trim().toLowerCase();
  if (
    action === "list_decisions" ||
    action === "record_decision" ||
    action === "list_artifacts" ||
    action === "record_artifact" ||
    action === "list_ownerships" ||
    action === "assign_owner"
  ) {
    return action;
  }
  throw new ToolInputError(
    "action must be one of: list_decisions, record_decision, list_artifacts, record_artifact, list_ownerships, assign_owner",
  );
}

function assertCoordinator(params: {
  requesterAgentId: string;
  coordinatorAgentId?: string;
  permissions: string[];
}): void {
  if (
    params.permissions.includes("coordinate") ||
    params.coordinatorAgentId === params.requesterAgentId
  ) {
    return;
  }
  throw new ToolAuthorizationError("Only the organization coordinator can record this item.");
}

function isCoordinator(authorized: AuthorizedOrganization): boolean {
  return (
    authorized.permissions.includes("coordinate") ||
    authorized.coordinatorAgentId === authorized.requesterAgentId
  );
}

/**
 * record_artifact: the coordinator may record artifacts for any owner; any other
 * agent must be an active member of the target organization and may only record
 * artifacts it owns itself (assigning ownership to others is coordinator-only,
 * like assign_owner).
 */
function assertCanRecordArtifact(params: {
  authorized: AuthorizedOrganization;
  ownerAgentId: string;
}): void {
  const { authorized } = params;
  if (isCoordinator(authorized)) {
    return;
  }
  if (authorized.selfMemberStatus !== "active") {
    throw new ToolAuthorizationError(
      "Only active members of this organization can record artifacts.",
    );
  }
  if (params.ownerAgentId !== authorized.requesterAgentId) {
    throw new ToolAuthorizationError(
      "Only the organization coordinator can record artifacts owned by another agent.",
    );
  }
}

function normalizeOwnershipSubject(raw: string): OrganizationOwnershipSubject {
  const value = raw.trim().toLowerCase();
  if (value === "artifact" || value === "task" || value === "decision") {
    return value;
  }
  throw new ToolInputError("subjectType must be one of: artifact, task, decision");
}

export function createOrganizationMemoryTool(opts?: {
  agentSessionKey?: string;
  requesterAgentIdOverride?: string;
  workspaceDir?: string;
  config?: ReturnType<typeof loadConfig>;
}): AnyAgentTool {
  return {
    label: "Organization Memory",
    name: "organization_memory",
    description:
      "Read and write shared organization memory for decisions, artifacts, and ownerships. Artifacts require ownerAgentId, organizationId, and taskId.",
    parameters: OrganizationMemoryToolSchema,
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

      if (action === "list_decisions") {
        return jsonResult({
          status: "ok",
          organizationId,
          decisions: await readOrganizationDecisions({ cfg, workspaceDir, organizationId }),
        });
      }
      if (action === "list_artifacts") {
        return jsonResult({
          status: "ok",
          organizationId,
          artifacts: await readOrganizationArtifacts({ cfg, workspaceDir, organizationId }),
        });
      }
      if (action === "list_ownerships") {
        return jsonResult({
          status: "ok",
          organizationId,
          ownerships: await readOrganizationOwnerships({ cfg, workspaceDir, organizationId }),
        });
      }

      if (action === "record_decision" || action === "assign_owner") {
        assertCoordinator({
          requesterAgentId,
          coordinatorAgentId,
          permissions: authorized.permissions,
        });
      }

      if (action === "record_decision") {
        const decision = createOrganizationDecision({
          organizationId,
          title: readStringParam(params, "title", { required: true }),
          createdByAgentId: requesterAgentId,
          status: readStringParam(params, "status") === "approved" ? "approved" : "proposed",
          taskId: readStringParam(params, "taskId"),
          rationale: readStringParam(params, "rationale"),
          notes: readStringParam(params, "notes"),
        });
        await upsertOrganizationDecision({ cfg, workspaceDir, decision });
        return jsonResult({ status: "ok", action, decision });
      }

      if (action === "record_artifact") {
        const ownerAgentId = readStringParam(params, "ownerAgentId") ?? requesterAgentId;
        assertCanRecordArtifact({ authorized, ownerAgentId });
        const artifact = createOrganizationArtifact({
          organizationId,
          title: readStringParam(params, "title", { required: true }),
          artifactType: readStringParam(params, "artifactType", { required: true }),
          ownerAgentId,
          createdByAgentId: requesterAgentId,
          taskId: readStringParam(params, "taskId", { required: true }),
          uri: readStringParam(params, "uri"),
          status: readStringParam(params, "status") === "ready" ? "ready" : "draft",
          notes: readStringParam(params, "notes"),
        });
        await upsertOrganizationArtifact({ cfg, workspaceDir, artifact });
        const ownership = createOrganizationOwnership({
          organizationId,
          subjectType: "artifact",
          subjectId: artifact.id,
          ownerAgentId,
          assignedByAgentId: requesterAgentId,
          taskId: artifact.taskId,
          notes: "artifact owner",
        });
        await upsertOrganizationOwnership({ cfg, workspaceDir, ownership });
        return jsonResult({ status: "ok", action, artifact, ownership });
      }

      const ownership = createOrganizationOwnership({
        organizationId,
        subjectType: normalizeOwnershipSubject(
          readStringParam(params, "subjectType", { required: true }),
        ),
        subjectId: readStringParam(params, "subjectId", { required: true }),
        ownerAgentId: readStringParam(params, "ownerAgentId", { required: true }),
        assignedByAgentId: requesterAgentId,
        taskId: readStringParam(params, "taskId"),
        notes: readStringParam(params, "notes"),
      });
      await upsertOrganizationOwnership({ cfg, workspaceDir, ownership });
      return jsonResult({ status: "ok", action, ownership });
    },
  };
}
