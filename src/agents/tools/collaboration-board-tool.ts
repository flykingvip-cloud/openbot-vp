/**
 * Executor-facing collaboration board tool (P0-1).
 *
 * Wraps existing claim-contract entry functions so Mode B executors can
 * markInProgress / submitForReview / proposeTodolist, and 主答 can
 * acceptSubmission / returnSubmission, without a second orchestrator.
 * Default OFF: only exposed when claimContract or claimContractGroupAllowlist
 * hits for the session group. Claimant writes still go through
 * requireClaimantActor + plan gate + S3 versioning inside the entry;
 * accept/return are reviewer/coordinator paths (no claimant check in the tool).
 *
 * Catalog sideEffectLevel is reversible so delivery-tool-side-effect can
 * fingerprint submit/mark under a confirmed delivery exec turn.
 */
import { Type } from "@sinclair/typebox";
import type { OpenBotConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { extractCollaborationGroupId } from "../../conversations/shared-task-runtime.js";
import { isCollabTaskClaimContractEnabled } from "../../gateway/collaboration-dispatch/claim-contract.js";
import {
  acceptCollaborationBoardItemSubmission,
  ClaimContractEntryError,
  ClaimContractFlagOffError,
  getCollaborationBoardMemberProgress,
  getCollaborationTodolist,
  listCollaborationBoardItems,
  markCollaborationBoardItemInProgress,
  proposeCollaborationTodolist,
  returnCollaborationBoardItemSubmission,
  submitCollaborationBoardItemForReview,
} from "../../gateway/collaboration-learning/claim-contract-entry.js";
import {
  resolveDeliveryAclActor,
  type DeliveryActorClient,
} from "../../gateway/collaboration-learning/delivery-actor-binding.js";
import { labelCollaborationIoTenant } from "../../gateway/collaboration-learning/trusted-tenant.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { stringEnum } from "../schema/typebox.js";
import { asToolParams, jsonResult, readStringParam, type AnyAgentTool } from "./common.js";

export const COLLABORATION_BOARD_TOOL = "collaboration_board";

const WRITE_ACTIONS = [
  "propose_todolist",
  "mark_in_progress",
  "submit_for_review",
  "accept_submission",
  "return_submission",
] as const;

const READ_ACTIONS = ["list_items", "get_member_progress", "get_todolist"] as const;

const ALL_ACTIONS = [...READ_ACTIONS, ...WRITE_ACTIONS] as const;

type BoardAction = (typeof ALL_ACTIONS)[number];

const CollaborationBoardSchema = Type.Object({
  action: stringEnum(ALL_ACTIONS),
  groupId: Type.Optional(
    Type.String({
      description:
        "Collaboration group id. Defaults to the space: group from the agent session key.",
    }),
  ),
  taskId: Type.Optional(Type.String({ description: "Shared board task id." })),
  itemId: Type.Optional(
    Type.String({
      description:
        "Board claim item id (mark_in_progress / submit_for_review / accept_submission / return_submission / list scope).",
    }),
  ),
  boardItemId: Type.Optional(
    Type.String({
      description: "Alias of itemId for propose_todolist (board item the private list belongs to).",
    }),
  ),
  todolistId: Type.Optional(Type.String({ description: "Private todolist id for get_todolist." })),
  submissionId: Type.Optional(
    Type.String({
      description: "UUID submission id for submit_for_review (S3 versioning).",
    }),
  ),
  artifactVersion: Type.Optional(
    Type.String({
      description: "Non-empty artifact version bound to this submission (S3).",
    }),
  ),
  submissionSummary: Type.Optional(
    Type.String({
      description:
        "Non-empty submission body. Empty / whitespace-only is refused (empty_submission).",
    }),
  ),
  steps: Type.Optional(
    Type.Array(
      Type.Object({
        title: Type.String(),
        detail: Type.Optional(Type.String()),
        stepId: Type.Optional(Type.String()),
      }),
      { description: "propose_todolist steps (min 1)." },
    ),
  ),
  expectedSubmissionId: Type.Optional(
    Type.String({
      description:
        "Pending submissionId that accept_submission / return_submission must match (S3 versioning).",
    }),
  ),
  reason: Type.Optional(
    Type.String({
      description: "Required rationale for accept_submission / return_submission.",
    }),
  ),
  checkedAcceptanceCriteria: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "accept_submission: Acceptance clauses checked; must cover board acceptanceCriteria.",
    }),
  ),
  proxyForActorId: Type.Optional(
    Type.String({
      description: "Optional proxy subject when accepting on behalf of another role.",
    }),
  ),
  proxyBasis: Type.Optional(
    Type.String({
      description: "Proxy basis / 身份依据 when proxyForActorId is set.",
    }),
  ),
});

export type CollaborationBoardToolDeps = {
  isEnabled?: (
    cfg: OpenBotConfig | undefined,
    groupId?: string | null,
    tenantId?: string | null,
  ) => boolean;
  resolveActor?: (
    client: DeliveryActorClient | null,
    groupId: unknown,
  ) => Promise<string | undefined>;
  listItems?: typeof listCollaborationBoardItems;
  getMemberProgress?: typeof getCollaborationBoardMemberProgress;
  getTodolist?: typeof getCollaborationTodolist;
  proposeTodolist?: typeof proposeCollaborationTodolist;
  markInProgress?: typeof markCollaborationBoardItemInProgress;
  submitForReview?: typeof submitCollaborationBoardItemForReview;
  acceptSubmission?: typeof acceptCollaborationBoardItemSubmission;
  returnSubmission?: typeof returnCollaborationBoardItemSubmission;
};

function isWriteAction(action: BoardAction): boolean {
  return (WRITE_ACTIONS as readonly string[]).includes(action);
}

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/**
 * Gray allowlist keys use managed tenant slugs (`001/…`, `personal_local/…`).
 * Some agent runs pass `sessionEnterpriseId` as a UUID, which never matches those
 * entries and would hide the tool on the gray group. Treat UUID/opaque ids as
 * "no tenant key" so `personal_local/` allowlist entries can authorize.
 */
function resolveClaimTenantIdForAllowlist(tenantId?: string | null): string | null {
  const t = tenantId?.trim() || "";
  if (!t) {
    return null;
  }
  if (t === "001" || t === "personal_local" || t === "_local" || t === "*") {
    return t;
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) {
    return null;
  }
  return t;
}

/**
 * Group id from session key for tool expose/resolve.
 * `extractCollaborationGroupId` only matches `space:`; executor bots in gray groups
 * commonly run as `agent:<id>:org:<groupId>` via organization_mentions, which does not
 * always carry CollaborationGroupId into the tool bag — also accept `org:`.
 */
function groupIdFromAgentSessionKey(sessionKey?: string | null): string {
  const fromSpace = extractCollaborationGroupId(sessionKey);
  if (fromSpace) {
    return fromSpace;
  }
  const raw = sessionKey?.trim().toLowerCase() ?? "";
  const orgMatch = raw.match(/(?:^|:)org:([^:]+)/);
  if (!orgMatch?.[1]) {
    return "";
  }
  try {
    return decodeURIComponent(orgMatch[1]);
  } catch {
    return orgMatch[1];
  }
}

/** True when claim contract is on for this session group (global flag or allowlist). */
export function shouldExposeCollaborationBoardTool(params: {
  config?: OpenBotConfig;
  agentSessionKey?: string;
  agentGroupId?: string | null;
  tenantId?: string | null;
  isEnabled?: CollaborationBoardToolDeps["isEnabled"];
}): boolean {
  const groupId =
    compact(params.agentGroupId) || groupIdFromAgentSessionKey(params.agentSessionKey) || "";
  if (!groupId) {
    return false;
  }
  const enabled = params.isEnabled ?? isCollabTaskClaimContractEnabled;
  return enabled(params.config, groupId, resolveClaimTenantIdForAllowlist(params.tenantId));
}

function buildActorClient(agentId: string): DeliveryActorClient {
  const id = agentId.trim();
  return {
    user: id,
    platformUserId: id,
    sessionMembershipId: id,
    connect: {
      user: id,
      client: { id, displayName: id },
    },
  };
}

function failResult(reason: string, message: string, extra?: Record<string, unknown>) {
  return jsonResult({
    ok: false,
    reason,
    message,
    ...extra,
  });
}

function mapEntryError(error: unknown) {
  if (error instanceof ClaimContractFlagOffError) {
    return failResult("flag_off", error.message);
  }
  if (error instanceof ClaimContractEntryError) {
    return failResult(error.code, error.message);
  }
  if (error instanceof Error) {
    const unbound = error.message.includes("actor_not_authenticated");
    if (unbound) {
      return failResult("actor_not_authenticated", error.message);
    }
    return failResult("error", error.message);
  }
  return failResult("error", String(error));
}

function resolveGroupId(params: {
  paramGroupId?: string;
  agentGroupId?: string | null;
  agentSessionKey?: string;
}): { ok: true; groupId: string } | { ok: false; reason: string; message: string } {
  const fromParams = compact(params.paramGroupId);
  const fromSession =
    compact(params.agentGroupId) || groupIdFromAgentSessionKey(params.agentSessionKey) || "";
  if (fromParams && fromSession && fromParams !== fromSession) {
    return {
      ok: false,
      reason: "group_mismatch",
      message: `groupId param (${fromParams}) does not match session group (${fromSession})`,
    };
  }
  const groupId = fromParams || fromSession;
  if (!groupId) {
    return {
      ok: false,
      reason: "group_required",
      message: "groupId is required (pass it or run inside a space: collaboration session)",
    };
  }
  return { ok: true, groupId };
}

export function createCollaborationBoardTool(options?: {
  agentSessionKey?: string;
  requesterAgentIdOverride?: string;
  agentGroupId?: string | null;
  tenantId?: string | null;
  config?: OpenBotConfig;
  deps?: CollaborationBoardToolDeps;
}): AnyAgentTool {
  const deps = options?.deps ?? {};
  const isEnabled = deps.isEnabled ?? isCollabTaskClaimContractEnabled;
  const resolveActor = deps.resolveActor ?? resolveDeliveryAclActor;
  const listItems = deps.listItems ?? listCollaborationBoardItems;
  const getMemberProgress = deps.getMemberProgress ?? getCollaborationBoardMemberProgress;
  const getTodolist = deps.getTodolist ?? getCollaborationTodolist;
  const proposeTodolist = deps.proposeTodolist ?? proposeCollaborationTodolist;
  const markInProgress = deps.markInProgress ?? markCollaborationBoardItemInProgress;
  const submitForReview = deps.submitForReview ?? submitCollaborationBoardItemForReview;
  const acceptSubmission = deps.acceptSubmission ?? acceptCollaborationBoardItemSubmission;
  const returnSubmission = deps.returnSubmission ?? returnCollaborationBoardItemSubmission;

  return {
    name: COLLABORATION_BOARD_TOOL,
    label: "Collaboration board",
    description:
      "Collaboration board tools (Mode B). Actions: list_items, get_member_progress, get_todolist (read); propose_todolist, mark_in_progress, submit_for_review, accept_submission, return_submission (write). Requires claimContract / claimContractGroupAllowlist for this group. Claimant writes (propose/mark/submit) enforce claimant + plan gate + S3 inside the entry. submit_for_review needs submissionId (UUID) + artifactVersion + non-empty submissionSummary. accept_submission / return_submission are 主答验收 paths: expectedSubmissionId + reason required; accept also needs checkedAcceptanceCriteria. Does not invent a second orchestrator.",
    parameters: CollaborationBoardSchema,
    execute: async (_toolCallId, args) => {
      const params = asToolParams(args);
      const actionRaw = readStringParam(params, "action", { required: true });
      const action = actionRaw as BoardAction;
      if (!(ALL_ACTIONS as readonly string[]).includes(action)) {
        return failResult("invalid_action", `action must be one of: ${ALL_ACTIONS.join(", ")}`);
      }

      const cfg = options?.config ?? loadConfig();
      const groupResolved = resolveGroupId({
        paramGroupId: readStringParam(params, "groupId"),
        agentGroupId: options?.agentGroupId,
        agentSessionKey: options?.agentSessionKey,
      });
      if (!groupResolved.ok) {
        return failResult(groupResolved.reason, groupResolved.message);
      }
      const { groupId } = groupResolved;
      const tenantIdRaw = options?.tenantId?.trim() || null;
      const tenantId = resolveClaimTenantIdForAllowlist(tenantIdRaw);

      // Defense in depth: even if the tool was injected, refuse when flag/allowlist miss.
      if (!isEnabled(cfg, groupId, tenantId)) {
        return failResult(
          "flag_off",
          "collaboration.task.claimContract is off for this group; enable the flag or claimContractGroupAllowlist",
          { groupId },
        );
      }

      const agentId =
        options?.requesterAgentIdOverride?.trim() ||
        resolveSessionAgentId({ sessionKey: options?.agentSessionKey, config: cfg });
      if (!agentId) {
        return failResult("actor_required", "could not resolve acting agent id");
      }

      let actor: string | undefined;
      try {
        actor = await resolveActor(buildActorClient(agentId), groupId);
      } catch (error) {
        return mapEntryError(error);
      }
      const actorRaw = compact(actor) || agentId;
      if (!actorRaw) {
        return failResult("actor_required", "resolveDeliveryAclActor returned no actor");
      }
      // Board claims store bot claimants as `bot:<id>`; session agent ids are bare.
      const actorId =
        actorRaw.startsWith("bot:") ||
        actorRaw.startsWith("agent:") ||
        actorRaw.startsWith("human:")
          ? actorRaw
          : `bot:${actorRaw}`;

      // Write path: never let a non-session agent spoof another owner via params.
      if (isWriteAction(action) && actorId !== agentId) {
        // Prefer session agent when ACL rebound to a different subject that is not us —
        // for in-process bots the synthetic client should keep agentId; if it drifted,
        // still require claimant checks against the resolved actor below.
      }

      const taskId = readStringParam(params, "taskId");
      const itemId =
        readStringParam(params, "itemId") || readStringParam(params, "boardItemId") || undefined;

      try {
        if (action === "list_items") {
          if (!taskId) {
            return failResult("invalid_input", "list_items requires taskId");
          }
          const items = await listItems({
            groupId,
            taskId,
            tenant: labelCollaborationIoTenant(tenantId),
            cfg,
          });
          return jsonResult({ ok: true, action, groupId, taskId, items });
        }

        if (action === "get_member_progress") {
          if (!taskId) {
            return failResult("invalid_input", "get_member_progress requires taskId");
          }
          const progress = await getMemberProgress({
            groupId,
            taskId,
            tenant: labelCollaborationIoTenant(tenantId),
            cfg,
          });
          return jsonResult({ ok: true, action, groupId, taskId, progress });
        }

        if (action === "get_todolist") {
          if (!taskId) {
            return failResult("invalid_input", "get_todolist requires taskId");
          }
          const todolistId = readStringParam(params, "todolistId", { required: true });
          const todolist = await getTodolist({
            groupId,
            taskId,
            todolistId,
            actor: actorId,
            tenant: labelCollaborationIoTenant(tenantId),
            cfg,
          });
          return jsonResult({ ok: true, action, groupId, taskId, todolist });
        }

        if (action === "propose_todolist") {
          if (!taskId) {
            return failResult("invalid_input", "propose_todolist requires taskId");
          }
          const boardItemId = itemId;
          if (!boardItemId) {
            return failResult("invalid_input", "propose_todolist requires boardItemId or itemId");
          }
          const stepsRaw = params.steps;
          if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
            return failResult("invalid_input", "propose_todolist requires non-empty steps");
          }
          const steps = stepsRaw.map((step, index) => {
            const row = step && typeof step === "object" ? (step as Record<string, unknown>) : {};
            const title = typeof row.title === "string" ? row.title.trim() : "";
            if (!title) {
              throw new ClaimContractEntryError(
                "invalid_input",
                `steps[${index}].title is required`,
              );
            }
            return {
              title,
              detail: typeof row.detail === "string" ? row.detail : undefined,
              stepId: typeof row.stepId === "string" ? row.stepId.trim() || undefined : undefined,
            };
          });
          const proposed = await proposeTodolist({
            groupId,
            taskId,
            boardItemId,
            steps,
            actor: actorId,
            ownerMemberId: actorId,
            tenant: labelCollaborationIoTenant(tenantId),
            cfg,
          });
          return jsonResult({
            ok: true,
            action,
            groupId,
            taskId,
            todolist: proposed.todolist,
            cardDelivery: proposed.cardDelivery,
          });
        }

        if (action === "mark_in_progress") {
          if (!taskId || !itemId) {
            return failResult("invalid_input", "mark_in_progress requires taskId and itemId");
          }
          const item = await markInProgress({
            groupId,
            taskId,
            itemId,
            actor: actorId,
            tenant: labelCollaborationIoTenant(tenantId),
            cfg,
          });
          return jsonResult({ ok: true, action, groupId, taskId, item });
        }

        if (action === "submit_for_review") {
          if (!taskId || !itemId) {
            return failResult("invalid_input", "submit_for_review requires taskId and itemId");
          }
          const submissionId = readStringParam(params, "submissionId", { required: true });
          const artifactVersion = readStringParam(params, "artifactVersion", { required: true });
          const submissionSummary = readStringParam(params, "submissionSummary");
          if (!submissionSummary?.trim()) {
            return failResult(
              "empty_submission",
              "submissionSummary is required and must be non-empty; empty/duplicate does not count as success",
            );
          }
          const item = await submitForReview({
            groupId,
            taskId,
            itemId,
            submissionId,
            artifactVersion,
            submissionSummary,
            actor: actorId,
            tenant: labelCollaborationIoTenant(tenantId),
            cfg,
          });
          return jsonResult({ ok: true, action, groupId, taskId, item });
        }

        if (action === "accept_submission") {
          if (!taskId || !itemId) {
            return failResult("invalid_input", "accept_submission requires taskId and itemId");
          }
          const expectedSubmissionId = readStringParam(params, "expectedSubmissionId", {
            required: true,
          });
          const reason = readStringParam(params, "reason");
          if (!reason?.trim()) {
            return failResult("invalid_input", "accept_submission requires a non-empty reason");
          }
          const criteriaRaw = params.checkedAcceptanceCriteria;
          if (!Array.isArray(criteriaRaw) || criteriaRaw.length === 0) {
            return failResult(
              "invalid_input",
              "accept_submission requires non-empty checkedAcceptanceCriteria",
            );
          }
          const checkedAcceptanceCriteria = criteriaRaw.map((row, index) => {
            const value = typeof row === "string" ? row.trim() : "";
            if (!value) {
              throw new ClaimContractEntryError(
                "invalid_input",
                `checkedAcceptanceCriteria[${index}] must be a non-empty string`,
              );
            }
            return value;
          });
          const proxyForActorId = readStringParam(params, "proxyForActorId") || undefined;
          const proxyBasis = readStringParam(params, "proxyBasis") || undefined;
          const item = await acceptSubmission({
            groupId,
            taskId,
            itemId,
            expectedSubmissionId,
            reason,
            checkedAcceptanceCriteria,
            proxyForActorId,
            proxyBasis,
            actor: actorId,
            tenant: labelCollaborationIoTenant(tenantId),
            cfg,
          });
          return jsonResult({ ok: true, action, groupId, taskId, item });
        }

        if (action === "return_submission") {
          if (!taskId || !itemId) {
            return failResult("invalid_input", "return_submission requires taskId and itemId");
          }
          const expectedSubmissionId = readStringParam(params, "expectedSubmissionId", {
            required: true,
          });
          const reason = readStringParam(params, "reason");
          if (!reason?.trim()) {
            return failResult("invalid_input", "return_submission requires a non-empty reason");
          }
          const item = await returnSubmission({
            groupId,
            taskId,
            itemId,
            expectedSubmissionId,
            reason,
            actor: actorId,
            tenant: labelCollaborationIoTenant(tenantId),
            cfg,
          });
          return jsonResult({ ok: true, action, groupId, taskId, item });
        }

        // Exhaustiveness: BoardAction union is handled above.
        return failResult("invalid_action", "unhandled action");
      } catch (error) {
        return mapEntryError(error);
      }
    },
  };
}
