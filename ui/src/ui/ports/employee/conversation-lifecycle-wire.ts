/**
 * Wire Conversation Catalog panel into employee workbench (CL-P1-03).
 */
import type { TemplateResult } from "lit";
import { parseAgentSessionKey } from "../../../../../src/sessions/session-key-utils.ts";
import type { AppPortState } from "../../app-port-state.ts";
import {
  archiveAgentConversation,
  beginConversationSwitch,
  closeAgentConversation,
  createAgentConversation,
  loadConversationsForAgent,
  openConversationSession,
  renameAgentConversation,
  restoreAgentConversation,
  type ConversationsState,
  type ConversationRecordView,
} from "../../controllers/conversations.ts";
import { switchEmployeeWorkbenchSession } from "./render-actions.ts";
import {
  renderWorkbenchConversationPanel,
  type WorkbenchConversationPanelProps,
} from "./views/workbench-conversation-panel.ts";

function asConversationsState(state: AppPortState): ConversationsState {
  return {
    client: state.client,
    connected: state.connected,
    conversationsLoading: Boolean(state.workbenchConversationsLoading),
    conversationsError: state.workbenchConversationsError ?? null,
    conversationsBusy: Boolean(state.workbenchConversationsBusy),
    conversationsAgentId: state.workbenchConversationsAgentId ?? null,
    conversationsGroupId: state.workbenchConversationsGroupId ?? null,
    conversationsRows: state.workbenchConversationsRows ?? [],
    conversationsShowArchived: Boolean(state.workbenchConversationsShowArchived),
    conversationsPanelOpen: state.workbenchConversationsPanelOpen !== false,
    conversationsNextCursor: state.workbenchConversationsNextCursor ?? null,
    conversationsHasMore: Boolean(state.workbenchConversationsHasMore),
    conversationsSwitchGeneration: state.workbenchConversationsSwitchGeneration ?? 0,
  };
}

function syncStateFromController(state: AppPortState, c: ConversationsState) {
  state.workbenchConversationsLoading = c.conversationsLoading;
  state.workbenchConversationsError = c.conversationsError;
  state.workbenchConversationsBusy = c.conversationsBusy;
  state.workbenchConversationsAgentId = c.conversationsAgentId;
  state.workbenchConversationsGroupId = c.conversationsGroupId;
  state.workbenchConversationsRows = c.conversationsRows;
  state.workbenchConversationsShowArchived = c.conversationsShowArchived;
  state.workbenchConversationsPanelOpen = c.conversationsPanelOpen;
  state.workbenchConversationsNextCursor = c.conversationsNextCursor ?? null;
  state.workbenchConversationsHasMore = Boolean(c.conversationsHasMore);
  state.workbenchConversationsSwitchGeneration = c.conversationsSwitchGeneration ?? 0;
}

function requestRender(state: AppPortState) {
  (state as unknown as { requestUpdate?: () => void }).requestUpdate?.();
}

function resolveAgentIdFromSessionKey(sessionKey: string): string | null {
  const parsed = parseAgentSessionKey(sessionKey);
  return parsed?.agentId ?? null;
}

function findActiveConversationId(
  rows: ConversationRecordView[],
  sessionKey: string,
): string | null {
  // Prefer exact session match via conversationId embedded in session key.
  const match = sessionKey.match(/:conversation:(conv_[a-z0-9_]+)/i);
  if (match?.[1]) {
    const id = match[1];
    if (rows.some((r) => r.conversationId === id)) {
      return id;
    }
    return id;
  }
  return stateActiveFallback(rows, sessionKey);
}

function stateActiveFallback(rows: ConversationRecordView[], _sessionKey: string): string | null {
  const active = rows.find((r) => r.lifecycleStatus === "ACTIVE");
  return active?.conversationId ?? rows[0]?.conversationId ?? null;
}

export async function ensureWorkbenchConversationsLoaded(
  state: AppPortState,
  agentId: string | null,
): Promise<void> {
  if (!agentId || !state.client || !state.connected) {
    return;
  }
  if (
    state.workbenchConversationsAgentId === agentId &&
    (state.workbenchConversationsRows?.length ?? 0) > 0 &&
    !state.workbenchConversationsLoading
  ) {
    return;
  }
  const c = asConversationsState(state);
  await loadConversationsForAgent(c, {
    agentId,
    includeArchived: c.conversationsShowArchived,
  });
  syncStateFromController(state, c);
  state.workbenchActiveConversationId = findActiveConversationId(
    c.conversationsRows,
    state.sessionKey,
  );
  requestRender(state);
}

export function buildWorkbenchConversationPanelProps(
  state: AppPortState,
): WorkbenchConversationPanelProps | null {
  const agentId =
    state.workbenchConversationsAgentId ?? resolveAgentIdFromSessionKey(state.sessionKey) ?? null;
  if (!agentId) {
    return null;
  }

  // Fire-and-forget load when agent changes.
  if (state.connected && state.client && state.workbenchConversationsAgentId !== agentId) {
    void ensureWorkbenchConversationsLoaded(state, agentId);
  }

  const rows = state.workbenchConversationsRows ?? [];
  const activeConversationId =
    state.workbenchActiveConversationId ?? findActiveConversationId(rows, state.sessionKey);

  return {
    open: state.workbenchConversationsPanelOpen !== false,
    loading: Boolean(state.workbenchConversationsLoading),
    busy: Boolean(state.workbenchConversationsBusy),
    error: state.workbenchConversationsError ?? null,
    agentId,
    activeSessionKey: state.sessionKey,
    activeConversationId,
    rows,
    showArchived: Boolean(state.workbenchConversationsShowArchived),
    onToggleOpen: () => {
      state.workbenchConversationsPanelOpen = !(state.workbenchConversationsPanelOpen !== false);
      requestRender(state);
    },
    onToggleArchived: () => {
      state.workbenchConversationsShowArchived = !state.workbenchConversationsShowArchived;
      void (async () => {
        const c = asConversationsState(state);
        await loadConversationsForAgent(c, {
          agentId,
          includeArchived: c.conversationsShowArchived,
        });
        syncStateFromController(state, c);
        requestRender(state);
      })();
    },
    hasMore: Boolean(state.workbenchConversationsHasMore),
    onCreate: () => {
      void (async () => {
        const c = asConversationsState(state);
        const gen = beginConversationSwitch(c);
        const created = await createAgentConversation(c, { agentId });
        syncStateFromController(state, c);
        if (created && c.conversationsSwitchGeneration === gen) {
          state.workbenchActiveConversationId = created.conversationId;
          state.workbenchConversationReadOnly = false;
          switchEmployeeWorkbenchSession(state, created.sessionKey, "assistant");
        }
        requestRender(state);
      })();
    },
    onSelect: (conversationId) => {
      void (async () => {
        const c = asConversationsState(state);
        const gen = beginConversationSwitch(c);
        syncStateFromController(state, c);
        const opened = await openConversationSession(c, conversationId, { generation: gen });
        syncStateFromController(state, c);
        if (opened?.stale || c.conversationsSwitchGeneration !== gen) {
          requestRender(state);
          return;
        }
        if (opened?.sessionKey) {
          state.workbenchActiveConversationId = conversationId;
          state.workbenchConversationReadOnly = opened.readOnly;
          switchEmployeeWorkbenchSession(state, opened.sessionKey, "assistant");
        }
        requestRender(state);
      })();
    },
    onRename: (conversationId, title, etag) => {
      void (async () => {
        const c = asConversationsState(state);
        await renameAgentConversation(c, { conversationId, title, etag, agentId });
        syncStateFromController(state, c);
        requestRender(state);
      })();
    },
    onClose: (conversationId, etag) => {
      void (async () => {
        const c = asConversationsState(state);
        await closeAgentConversation(c, { conversationId, etag, agentId });
        syncStateFromController(state, c);
        requestRender(state);
      })();
    },
    onArchive: (conversationId, etag) => {
      void (async () => {
        const c = asConversationsState(state);
        const ok = await archiveAgentConversation(c, { conversationId, etag, agentId });
        syncStateFromController(state, c);
        if (ok && state.workbenchActiveConversationId === conversationId) {
          state.workbenchConversationReadOnly = true;
        }
        requestRender(state);
      })();
    },
    onRestore: (conversationId, etag) => {
      void (async () => {
        const c = asConversationsState(state);
        const gen = beginConversationSwitch(c);
        const restored = await restoreAgentConversation(c, { conversationId, etag, agentId });
        syncStateFromController(state, c);
        if (restored && c.conversationsSwitchGeneration === gen) {
          state.workbenchActiveConversationId = conversationId;
          state.workbenchConversationReadOnly = false;
          switchEmployeeWorkbenchSession(state, restored.sessionKey, "assistant");
        }
        requestRender(state);
      })();
    },
    onLoadMore: () => {
      void (async () => {
        const c = asConversationsState(state);
        await loadConversationsForAgent(c, {
          agentId,
          includeArchived: c.conversationsShowArchived,
          append: true,
        });
        syncStateFromController(state, c);
        requestRender(state);
      })();
    },
  };
}

/** Build rendered Conversation Catalog for the assistant stage (CL-P1-03). */
export function renderWorkbenchConversationCatalog(state: AppPortState): TemplateResult | null {
  const props = buildWorkbenchConversationPanelProps(state);
  if (!props) {
    return null;
  }
  return renderWorkbenchConversationPanel(props) as TemplateResult | null;
}
