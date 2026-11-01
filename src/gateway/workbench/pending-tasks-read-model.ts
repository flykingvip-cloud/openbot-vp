import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
import { type OpenBotConfig, loadConfig } from "../../config/config.js";
import { listHumanMentionNotifications } from "../../organization/human-mention-notifications.js";
import {
  readOrganizationTaskAssignments,
  type TaskAssignment,
} from "../../organization/task-assignment.js";
import { listPendingTenantHumanNotices } from "../../organization/tenant-human-notice.js";
import { listHumanAttentionTodos } from "../collaboration-dispatch/human-attention-inbox.js";
import type { GatewayCollaborationSpacesListResult } from "../collaboration-learning/snapshot-types.js";
import { listGatewayCollaborationSpaces } from "../collaboration-learning/space-store.js";
import { humanRosterMemberMatchesActorIdentities } from "../employee-workbench-scope.js";
import { listWorkspaceDeliverables } from "../knowledge/deliverables/read-model.js";
import type {
  ListWorkspaceDeliverablesParams,
  ListWorkspaceDeliverablesResult,
} from "../knowledge/deliverables/types.js";
import { listAgentsForGateway } from "../session-utils.js";

export type WorkbenchPendingTaskKind =
  | "task"
  | "governance"
  | "invite"
  | "mention"
  | "human-gate"
  | "human-attention";

/**
 * Distinguishes actor-private follow-ups from space-shared queue items.
 * - personal: assigned to / owned by the actor (or actor-scoped governance/invite/mention)
 * - space: visible because the actor seats the space (no personal assignee)
 */
export type WorkbenchPendingTaskVisibility = "personal" | "space";

export type WorkbenchPendingTaskItem = {
  id: string;
  kind: WorkbenchPendingTaskKind;
  title: string;
  /** Best-effort origin (space/org id or knowledge base id). */
  source?: string;
  updatedAtMs?: number;
  /** True for pending tasks awaiting explicit acknowledgement (sorted first). */
  ackRequired?: boolean;
  /** personal vs space-shared; UI labels space items so they are not read as "mine only". */
  visibility?: WorkbenchPendingTaskVisibility;
  /** Deep-link targets for mention notifications. */
  groupId?: string;
  sessionKey?: string;
  sourceMessageId?: string;
  mentionId?: string;
};

export type WorkbenchPendingTasksResult = {
  totalCount: number;
  taskCount: number;
  /** Subset of taskCount whose pending task still needs explicit ack. */
  ackRequiredCount: number;
  /** Task items assigned to the actor (assigneeUserId match). */
  personalTaskCount: number;
  /** Task items with no assignee — space-scoped shared queue. */
  spaceTaskCount: number;
  governanceCount: number;
  inviteCount: number;
  mentionCount?: number;
  items: WorkbenchPendingTaskItem[];
} & { humanGateCount?: number; humanAttentionCount?: number };

/**
 * Read pending task-assignments for an organization across EVERY configured
 * agent's workspace, not just the default agent's.
 *
 * Why: task-assignments are written into the *executing* agent's workspace
 * (`organization-tasks-tool` / `mention-task-converter` pass that agent's
 * `resolveWorkspaceRoot(...)`), and `resolveAgentWorkspaceDir` resolves the same
 * per-agent dir. Reading only the default agent's workspace would miss tasks a
 * non-default agent created. `readOrganizationTaskAssignments` additionally
 * merges the workspace-independent managed dir (`<stateDir>/spaces/...`) and, when
 * `collaboration.defaults.workspace` is set, the shared collaboration workspace —
 * so iterating configured agents + that always-merged base covers all write
 * locations. Deduped by assignment id.
 */
export async function readTaskAssignmentsAcrossAgentWorkspaces(
  cfg: OpenBotConfig,
  organizationId: string,
): Promise<TaskAssignment[]> {
  const agentIds = new Set<string>([resolveDefaultAgentId(cfg)]);
  try {
    for (const agent of listAgentsForGateway(cfg).agents) {
      if (agent?.id) {
        agentIds.add(agent.id);
      }
    }
  } catch {
    // Fall back to the default agent only.
  }
  const byId = new Map<string, TaskAssignment>();
  for (const agentId of agentIds) {
    let assignments: TaskAssignment[] = [];
    try {
      const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
      assignments = await readOrganizationTaskAssignments({ cfg, workspaceDir, organizationId });
    } catch {
      assignments = [];
    }
    for (const assignment of assignments) {
      byId.set(assignment.id, assignment);
    }
  }
  return [...byId.values()];
}

/**
 * Injected data sources — defaults read the real on-disk stores; tests override
 * them. No source involves an LLM (M1 is a deterministic projection).
 */
export type WorkbenchPendingTasksDeps = {
  listDeliverables: (
    params: ListWorkspaceDeliverablesParams,
  ) => Promise<ListWorkspaceDeliverablesResult>;
  readTaskAssignments: (organizationId: string) => Promise<TaskAssignment[]>;
  listSpaces: () => Promise<GatewayCollaborationSpacesListResult>;
  listHumanMentions?: (params: { tenantId: string; targetUserId: string }) => Promise<
    Array<{
      mentionId: string;
      groupId: string;
      sessionKey: string;
      sourceMessageId: string;
      excerpt: string;
      createdAt: string;
      readAt?: string | null;
      acknowledgedAt?: string | null;
    }>
  >;
  listHumanGates?: (params: {
    userId: string;
    userEmail?: string | null;
    tenantId?: string | null;
  }) => Promise<
    Array<{
      id: string;
      taskId: string;
      title: string;
      reason: "blocked_user" | "blocked_authorization";
      goal: string;
      sessionKey?: string;
      updatedAtMs: number;
      ackRequired: true;
    }>
  >;
  listHumanAttentionTodos?: (params: { actorId: string; limit?: number }) => Array<{
    id: string;
    groupId: string;
    taskId: string;
    title: string;
    updatedAtMs: number;
    fingerprint: string;
    version: number;
  }>;
};

export type WorkbenchPendingTasksParams = {
  userId: string;
  userEmail?: string | null;
  tenantId?: string | null;
  /** Group/space ids the actor owns or is seated in (employee seat scope). */
  seatSpaceIds?: string[];
  /** Agent ids the actor controls; scopes agent-skill governance items. */
  visibleAgentIds?: string[];
  /** Max items returned (counts are NOT capped). */
  limit?: number;
  deps?: Partial<WorkbenchPendingTasksDeps>;
};

const DEFAULT_ITEM_LIMIT = 12;

function defaultDeps(): WorkbenchPendingTasksDeps {
  return {
    listDeliverables: (params) => listWorkspaceDeliverables(params),
    readTaskAssignments: (organizationId) =>
      readTaskAssignmentsAcrossAgentWorkspaces(loadConfig(), organizationId),
    listSpaces: () => listGatewayCollaborationSpaces(),
    listHumanMentions: async ({ tenantId, targetUserId }) =>
      listHumanMentionNotifications({
        tenantId,
        targetUserId,
        unreadOnly: true,
      }),
    listHumanGates: async ({ userId, userEmail, tenantId }) => {
      const { isProgressLedgerEnabled } = await import("../../progress-ledger/feature.js");
      if (!isProgressLedgerEnabled()) {
        return [];
      }
      try {
        const { loadCronStore, resolveCronStorePath } = await import("../../cron/store.js");
        const { listCronHumanGates } = await import("../../progress-ledger/read.js");
        const storePath = resolveCronStorePath(loadConfig().cron?.store);
        const store = await loadCronStore(storePath);
        return await listCronHumanGates({
          jobs: store.jobs ?? [],
          actorIdentities: [userId, userEmail ?? ""],
          ...(tenantId ? { actorTenantId: tenantId } : {}),
          cronStorePath: storePath,
        });
      } catch {
        return [];
      }
    },
    listHumanAttentionTodos: ({ actorId, limit }) =>
      listHumanAttentionTodos({ actorId, limit: limit ?? 50 }).map((todo) => ({
        id: todo.id,
        groupId: todo.groupId,
        taskId: todo.taskId,
        title: todo.taskTitle?.trim() || todo.reason || "任务需要你处理",
        updatedAtMs: todo.updatedAt,
        fingerprint: todo.fingerprint,
        version: todo.version,
      })),
  };
}

function normalizeIdentity(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveSpaceOwnerUserId(space: {
  ownerUserId?: string | null;
  operatingState?: { governance?: { ownerUserId?: string | null } | null } | null;
}): string {
  return normalizeIdentity(
    space.ownerUserId ?? space.operatingState?.governance?.ownerUserId ?? null,
  );
}

function resolveSpaceInviterLabel(space: {
  title?: string | null;
  groupId?: string | null;
  ownerUserId?: string | null;
  operatingState?: { governance?: { ownerUserId?: string | null } | null } | null;
  members?: { humans?: Array<{ userId?: string | null; name?: string | null }> | null } | null;
  invites?: { humans?: Array<{ userId?: string | null; name?: string | null }> | null } | null;
}): string {
  const ownerUserId = resolveSpaceOwnerUserId(space);
  const humans = [...(space.members?.humans ?? []), ...(space.invites?.humans ?? [])];
  const owner = humans.find((human) => normalizeIdentity(human.userId) === ownerUserId);
  const ownerName = owner?.name?.trim();
  if (ownerName) {
    return ownerName;
  }
  const spaceTitle = space.title?.trim();
  if (spaceTitle) {
    return spaceTitle;
  }
  return "协作伙伴";
}

function buildReceivedCollaborationInviteTitle(space: {
  title?: string | null;
  groupId?: string | null;
  ownerUserId?: string | null;
  operatingState?: { governance?: { ownerUserId?: string | null } | null } | null;
  members?: { humans?: Array<{ userId?: string | null; name?: string | null }> | null } | null;
  invites?: { humans?: Array<{ userId?: string | null; name?: string | null }> | null } | null;
}): string {
  return `收到${resolveSpaceInviterLabel(space)}发来的协作邀请`;
}

/**
 * Deterministic "pending work" projection for the employee home 待处理任务 card.
 * Merges three real business sources — never invokes an LLM:
 *   1. pending task-assignments in the actor's spaces,
 *   2. pending-governance ("待治理") workspace deliverables,
 *   3. pending collaboration confirmations — the actor's own invited human seat,
 *      bots awaiting confirmation in spaces the actor owns/seats, and bot invites
 *      for robots the actor owns in spaces they do not seat.
 * Scope is bounded by the caller's seat spaces / visible agents, so a brand-new
 * member with no spaces or assets correctly resolves to zero.
 */
export async function buildWorkbenchPendingTasks(
  params: WorkbenchPendingTasksParams,
): Promise<WorkbenchPendingTasksResult> {
  const deps = { ...defaultDeps(), ...params.deps };
  const limit = Math.max(1, Math.min(params.limit ?? DEFAULT_ITEM_LIMIT, 100));
  const seatSpaceIds = [
    ...new Set((params.seatSpaceIds ?? []).map((id) => id.trim()).filter(Boolean)),
  ];
  const actorIdentities = new Set(
    [params.userId, params.userEmail].map((value) => normalizeIdentity(value)).filter(Boolean),
  );
  const seatSpaceIdSet = new Set(seatSpaceIds.map((id) => normalizeIdentity(id)));

  // Dedupe by stable id so the same item surfaced by two rosters/sources counts once.
  const byId = new Map<string, WorkbenchPendingTaskItem>();
  const add = (item: WorkbenchPendingTaskItem) => {
    if (!byId.has(item.id)) {
      byId.set(item.id, item);
    }
  };

  // (1) Pending task-assignments across the actor's spaces.
  for (const organizationId of seatSpaceIds) {
    let assignments: TaskAssignment[] = [];
    try {
      assignments = await deps.readTaskAssignments(organizationId);
    } catch {
      assignments = [];
    }
    for (const assignment of assignments) {
      if (assignment.status !== "pending") {
        continue;
      }
      // Phase C4: a human-assigned task (assigneeUserId set) is surfaced ONLY to its
      // assignee; tasks without an assignee keep the existing space-scoped behavior,
      // so existing per-agent task counts stay byte-for-byte unchanged.
      if (
        assignment.assigneeUserId &&
        !actorIdentities.has(normalizeIdentity(assignment.assigneeUserId))
      ) {
        continue;
      }
      const personal =
        Boolean(assignment.assigneeUserId) &&
        actorIdentities.has(normalizeIdentity(assignment.assigneeUserId));
      add({
        id: `task:${assignment.id}`,
        kind: "task",
        title: assignment.title,
        source: assignment.organizationId,
        updatedAtMs: parseTimestamp(assignment.updatedAt),
        ackRequired: assignment.ackRequired,
        visibility: personal ? "personal" : "space",
      });
    }
  }

  // (2) Pending-governance ("待治理") deliverables, scoped to the actor.
  try {
    const result = await deps.listDeliverables({
      userId: params.userId,
      limit: 100,
      ...(seatSpaceIds.length > 0 ? { groupIds: seatSpaceIds } : {}),
      ...(params.visibleAgentIds ? { visibleAgentIds: params.visibleAgentIds } : {}),
    });
    for (const deliverable of result.deliverables) {
      if (deliverable.governanceStatus !== "pending") {
        continue;
      }
      add({
        id: `governance:${deliverable.deliverableId}`,
        kind: "governance",
        title: deliverable.title,
        source: deliverable.groupId ?? deliverable.relatedKnowledgeBaseId,
        updatedAtMs: deliverable.updatedAtMs,
        visibility: "personal",
      });
    }
  } catch {
    // Best-effort: governance source unavailable this cycle.
  }

  // (3) Pending collaboration confirmations.
  try {
    const { spaces } = await deps.listSpaces();
    for (const space of spaces) {
      const spaceIdentity =
        normalizeIdentity(space.groupId) || normalizeIdentity(space.id.replace(/^space:/, ""));
      const actorSeatsSpace = seatSpaceIdSet.has(spaceIdentity);
      // (a) The actor's own pending invite into this space (human invited).
      for (const human of [...(space.members?.humans ?? []), ...(space.invites?.humans ?? [])]) {
        if (normalizeIdentity(human.status) !== "invited") {
          continue;
        }
        if (!humanRosterMemberMatchesActorIdentities(human, actorIdentities)) {
          continue;
        }
        add({
          id: `invite:human:${space.groupId}:${normalizeIdentity(human.userId)}`,
          kind: "invite",
          title: buildReceivedCollaborationInviteTitle(space),
          source: space.groupId,
          groupId: space.groupId,
          visibility: "personal",
        });
      }
      // (b) Bots awaiting confirmation in spaces the actor owns/seats.
      if (actorSeatsSpace) {
        for (const bot of [...(space.members?.bots ?? []), ...(space.invites?.bots ?? [])]) {
          const status = normalizeIdentity(bot.status);
          if (status !== "invited" && status !== "pending") {
            continue;
          }
          const botLabel = bot.name?.trim() || bot.agentId;
          const spaceLabel = space.title?.trim() || space.groupId;
          add({
            id: `invite:bot:${space.groupId}:${normalizeIdentity(bot.agentId)}`,
            kind: "invite",
            title: `待确认：${botLabel}加入「${spaceLabel}」`,
            source: space.groupId,
            groupId: space.groupId,
            visibility: "space",
          });
        }
      }
      // (c) Bots the actor owns that are invited into spaces they do not seat.
      // Skip the universal builtin steward — it is not a personal asset to approve.
      if (!actorSeatsSpace) {
        for (const bot of [...(space.members?.bots ?? []), ...(space.invites?.bots ?? [])]) {
          const status = normalizeIdentity(bot.status);
          if (status !== "invited" && status !== "pending") {
            continue;
          }
          const agentId = normalizeIdentity(bot.agentId);
          if (!agentId || isBuiltinStewardAgent(agentId)) {
            continue;
          }
          const ownerUserId = normalizeIdentity(
            (bot as { ownerUserId?: string | null }).ownerUserId,
          );
          if (!ownerUserId || !actorIdentities.has(ownerUserId)) {
            continue;
          }
          add({
            id: `invite:bot:${space.groupId}:${agentId}`,
            kind: "invite",
            title: buildReceivedCollaborationInviteTitle(space),
            source: space.groupId,
            groupId: space.groupId,
            visibility: "personal",
          });
        }
      }
    }
  } catch {
    // Best-effort: collaboration source unavailable this cycle.
  }

  // (4) Long-horizon ledger human gates (blocked_user / blocked_authorization only).
  if (deps.listHumanGates) {
    try {
      const gates = await deps.listHumanGates({
        userId: params.userId,
        userEmail: params.userEmail,
        tenantId: params.tenantId,
      });
      for (const gate of gates) {
        add({
          id: gate.id,
          kind: "human-gate",
          title: gate.title,
          source: gate.taskId,
          updatedAtMs: gate.updatedAtMs,
          ackRequired: true,
          visibility: "personal",
          ...(gate.sessionKey ? { sessionKey: gate.sessionKey } : {}),
        });
      }
    } catch {
      // Best-effort: ledger source unavailable this cycle.
    }
  }

  // (5) Unread human @mentions for this actor (tenant-scoped inbox).
  const tenantId = params.tenantId?.trim();
  if (tenantId && deps.listHumanMentions) {
    try {
      const mentions = await deps.listHumanMentions({
        tenantId,
        targetUserId: params.userId,
      });
      for (const mention of mentions) {
        if (mention.readAt || mention.acknowledgedAt) {
          continue;
        }
        add({
          // id encodes groupId for UI deep-link: mention:<groupId>:<mentionId>
          id: `mention:${mention.groupId}:${mention.mentionId}`,
          kind: "mention",
          title: mention.excerpt || "有人在协作小组提到了你",
          source: mention.groupId,
          updatedAtMs: parseTimestamp(mention.createdAt),
          ackRequired: true,
          visibility: "personal",
          groupId: mention.groupId,
          sessionKey: mention.sessionKey,
          sourceMessageId: mention.sourceMessageId,
          mentionId: mention.mentionId,
        });
      }
    } catch {
      // Best-effort: mention inbox unavailable this cycle.
    }
  }

  if (tenantId) {
    try {
      const notices = listPendingTenantHumanNotices({
        tenantId,
        recipientUserId: params.userId,
      });
      for (const notice of notices) {
        const message = notice.message.trim();
        add({
          id: `tenant-notice:${notice.id}`,
          kind: "task",
          title: message ? `通知：${message}` : "一条待确认通知",
          source: notice.fromAgentId,
          updatedAtMs: parseTimestamp(notice.createdAt),
          ackRequired: true,
          visibility: "personal",
        });
      }
    } catch {
      // Best-effort: tenant notice store unavailable this cycle.
    }
  }

  // (6) Watchdog / heartbeat human-attention intake (conversation card + unified todo).
  if (deps.listHumanAttentionTodos) {
    try {
      const todos = deps.listHumanAttentionTodos({
        actorId: params.userId,
        limit: 50,
      });
      for (const todo of todos) {
        add({
          id: `human-attention:${todo.id}`,
          kind: "human-attention",
          title: todo.title.startsWith("任务需要") ? todo.title : `任务需要你处理：${todo.title}`,
          source: todo.groupId,
          updatedAtMs: todo.updatedAtMs,
          ackRequired: true,
          visibility: "personal",
          groupId: todo.groupId,
        });
      }
    } catch {
      // Best-effort: human-attention inbox unavailable this cycle.
    }
  }

  const all = [...byId.values()];
  const taskItems = all.filter((item) => item.kind === "task");
  const taskCount = taskItems.length;
  const personalTaskCount = taskItems.filter((item) => item.visibility === "personal").length;
  const spaceTaskCount = taskItems.filter((item) => item.visibility === "space").length;
  const ackRequiredCount = all.filter(
    (item) =>
      (item.kind === "task" ||
        item.kind === "mention" ||
        item.kind === "human-gate" ||
        item.kind === "human-attention") &&
      item.ackRequired === true,
  ).length;
  const governanceCount = all.filter((item) => item.kind === "governance").length;
  const inviteCount = all.filter((item) => item.kind === "invite").length;
  const mentionCount = all.filter((item) => item.kind === "mention").length;
  const humanGateCount = all.filter((item) => item.kind === "human-gate").length;
  const humanAttentionCount = all.filter((item) => item.kind === "human-attention").length;
  // Layer: ack-required first, then personal over space-shared, then recency.
  const items = all
    .toSorted((left, right) => {
      const ackDelta = Number(right.ackRequired ?? false) - Number(left.ackRequired ?? false);
      if (ackDelta !== 0) {
        return ackDelta;
      }
      const visibilityRank = (item: WorkbenchPendingTaskItem) =>
        item.visibility === "personal" ? 1 : 0;
      const visibilityDelta = visibilityRank(right) - visibilityRank(left);
      if (visibilityDelta !== 0) {
        return visibilityDelta;
      }
      return (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0);
    })
    .slice(0, limit);

  return {
    totalCount:
      taskCount +
      governanceCount +
      inviteCount +
      mentionCount +
      humanGateCount +
      humanAttentionCount,
    taskCount,
    ackRequiredCount,
    personalTaskCount,
    spaceTaskCount,
    governanceCount,
    inviteCount,
    mentionCount,
    humanGateCount,
    humanAttentionCount,
    items,
  };
}
