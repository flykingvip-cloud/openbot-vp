import { i18n, type Locale } from "../../../i18n/index.ts";
import type { AppPortState } from "../../app-port-state.ts";
import {
  resolveBuiltinStewardSessionKey,
  resolveStewardSessionDefaultsFromHello,
} from "../../builtin-steward-selection.ts";
import { cronCapability } from "../../capability/cron/index.ts";
import { sessionKeysShareChatSurface } from "../../chat-session-key-match.ts";
import { openKnowledgeUniverseGovernancePage } from "../../controllers/knowledge-universe.ts";
import { cancelWorkbenchScheduleEntry, refreshWorkbenchSignals } from "../../controllers/spaces.ts";
import { replaceLocationWithPublicHomepage } from "../../public-home.ts";
import { bumpSessionSeenAtMany } from "../../session-seen-at.ts";
import type { ThemeMode } from "../../theme.ts";
import { openPersonalOperationalIdentitySection } from "./operational-identity-navigation.ts";
import {
  openEmployeeCronTaskDetail,
  resetEmployeeWorkbenchGovernanceDetailState,
  resolveWorkspacePrimaryModuleForSelection,
  switchEmployeeWorkbenchSession,
} from "./render-actions.ts";
import {
  DEFAULT_WORKBENCH_SYSTEM_SETTINGS_TAB,
  type WorkbenchProps,
} from "./views/workbench-types.ts";

type ShellActionProps = Pick<
  WorkbenchProps,
  | "onLocaleChange"
  | "onThemeChange"
  | "onChatFocusModeChange"
  | "onChatShowThinkingChange"
  | "onLogout"
  | "profileMenuOpen"
  | "onProfileMenuOpenChange"
  | "onPrimaryModuleChange"
  | "onTasksSubTabChange"
  | "onOpenSystemSettings"
  | "onOpenPersonalSettings"
  | "onTeamSelectedKeyChange"
  | "onSelectSession"
  | "onAcknowledgeSiblingSessions"
  | "onToggleSidebar"
  | "onToggleSidebarGroup"
  | "onOpenAssistantSettings"
  | "onOpenChannelSettings"
  | "onOpenCron"
  | "onOpenOverview"
  | "onOpenScheduleEntry"
  | "onOpenCollaborationSpace"
  | "onOpenCollaborationInvite"
  | "onOpenStewardSuggestion"
  | "onOpenMeetingInviteReview"
  | "onConfirmTenantNotice"
  | "onAddScheduleEntry"
  | "onCancelScheduleEntry"
  | "onPrefillChatDraft"
  | "onAskDaibai"
  | "onExecuteDaibaiAction"
  | "onConfirmDaibaiPendingAction"
  | "onCancelDaibaiPendingConfirmation"
  | "onConfirmMeetingPendingApproval"
  | "onCancelMeetingPendingConfirmation"
  | "onDismissMeetingConfirmRelease"
  | "onOpenDaibaiHelp"
  | "onOpenSupervisorTask"
  | "onOpenSupervisorBoard"
  | "onOpenDaibaiForDevTask"
  | "onLoadGroupMembers"
  | "onBrandLogoFileChange"
  | "onResetBrandLogo"
>;

function openStewardInbox(state: AppPortState) {
  const defaults = resolveStewardSessionDefaultsFromHello(state.hello);
  const stewardKey = resolveBuiltinStewardSessionKey(defaults);
  state.workbenchTeamSelectedKey = stewardKey;
  switchEmployeeWorkbenchSession(state, stewardKey, "assistant");
}

type BuildEmployeeWorkbenchShellActionPropsArgs = {
  state: AppPortState;
  collaborationSelectionKeys: string[];
  resetWorkbenchMemberGovernanceState: (state: AppPortState) => void;
};

/** Mirror of render-model's requestWorkbenchRender (state.requestUpdate). */
function requestShellRender(state: AppPortState) {
  (state as unknown as { requestUpdate?: () => void }).requestUpdate?.();
}

/**
 * 加载「我的任务」定时任务子段数据。cron 中心组件不自加载，依赖此处显式触发；
 * cron 加载器只改非响应式 state，故完成后需显式 requestUpdate 触发重渲染。
 */
function reloadEmployeeCronCenter(state: AppPortState) {
  cronCapability.setPersonalScopeOnly(state, true);
  void cronCapability.loadStatus(state).then(async () => {
    await cronCapability.loadJobs(state);
    requestShellRender(state);
  });
}

function normalizeShellLookupValue(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function resolveCollaborationSessionKeyByGroupId(
  state: AppPortState,
  groupId: string,
): string | null {
  const gid = groupId.trim();
  if (!gid) {
    return null;
  }
  for (const session of state.sessionsResult?.sessions ?? []) {
    const sessionKey = normalizeShellLookupValue(session.key);
    if (!sessionKey) {
      continue;
    }
    const sessionGroupId =
      normalizeShellLookupValue(session.groupId) ??
      normalizeShellLookupValue(session.collaborationGroupProfile?.groupId) ??
      normalizeShellLookupValue(session.collaborationParticipationOverlay?.groupId);
    if (sessionGroupId === gid) {
      return sessionKey;
    }
    if (sessionKey === `space:${gid}` || sessionKey.endsWith(`:space:${gid}`)) {
      return sessionKey;
    }
    const spaceAlias = sessionKey.startsWith("space:")
      ? sessionKey.slice("space:".length).trim()
      : null;
    if (spaceAlias === gid) {
      return sessionKey;
    }
  }
  return null;
}

export function buildEmployeeWorkbenchShellActionProps({
  state,
  collaborationSelectionKeys,
  resetWorkbenchMemberGovernanceState,
}: BuildEmployeeWorkbenchShellActionPropsArgs): ShellActionProps {
  const hasTrustedProxySession = Boolean(
    state.hello?.auth?.provider === "trusted-proxy" && state.hello.auth.user,
  );
  const shouldUsePlatformLogout = Boolean(
    state.platformAuthState?.enabled ||
    state.platformAuthState?.session ||
    state.bootstrapAuthSession,
  );
  return {
    onLocaleChange: (locale) => {
      const nextLocale: Locale = locale === "en" ? "en" : "zh-CN";
      void i18n.setLocale(nextLocale);
      state.applySettings({
        ...state.settings,
        locale: nextLocale,
        localePinnedByUser: true,
      });
    },
    onThemeChange: (theme) => {
      const nextTheme: ThemeMode = theme === "dark" || theme === "system" ? theme : "light";
      state.setTheme(nextTheme);
    },
    onChatFocusModeChange: (value) => {
      state.applySettings({
        ...state.settings,
        chatFocusMode: Boolean(value),
      });
    },
    onChatShowThinkingChange: (value) => {
      state.applySettings({
        ...state.settings,
        chatShowThinking: Boolean(value),
      });
    },
    onLogout: () => {
      if (hasTrustedProxySession || shouldUsePlatformLogout) {
        void state.logoutPlatformAuth();
        return;
      }
      state.client?.stop();
      state.connected = false;
      state.lastError = null;
      state.lastErrorCode = null;
      state.forcePublicHomepage = true;
      state.tab = "me";
      state.applySettings({
        ...state.settings,
        token: "",
      });
      replaceLocationWithPublicHomepage(state.basePath ?? "");
    },
    profileMenuOpen: Boolean(state.workbenchHeaderProfileMenuOpen),
    onProfileMenuOpenChange: (open) => {
      state.workbenchHeaderProfileMenuOpen = open;
      requestShellRender(state);
    },
    onPrimaryModuleChange: (module) => {
      state.workbenchPrimaryModule = module;
      if (module === "settings") {
        state.workbenchSettingsView = "system";
        state.workbenchSystemSettingsTab = DEFAULT_WORKBENCH_SYSTEM_SETTINGS_TAB;
      }
      if (module === "tasks") {
        // 「我的任务」始终从默认子段（定时任务）进入，并预加载 cron 数据
        // （cron 中心不自加载；与原 onSystemSettingsTabChange("jobs") 行为一致）。
        state.workbenchTasksSubTab = "cron";
        reloadEmployeeCronCenter(state);
      }
      if (module === "knowledge") {
        // Force reload: first enter can race gateway/auth and stick hasLoaded=true
        // with an empty knowledgeBases cache.
        void state.loadKnowledgeUniverseHome({ force: true });
        return;
      }
      if (module !== "collaboration") {
        if (module === "assistant") {
          state.workbenchRobotWorkbenchTab = "overview";
          void state.loadUserOperationalIdentities();
        }
        state.workbenchGroupProfileView = "chat";
        resetEmployeeWorkbenchGovernanceDetailState(state);
        state.resetCollaborationLearningSnapshot();
        state.resetCollaborationGovernanceActionState();
        resetWorkbenchMemberGovernanceState(state);
        return;
      }
      if (state.workbenchGroupProfileView !== "chat") {
        void state.loadCollaborationLearningSnapshot();
        void state.loadCollaborationObservabilitySnapshot();
      }
    },
    onTasksSubTabChange: (tab) => {
      state.workbenchTasksSubTab = tab;
      if (tab === "cron") {
        reloadEmployeeCronCenter(state);
      }
      requestShellRender(state);
    },
    onOpenSystemSettings: () => {
      state.workbenchPrimaryModule = "settings";
      state.workbenchSettingsView = "system";
      state.workbenchSystemSettingsTab = DEFAULT_WORKBENCH_SYSTEM_SETTINGS_TAB;
      state.workbenchGroupProfileView = "chat";
      resetEmployeeWorkbenchGovernanceDetailState(state);
      state.resetCollaborationLearningSnapshot();
      state.resetCollaborationGovernanceActionState();
      resetWorkbenchMemberGovernanceState(state);
    },
    onOpenPersonalSettings: () => {
      state.workbenchHeaderProfileMenuOpen = false;
      openPersonalOperationalIdentitySection(state, { scroll: false }, requestShellRender);
      resetWorkbenchMemberGovernanceState(state);
    },
    onTeamSelectedKeyChange: (key, options) => {
      const nextPrimaryModule =
        options?.preferredModule ??
        resolveWorkspacePrimaryModuleForSelection(key, collaborationSelectionKeys);
      state.workbenchRobotWorkbenchTab = "overview";
      state.workbenchGroupProfileView = "chat";
      resetEmployeeWorkbenchGovernanceDetailState(state);
      state.resetCollaborationLearningSnapshot();
      state.resetCollaborationGovernanceActionState();
      resetWorkbenchMemberGovernanceState(state);
      // Assistant and collaboration both own a chat surface — switching nav must
      // also switch sessionKey. Previously assistant only updated the highlight,
      // so Skill 孵化 could stay highlighted while sends/history stayed on 大白.
      if (nextPrimaryModule === "collaboration" || nextPrimaryModule === "assistant") {
        switchEmployeeWorkbenchSession(state, key, nextPrimaryModule);
        // Always restore the nav alias (`space:id`) even when the live history
        // session is the scoped mirror (`agent:…:space:id`).
        state.workbenchTeamSelectedKey = key;
        return;
      }
      state.workbenchTeamSelectedKey = key;
      state.workbenchPrimaryModule = nextPrimaryModule;
    },
    onSelectSession: (sessionKey, options) => {
      const nextPrimaryModule =
        options?.preferredModule ??
        resolveWorkspacePrimaryModuleForSelection(sessionKey, collaborationSelectionKeys);
      if (nextPrimaryModule === "assistant") {
        state.workbenchRobotWorkbenchTab = "overview";
      }
      state.resetCollaborationLearningSnapshot();
      state.resetCollaborationGovernanceActionState();
      resetWorkbenchMemberGovernanceState(state);
      switchEmployeeWorkbenchSession(state, sessionKey, nextPrimaryModule);
      // Keep nav selection on the key the user opened (may be a conversation child).
      // Collaboration mirrors must not replace the `space:` alias — the follow-up
      // onTeamSelectedKeyChange restores it after a nav click.
      if (
        !sessionKeysShareChatSurface(state.workbenchTeamSelectedKey, sessionKey) &&
        !sessionKey.includes(":space:")
      ) {
        state.workbenchTeamSelectedKey = sessionKey;
      }
    },
    /**
     * Mark sibling sessions as seen so the unread badge can clear when the
     * user opens an assistant or collaboration space. The primary session
     * already has its `sessionSeenAt` bumped inside
     * `switchEmployeeWorkbenchSession`; this fans out the same acknowledgement
     * to the rest of the entry's sessions (cron jobs, group chats, dm rows…).
     *
     * Without this, clicking 市场助手 leaves the badge stuck because
     * `countUnreadSessions` keeps finding `updatedAt > seenAt` on the noisy
     * sibling sessions the user never explicitly visited.
     */
    onAcknowledgeSiblingSessions: (sessionKeys) => {
      if (!Array.isArray(sessionKeys) || sessionKeys.length === 0) {
        return;
      }
      const seenAt = Date.now();
      const ownStewardSessionKey = resolveBuiltinStewardSessionKey(
        resolveStewardSessionDefaultsFromHello(state.hello),
      );
      const merged = bumpSessionSeenAtMany(state.settings.sessionSeenAt, sessionKeys, seenAt, {
        ownStewardSessionKey,
      });
      if (merged === state.settings.sessionSeenAt) {
        return;
      }
      state.applySettings({
        ...state.settings,
        sessionSeenAt: merged,
      });
    },
    onToggleSidebar: () => {
      state.applySettings({
        ...state.settings,
        navCollapsed: !state.settings.navCollapsed,
      });
    },
    onToggleSidebarGroup: (groupId) => {
      state.applySettings({
        ...state.settings,
        navGroupsCollapsed: {
          ...state.settings.navGroupsCollapsed,
          [groupId]: !state.settings.navGroupsCollapsed[groupId],
        },
      });
    },
    onOpenAssistantSettings: () => {
      // 待办事项 card "查看全部" → 切到大白管家助手对话（内置 steward），
      // 管家是查看和处理待办工作的统一入口。
      openStewardInbox(state);
    },
    onOpenMeetingInviteReview: () => {
      // CollabDispatch D1: workbench meeting-invite-review mirror → chat confirm card.
      openStewardInbox(state);
      void state.syncMeetingPendingConfirmation?.();
    },
    onConfirmTenantNotice: (noticeId) => {
      const client = state.client;
      if (!client || !state.connected) {
        return;
      }
      void client
        .request("workbench.tenantNotices.ack", { noticeId })
        .then(() => refreshWorkbenchSignals(state))
        .catch(() => undefined);
    },
    onOpenStewardSuggestion: (kind) => {
      const normalized = kind.trim();
      // 「N 处知识待关注 / 知识库冲突」必须进知识治理，不能落到协作群聊天。
      if (normalized === "attention" || normalized === "conflict") {
        openKnowledgeUniverseGovernancePage(state);
        requestShellRender(state);
        return;
      }
      openStewardInbox(state);
    },
    onOpenChannelSettings: () => {
      // Collaboration deep-links from todos entries land here.
      state.workbenchPrimaryModule = "collaboration";
      state.workbenchGroupProfileView = "chat";
      resetEmployeeWorkbenchGovernanceDetailState(state);
      state.resetCollaborationLearningSnapshot();
      state.resetCollaborationGovernanceActionState();
      resetWorkbenchMemberGovernanceState(state);
    },
    onOpenCron: () => {
      // 今日日程 card "查看全部" → 切到「我的任务」定时任务子段。
      state.workbenchPrimaryModule = "tasks";
      state.workbenchTasksSubTab = "cron";
      reloadEmployeeCronCenter(state);
    },
    onOpenOverview: () => {
      // Legacy overview opener retained for non-home surfaces (settings/robots).
      state.workbenchPrimaryModule = "settings";
      state.workbenchSettingsView = "system";
      state.workbenchSystemSettingsTab = "robots";
      state.workbenchGroupProfileView = "chat";
      resetEmployeeWorkbenchGovernanceDetailState(state);
      state.resetCollaborationLearningSnapshot();
      state.resetCollaborationGovernanceActionState();
      resetWorkbenchMemberGovernanceState(state);
    },
    onOpenScheduleEntry: (entryId) => {
      const id = entryId.trim();
      const CRON_PREFIX = "cron:";
      if (id.startsWith(CRON_PREFIX)) {
        const jobId = id.slice(CRON_PREFIX.length).trim();
        if (jobId) {
          openEmployeeCronTaskDetail(state, jobId);
          reloadEmployeeCronCenter(state);
          requestShellRender(state);
          return;
        }
      }
      // Real ScheduleEntry rows have no detail view yet -> open the cron center.
      state.workbenchPrimaryModule = "tasks";
      state.workbenchTasksSubTab = "cron";
      reloadEmployeeCronCenter(state);
    },
    onOpenCollaborationSpace: (groupId) => {
      const gid = groupId.trim();
      if (!gid) {
        return;
      }
      const sessionKey = resolveCollaborationSessionKeyByGroupId(state, gid);
      if (sessionKey) {
        state.workbenchTeamSelectedKey = sessionKey;
        switchEmployeeWorkbenchSession(state, sessionKey, "collaboration");
      } else {
        state.setTab("overview");
      }
    },
    onOpenCollaborationInvite: (params) => {
      const gid = params.groupId.trim();
      if (!gid) {
        return;
      }
      // Invite-only spaces may not have a prior session row; `space:<groupId>` is
      // the managed-space selection key used by the collaboration read model.
      const sessionKey = resolveCollaborationSessionKeyByGroupId(state, gid) ?? `space:${gid}`;
      state.workbenchTeamSelectedKey = sessionKey;
      switchEmployeeWorkbenchSession(state, sessionKey, "collaboration");
      resetWorkbenchMemberGovernanceState(state);
      state.workbenchPrimaryModule = "collaboration";
      state.workbenchGroupProfileView = "members";
      state.workbenchMemberGovernanceDrawerOpen = true;
      requestShellRender(state);
    },
    // Manual add goes through Daibai confirmation → schedule.entry.add (same store as schedule tool).
    onAddScheduleEntry: (input) =>
      void state.executeDaibaiAction("schedule.entry.add", {
        title: input.title,
        startAtMs: input.startAtMs,
        ...(input.endAtMs !== undefined ? { endAtMs: input.endAtMs } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
      }),
    onCancelScheduleEntry: (id) => void cancelWorkbenchScheduleEntry(state, id),
    onPrefillChatDraft: (draft) => {
      state.chatMessage = draft;
      state.workbenchGroupProfileView = "chat";
    },
    onAskDaibai: (message) => state.askDaibai(message),
    onExecuteDaibaiAction: (actionId, payload) => state.executeDaibaiAction(actionId, payload),
    onConfirmDaibaiPendingAction: () => state.confirmDaibaiPendingAction(),
    onCancelDaibaiPendingConfirmation: () => state.cancelDaibaiPendingConfirmation(),
    onConfirmMeetingPendingApproval: () => state.confirmMeetingPendingApproval(),
    onCancelMeetingPendingConfirmation: () => state.cancelMeetingPendingConfirmation(),
    onDismissMeetingConfirmRelease: () => state.dismissMeetingConfirmRelease(),
    onOpenDaibaiHelp: (params) => state.openDaibaiHelpFromModule(params),
    onOpenSupervisorTask: (taskId) => {
      const normalized = taskId.trim();
      if (!normalized) {
        return;
      }
      state.workbenchPrimaryModule = "tasks";
      state.workbenchTasksSubTab = "supervisor";
      state.workbenchSupervisorInitialTaskId = normalized;
      requestShellRender(state);
    },
    onOpenSupervisorBoard: () => {
      state.workbenchPrimaryModule = "tasks";
      state.workbenchTasksSubTab = "supervisor";
      state.workbenchSupervisorInitialTaskId = "";
      requestShellRender(state);
    },
    onOpenDaibaiForDevTask: () => {
      void state.openDaibaiHelpFromModule({
        moduleLabel: "开发监督",
        contextMessage:
          "我想创建一个开发监督任务。请根据我的开发目标整理后，帮我发起受监督的 IDE CLI 执行。",
      });
    },
    onLoadGroupMembers: async () => undefined,
    onBrandLogoFileChange: async (file) => {
      await state.handleBrandLogoFileChange(file);
    },
    onResetBrandLogo: () => {
      state.handleResetBrandLogo();
    },
  };
}
