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
 *
 * F4: resolveCompositionTrustedTeamContext from the session composition root
 * (stamped enterprise id + gateway client identity) and pass auth/trusted/stores
 * into every claim/board/plan entry. Managed without locator hard-refuses —
 * never createWorkspaceCollaborationStores.
 */
import { Type } from "@sinclair/typebox";
import type { OpenBotConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { extractCollaborationGroupId } from "../../conversations/shared-task-runtime.js";
import { isCollabTaskClaimContractEnabled } from "../../gateway/collaboration-dispatch/claim-contract.js";
import { activateCollaborationTask } from "../../gateway/collaboration-learning/activate-collaboration-task.js";
import {
  acceptCollaborationBoardItemSubmission,
  applyCollaborationBoardClaim,
  ClaimContractEntryError,
  ClaimContractFlagOffError,
  claimCollaborationBoardItem,
  getCollaborationBoardMemberProgress,
  getCollaborationTodolist,
  listCollaborationBoardItems,
  listCollaborationTodolists,
  markCollaborationBoardItemInProgress,
  proposeCollaborationTodolist,
  returnCollaborationBoardItemSubmission,
  submitCollaborationBoardItemForReview,
} from "../../gateway/collaboration-learning/claim-contract-entry.js";
import {
  resolveDeliveryAclActor,
  type DeliveryActorClient,
} from "../../gateway/collaboration-learning/delivery-actor-binding.js";
import {
  assertPersistedTaskNotStopped,
  TaskStoppedError,
} from "../../gateway/collaboration-learning/task-stop-entry.js";
import {
  readTeamDeliverable,
  submitTeamDeliverable,
} from "../../gateway/collaboration-learning/team-deliverable-submit.js";
import {
  resolveCompositionTrustedTeamContext,
  type TeamResourceAuthOk,
  type TrustedGroupStores,
} from "../../gateway/collaboration-learning/team-resource-auth.js";
import type { CollaborationTenantResolution } from "../../gateway/collaboration-learning/trusted-tenant.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { stringEnum } from "../schema/typebox.js";
import {
  asToolParams,
  jsonResult,
  readStringParam,
  ToolInputError,
  type AnyAgentTool,
} from "./common.js";

export const COLLABORATION_BOARD_TOOL = "collaboration_board";

const WRITE_ACTIONS = [
  "activate_task",
  "claim_item",
  "apply_claim",
  "propose_todolist",
  "mark_in_progress",
  "submit_for_review",
  "accept_submission",
  "return_submission",
  "submit_team_deliverable",
] as const;

const READ_ACTIONS = [
  "list_items",
  "get_member_progress",
  "get_todolist",
  "list_todolists",
  "read_team_deliverable",
] as const;

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
  title: Type.Optional(Type.String({ description: "activate_task board title." })),
  message: Type.Optional(
    Type.String({ description: "activate_task intent message (not oral dispatch)." }),
  ),
  goal: Type.Optional(Type.String({ description: "activate_task goal." })),
  acceptanceCriteria: Type.Optional(
    Type.Array(Type.String(), { description: "activate_task acceptance clauses." }),
  ),
  constraints: Type.Optional(
    Type.Array(Type.String(), { description: "activate_task constraints." }),
  ),
  suggestedClaimantIds: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "activate_task intended claimants. Use gateway agent ids (bare id, not bot: prefix).",
    }),
  ),
  humanConfirmed: Type.Optional(
    Type.Boolean({
      description:
        "activate_task: true publishes the board item. The human gate is the later todolist card, not this flag.",
    }),
  ),
  dueAtMs: Type.Optional(Type.Number({ description: "activate_task due time in epoch ms." })),
  claimantId: Type.Optional(
    Type.String({
      description:
        "claim_item claimant. Defaults to the session agent id (gateway agents.list id).",
    }),
  ),
  deliverableTitle: Type.Optional(
    Type.String({
      description: "submit_team_deliverable title (formal group deliverable).",
    }),
  ),
  deliverableContent: Type.Optional(
    Type.String({
      description:
        "submit_team_deliverable UTF-8 body. Gateway writes trusted group deliverables/ and returns sha256 receipt — do not claim managed path writes from the sandbox.",
    }),
  ),
  deliverableRelativePath: Type.Optional(
    Type.String({
      description: "Optional relative path under deliverables/ for submit_team_deliverable.",
    }),
  ),
  deliverableId: Type.Optional(
    Type.String({
      description: "read_team_deliverable id (from a prior submit receipt).",
    }),
  ),
  previousDeliverableId: Type.Optional(
    Type.String({
      description: "submit_team_deliverable: revise this prior deliverable into a new version.",
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
  activateTask?: typeof activateCollaborationTask;
  claimItem?: typeof claimCollaborationBoardItem;
  applyClaim?: typeof applyCollaborationBoardClaim;
  listTodolists?: typeof listCollaborationTodolists;
  resolveTrustedTeam?: typeof resolveCompositionTrustedTeamContext;
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
  if (error instanceof TaskStoppedError) {
    return failResult(error.code, error.message);
  }
  if (error instanceof ToolInputError) {
    return failResult("invalid_input", error.message);
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

function bareCollaborationAgentId(value: string): string {
  const id = value.trim();
  if (id.startsWith("bot:")) {
    return id.slice(4);
  }
  if (id.startsWith("agent:")) {
    return id.slice("agent:".length);
  }
  return id;
}

function readStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out = value
    .map((row) => (typeof row === "string" ? bareCollaborationAgentId(row) : ""))
    .filter(Boolean);
  return out.length > 0 ? out : undefined;
}

type BoundTeamFields = {
  auth?: TeamResourceAuthOk;
  trusted?: { groupsRoot: string; groupLocator: string };
  stores?: TrustedGroupStores;
  tenant: CollaborationTenantResolution;
};

function sessionGatewayClient(options: {
  gatewayClientUser?: string;
  gatewayClientPlatformUserId?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientSessionEnterpriseId?: string;
  gatewayClientSessionMembershipId?: string;
}): GatewayClient | null {
  const user = options.gatewayClientUser?.trim();
  const platformUserId = options.gatewayClientPlatformUserId?.trim();
  if (!user && !platformUserId) {
    return null;
  }
  return {
    connect: {} as GatewayClient["connect"],
    ...(user ? { user } : {}),
    ...(platformUserId ? { platformUserId } : {}),
    ...(options.gatewayClientSessionDomain
      ? { sessionDomain: options.gatewayClientSessionDomain }
      : {}),
    ...(options.gatewayClientSessionEnterpriseId
      ? {
          sessionEnterpriseId: options.gatewayClientSessionEnterpriseId,
          sessionTenantId: options.gatewayClientSessionEnterpriseId,
        }
      : {}),
    ...(options.gatewayClientSessionMembershipId
      ? { sessionMembershipId: options.gatewayClientSessionMembershipId }
      : {}),
  };
}

export function createCollaborationBoardTool(options?: {
  agentSessionKey?: string;
  requesterAgentIdOverride?: string;
  agentGroupId?: string | null;
  tenantId?: string | null;
  /**
   * Gateway-frozen enterprise id (execution identity). Never read from tool args.
   * Distinct from allowlist tenant normalization, which drops UUIDs.
   */
  stampedEnterpriseId?: string | null;
  gatewayClientUser?: string;
  gatewayClientPlatformUserId?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientSessionEnterpriseId?: string;
  gatewayClientSessionMembershipId?: string;
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
  const activateTask = deps.activateTask ?? activateCollaborationTask;
  const claimItem = deps.claimItem ?? claimCollaborationBoardItem;
  const applyClaim = deps.applyClaim ?? applyCollaborationBoardClaim;
  const listTodolists = deps.listTodolists ?? listCollaborationTodolists;
  const resolveTrustedTeam = deps.resolveTrustedTeam ?? resolveCompositionTrustedTeamContext;
  const stampedEnterpriseId = compact(options?.stampedEnterpriseId);

  return {
    name: COLLABORATION_BOARD_TOOL,
    label: "Collaboration board",
    description:
      "Collaboration board tools (Mode B). Actions: list_items, get_member_progress, get_todolist, list_todolists, read_team_deliverable (read); activate_task, claim_item, apply_claim, propose_todolist, mark_in_progress, submit_for_review, accept_submission, return_submission, submit_team_deliverable (write). Requires claimContract / claimContractGroupAllowlist for this group. Managed paths need a trusted group locator from the session (stamped enterprise id); never fall back to host ~/.openbot/collaboration. Formal team delivery is submit_team_deliverable (gateway receipt with contentSha256) — sandbox cannot see host managed paths. Human-gate card is propose_todolist (agent↔agent peer plans may auto-confirm). Claimant writes enforce claimant + plan gate + S3 inside the entry.",
    parameters: CollaborationBoardSchema,
    execute: async (_toolCallId, args) => {
      const params = asToolParams(args);
      const action = readStringParam(params, "action", { required: true }) as BoardAction;
      const groupResolved = resolveGroupId({
        paramGroupId: readStringParam(params, "groupId"),
        agentGroupId: options?.agentGroupId,
        agentSessionKey: options?.agentSessionKey,
      });
      if (!groupResolved.ok) {
        return failResult(groupResolved.reason, groupResolved.message);
      }
      const { groupId } = groupResolved;

      const cfg = options?.config ?? loadConfig();
      const tenantIdRaw = options?.tenantId;
      const tenantId = resolveClaimTenantIdForAllowlist(tenantIdRaw);

      if (!isEnabled(cfg, groupId, tenantId)) {
        return failResult(
          "flag_off",
          "collaboration.task.claimContract is off for this group (and group is not on claimContractGroupAllowlist)",
          { groupId },
        );
      }

      const agentId =
        compact(options?.requesterAgentIdOverride) ||
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

      const client = sessionGatewayClient({
        gatewayClientUser: options?.gatewayClientUser ?? actorId,
        gatewayClientPlatformUserId: options?.gatewayClientPlatformUserId ?? actorId,
        gatewayClientSessionDomain: options?.gatewayClientSessionDomain,
        gatewayClientSessionEnterpriseId:
          options?.gatewayClientSessionEnterpriseId ?? (stampedEnterpriseId || undefined),
        gatewayClientSessionMembershipId: options?.gatewayClientSessionMembershipId,
      });

      const aliases = [
        options?.gatewayClientUser,
        options?.gatewayClientPlatformUserId,
        options?.gatewayClientSessionMembershipId,
        actorId,
        agentId,
      ]
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean);

      let team: Awaited<ReturnType<typeof resolveTrustedTeam>> | null = null;
      try {
        team = await resolveTrustedTeam({
          groupId,
          action: isWriteAction(action) ? "write" : "read",
          actor: actorId,
          identityAliases: aliases,
          client,
          cfg,
          stampedEnterpriseId: stampedEnterpriseId || tenantIdRaw || null,
        });
      } catch (err) {
        return mapEntryError(err);
      }
      if (!team || !team.ok) {
        return failResult(
          team?.reason ?? "trusted_group_locator_required",
          team?.detail ??
            "managed claim/board/plan requires trusted group locator from session composition root",
          { groupId, action },
        );
      }

      const bound: BoundTeamFields = {
        auth: team.auth,
        trusted: team.trusted,
        stores: team.stores,
        tenant: team.tenant,
      };

      const taskId = readStringParam(params, "taskId");
      const itemId =
        readStringParam(params, "itemId") || readStringParam(params, "boardItemId") || undefined;

      try {
        if (taskId) {
          await assertPersistedTaskNotStopped({
            groupId,
            taskId,
            cfg,
            objectStorage: team.stores.objectStorage,
          });
        }

        if (action === "activate_task") {
          if (!taskId) {
            return failResult("invalid_input", "activate_task requires taskId");
          }
          const title = readStringParam(params, "title", { required: true });
          const message = readStringParam(params, "message", { required: true });
          const suggested =
            readStringList(params.suggestedClaimantIds) ?? [bareCollaborationAgentId(agentId)];
          const activated = await activateTask({
            groupId,
            taskId,
            title,
            message,
            actor: actorId,
            goal: readStringParam(params, "goal"),
            acceptanceCriteria: readStringList(params.acceptanceCriteria),
            constraints: readStringList(params.constraints),
            suggestedClaimantIds: suggested,
            dueAtMs: typeof params.dueAtMs === "number" ? params.dueAtMs : undefined,
            humanConfirmed: params.humanConfirmed === true,
            ...bound,
            cfg,
          });
          const published =
            activated.status === "activated" || activated.status === "partial_success";
          return jsonResult({
            ok: published,
            action,
            groupId,
            taskId,
            locatorBound: true,
            activation: activated,
          });
        }

        if (action === "claim_item") {
          if (!taskId || !itemId) {
            return failResult("invalid_input", "claim_item requires taskId and itemId");
          }
          const claimantId = bareCollaborationAgentId(
            readStringParam(params, "claimantId") || agentId,
          );
          const item = await claimItem({
            groupId,
            taskId,
            itemId,
            claimantId,
            actor: actorId,
            ...bound,
            cfg,
          });
          return jsonResult({
            ok: true,
            action,
            groupId,
            taskId,
            item,
            locatorBound: true,
          });
        }

        if (action === "apply_claim") {
          if (!taskId || !itemId) {
            return failResult("invalid_input", "apply_claim requires taskId and itemId");
          }
          const applied = await applyClaim({
            groupId,
            taskId,
            itemId,
            actor: actorId,
            ...bound,
            cfg,
          });
          return jsonResult({
            ok: true,
            action,
            groupId,
            taskId,
            item: applied.item,
            locatorBound: true,
          });
        }

        if (action === "list_todolists") {
          if (!taskId) {
            return failResult("invalid_input", "list_todolists requires taskId");
          }
          const todolists = await listTodolists({
            groupId,
            taskId,
            boardItemId: itemId,
            actor: actorId,
            viewerId: actorId,
            ...bound,
            cfg,
          });
          return jsonResult({
            ok: true,
            action,
            groupId,
            taskId,
            todolists,
            locatorBound: true,
          });
        }

        if (action === "list_items") {
          if (!taskId) {
            return failResult("invalid_input", "list_items requires taskId");
          }
          const items = await listItems({
            groupId,
            taskId,
            ...bound,
            cfg,
          });
          return jsonResult({ ok: true, action, groupId, taskId, items, locatorBound: true });
        }

        if (action === "get_member_progress") {
          if (!taskId) {
            return failResult("invalid_input", "get_member_progress requires taskId");
          }
          const progress = await getMemberProgress({
            groupId,
            taskId,
            ...bound,
            cfg,
          });
          return jsonResult({ ok: true, action, groupId, taskId, progress, locatorBound: true });
        }

        if (action === "get_todolist") {
          const todolistId = readStringParam(params, "todolistId", { required: true });
          if (!taskId) {
            return failResult("invalid_input", "get_todolist requires taskId");
          }
          const todolist = await getTodolist({
            groupId,
            taskId,
            todolistId,
            actor: actorId,
            viewerId: actorId,
            ...bound,
            cfg,
          });
          return jsonResult({ ok: true, action, groupId, taskId, todolist, locatorBound: true });
        }

        if (action === "propose_todolist") {
          if (!taskId) {
            return failResult("invalid_input", "propose_todolist requires taskId");
          }
          const boardItemId =
            readStringParam(params, "boardItemId") ||
            readStringParam(params, "itemId") ||
            undefined;
          if (!boardItemId) {
            return failResult("invalid_input", "propose_todolist requires boardItemId or itemId");
          }
          const stepsRaw = params.steps;
          if (!Array.isArray(stepsRaw) || stepsRaw.length < 1) {
            return failResult("invalid_input", "propose_todolist requires steps (min 1)");
          }
          const steps = stepsRaw.map((row) => {
            const rec = row as Record<string, unknown>;
            return {
              title: String(rec.title ?? ""),
              ...(typeof rec.detail === "string" ? { detail: rec.detail } : {}),
              ...(typeof rec.stepId === "string" ? { stepId: rec.stepId } : {}),
            };
          });
          const proposed = await proposeTodolist({
            groupId,
            taskId,
            boardItemId,
            steps,
            actor: actorId,
            ownerMemberId: actorId,
            ...bound,
            cfg,
          });
          return jsonResult({
            ok: true,
            action,
            groupId,
            taskId,
            todolist: proposed.todolist,
            cardDelivery: proposed.cardDelivery,
            locatorBound: true,
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
            ...bound,
            cfg,
          });
          return jsonResult({ ok: true, action, groupId, taskId, item, locatorBound: true });
        }

        if (action === "submit_for_review") {
          if (!taskId || !itemId) {
            return failResult("invalid_input", "submit_for_review requires taskId and itemId");
          }
          const submissionId = readStringParam(params, "submissionId", { required: true });
          const artifactVersion = readStringParam(params, "artifactVersion", { required: true });
          // Empty / whitespace-only is empty_submission (product code), not a generic required miss.
          const submissionSummaryRaw = readStringParam(params, "submissionSummary", {
            allowEmpty: true,
          });
          const submissionSummary = submissionSummaryRaw?.trim() ?? "";
          if (!submissionSummary) {
            return failResult("empty_submission", "submissionSummary must be non-empty");
          }
          const item = await submitForReview({
            groupId,
            taskId,
            itemId,
            submissionId,
            artifactVersion,
            submissionSummary,
            actor: actorId,
            ...bound,
            cfg,
          });
          return jsonResult({ ok: true, action, groupId, taskId, item, locatorBound: true });
        }

        if (action === "accept_submission") {
          if (!taskId || !itemId) {
            return failResult("invalid_input", "accept_submission requires taskId and itemId");
          }
          const expectedSubmissionId = readStringParam(params, "expectedSubmissionId", {
            required: true,
          });
          const reason = readStringParam(params, "reason", { required: true });
          const checked = readStringList(params.checkedAcceptanceCriteria) ?? [];
          const proxyForActorId = readStringParam(params, "proxyForActorId");
          const proxyBasis = readStringParam(params, "proxyBasis");
          const item = await acceptSubmission({
            groupId,
            taskId,
            itemId,
            expectedSubmissionId,
            reason,
            checkedAcceptanceCriteria: checked,
            proxyForActorId,
            proxyBasis,
            actor: actorId,
            tenant: bound.tenant,
            cfg,
          });
          return jsonResult({ ok: true, action, groupId, taskId, item, locatorBound: true });
        }

        if (action === "return_submission") {
          if (!taskId || !itemId) {
            return failResult("invalid_input", "return_submission requires taskId and itemId");
          }
          const expectedSubmissionId = readStringParam(params, "expectedSubmissionId", {
            required: true,
          });
          const reason = readStringParam(params, "reason", { required: true });
          const item = await returnSubmission({
            groupId,
            taskId,
            itemId,
            expectedSubmissionId,
            reason,
            actor: actorId,
            ...bound,
            cfg,
          });
          return jsonResult({ ok: true, action, groupId, taskId, item, locatorBound: true });
        }

        if (action === "submit_team_deliverable") {
          if (!taskId) {
            return failResult("invalid_input", "submit_team_deliverable requires taskId");
          }
          const deliverableTitle = readStringParam(params, "deliverableTitle", { required: true });
          const deliverableContent = readStringParam(params, "deliverableContent", {
            allowEmpty: true,
          });
          if (deliverableContent == null) {
            return failResult("invalid_input", "submit_team_deliverable requires deliverableContent");
          }
          const relativePath = readStringParam(params, "deliverableRelativePath") || undefined;
          const previousDeliverableId =
            readStringParam(params, "previousDeliverableId") || undefined;
          const receipt = await submitTeamDeliverable({
            groupId,
            taskId,
            actor: actorId,
            title: deliverableTitle,
            content: deliverableContent,
            relativePath,
            previousDeliverableId,
            client,
            tenant: bound.tenant,
            trusted: bound.trusted,
            identityAliases: aliases,
            cfg,
          });
          if (!receipt.ok) {
            return failResult(receipt.reason, receipt.detail ?? receipt.reason);
          }
          return jsonResult({
            ok: true,
            action,
            groupId,
            taskId,
            receipt: {
              ...receipt,
              fingerprintSha16: receipt.contentSha256.slice(0, 16),
            },
            locatorBound: true,
          });
        }

        if (action === "read_team_deliverable") {
          const deliverableId = readStringParam(params, "deliverableId", { required: true });
          const read = await readTeamDeliverable({
            groupId,
            deliverableId,
            actor: actorId,
            client,
            tenant: bound.tenant,
            trusted: bound.trusted,
            identityAliases: aliases,
            cfg,
          });
          if (!read.ok) {
            return failResult(read.reason, read.detail ?? read.reason);
          }
          return jsonResult({
            ok: true,
            action,
            groupId,
            deliverable: {
              ...read,
              fingerprintSha16: read.contentSha256.slice(0, 16),
            },
            locatorBound: true,
          });
        }

        return failResult("invalid_action", `unknown action: ${action}`);
      } catch (error) {
        return mapEntryError(error);
      }
    },
  };
}
