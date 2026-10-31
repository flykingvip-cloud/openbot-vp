import {
  canonicalizeWorkbenchChatSessionKey,
  isRedundantRobotAliasSessionKey,
} from "../../../../../src/sessions/session-key-utils.ts";
import { reloadShellChatHistory } from "../../app-chat-actions.ts";
import type { AppPortState } from "../../app-port-state.ts";
import {
  resolveBuiltinStewardSessionKey,
  resolveStewardSessionDefaultsFromHello,
} from "../../builtin-steward-selection.ts";
import { sessionKeysShareChatSurface } from "../../chat-session-key-match.ts";
import {
  createChatCheckpointLoadState,
  isolateChatCheckpointLoad,
  type ChatCheckpointLoadState,
} from "../../chat/checkpoint-load-state.ts";
import type { ChatCheckpointVisibilityDiagnostic } from "../../chat/checkpoint-visibility-diagnostics.ts";
import { applyPendingChatFocusMessage } from "../../chat/focus-message.ts";
import {
  bumpSessionSeenAt,
  resolveSessionSeenAliasOptionsFromTrustedSession,
} from "../../session-seen-at.ts";
import { syncComputerPreviewAfterSessionSwitch } from "../../views/account-computer-preview.ts";
import {
  maybeTriggerGrowthBirthTurn,
  resetGrowthBirthTurnForSessionSwitch,
  syncGrowthBirthAwakeningState,
  type GrowthBirthTurnWireHost,
} from "./growth-birth-turn-wire.ts";
import { syncGrowthOnWorkbenchSessionOpen } from "./growth-session-sync.ts";
import type {
  WorkbenchGovernanceObjectKind,
  WorkbenchPrimaryModule,
  WorkbenchTasksSubTab,
} from "./views/workbench-types.ts";
import {
  readWorkbenchSessionTranscript,
  writeWorkbenchSessionTranscript,
  type WorkbenchSessionTranscriptCacheEntry,
} from "./workbench-session-transcript-cache.ts";
import {
  cancelWorkbenchTranscriptPrefetch,
  prefetchWorkbenchSessionTranscripts,
} from "./workbench-session-transcript-prefetch.ts";

export type EmployeeWorkbenchGovernanceDetailState = Pick<
  AppPortState,
  | "workbenchTaskDetailId"
  | "workbenchDeliverableDetailId"
  | "workbenchReviewDetailId"
  | "workbenchDecisionDetailId"
  | "workbenchCapsuleDetailId"
  | "workbenchDecisionSelectedOptionDraft"
  | "workbenchDecisionRationaleDraft"
  | "workbenchDecisionOptionsDraft"
>;

export type EmployeeWorkbenchGovernanceSelectionState = EmployeeWorkbenchGovernanceDetailState &
  Pick<AppPortState, "workbenchGroupProfileView">;

export type EmployeeWorkbenchSessionState = EmployeeWorkbenchGovernanceDetailState &
  Pick<
    AppPortState,
    | "basePath"
    | "hello"
    | "workbenchPrimaryModule"
    | "workbenchGroupProfileView"
    | "workbenchTeamSelectedKey"
    | "sessionKey"
    | "connected"
    | "client"
    | "lastError"
    | "chatMessage"
    | "chatAttachments"
    | "chatQuoteDraft"
    | "chatLoading"
    | "chatSending"
    | "chatMessages"
    | "chatAvatarUrl"
    | "chatThinkingLevel"
    | "chatStream"
    | "chatStreamStartedAt"
    | "chatStreamSessionKey"
    | "chatRunId"
    | "chatQueue"
    | "sessionsResult"
    | "settings"
    | "applySettings"
    | "loadAssistantIdentity"
    | "resetToolStream"
    | "resetChatScroll"
    | "workbenchActiveGrowthStatus"
    | "workbenchGrowthBirthAwakening"
    | "workbenchGrowthBirthTurnSentKey"
  > & {
    requestUpdate?: () => void;
    updateComplete?: Promise<unknown>;
    querySelector?: (selectors: string) => Element | null;
    chatHistoryNextBefore?: string | null;
    chatHistoryHasMore?: boolean;
    chatHistoryQuietReload?: boolean;
    chatThinkingProgress?: unknown;
    chatCheckpoints?: unknown[];
    chatCheckpointLoadState?: ChatCheckpointLoadState;
    chatCheckpointDiagnostics?: ChatCheckpointVisibilityDiagnostic[];
    pendingRestoreCheckpointId?: string | null;
    sidebarOpen?: boolean;
    chatOguiDecisions?: import("../../chat/ogui-form-view.ts").OguiDecisionStatusLookup | null;
  };

let workbenchSessionSwitchGeneration = 0;

function snapshotWorkbenchTranscript(
  state: EmployeeWorkbenchSessionState,
): WorkbenchSessionTranscriptCacheEntry {
  return {
    messages: Array.isArray(state.chatMessages) ? state.chatMessages.slice() : [],
    chatHistoryNextBefore: state.chatHistoryNextBefore ?? null,
    chatHistoryHasMore: state.chatHistoryHasMore ?? false,
    chatRunId: state.chatRunId,
    chatStream: state.chatStream,
    chatStreamStartedAt: state.chatStreamStartedAt,
    chatStreamSessionKey: state.chatStreamSessionKey,
    chatThinkingProgress: state.chatThinkingProgress ?? null,
    oguiDecisions: state.chatOguiDecisions ?? null,
  };
}

function applyWorkbenchTranscript(
  state: EmployeeWorkbenchSessionState,
  transcript: WorkbenchSessionTranscriptCacheEntry,
) {
  state.chatMessages = transcript.messages.slice();
  state.chatHistoryNextBefore = transcript.chatHistoryNextBefore ?? null;
  state.chatHistoryHasMore = transcript.chatHistoryHasMore ?? false;
  state.chatOguiDecisions =
    "oguiDecisions" in transcript ? (transcript.oguiDecisions ?? null) : null;
}

function applyWorkbenchRunOccupancy(
  state: EmployeeWorkbenchSessionState,
  transcript: WorkbenchSessionTranscriptCacheEntry | null,
) {
  const runId = transcript?.chatRunId?.trim() ?? "";
  if (!runId) {
    state.chatStream = null;
    state.chatStreamStartedAt = null;
    state.chatStreamSessionKey = null;
    state.chatRunId = null;
    state.chatThinkingProgress = null;
    return;
  }
  state.chatRunId = runId;
  state.chatStream = transcript?.chatStream ?? "";
  state.chatStreamStartedAt = transcript?.chatStreamStartedAt ?? Date.now();
  state.chatStreamSessionKey = transcript?.chatStreamSessionKey ?? null;
  state.chatThinkingProgress = transcript?.chatThinkingProgress ?? null;
}

function normalizeValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : "";
}

export function resetEmployeeWorkbenchGovernanceDetailState(
  state: EmployeeWorkbenchGovernanceDetailState,
) {
  state.workbenchTaskDetailId = null;
  state.workbenchDeliverableDetailId = null;
  state.workbenchReviewDetailId = null;
  state.workbenchDecisionDetailId = null;
  state.workbenchCapsuleDetailId = null;
  state.workbenchDecisionSelectedOptionDraft = null;
  state.workbenchDecisionRationaleDraft = null;
  state.workbenchDecisionOptionsDraft = null;
}

export function openEmployeeCronTaskDetail(
  state: {
    workbenchPrimaryModule: WorkbenchPrimaryModule;
    workbenchTasksSubTab: WorkbenchTasksSubTab;
    workbenchCronFocusJobId: string | null;
    requestUpdate?: () => void;
  },
  jobId: string,
) {
  const id = jobId.trim();
  if (!id) {
    return;
  }
  state.workbenchPrimaryModule = "tasks";
  state.workbenchTasksSubTab = "cron";
  state.workbenchCronFocusJobId = id;
  state.requestUpdate?.();
}

export function openEmployeeWorkbenchGovernanceObjectDetail(
  state: EmployeeWorkbenchGovernanceSelectionState,
  kind: WorkbenchGovernanceObjectKind,
  id: string,
) {
  resetEmployeeWorkbenchGovernanceDetailState(state);
  switch (kind) {
    case "task":
      state.workbenchTaskDetailId = id;
      state.workbenchGroupProfileView = "task-detail";
      break;
    case "deliverable":
      state.workbenchDeliverableDetailId = id;
      state.workbenchGroupProfileView = "deliverable-detail";
      break;
    case "review":
      state.workbenchReviewDetailId = id;
      state.workbenchGroupProfileView = "review-detail";
      break;
    case "decision":
      state.workbenchDecisionDetailId = id;
      state.workbenchGroupProfileView = "decision-detail";
      break;
    case "capsule":
      state.workbenchCapsuleDetailId = id;
      state.workbenchGroupProfileView = "capsule-detail";
      break;
  }
}

export function resolveWorkspacePrimaryModuleForSelection(
  selectionKey: string,
  collaborationSelectionKeys: string[],
): WorkbenchPrimaryModule {
  const normalizedSelectionKey = normalizeValue(selectionKey);
  if (!normalizedSelectionKey) {
    return "assistant";
  }
  if (
    normalizedSelectionKey.startsWith("space:") ||
    normalizedSelectionKey.includes(":space:") ||
    collaborationSelectionKeys.includes(normalizedSelectionKey)
  ) {
    return "collaboration";
  }
  return "assistant";
}

async function bootstrapWorkbenchSessionGrowthAndChat(
  state: EmployeeWorkbenchSessionState,
  sessionKey: string,
  generation: number,
  opts?: { quiet?: boolean },
) {
  const host = state;
  const previousQuiet = host.chatHistoryQuietReload;
  if (opts?.quiet) {
    host.chatHistoryQuietReload = true;
  }
  try {
    await reloadShellChatHistory(state as unknown as Parameters<typeof reloadShellChatHistory>[0], {
      refreshAvatar: !opts?.quiet,
    });
  } finally {
    host.chatHistoryQuietReload = previousQuiet;
  }
  if (
    generation !== workbenchSessionSwitchGeneration ||
    !sessionKeysShareChatSurface(state.sessionKey, sessionKey)
  ) {
    return;
  }
  writeWorkbenchSessionTranscript(sessionKey, snapshotWorkbenchTranscript(state));
  void prefetchWorkbenchSessionTranscripts({
    client: state.client,
    connected: state.connected,
    sessions: state.sessionsResult?.sessions ?? [],
    currentSessionKey: sessionKey,
  });
  state.requestUpdate?.();
  if (typeof state.querySelector === "function") {
    void applyPendingChatFocusMessage({
      sessionKey,
      updateComplete: state.updateComplete,
      querySelector: state.querySelector.bind(state),
    });
  }
  void (async () => {
    if (generation !== workbenchSessionSwitchGeneration) {
      return;
    }
    await syncGrowthOnWorkbenchSessionOpen(state, sessionKey);
    if (generation !== workbenchSessionSwitchGeneration) {
      return;
    }
    syncGrowthBirthAwakeningState(state as unknown as GrowthBirthTurnWireHost);
    await maybeTriggerGrowthBirthTurn(state as unknown as GrowthBirthTurnWireHost);
    if (generation !== workbenchSessionSwitchGeneration) {
      return;
    }
    state.requestUpdate?.();
  })();
}

export function switchEmployeeWorkbenchSession(
  state: EmployeeWorkbenchSessionState,
  sessionKey: string,
  primaryModule: WorkbenchPrimaryModule,
) {
  sessionKey = canonicalizeWorkbenchChatSessionKey(sessionKey);
  if (isRedundantRobotAliasSessionKey(sessionKey)) {
    return;
  }
  const alreadyOnSurface =
    state.workbenchPrimaryModule === primaryModule &&
    sessionKeysShareChatSurface(state.sessionKey, sessionKey);
  // Nav often re-enters the same group via the `space:` alias after the
  // scoped mirror is already open. Restarting history here doubles the
  // slow group store scan and can overwrite a warm transcript with [].
  if (
    alreadyOnSurface &&
    (sessionKey === state.sessionKey.trim() || sessionKey.startsWith("space:"))
  ) {
    state.workbenchPrimaryModule = primaryModule;
    state.sessionKey = sessionKey;
    if (
      !state.workbenchTeamSelectedKey?.trim() ||
      !sessionKeysShareChatSurface(state.workbenchTeamSelectedKey, sessionKey)
    ) {
      state.workbenchTeamSelectedKey = sessionKey;
    }
    // Still persist the unread cursor — skipping applySettings here left
    // sessionSeenAt stale, so refresh resurrected badges for an already-open
    // steward/space surface.
    const seenOpts = resolveSessionSeenAliasOptionsFromTrustedSession({
      hello: state.hello,
      // Auth surfaces live on the Lit app host; EmployeeWorkbenchSessionState is a
      // narrow Pick and may omit them — resolve once via trusted-session helper.
      ...(state as {
        platformAuthState?: {
          enabled?: boolean | null;
          session?: { tenantId?: string | null; user?: string | null } | null;
        } | null;
        bootstrapAuthSession?: { tenantId?: string | null; user?: string | null } | null;
        bootstrapDataSpace?: { mode?: string | null } | null;
      }),
      ownStewardSessionKey: resolveBuiltinStewardSessionKey(
        resolveStewardSessionDefaultsFromHello(state.hello),
      ),
    });
    state.applySettings({
      ...state.settings,
      sessionKey,
      lastActiveSessionKey: sessionKey,
      sessionSeenAt: bumpSessionSeenAt(
        state.settings.sessionSeenAt,
        sessionKey,
        Date.now(),
        seenOpts,
      ),
    });
    return;
  }
  state.workbenchPrimaryModule = primaryModule;
  state.workbenchGroupProfileView = "chat";
  resetEmployeeWorkbenchGovernanceDetailState(state);
  resetGrowthBirthTurnForSessionSwitch(state as unknown as GrowthBirthTurnWireHost);
  cancelWorkbenchTranscriptPrefetch();
  const previousSelection = state.workbenchTeamSelectedKey?.trim() ?? "";
  const previousSessionKey = state.sessionKey.trim();
  if (previousSessionKey && previousSessionKey !== sessionKey) {
    const snapshot = snapshotWorkbenchTranscript(state);
    // Keep a partial transcript even while history is still loading so a
    // fast A→B→A round-trip does not fall back to a blank first visit.
    // Skip empty-in-flight snapshots so we do not record "known empty".
    if (snapshot.messages.length > 0 || !state.chatLoading) {
      writeWorkbenchSessionTranscript(previousSessionKey, snapshot, {
        allowEmpty: snapshot.messages.length === 0 && !state.chatLoading,
      });
    }
  }
  // Stale checkpoint ids must not ride onto the next assistant. Leave an
  // already-open computer dock alone: #581 refreshes it on session switch
  // and only history force-open is suppressed.
  // P0: isolate load state immediately — never show prior session checkpoints.
  state.chatCheckpoints = [];
  state.pendingRestoreCheckpointId = null;
  state.chatCheckpointLoadState = isolateChatCheckpointLoad(
    state.chatCheckpointLoadState ?? createChatCheckpointLoadState(),
    sessionKey,
  );
  state.chatCheckpointDiagnostics = [];
  const cached = readWorkbenchSessionTranscript(sessionKey);
  const generation = ++workbenchSessionSwitchGeneration;
  state.sessionKey = sessionKey;
  // Keep collaboration nav aliases (space:foo) when entering the scoped session.
  // If selection points at a different bot/space, realign so label matches send target.
  if (!previousSelection || !sessionKeysShareChatSurface(previousSelection, sessionKey)) {
    state.workbenchTeamSelectedKey = sessionKey;
  }
  state.chatMessage = "";
  state.chatAttachments = [];
  state.chatQuoteDraft = null;
  // Restore the last painted transcript immediately when we have one.
  // Otherwise clear so collaboration/group never shows leftover 1:1 bubbles.
  if (cached) {
    applyWorkbenchTranscript(state, cached);
    state.chatLoading = false;
  } else {
    state.chatMessages = [];
    state.chatHistoryNextBefore = null;
    state.chatHistoryHasMore = false;
    state.chatOguiDecisions = null;
    state.chatLoading = true;
  }
  applyWorkbenchRunOccupancy(state, cached);
  state.chatQueue = [];
  state.resetToolStream();
  state.resetChatScroll();
  state.applySettings({
    ...state.settings,
    sessionKey,
    lastActiveSessionKey: sessionKey,
    sessionSeenAt: bumpSessionSeenAt(
      state.settings.sessionSeenAt,
      sessionKey,
      Date.now(),
      resolveSessionSeenAliasOptionsFromTrustedSession({
        hello: state.hello,
        ...(state as {
          platformAuthState?: {
            enabled?: boolean | null;
            session?: { tenantId?: string | null; user?: string | null } | null;
          } | null;
          bootstrapAuthSession?: { tenantId?: string | null; user?: string | null } | null;
          bootstrapDataSpace?: { mode?: string | null } | null;
        }),
        ownStewardSessionKey: resolveBuiltinStewardSessionKey(
          resolveStewardSessionDefaultsFromHello(state.hello),
        ),
      }),
    ),
  });
  void state.loadAssistantIdentity();
  syncComputerPreviewAfterSessionSwitch(
    state as unknown as Parameters<typeof syncComputerPreviewAfterSessionSwitch>[0],
  );
  void bootstrapWorkbenchSessionGrowthAndChat(state, sessionKey, generation, {
    quiet: Boolean(cached),
  });
}
