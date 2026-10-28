/**
 * Best-effort emit of an owner-decision card into the group public transcript
 * after proposeTodolist. Failures must never fail the propose RPC.
 *
 * Unread path: real assistant message (preview + updatedAt bump on space:).
 * Confirm path: UI calls collaboration.task.confirmTodolist with bound actor.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../../config/config.js";
import { loadSessionStore, updateSessionStore } from "../../config/sessions.js";
import { resolveStorePath } from "../../config/sessions/paths.js";
import type { OpenBotConfig } from "../../config/types.js";
import { loadBoardClaimItem } from "../collaboration-dispatch/claim-contract.js";
import type { ExecutorPrivateTodolist } from "../collaboration-dispatch/executor-private-todolist.js";
import {
  buildOwnerDecisionCard,
  formatOwnerDecisionMessageText,
  ownerDecisionIdempotencyKey,
  resolveOwnerDecisionMentionLabel,
  type OwnerDecisionCard,
} from "../collaboration-dispatch/owner-decision-card.js";
import type { RuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import { appendPersistedAgentMessageToTranscript } from "../server-methods/chat-transcript-inject.js";
import {
  materializeGroupCollaborationWorkspace,
  resolveGroupPublicTranscriptPath,
} from "./collaboration-paths.js";
import { collaborationDispatchIdsMatch } from "./member-dispatch-readiness.js";
import {
  normalizeOwnerDecisionDelivery,
  recordOwnerDecisionDelivery,
  type OwnerDecisionCardDelivery,
} from "./owner-decision-delivery.js";
import { createWorkspaceCollaborationStores, readGroupOperatingState } from "./shared.js";
import { createTrustedGroupStores } from "./team-resource-auth.js";

export type OwnerDecisionEmitResult = (
  | { ok: true; card: OwnerDecisionCard; messageId?: string; skipped?: false }
  | { ok: true; skipped: true; reason: string; card?: OwnerDecisionCard }
  | { ok: false; reason: string; message: string; card?: OwnerDecisionCard }
) & { delivery: OwnerDecisionCardDelivery };

type OperatingStateAclSource = {
  governance?: {
    coordinatorBotId?: string | null;
    ownerUserId?: string | null;
    adminUserIds?: readonly string[] | null;
  };
  memberRoleMap?: ReadonlyArray<{
    memberId?: string | null;
    memberKind?: string | null;
    status?: string | null;
    displayName?: string | null;
    name?: string | null;
    label?: string | null;
    governanceRole?: string | null;
  }>;
} | null;

type GroupMemberNameRow = {
  memberId?: string | null;
  agentId?: string | null;
  userId?: string | null;
  name?: string | null;
  displayName?: string | null;
  status?: string | null;
  memberKind?: string | null;
  governanceRole?: string | null;
};

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function memberIdsMatch(left: string, right: string): boolean {
  const a = compact(left);
  const b = compact(right);
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  if (collaborationDispatchIdsMatch(a, b)) {
    return true;
  }
  // human:<uuid> ↔ bare uuid
  if (a.startsWith("human:") && a.slice("human:".length) === b) {
    return true;
  }
  if (b.startsWith("human:") && b.slice("human:".length) === a) {
    return true;
  }
  return false;
}

function memberExplicitlyActive(state: OperatingStateAclSource, memberId: string): boolean {
  const id = memberId.trim();
  if (!id) {
    return false;
  }
  const member = state?.memberRoleMap?.find((row) => memberIdsMatch(row.memberId ?? "", id));
  if (!member) {
    return false;
  }
  return (member.status ?? "active") === "active";
}

/** When OS is missing on managed SoT, project a minimal active map from members.json. */
function operatingStateFromMemberRows(
  rows: readonly GroupMemberNameRow[],
  existing: OperatingStateAclSource,
): OperatingStateAclSource {
  if (!rows.length) {
    return existing;
  }
  const memberRoleMap = rows
    .map((row) => {
      const memberId = compact(row.memberId);
      if (!memberId) {
        return null;
      }
      const status = compact(row.status) || "active";
      if (status === "removed" || status === "revoked") {
        return null;
      }
      return {
        memberId,
        memberKind: compact(row.memberKind) || undefined,
        status,
        displayName: compact(row.displayName) || compact(row.name) || undefined,
        name: compact(row.name) || undefined,
        governanceRole: compact(row.governanceRole) || undefined,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  if (memberRoleMap.length === 0) {
    return existing;
  }
  const ownerFromMembers =
    memberRoleMap.find(
      (row) =>
        (row.governanceRole ?? "") === "owner" &&
        ((row.memberKind ?? "").startsWith("human") || (row.memberId ?? "").startsWith("human:")),
    )?.memberId ?? null;
  return {
    governance: {
      coordinatorBotId: existing?.governance?.coordinatorBotId ?? null,
      ownerUserId: existing?.governance?.ownerUserId ?? ownerFromMembers,
      adminUserIds: existing?.governance?.adminUserIds ?? [],
    },
    memberRoleMap,
  };
}

function agentNameFromConfig(cfg: OpenBotConfig | undefined, agentId: string): string {
  const list = cfg?.agents?.list;
  if (!Array.isArray(list)) {
    return "";
  }
  const row = list.find((entry) => compact(entry?.id) === agentId);
  if (!row) {
    return "";
  }
  const identityName =
    row.identity && typeof row.identity === "object" && typeof row.identity.name === "string"
      ? compact(row.identity.name)
      : "";
  return identityName || compact(typeof row.name === "string" ? row.name : "");
}

function nameFromMemberRows(rows: readonly GroupMemberNameRow[], memberId: string): string {
  const id = compact(memberId);
  for (const row of rows) {
    const candidates = [row.memberId, row.agentId, row.userId].map((value) => compact(value));
    if (!candidates.includes(id)) {
      continue;
    }
    const label = compact(row.name) || compact(row.displayName);
    if (label) {
      return label;
    }
  }
  return "";
}

function resolveMentionTargets(params: {
  operatingState: OperatingStateAclSource;
  publishedBy?: string | null;
  memberRows?: readonly GroupMemberNameRow[];
  cfg?: OpenBotConfig;
}): { mentionMemberIds: string[]; mentionDisplayNames: string[] } {
  const ids: string[] = [];
  const names: string[] = [];
  const memberRows = params.memberRows ?? [];
  const state =
    (params.operatingState?.memberRoleMap?.length ?? 0) > 0
      ? params.operatingState
      : operatingStateFromMemberRows(memberRows, params.operatingState);
  const canonicalMemberId = (memberId: string): string => {
    const match = state?.memberRoleMap?.find((row) => memberIdsMatch(row.memberId ?? "", memberId));
    return compact(match?.memberId) || memberId;
  };
  const push = (memberId: string | null | undefined) => {
    const raw = compact(memberId);
    if (!raw || !memberExplicitlyActive(state, raw)) {
      return;
    }
    const id = canonicalMemberId(raw);
    if (ids.some((existing) => memberIdsMatch(existing, id))) {
      return;
    }
    ids.push(id);
    const row = state?.memberRoleMap?.find((entry) => memberIdsMatch(entry.memberId ?? "", id));
    const preferred =
      compact(row?.displayName) ||
      compact(row?.label) ||
      compact(row?.name) ||
      nameFromMemberRows(memberRows, id) ||
      agentNameFromConfig(params.cfg, id);
    names.push(resolveOwnerDecisionMentionLabel(id, preferred));
  };
  push(params.publishedBy);
  push(state?.governance?.coordinatorBotId);
  // Human gate: surface governance owners/admins so a bot-published board still
  // presents a card a human can confirm (does not auto-confirm or widen submit).
  const ownerUserId = compact(state?.governance?.ownerUserId);
  if (ownerUserId) {
    push(ownerUserId.startsWith("human:") ? ownerUserId : `human:${ownerUserId}`);
    push(ownerUserId);
  }
  for (const adminId of state?.governance?.adminUserIds ?? []) {
    const admin = compact(adminId);
    if (!admin) {
      continue;
    }
    push(admin.startsWith("human:") ? admin : `human:${admin}`);
    push(admin);
  }
  for (const row of state?.memberRoleMap ?? []) {
    const role = compact(row.governanceRole);
    if (role !== "owner" && role !== "admin") {
      continue;
    }
    const mid = compact(row.memberId);
    const kind = compact(row.memberKind);
    if (!mid) {
      continue;
    }
    if (kind === "human" || mid.startsWith("human:")) {
      push(mid);
    }
  }
  for (const row of memberRows) {
    const role = compact(row.governanceRole);
    if (role !== "owner" && role !== "admin") {
      continue;
    }
    const mid = compact(row.memberId);
    const kind = compact(row.memberKind);
    if (!mid) {
      continue;
    }
    if (kind === "human" || mid.startsWith("human:")) {
      push(mid);
    }
  }
  return { mentionMemberIds: ids, mentionDisplayNames: names };
}

function buildAssistantMessageBody(params: {
  card: OwnerDecisionCard;
  text: string;
  nowMs: number;
  idempotencyKey: string;
}): Record<string, unknown> {
  return {
    role: "assistant",
    content: [{ type: "text" as const, text: params.text }],
    timestamp: params.nowMs,
    stopReason: "stop",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    api: "openai-responses",
    provider: "openclaw",
    model: "gateway-injected",
    idempotencyKey: params.idempotencyKey,
    ownerDecision: params.card,
  };
}

/**
 * True only when a persisted message carries this idempotency key.
 * A matching owner-decision fence in free text is not issuance.
 */
function transcriptHasIdempotencyKey(transcriptPath: string, idempotencyKey: string): boolean {
  try {
    const text = fs.readFileSync(transcriptPath, "utf-8");
    if (!text.includes(idempotencyKey)) {
      return false;
    }
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        const message =
          parsed && typeof parsed.message === "object" && parsed.message
            ? (parsed.message as Record<string, unknown>)
            : parsed;
        if (
          message &&
          typeof message === "object" &&
          typeof message.idempotencyKey === "string" &&
          message.idempotencyKey === idempotencyKey
        ) {
          return true;
        }
      } catch {
        // ignore bad lines
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function ensureTranscriptHeader(params: {
  transcriptPath: string;
  sessionId: string;
}): Promise<void> {
  await fsp.mkdir(path.dirname(params.transcriptPath), { recursive: true });
  try {
    const existing = await fsp.readFile(params.transcriptPath, "utf-8");
    if (existing.trim()) {
      return;
    }
  } catch {
    // create below
  }
  const header = JSON.stringify({
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: params.sessionId,
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
  });
  await fsp.writeFile(params.transcriptPath, `${header}\n`, { encoding: "utf-8", mode: 0o600 });
}

/**
 * Best-effort: bump space:{groupId} updatedAt so sidebar unread can fire.
 * lastMessagePreview is derived from transcript by sessions.list.
 */
type PushOutcome = "completed" | "skipped" | "failed";

/**
 * Best-effort unread bump. Returns whether the push was skipped (no session),
 * completed, or attempted and failed. Never throws.
 */
async function bumpSpaceSessionUpdatedAt(params: {
  groupId: string;
  cfg?: OpenBotConfig;
  nowMs: number;
}): Promise<PushOutcome> {
  const sessionKey = `space:${params.groupId}`;
  const cfg = params.cfg ?? loadConfig();
  let storePath: string;
  try {
    storePath = resolveStorePath(cfg.session?.store);
  } catch {
    return "skipped";
  }
  try {
    const store = loadSessionStore(storePath);
    const existing = store[sessionKey] ?? store[sessionKey.toLowerCase()];
    if (!existing) {
      // Do not invent a new space session — chat.send / bind owns that.
      return "skipped";
    }
    await updateSessionStore(
      storePath,
      (next) => {
        const key = next[sessionKey] ? sessionKey : sessionKey.toLowerCase();
        const prev = next[key] ?? existing;
        if (!prev) {
          return prev;
        }
        const updated = {
          ...prev,
          updatedAt: params.nowMs,
          groupId: params.groupId,
          space: params.groupId,
          chatType: "group" as const,
        };
        next[key] = updated;
        return updated;
      },
      { activeSessionKey: sessionKey },
    );
    return "completed";
  } catch {
    return "failed";
  }
}

function deliveryForTodolist(
  todolist: ExecutorPrivateTodolist,
  patch: Partial<OwnerDecisionCardDelivery> & Pick<OwnerDecisionCardDelivery, "ok" | "stage">,
): OwnerDecisionCardDelivery {
  return normalizeOwnerDecisionDelivery({
    historyReloadable: false,
    deliveryTracked: false,
    clientPresented: false,
    retryable: false,
    userFacing: "tracked",
    groupId: todolist.groupId,
    taskId: todolist.taskId,
    boardItemId: todolist.boardItemId,
    todolistId: todolist.todolistId,
    version: todolist.version,
    ...patch,
  });
}

async function finishDelivery(params: {
  groupId: string;
  cfg?: OpenBotConfig;
  nowMs: number;
  delivery: OwnerDecisionCardDelivery;
  groupRootDir?: string;
  groupLocator?: string;
}): Promise<OwnerDecisionCardDelivery> {
  if (!compact(params.groupId)) {
    return params.delivery;
  }
  try {
    return await recordOwnerDecisionDelivery({
      groupId: params.groupId,
      cfg: params.cfg,
      nowMs: params.nowMs,
      delivery: params.delivery,
      groupRootDir: params.groupRootDir,
      groupLocator: params.groupLocator,
    });
  } catch (err) {
    return normalizeOwnerDecisionDelivery({
      ...params.delivery,
      deliveryTracked: false,
      retryable: true,
      reason: params.delivery.reason ?? "delivery_record_failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Resolve confirmer targets for a proposed todolist and emit a card message.
 */
export async function emitOwnerDecisionCardForProposedTodolist(params: {
  groupId: string;
  todolist: ExecutorPrivateTodolist;
  authority?: RuntimeAuthority;
  cfg?: OpenBotConfig;
  nowMs?: number;
  /** Trusted locator so delivery log matches board/plan SoT. */
  groupRootDir?: string;
  groupLocator?: string;
}): Promise<OwnerDecisionEmitResult> {
  const cfg = params.cfg ?? loadConfig();
  const nowMs = params.nowMs ?? Date.now();
  const groupId = compact(params.groupId) || compact(params.todolist.groupId);
  const tracked = async (delivery: OwnerDecisionCardDelivery): Promise<OwnerDecisionCardDelivery> =>
    finishDelivery({
      groupId,
      cfg,
      nowMs,
      delivery,
      groupRootDir: params.groupRootDir,
      groupLocator: params.groupLocator,
    });

  if (!groupId) {
    return {
      ok: true,
      skipped: true,
      reason: "missing_group_id",
      delivery: deliveryForTodolist(params.todolist, {
        ok: true,
        stage: "skipped",
        reason: "missing_group_id",
        retryable: false,
      }),
    };
  }
  if (params.todolist.status !== "proposed") {
    const reason = `status_${params.todolist.status}`;
    const delivery = await tracked(
      deliveryForTodolist(params.todolist, {
        ok: true,
        stage: "skipped",
        reason,
        retryable: params.todolist.status !== "superseded",
      }),
    );
    return { ok: true, skipped: true, reason, delivery };
  }

  let operatingState: OperatingStateAclSource = null;
  let memberRows: GroupMemberNameRow[] = [];
  try {
    const stores =
      params.groupRootDir && params.groupLocator
        ? createTrustedGroupStores({
            groupsRoot: params.groupRootDir,
            groupLocator: params.groupLocator,
          })
        : createWorkspaceCollaborationStores(cfg);
    operatingState = (await readGroupOperatingState({
      fileStore: stores.fileStore,
      groupId,
    })) as OperatingStateAclSource;
    try {
      const rawMembers = await stores.fileStore.readGroupFile<
        GroupMemberNameRow[] | { members?: GroupMemberNameRow[] | null }
      >({
        groupId,
        filename: "members.json",
      });
      if (Array.isArray(rawMembers)) {
        memberRows = rawMembers;
      } else if (Array.isArray(rawMembers?.members)) {
        memberRows = rawMembers.members;
      }
    } catch {
      memberRows = [];
    }
  } catch {
    operatingState = null;
  }

  let publishedBy: string | null = null;
  if (params.authority) {
    try {
      const board = await loadBoardClaimItem(params.authority, {
        taskId: params.todolist.taskId,
        itemId: params.todolist.boardItemId,
      });
      publishedBy = board?.publishedBy?.trim() ?? null;
    } catch {
      publishedBy = null;
    }
  }

  const { mentionMemberIds, mentionDisplayNames } = resolveMentionTargets({
    operatingState,
    publishedBy,
    memberRows,
    cfg,
  });
  if (mentionMemberIds.length === 0) {
    const delivery = await tracked(
      deliveryForTodolist(params.todolist, {
        ok: true,
        stage: "skipped",
        reason: "no_active_confirmer",
        retryable: true,
      }),
    );
    return { ok: true, skipped: true, reason: "no_active_confirmer", delivery };
  }

  const card = buildOwnerDecisionCard({
    groupId,
    taskId: params.todolist.taskId,
    boardItemId: params.todolist.boardItemId,
    todolistId: params.todolist.todolistId,
    steps: params.todolist.steps,
    mentionMemberIds,
    mentionDisplayNames,
    version: params.todolist.version,
    supplementHint: "确认后执行者才可 markInProgress；退回修订将清除确认。",
  });
  if (!card) {
    const message = "failed to build owner decision card";
    const delivery = await tracked(
      deliveryForTodolist(params.todolist, {
        ok: false,
        stage: "delivery_failed",
        reason: "build_failed",
        message,
        retryable: true,
      }),
    );
    return { ok: false, reason: "build_failed", message, delivery };
  }

  const text = formatOwnerDecisionMessageText(card, {
    mentionDisplayNames,
    includeFence: true,
  });
  const idempotencyKey = ownerDecisionIdempotencyKey(card);

  try {
    await materializeGroupCollaborationWorkspace(groupId, cfg);
  } catch {
    // continue; mkdir on transcript write may still succeed
  }

  const transcriptPath = resolveGroupPublicTranscriptPath(groupId, cfg);
  const sessionId = `group-${groupId}`;
  try {
    await ensureTranscriptHeader({ transcriptPath, sessionId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const delivery = await tracked(
      deliveryForTodolist(params.todolist, {
        ok: false,
        stage: "delivery_failed",
        reason: "transcript_header",
        message,
        retryable: true,
        card,
        idempotencyKey,
      }),
    );
    return { ok: false, reason: "transcript_header", message, card, delivery };
  }

  if (transcriptHasIdempotencyKey(transcriptPath, idempotencyKey)) {
    const push = await bumpSpaceSessionUpdatedAt({ groupId, cfg, nowMs });
    const pushFailed = push === "failed";
    const delivery = await tracked(
      deliveryForTodolist(params.todolist, {
        ok: !pushFailed,
        stage:
          push === "completed"
            ? "push_completed"
            : pushFailed
              ? "push_attempted"
              : "card_persisted",
        reason: pushFailed ? "push_failed" : "idempotent_exists",
        historyReloadable: true,
        retryable: pushFailed,
        card,
        idempotencyKey,
      }),
    );
    return { ok: true, skipped: true, reason: "idempotent_exists", card, delivery };
  }

  const messageBody = buildAssistantMessageBody({
    card,
    text,
    nowMs,
    idempotencyKey,
  });
  const appended = appendPersistedAgentMessageToTranscript({
    transcriptPath,
    message: messageBody,
  });
  if (!appended.ok) {
    const message = appended.error ?? "failed to append owner decision message";
    const delivery = await tracked(
      deliveryForTodolist(params.todolist, {
        ok: false,
        stage: "delivery_failed",
        reason: "transcript_append",
        message,
        retryable: true,
        historyReloadable: false,
        card,
        idempotencyKey,
      }),
    );
    return { ok: false, reason: "transcript_append", message, card, delivery };
  }

  const push = await bumpSpaceSessionUpdatedAt({ groupId, cfg, nowMs });
  const pushFailed = push === "failed";
  const delivery = await tracked(
    deliveryForTodolist(params.todolist, {
      ok: !pushFailed,
      stage:
        push === "completed" ? "push_completed" : pushFailed ? "push_attempted" : "card_persisted",
      reason: pushFailed ? "push_failed" : undefined,
      historyReloadable: true,
      retryable: pushFailed,
      card,
      idempotencyKey,
      messageId: appended.messageId,
    }),
  );
  if (pushFailed) {
    return {
      ok: false,
      reason: "push_failed",
      message: "owner decision card was persisted but the session push failed",
      card,
      delivery,
    };
  }
  return { ok: true, card, messageId: appended.messageId, delivery };
}
