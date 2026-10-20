import {
  applySessionDefaults,
  type SessionDefaultsSnapshot,
} from "./app-gateway-session-defaults.ts";
import { adaptSettingsHost, adaptToolStreamHost } from "./app-host-adapters.ts";
import { applySettings, refreshActiveTab } from "./app-settings.ts";
import { resetToolStream } from "./app-tool-stream.ts";
import { agentsCapability } from "./capability/agents/index.ts";
import { assistantIdentityCapability } from "./capability/assistant-identity/index.ts";
import { configCapability } from "./capability/config/index.ts";
import { devicesCapability } from "./capability/devices/index.ts";
import {
  createGatewayConnectionClient,
  resolveControlUiClientVersion,
  resolveGatewayCloseDetailCode,
  resolveGatewayCloseMessage,
  resolveRecoveredGatewayUrlForOriginError,
} from "./capability/gateway/runtime.ts";
import { nodesCapability } from "./capability/nodes/index.ts";
import { sessionsCapability } from "./capability/sessions/index.ts";
import { spacesCapability } from "./capability/spaces/index.ts";
import {
  adaptAgentsLoadCapabilityState,
  adaptAgentsToolsCapabilityState,
  adaptAssistantIdentityLoadCapabilityState,
  adaptConfigLoadCapabilityState,
  adaptConfigSchemaCapabilityState,
  adaptDevicesLoadCapabilityState,
  adaptNodesLoadCapabilityState,
  adaptSessionsLoadCapabilityState,
  adaptSpacesLoadCapabilityState,
} from "./capability/view-state.ts";
import { refreshWorkbenchSignals } from "./controllers/spaces.ts";
import {
  loadUserOperationalIdentities,
  type UserOperationalIdentityHost,
} from "./controllers/user-operational-identity.ts";
import {
  advanceTransientGatewayClose,
  isTransientGatewayClose,
} from "./gateway-connection-phase.ts";
import type { GatewayHost } from "./gateway-host.ts";
import { dispatchGatewaySubscriptionEvent } from "./gateway-subscriptions/index.ts";
import {
  GatewayBrowserClient,
  isNonRecoverableAuthError,
  type GatewayEventFrame,
  type GatewayHelloOk,
} from "./gateway.ts";
export type { GatewayHost } from "./gateway-host.ts";
import { persistGatewayUrlIfChanged, recoverGatewayUrlForReconnect } from "./app-gateway-url.ts";
import { shouldUseLeanGatewayConnectFanout } from "./gateway-connect-fanout.ts";
import { isEnterpriseTab } from "./navigation.ts";
import { loadCollaborationOrgBotDirectory } from "./ports/employee/collaboration-org-bot-directory.ts";
import type { PresenceEntry, HealthSnapshot, UpdateAvailable } from "./types.ts";
import { refreshCostBudgetV2AfterGatewayConnect } from "./views/cost-budget-v2/actions/refresh-after-gateway-connect.ts";
import { refreshPublicPricingAfterGatewayConnect } from "./views/pricing-v3/public-pricing-surface.ts";

export { shouldUseLeanGatewayConnectFanout } from "./gateway-connect-fanout.ts";
export { setAppGatewayPageUrlForTests, setAppGatewayTestHooks } from "./app-gateway-url.ts";

export { resolveControlUiClientVersion };

/**
 * Periodically refresh the home workbench signal cards (待处理任务 / 重要通知) so the
 * counts converge when task / governance / invite state changes elsewhere — not only
 * when collaboration spaces are (re)loaded. The loop is keyed on the active `client`:
 * when the connection is torn down or replaced (disconnect / reconnect installs a new
 * client, or `host.connected` flips false), the stale loop self-cancels on its next tick.
 */
const WORKBENCH_SIGNALS_REFRESH_INTERVAL_MS = 45_000;

/**
 * Employee 「我的任务 → 定时任务」 does not reload from refreshActiveTab.
 * Re-fetch after hello so a reconnect gap does not leave the red socket banner
 * or an empty list stuck on screen.
 */
function reloadEmployeeCronCenterAfterHello(host: GatewayHost) {
  const workbench = host as GatewayHost & {
    workbenchPrimaryModule?: string;
    workbenchTasksSubTab?: string;
    requestUpdate?: () => void;
  };
  if (workbench.workbenchPrimaryModule !== "tasks") {
    return;
  }
  if (workbench.workbenchTasksSubTab && workbench.workbenchTasksSubTab !== "cron") {
    return;
  }
  void import("./capability/cron/index.ts").then(async ({ cronCapability }) => {
    if (!host.connected || !host.client) {
      return;
    }
    cronCapability.setPersonalScopeOnly(host as never, true);
    await cronCapability.loadStatus(host as never);
    await cronCapability.loadJobs(host as never);
    workbench.requestUpdate?.();
  });
}

function startWorkbenchSignalsRefresh(host: GatewayHost, client: GatewayBrowserClient) {
  if (typeof window === "undefined") {
    return;
  }
  const scheduleNext = () => {
    if (host.client !== client || !host.connected) {
      return;
    }
    window.setTimeout(tick, WORKBENCH_SIGNALS_REFRESH_INTERVAL_MS);
  };
  const tick = () => {
    if (host.client !== client || !host.connected) {
      return;
    }
    void refreshWorkbenchSignals(adaptSpacesLoadCapabilityState(host)).finally(scheduleNext);
  };
  window.setTimeout(tick, WORKBENCH_SIGNALS_REFRESH_INTERVAL_MS);
}

function clearChatLoadingOnUnreachable(host: GatewayHost) {
  const candidate = host as GatewayHost & { chatLoading?: boolean };
  if (candidate.chatLoading) {
    candidate.chatLoading = false;
  }
}

export function connectGateway(host: GatewayHost) {
  host.lastError = null;
  host.lastErrorCode = null;
  host.hello = null;
  host.connected = false;
  host.gatewayConnectionPhase = "connecting";
  host.gatewayReconnectAttempt = 0;
  host.execApprovalQueue = [];
  host.execApprovalError = null;
  host.secureFormOffered = null;
  host.secureFormValues = {};
  host.secureFormBusy = false;
  host.secureFormError = null;
  host.secureFormReceipt = null;
  host.loginMethodChoice = null;
  host.loginSaveOffer = null;
  host.loginCardBusy = false;
  host.loginCardError = null;

  const previousClient = host.client;
  const gatewayUrl = persistGatewayUrlIfChanged(host, host.settings.gatewayUrl);
  const client = createGatewayConnectionClient({
    gatewayUrl,
    token: host.settings.token,
    password: host.password,
    clientInstanceId: host.clientInstanceId,
    serverVersion: host.serverVersion,
    bootstrapAuthMode: host.bootstrapAuthMode,
    bootstrapAuthSession: host.bootstrapAuthSession,
    onHello: (hello) => {
      if (host.client !== client) {
        return;
      }
      host.connected = true;
      host.lastError = null;
      host.lastErrorCode = null;
      host.gatewayConnectionPhase = "connected";
      host.gatewayReconnectAttempt = 0;
      host.hello = hello;
      applySnapshot(host, hello);
      // A transport drop does not cancel the server run. Keep the stop control
      // and any buffered stream until chat.history reports activeRun (or idle).
      // Only drop tool cards when this client has no run to resume.
      if (!host.chatRunId) {
        resetToolStream(adaptToolStreamHost(host));
      }
      void assistantIdentityCapability.load(adaptAssistantIdentityLoadCapabilityState(host));
      const activeTab = host.tab === "enterpriseBudget" ? "enterpriseUsage" : host.tab;
      const leanEnterpriseConnect = shouldUseLeanGatewayConnectFanout(activeTab);
      if (!leanEnterpriseConnect) {
        // Employee / platform reconnect: hydrate cross-tab workbench state.
        // Enterprise tabs skip this fan-out — `refreshActiveTab` → tab shell loads
        // only the RPCs that surface needs (avoids 4–7s spaces/sessions/tools pile-up).
        void agentsCapability.load(adaptAgentsLoadCapabilityState(host));
        void agentsCapability.loadToolsCatalog(adaptAgentsToolsCapabilityState(host));
        void nodesCapability.load(adaptNodesLoadCapabilityState(host), { quiet: true });
        void devicesCapability.load(adaptDevicesLoadCapabilityState(host), { quiet: true });
        void spacesCapability.load(adaptSpacesLoadCapabilityState(host));
        startWorkbenchSignalsRefresh(host, client);
        void loadCollaborationOrgBotDirectory(
          host as Parameters<typeof loadCollaborationOrgBotDirectory>[0],
        );
        void sessionsCapability.load(adaptSessionsLoadCapabilityState(host));
        void configCapability.loadSchema(adaptConfigSchemaCapabilityState(host));
        void configCapability.load(adaptConfigLoadCapabilityState(host));
        refreshPublicPricingAfterGatewayConnect(client);
      }
      if (hello.auth?.user?.trim()) {
        void loadUserOperationalIdentities(host as unknown as UserOperationalIdentityHost);
      }
      if (isEnterpriseTab(activeTab)) {
        void import("./controllers/enterprise-port-session-align.ts").then(
          ({ ensureEnterprisePortSessionAligned }) =>
            ensureEnterprisePortSessionAligned(
              host as unknown as Parameters<typeof ensureEnterprisePortSessionAligned>[0],
            ).finally(() => {
              void refreshActiveTab(adaptSettingsHost(host));
            }),
        );
        if (activeTab === "enterpriseUsage" && host.client) {
          refreshCostBudgetV2AfterGatewayConnect(host.client);
        }
        return;
      }
      void refreshActiveTab(adaptSettingsHost(host));
      reloadEmployeeCronCenterAfterHello(host);
      if (activeTab === "enterpriseUsage" && host.client) {
        refreshCostBudgetV2AfterGatewayConnect(host.client);
      }
    },
    onClose: ({ code, reason, error }) => {
      if (host.client !== client) {
        return;
      }
      host.connected = false;
      // Transient closes: client auto-reconnects. Do not sticky-banner these —
      // production flaps often surface as 1006 (TCP reset / SIGKILL / proxy) with
      // an empty reason; hello success clears state. Keep auth / policy errors visible.
      // 1012 = service restart; 1006/1001/1005 = abnormal/go-away without actionable reason.
      const transientClose = isTransientGatewayClose(code);
      const stickyAuth = isNonRecoverableAuthError(error);
      host.lastErrorCode =
        resolveGatewayCloseDetailCode(error) ??
        (typeof error?.code === "string" ? error.code : null);
      if (transientClose && !error?.message && !stickyAuth) {
        host.lastError = null;
        host.lastErrorCode = null;
        const next = advanceTransientGatewayClose(host.gatewayReconnectAttempt);
        host.gatewayReconnectAttempt = next.reconnectAttempt;
        host.gatewayConnectionPhase = next.phase;
        if (next.phase === "unreachable") {
          // Stop the empty-thread skeleton. The client may still retry; hello clears this.
          clearChatLoadingOnUnreachable(host);
        }
        return;
      }
      host.gatewayConnectionPhase = "blocked";
      if (error?.message) {
        const recoveredGatewayUrl = resolveRecoveredGatewayUrlForOriginError({
          currentGatewayUrl: host.settings.gatewayUrl,
          errorMessage: error.message,
        });
        if (recoveredGatewayUrl) {
          applySettings(adaptSettingsHost(host), {
            ...host.settings,
            gatewayUrl: recoveredGatewayUrl,
          });
          connectGateway(host);
          return;
        }
        host.lastError = resolveGatewayCloseMessage({
          errorCode: host.lastErrorCode,
          errorMessage: error.message,
        });
        return;
      }
      host.lastError = `disconnected (${code}): ${reason || "no reason"}`;
    },
    onEvent: (evt) => {
      if (host.client !== client) {
        return;
      }
      handleGatewayEvent(host, evt);
    },
    onGap: ({ expected, received }) => {
      if (host.client !== client) {
        return;
      }
      host.lastError = `event gap detected (expected seq ${expected}, got ${received}); refresh recommended`;
      host.lastErrorCode = null;
    },
    onReconnectUrl: (currentGatewayUrl) => recoverGatewayUrlForReconnect(host, currentGatewayUrl),
  });
  host.client = client;
  previousClient?.stop();
  client.start();
}

export function handleGatewayEvent(host: GatewayHost, evt: GatewayEventFrame) {
  try {
    dispatchGatewaySubscriptionEvent(host, evt);
  } catch (err) {
    console.error("[gateway] handleGatewayEvent error:", evt.event, err);
  }
}

export function applySnapshot(host: GatewayHost, hello: GatewayHelloOk) {
  const snapshot = hello.snapshot as
    | {
        presence?: PresenceEntry[];
        health?: HealthSnapshot;
        sessionDefaults?: SessionDefaultsSnapshot;
        updateAvailable?: UpdateAvailable;
      }
    | undefined;
  if (snapshot?.presence && Array.isArray(snapshot.presence)) {
    host.presenceEntries = snapshot.presence;
  }
  if (snapshot?.health) {
    host.debugHealth = snapshot.health;
  }
  if (snapshot?.sessionDefaults) {
    applySessionDefaults(host, snapshot.sessionDefaults);
  }
  host.updateAvailable = snapshot?.updateAvailable ?? null;
}
