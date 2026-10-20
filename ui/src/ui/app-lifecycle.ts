import type {
  ControlUiAuthMode,
  ControlUiPlatformAuthState,
  ControlUiTrustedProxySession,
} from "../../../src/gateway/control-ui-contract.js";
import { connectGateway } from "./app-gateway.ts";
import {
  adaptLifecycleHost,
  adaptPollingHost,
  adaptScrollHost,
  adaptSettingsHost,
} from "./app-host-adapters.ts";
import {
  startLogsPolling,
  startNodesPolling,
  stopLogsPolling,
  stopNodesPolling,
  startDebugPolling,
  stopDebugPolling,
  type PollingHost,
} from "./app-polling.ts";
import {
  observeTopbar,
  scheduleChatScroll,
  scheduleLogsScroll,
  type ScrollHost,
} from "./app-scroll.ts";
import {
  applySettingsFromUrl,
  attachThemeListener,
  detachThemeListener,
  inferBasePath,
  syncTabWithLocation,
  syncThemeWithSettings,
  type SettingsHost,
} from "./app-settings.ts";
import { syncBrandHeadAssets } from "./brand-assets.ts";
import { stopChatThinkingClock, syncChatThinkingClock } from "./chat/thinking-clock.ts";
import { loadControlUiBootstrapConfig } from "./controllers/control-ui-bootstrap.ts";
import type { Tab } from "./navigation.ts";

const lifecycleDeps = {
  connectGateway,
  startLogsPolling,
  startNodesPolling,
  stopLogsPolling,
  stopNodesPolling,
  startDebugPolling,
  stopDebugPolling,
  observeTopbar,
  scheduleChatScroll,
  scheduleLogsScroll,
  syncBrandHeadAssets,
  applySettingsFromUrl,
  attachThemeListener,
  detachThemeListener,
  inferBasePath,
  syncTabWithLocation,
  syncThemeWithSettings,
  loadControlUiBootstrapConfig,
};

export function setAppLifecycleTestHooks(hooks: Partial<typeof lifecycleDeps> | null) {
  Object.assign(
    lifecycleDeps,
    hooks ?? {
      connectGateway,
      startLogsPolling,
      startNodesPolling,
      stopLogsPolling,
      stopNodesPolling,
      startDebugPolling,
      stopDebugPolling,
      observeTopbar,
      scheduleChatScroll,
      scheduleLogsScroll,
      syncBrandHeadAssets,
      applySettingsFromUrl,
      attachThemeListener,
      detachThemeListener,
      inferBasePath,
      syncTabWithLocation,
      syncThemeWithSettings,
      loadControlUiBootstrapConfig,
    },
  );
}

export type LifecycleHost = SettingsHost &
  PollingHost &
  ScrollHost & {
    basePath: string;
    settings: { customBrandLogoDataUrl?: string };
    client?: { stop: () => void } | null;
    connectGeneration: number;
    connected?: boolean;
    workbenchPendingTasks?:
      | import("./ports/employee/views/workbench-signals.ts").WorkbenchPendingTasksSummary
      | null;
    workbenchMyTasks?:
      | import("./ports/employee/views/workbench-signals.ts").WorkbenchMyTasksSummary
      | null;
    workbenchNotices?:
      | import("./ports/employee/views/workbench-signals.ts").WorkbenchNoticesSummary
      | null;
    workbenchUpcomingCollaboration?:
      | import("./ports/employee/views/workbench-signals.ts").WorkbenchUpcomingCollaborationSummary
      | null;
    workbenchSchedule?:
      | import("./ports/employee/views/workbench-signals.ts").WorkbenchScheduleSummary
      | null;
    workbenchStewardSuggestion?:
      | import("./ports/employee/views/workbench-signals.ts").WorkbenchStewardSuggestionSummary
      | null;
    tab: Tab;
    assistantName: string;
    assistantAvatar: string | null;
    assistantAgentId: string | null;
    serverVersion: string | null;
    bootstrapAuthMode: ControlUiAuthMode | null;
    bootstrapAuthSession: ControlUiTrustedProxySession | null;
    platformAuthState: ControlUiPlatformAuthState | null;
    chatHasAutoScrolled: boolean;
    chatManualRefreshInFlight: boolean;
    chatLoading: boolean;
    chatSending: boolean;
    chatMessages: unknown[];
    chatToolMessages: unknown[];
    chatStream: string;
    chatStreamStartedAt: number | null;
    chatThinkingNowMs: number;
    logsAutoFollow: boolean;
    logsAtBottom: boolean;
    logsEntries: unknown[];
    popStateHandler: () => void;
    topbarObserver: ResizeObserver | null;
  };

export function handleConnected(host: LifecycleHost) {
  const connectGeneration = ++host.connectGeneration;
  host.basePath = lifecycleDeps.inferBasePath();
  lifecycleDeps.applySettingsFromUrl(adaptSettingsHost(host));
  lifecycleDeps.syncBrandHeadAssets(host.settings ?? {}, host.basePath);
  const bootstrapReady = lifecycleDeps.loadControlUiBootstrapConfig(host);
  lifecycleDeps.syncTabWithLocation(adaptSettingsHost(host), true);
  lifecycleDeps.syncThemeWithSettings(adaptSettingsHost(host));
  lifecycleDeps.attachThemeListener(adaptSettingsHost(host));
  if (typeof window !== "undefined") {
    window.addEventListener("popstate", host.popStateHandler);
  }
  void bootstrapReady.finally(() => {
    if (host.connectGeneration !== connectGeneration) {
      return;
    }
    lifecycleDeps.syncTabWithLocation(adaptSettingsHost(host), true);
    lifecycleDeps.connectGateway(
      adaptLifecycleHost(host) as unknown as Parameters<typeof connectGateway>[0],
    );
  });
  lifecycleDeps.startNodesPolling(adaptPollingHost(host));
  if (host.tab === "platformAdvanced") {
    lifecycleDeps.startLogsPolling(adaptPollingHost(host));
  }
  if (host.tab === "platformAdvanced") {
    lifecycleDeps.startDebugPolling(adaptPollingHost(host));
  }
}

export function handleFirstUpdated(host: LifecycleHost) {
  lifecycleDeps.observeTopbar(adaptScrollHost(host));
}

export function handleDisconnected(host: LifecycleHost) {
  stopChatThinkingClock(host);
  host.connectGeneration += 1;
  if (typeof window !== "undefined") {
    window.removeEventListener("popstate", host.popStateHandler);
  }
  lifecycleDeps.stopNodesPolling(adaptPollingHost(host));
  lifecycleDeps.stopLogsPolling(adaptPollingHost(host));
  lifecycleDeps.stopDebugPolling(adaptPollingHost(host));
  host.client?.stop();
  host.client = null;
  host.connected = false;
  // Clear home workbench signal projections so stale pending-task / notice counts
  // from the previous connection (or previous account) don't linger across a
  // disconnect, account switch, or space exit until the next successful refresh.
  host.workbenchPendingTasks = null;
  host.workbenchMyTasks = null;
  host.workbenchNotices = null;
  host.workbenchUpcomingCollaboration = null;
  host.workbenchSchedule = null;
  host.workbenchStewardSuggestion = null;
  lifecycleDeps.detachThemeListener(adaptSettingsHost(host));
  host.topbarObserver?.disconnect();
  host.topbarObserver = null;
}

export function handleUpdated(host: LifecycleHost, changed: Map<PropertyKey, unknown>) {
  if (host.tab === "me" && host.chatManualRefreshInFlight) {
    return;
  }
  if (
    host.tab === "me" &&
    (changed.has("chatMessages") ||
      changed.has("chatToolMessages") ||
      changed.has("chatStream") ||
      changed.has("chatLoading") ||
      changed.has("tab"))
  ) {
    const forcedByTab = changed.has("tab");
    const forcedByLoad =
      changed.has("chatLoading") && changed.get("chatLoading") === true && !host.chatLoading;
    lifecycleDeps.scheduleChatScroll(
      adaptScrollHost(host),
      forcedByTab || forcedByLoad || !host.chatHasAutoScrolled,
    );
  }
  if (
    host.tab === "platformAdvanced" &&
    (changed.has("logsEntries") || changed.has("logsAutoFollow") || changed.has("tab"))
  ) {
    if (host.logsAutoFollow && host.logsAtBottom) {
      lifecycleDeps.scheduleLogsScroll(
        adaptScrollHost(host),
        changed.has("tab") || changed.has("logsAutoFollow"),
      );
    }
  }
  syncChatThinkingClock(host);
}
