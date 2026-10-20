/**
 * Employee Conversation Catalog API client (CL-P1-03).
 */
import type { GatewayBrowserClient } from "../gateway.ts";

export type ConversationLifecycleStatus = "ACTIVE" | "CLOSED" | "ARCHIVED" | "DELETED";
export type ConversationStorageTier = "HOT" | "WARM" | "COLD";
export type ConversationRetentionState = "RETAIN" | "EXPIRING" | "LEGAL_HOLD" | "PURGE_PENDING";

export type ConversationRecordView = {
  conversationId: string;
  agentId: string | null;
  groupId: string | null;
  title: string;
  titleSource: "AUTO" | "USER" | "IMPORT";
  lifecycleStatus: ConversationLifecycleStatus;
  storageTier: ConversationStorageTier;
  retentionState: ConversationRetentionState;
  updatedAt: string;
  lastMessageAt: string | null;
  etag: string;
  primaryBindingId: string | null;
};

export type ConversationBindingView = {
  bindingId: string;
  conversationId: string;
  sessionKey: string;
  sessionId: string;
  role: string;
  transcriptState: string;
};

export type ConversationsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  conversationsLoading: boolean;
  conversationsError: string | null;
  conversationsBusy: boolean;
  conversationsAgentId: string | null;
  conversationsGroupId: string | null;
  conversationsRows: ConversationRecordView[];
  conversationsShowArchived: boolean;
  conversationsPanelOpen: boolean;
  /** Opaque list cursor for load-more (CL-P1-03). */
  conversationsNextCursor?: string | null;
  conversationsHasMore?: boolean;
  /**
   * Monotonic generation for in-flight open/create; stale responses must not
   * overwrite the active session after a later switch (CL-P1-03).
   */
  conversationsSwitchGeneration?: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeConversation(raw: unknown): ConversationRecordView | null {
  const o = asRecord(raw);
  if (!o || typeof o.conversationId !== "string") {
    return null;
  }
  return {
    conversationId: o.conversationId,
    agentId: typeof o.agentId === "string" ? o.agentId : null,
    groupId: typeof o.groupId === "string" ? o.groupId : null,
    title: typeof o.title === "string" && o.title.trim() ? o.title : "Conversation",
    titleSource:
      o.titleSource === "USER" || o.titleSource === "IMPORT" || o.titleSource === "AUTO"
        ? o.titleSource
        : "AUTO",
    lifecycleStatus:
      o.lifecycleStatus === "CLOSED" ||
      o.lifecycleStatus === "ARCHIVED" ||
      o.lifecycleStatus === "DELETED" ||
      o.lifecycleStatus === "ACTIVE"
        ? o.lifecycleStatus
        : "ACTIVE",
    storageTier:
      o.storageTier === "WARM" || o.storageTier === "COLD" || o.storageTier === "HOT"
        ? o.storageTier
        : "HOT",
    retentionState:
      o.retentionState === "EXPIRING" ||
      o.retentionState === "LEGAL_HOLD" ||
      o.retentionState === "PURGE_PENDING" ||
      o.retentionState === "RETAIN"
        ? o.retentionState
        : "RETAIN",
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : new Date().toISOString(),
    lastMessageAt: typeof o.lastMessageAt === "string" ? o.lastMessageAt : null,
    etag: typeof o.etag === "string" ? o.etag : "",
    primaryBindingId: typeof o.primaryBindingId === "string" ? o.primaryBindingId : null,
  };
}

export async function loadConversationsForAgent(
  state: ConversationsState,
  params: {
    agentId?: string | null;
    groupId?: string | null;
    includeArchived?: boolean;
    /** Append next page when true (uses conversationsNextCursor). */
    append?: boolean;
  },
): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  state.conversationsLoading = true;
  state.conversationsError = null;
  state.conversationsAgentId = params.agentId?.trim() || null;
  state.conversationsGroupId = params.groupId?.trim() || null;
  try {
    const lifecycleStatus = params.includeArchived
      ? (["ACTIVE", "CLOSED", "ARCHIVED"] as const)
      : (["ACTIVE", "CLOSED"] as const);
    const cursor =
      params.append && state.conversationsNextCursor ? state.conversationsNextCursor : undefined;
    if (params.append && !cursor) {
      state.conversationsHasMore = false;
      return;
    }
    const res = await state.client.request<{ rows?: unknown[]; nextCursor?: string | null }>(
      "conversations.list",
      {
        agentId: state.conversationsAgentId ?? undefined,
        groupId: state.conversationsGroupId ?? undefined,
        lifecycleStatus: [...lifecycleStatus],
        limit: 40,
        cursor: cursor ?? null,
      },
    );
    const rows = Array.isArray(res?.rows) ? res.rows : [];
    const normalized = rows
      .map(normalizeConversation)
      .filter((row): row is ConversationRecordView => Boolean(row));
    if (params.append) {
      const seen = new Set(state.conversationsRows.map((r) => r.conversationId));
      state.conversationsRows = [
        ...state.conversationsRows,
        ...normalized.filter((r) => !seen.has(r.conversationId)),
      ];
    } else {
      state.conversationsRows = normalized;
    }
    state.conversationsNextCursor =
      typeof res?.nextCursor === "string" && res.nextCursor.trim() ? res.nextCursor : null;
    state.conversationsHasMore = Boolean(state.conversationsNextCursor);
  } catch (err) {
    state.conversationsError = String(err);
    if (!params.append) {
      state.conversationsRows = [];
      state.conversationsNextCursor = null;
      state.conversationsHasMore = false;
    }
  } finally {
    state.conversationsLoading = false;
  }
}

export async function closeAgentConversation(
  state: ConversationsState,
  params: { conversationId: string; etag: string; agentId?: string | null },
): Promise<boolean> {
  if (!state.client || !state.connected || state.conversationsBusy) {
    return false;
  }
  state.conversationsBusy = true;
  state.conversationsError = null;
  try {
    await state.client.request("conversations.close", {
      conversationId: params.conversationId,
      etag: params.etag,
    });
    await loadConversationsForAgent(state, {
      agentId: params.agentId ?? state.conversationsAgentId,
      includeArchived: state.conversationsShowArchived,
    });
    return true;
  } catch (err) {
    state.conversationsError = String(err);
    return false;
  } finally {
    state.conversationsBusy = false;
  }
}

export async function createAgentConversation(
  state: ConversationsState,
  params: { agentId: string; title?: string },
): Promise<{ sessionKey: string; conversationId: string } | null> {
  if (!state.client || !state.connected || state.conversationsBusy) {
    return null;
  }
  state.conversationsBusy = true;
  state.conversationsError = null;
  try {
    const res = await state.client.request<{
      conversation?: unknown;
      sessionKey?: string;
      binding?: { sessionKey?: string };
    }>("conversations.create", {
      surfaceType: "AGENT",
      agentId: params.agentId,
      title: params.title ?? null,
    });
    const conversation = normalizeConversation(res?.conversation);
    const sessionKey =
      (typeof res?.sessionKey === "string" && res.sessionKey) ||
      (typeof res?.binding?.sessionKey === "string" && res.binding.sessionKey) ||
      "";
    if (!conversation || !sessionKey) {
      throw new Error("invalid conversations.create response");
    }
    await loadConversationsForAgent(state, {
      agentId: params.agentId,
      includeArchived: state.conversationsShowArchived,
    });
    return { sessionKey, conversationId: conversation.conversationId };
  } catch (err) {
    state.conversationsError = String(err);
    return null;
  } finally {
    state.conversationsBusy = false;
  }
}

export async function renameAgentConversation(
  state: ConversationsState,
  params: { conversationId: string; title: string; etag: string; agentId?: string | null },
): Promise<boolean> {
  if (!state.client || !state.connected || state.conversationsBusy) {
    return false;
  }
  state.conversationsBusy = true;
  state.conversationsError = null;
  try {
    await state.client.request("conversations.rename", {
      conversationId: params.conversationId,
      title: params.title,
      etag: params.etag,
    });
    await loadConversationsForAgent(state, {
      agentId: params.agentId ?? state.conversationsAgentId,
      includeArchived: state.conversationsShowArchived,
    });
    return true;
  } catch (err) {
    state.conversationsError = String(err);
    return false;
  } finally {
    state.conversationsBusy = false;
  }
}

/**
 * Stable client requestId for archive/restore idempotency.
 * Survives UI retry after partial failure / response loss until success clears it.
 */
const lifecycleRequestIds = new Map<string, string>();

function stableLifecycleRequestId(kind: "archive" | "restore", conversationId: string): string {
  const key = `${kind}:${conversationId}`;
  let id = lifecycleRequestIds.get(key);
  if (!id) {
    id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `ui-${kind}-${conversationId}-${Math.random().toString(16).slice(2)}`;
    lifecycleRequestIds.set(key, id);
  }
  return id;
}

function clearLifecycleRequestId(kind: "archive" | "restore", conversationId: string): void {
  lifecycleRequestIds.delete(`${kind}:${conversationId}`);
}

/** Test helper */
export function _resetLifecycleRequestIdsForTests(): void {
  lifecycleRequestIds.clear();
}

/** Test helper: inspect whether requestId is still retained for retry. */
export function _peekLifecycleRequestId(
  kind: "archive" | "restore",
  conversationId: string,
): string | undefined {
  return lifecycleRequestIds.get(`${kind}:${conversationId}`);
}

type LifecycleRpcResponse = {
  claimed?: boolean;
  job?: {
    jobId?: string;
    status?: string;
    requestId?: string;
  };
  sessionKey?: string;
  binding?: { sessionKey?: string };
  conversation?: { etag?: string };
};

/** Mutable for unit tests (fast poll). Production defaults: 400ms × 90. */
export const __lifecyclePollConfig = {
  pollMs: 400,
  pollMax: 90,
};

/**
 * Wait until job leaves RUNNING. Keeps requestId until SUCCEEDED/FAILED terminal.
 */
async function pollLifecycleJobUntilSettled(
  state: ConversationsState,
  jobId: string,
): Promise<{ status: string; job: Record<string, unknown> } | null> {
  if (!state.client) {
    return null;
  }
  const pollMs = __lifecyclePollConfig.pollMs;
  const pollMax = __lifecyclePollConfig.pollMax;
  for (let i = 0; i < pollMax; i++) {
    const res = await state.client.request<{ job?: { status?: string; jobId?: string } }>(
      "conversations.job",
      { jobId },
    );
    const status = res?.job?.status ?? "";
    if (status && status !== "RUNNING" && status !== "PENDING") {
      return { status, job: (res?.job ?? {}) as Record<string, unknown> };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}

function isRunningLifecycleResponse(res: LifecycleRpcResponse | null | undefined): boolean {
  const status = res?.job?.status;
  return status === "RUNNING" || status === "PENDING";
}

export async function archiveAgentConversation(
  state: ConversationsState,
  params: { conversationId: string; etag?: string; agentId?: string | null },
): Promise<boolean> {
  if (!state.client || !state.connected || state.conversationsBusy) {
    return false;
  }
  state.conversationsBusy = true;
  state.conversationsError = null;
  const requestId = stableLifecycleRequestId("archive", params.conversationId);
  try {
    let res = await state.client.request<LifecycleRpcResponse>("conversations.archive", {
      conversationId: params.conversationId,
      etag: params.etag,
      requestId,
    });
    // Inflight (no claim): poll until terminal; never clear requestId early.
    if (isRunningLifecycleResponse(res) && res.job?.jobId) {
      const settled = await pollLifecycleJobUntilSettled(state, res.job.jobId);
      if (!settled || settled.status === "FAILED_RETRYABLE") {
        state.conversationsError =
          settled?.status === "FAILED_RETRYABLE"
            ? "archive failed; retry will reuse requestId"
            : "archive still running; retry will reuse requestId";
        return false;
      }
      res = { job: { status: settled.status, jobId: res.job.jobId }, claimed: false };
    }
    if (res?.job?.status === "FAILED_RETRYABLE") {
      state.conversationsError = "archive failed; retry will reuse requestId";
      return false;
    }
    // Only clear idempotency key after confirmed SUCCEEDED (or legacy success without job).
    if (!res?.job?.status || res.job.status === "SUCCEEDED") {
      clearLifecycleRequestId("archive", params.conversationId);
    }
    await loadConversationsForAgent(state, {
      agentId: params.agentId ?? state.conversationsAgentId,
      includeArchived: true,
    });
    state.conversationsShowArchived = true;
    return true;
  } catch (err) {
    // Keep requestId for retry with same idempotency key.
    state.conversationsError = String(err);
    return false;
  } finally {
    state.conversationsBusy = false;
  }
}

export async function restoreAgentConversation(
  state: ConversationsState,
  params: { conversationId: string; etag?: string; agentId?: string | null },
): Promise<{ sessionKey: string } | null> {
  if (!state.client || !state.connected || state.conversationsBusy) {
    return null;
  }
  state.conversationsBusy = true;
  state.conversationsError = null;
  const requestId = stableLifecycleRequestId("restore", params.conversationId);
  try {
    let res = await state.client.request<LifecycleRpcResponse>("conversations.restore", {
      conversationId: params.conversationId,
      etag: params.etag,
      requestId,
      targetLifecycle: "ACTIVE",
    });
    if (isRunningLifecycleResponse(res) && res.job?.jobId) {
      const settled = await pollLifecycleJobUntilSettled(state, res.job.jobId);
      if (!settled || settled.status === "FAILED_RETRYABLE") {
        state.conversationsError =
          settled?.status === "FAILED_RETRYABLE"
            ? "restore failed; retry will reuse requestId"
            : "restore still running; retry will reuse requestId";
        return null;
      }
      // Re-fetch restore with same requestId to get sessionKey after SUCCEEDED.
      res = await state.client.request<LifecycleRpcResponse>("conversations.restore", {
        conversationId: params.conversationId,
        requestId,
        targetLifecycle: "ACTIVE",
      });
    }
    if (res?.job?.status === "FAILED_RETRYABLE") {
      state.conversationsError = "restore failed; retry will reuse requestId";
      return null;
    }
    if (!res?.job?.status || res.job.status === "SUCCEEDED") {
      clearLifecycleRequestId("restore", params.conversationId);
    }
    const sessionKey =
      (typeof res?.sessionKey === "string" && res.sessionKey) ||
      (typeof res?.binding?.sessionKey === "string" && res.binding.sessionKey) ||
      "";
    await loadConversationsForAgent(state, {
      agentId: params.agentId ?? state.conversationsAgentId,
      includeArchived: state.conversationsShowArchived,
    });
    return sessionKey ? { sessionKey } : null;
  } catch (err) {
    state.conversationsError = String(err);
    return null;
  } finally {
    state.conversationsBusy = false;
  }
}

export async function openConversationSession(
  state: ConversationsState,
  conversationId: string,
  options?: { generation?: number },
): Promise<{ sessionKey: string; readOnly: boolean; stale?: boolean } | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  const generation = options?.generation;
  try {
    const res = await state.client.request<{
      conversation?: { lifecycleStatus?: string };
      bindings?: Array<{ sessionKey?: string; role?: string }>;
    }>("conversations.get", { conversationId });
    if (
      generation != null &&
      state.conversationsSwitchGeneration != null &&
      generation !== state.conversationsSwitchGeneration
    ) {
      return { sessionKey: "", readOnly: false, stale: true };
    }
    const binding =
      res?.bindings?.find((b) => b.role === "PRIMARY" || b.role === "GROUP_PUBLIC") ??
      res?.bindings?.[0];
    const sessionKey = binding?.sessionKey?.trim() ?? "";
    if (!sessionKey) {
      return null;
    }
    return {
      sessionKey,
      readOnly: res?.conversation?.lifecycleStatus === "ARCHIVED",
    };
  } catch (err) {
    state.conversationsError = String(err);
    return null;
  }
}

/** Bump switch generation; returns the token for this open/create request. */
export function beginConversationSwitch(state: ConversationsState): number {
  const next = (state.conversationsSwitchGeneration ?? 0) + 1;
  state.conversationsSwitchGeneration = next;
  return next;
}
