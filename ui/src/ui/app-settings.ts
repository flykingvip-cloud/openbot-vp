import { refreshChat } from "./app-chat.ts";
import { adaptChatRefreshHost, adaptPollingHost } from "./app-host-adapters.ts";
import { adaptEnterpriseOperationalIdentityHost } from "./app-host-adapters.ts";
import {
  startLogsPolling,
  stopLogsPolling,
  startDebugPolling,
  stopDebugPolling,
} from "./app-polling.ts";
import { syncBrandHeadAssets } from "./brand-assets.ts";
import { agentIdentityCapability } from "./capability/agent-identity/index.ts";
import { agentRuntimeCapability } from "./capability/agent-runtime/index.ts";
import { agentSkillsCapability } from "./capability/agent-skills/index.ts";
import { agentsCapability } from "./capability/agents/index.ts";
import { channelsCapability } from "./capability/channels/index.ts";
import { configCapability } from "./capability/config/index.ts";
import { cronCapability } from "./capability/cron/index.ts";
import { debugCapability } from "./capability/debug/index.ts";
import { devicesCapability } from "./capability/devices/index.ts";
import { logsCapability } from "./capability/logs/index.ts";
import { nodesCapability } from "./capability/nodes/index.ts";
import { presenceCapability } from "./capability/presence/index.ts";
import { sessionsCapability } from "./capability/sessions/index.ts";
import { skillsCapability } from "./capability/skills/index.ts";
import { spacesCapability } from "./capability/spaces/index.ts";
import {
  adaptAgentsLoadCapabilityState,
  adaptAgentsToolsCapabilityState,
  adaptAgentIdentityLoadCapabilityState,
  adaptAgentRuntimeOverviewCapabilityState,
  adaptAgentSkillsLoadCapabilityState,
  adaptChannelsLoadCapabilityState,
  adaptConfigLoadCapabilityState,
  adaptConfigSchemaCapabilityState,
  adaptCronJobsCapabilityState,
  adaptCronModelSuggestionsCapabilityState,
  adaptCronRunsCapabilityState,
  adaptCronStatusCapabilityState,
  adaptDebugLoadCapabilityState,
  adaptDevicesLoadCapabilityState,
  adaptLogsLoadCapabilityState,
  adaptNodesLoadCapabilityState,
  adaptPresenceLoadCapabilityState,
  adaptSessionsLoadCapabilityState,
  adaptSkillsLoadCapabilityState,
  adaptSpacesLoadCapabilityState,
} from "./capability/view-state.ts";
import { loadEnterpriseOperationalIdentities } from "./controllers/enterprise-operational-identity.ts";
import { loadEnterpriseOrganizationMonthlyUsage } from "./controllers/enterprise-organization-monthly-usage.ts";
import { refreshEnterpriseOrganizationSnapshot } from "./controllers/enterprise-organization-snapshot.ts";
import { ensureEnterprisePortSessionAligned } from "./controllers/enterprise-port-session-align.ts";
import { loadMeshOwnership } from "./controllers/mesh-ownership.ts";
import { loadMeshShellData } from "./controllers/mesh-shell.ts";
import { loadPlatformModelsManagementSnapshot } from "./controllers/platform-models-management.ts";
import { loadUsage, type UsageState } from "./controllers/usage.ts";
import {
  applyEmployeeEmbedRootClass,
  resolveEmployeeEmbedRouting,
} from "./employee-shell/workbench-embed.ts";
import {
  canonicalizeTab,
  defaultTabForSubdomain,
  inferBasePathFromPathname,
  isEnterpriseTab,
  isPlatformTab,
  matchTabRoute,
  normalizeBasePath,
  normalizePath,
  hasCostBudgetUsageSubRoute,
  pathForTab,
  type Tab,
} from "./navigation.ts";
import type { EnterprisePortState } from "./ports/enterprise/port-state.ts";
import { resolveEnterpriseTenantId as resolveEnterpriseTenantIdFromState } from "./ports/enterprise/semantic/enterprise-read-model.ts";
import { PLATFORM_ADVANCED_HASH_PREFIX } from "./ports/platform/advanced/constants.ts";
import type { CapabilityGovernanceSnapshotHost } from "./ports/platform/capability-governance-gateway.ts";
import {
  isEnterpriseAdminAuthenticated,
  isPlatformAdminAuthenticated,
} from "./ports/platform/platform-auth-session.ts";

function syncPlatformAdvancedPanelVisibilityLazy(): void {
  void import("./ports/platform/advanced/page.ts")
    .then((mod) => {
      mod.syncPlatformAdvancedPanelVisibility();
    })
    .catch((err) => {
      console.error("[app-settings] failed to load platform advanced panel", err);
    });
}

async function refreshCapabilityGovernanceSnapshotLazy(
  host: CapabilityGovernanceSnapshotHost,
): Promise<void> {
  const { refreshCapabilityGovernanceSnapshot } =
    await import("./ports/platform/capability-governance-gateway.ts");
  await refreshCapabilityGovernanceSnapshot(host);
}
import { resolveWorkbenchSessionKeyFromUrlSearch } from "./chat-session-key-match.ts";
import {
  consoleHostEmployeeHomeUrl,
  shouldUsePublicHomepageForCurrentLocation,
} from "./public-home.ts";
import { requestOpenBotAppRerender } from "./request-app-rerender.ts";
import { canonicalizeEmployeeCloudGatewayUrl } from "./routing/canonical-employee-gateway.ts";
import { decideControlledLogin } from "./routing/confirmed-session-land.ts";
import type { CrossPortContext } from "./routing/cross-port-context.ts";
import {
  resolveAuthorizedTabSubdomainRedirectUrl,
  resolveOpenBotSubdomainRedirectUrl,
} from "./routing/openbot-subdomain-redirect.ts";
import { canonicalPasswordResetLocation } from "./routing/password-reset-link.ts";
import { resolveAuthorizedTab, type PermissionStateLike } from "./routing/port-permissions.ts";
import { bumpSessionSeenAt } from "./session-seen-at.ts";
import { saveSettings, type UiSettings } from "./storage.ts";
import { startThemeTransition, type ThemeTransitionContext } from "./theme-transition.ts";
import { resolveTheme, type ResolvedTheme, type ThemeMode } from "./theme.ts";
import type { AgentsListResult, CronRunScope } from "./types.ts";
import type { MeshOwnershipListResult } from "./types.ts";

export type SettingsHost = PermissionStateLike & {
  settings: UiSettings;
  password?: string;
  theme: ThemeMode;
  themeResolved: ResolvedTheme;
  applySessionKey: string;
  sessionKey: string;
  tab: Tab;
  connected: boolean;
  chatHasAutoScrolled: boolean;
  logsAtBottom: boolean;
  eventLog: unknown[];
  eventLogBuffer: unknown[];
  basePath: string;
  agentsList?: AgentsListResult | null;
  meshOwnershipList?: MeshOwnershipListResult | null;
  meshOwnershipLoading?: boolean;
  meshOwnershipError?: string | null;
  agentsSelectedId?: string | null;
  agentsPanel?: "overview" | "files" | "tools" | "skills" | "channels" | "cron";
  cronRunsScope: CronRunScope;
  cronRunsJobId: string | null;
  themeMedia: MediaQueryList | null;
  themeMediaHandler: ((event: MediaQueryListEvent) => void) | null;
  pendingGatewayUrl?: string | null;
  pendingGatewayToken?: string | null;
  platformAuthSeatOfferId?: string | null;
  platformAuthNotice?: string | null;
  workbenchPrimaryModule?: string;
  workbenchSettingsView?: string;
  workbenchPersonalSettingsTab?: string;
  /** Keep nav highlight aligned with ?session= hydration / popstate. */
  workbenchTeamSelectedKey?: string;
  skillsFilter?: string;
  syncEnterpriseHandoverRoute: (context: CrossPortContext | null) => Promise<void>;
} & Partial<CapabilityGovernanceSnapshotHost>;

function toMeshShellHost(host: SettingsHost): Parameters<typeof loadMeshShellData>[0] {
  return {
    ...(host as unknown as Parameters<typeof loadMeshShellData>[0]),
    client: host.client ?? null,
    meshOwnershipLoading: host.meshOwnershipLoading ?? false,
  };
}

function syncSkillsFilterFromUrl(host: SettingsHost, tab: Tab) {
  if (typeof window === "undefined" || tab !== "platformCapabilities") {
    return;
  }
  const url = new URL(window.location.href);
  host.skillsFilter = url.searchParams.get("skill")?.trim() ?? "";
}

function rememberEnterpriseTenant(host: SettingsHost, tenantId: string | undefined) {
  const normalized = tenantId?.trim();
  if (!normalized) {
    return;
  }
  const previous = host.settings.recentEnterpriseTenantIds ?? [];
  const next = [normalized, ...previous.filter((entry) => entry !== normalized)].slice(0, 8);
  if (next.length === previous.length && next.every((value, index) => value === previous[index])) {
    return;
  }
  applySettings(host, {
    ...host.settings,
    recentEnterpriseTenantIds: next,
  });
}

function resolveEnterpriseTenantId(host: SettingsHost): string | null {
  const fromState = resolveEnterpriseTenantIdFromState(host as unknown as EnterprisePortState);
  if (fromState) {
    return fromState;
  }
  if (typeof window !== "undefined") {
    const fromRoute = matchTabRoute(
      window.location.pathname,
      host.basePath,
    )?.context?.tenantId?.trim();
    if (fromRoute) {
      return fromRoute;
    }
  }
  return null;
}

async function loadEnterpriseOperationalIdentityOverview(host: SettingsHost) {
  if (!isEnterpriseTab(host.tab)) {
    return;
  }
  const aligned = await ensureEnterprisePortSessionAligned(
    host as unknown as Parameters<typeof ensureEnterprisePortSessionAligned>[0],
  );
  if (!aligned && host.platformAuthState?.sessionKind !== "enterprise-admin") {
    return;
  }
  const tenantId = resolveEnterpriseTenantId(host);
  if (!tenantId) {
    return;
  }
  await loadEnterpriseOperationalIdentities(adaptEnterpriseOperationalIdentityHost(host), tenantId);
}

type SessionSeenHost = {
  settings: UiSettings;
  applySettings: (next: UiSettings) => void;
};

function controlledLoginPathFromLocation(
  host: SettingsHost,
): "/enterprise/login" | "/platform/login" | null {
  if (typeof window === "undefined") {
    return null;
  }
  const canonical = matchTabRoute(window.location.pathname, host.basePath)?.canonicalPath;
  if (canonical === "/enterprise/login" || canonical === "/platform/login") {
    return canonical;
  }
  return null;
}

/**
 * Confirmed enterprise/platform sessions leave the dedicated login route.
 * Returns the land tab when auto-redirect is safe; otherwise leaves the
 * caller on the login tab (the paint path shows the continue CTA).
 */
function tabAfterControlledLogin(host: SettingsHost, fallback: Tab): Tab {
  const path = controlledLoginPathFromLocation(host);
  if (!path) {
    return fallback;
  }
  const decision = decideControlledLogin({
    path,
    auth: host.platformAuthState,
    enterpriseAuthenticated: isEnterpriseAdminAuthenticated(host),
    platformAuthenticated: isPlatformAdminAuthenticated(host),
    notice: host.platformAuthNotice,
    landReachable: (tab) => resolveAuthorizedTab(host, tab) === tab,
  });
  if (decision.action === "stay" && decision.clearStaleSuccessNotice) {
    host.platformAuthNotice = null;
  }
  if (decision.action === "redirect") {
    return decision.tab;
  }
  return fallback;
}

function resolveRootPathRoleTab(host: SettingsHost): Tab | null {
  if (shouldUsePublicHomepageForCurrentLocation(host.basePath ?? "")) {
    return null;
  }
  // 子域锁定：当子域明确指定 port 时，直接返回该 port 的默认 tab
  if (typeof window !== "undefined") {
    const subdomainTab = defaultTabForSubdomain(window.location.host);
    if (subdomainTab) {
      return subdomainTab;
    }
    // An active employee workbench session (?session=…) means the user is working
    // inside the employee side (e.g. an agent chat). Refreshing must keep them there
    // rather than bouncing admins to their platform/enterprise console. The bare root
    // with no session still applies the role-based landing below.
    if (new URLSearchParams(window.location.search).get("session")?.trim()) {
      return null;
    }
  }
  if (host.tab !== "me") {
    return null;
  }
  if (isPlatformAdminAuthenticated(host)) {
    return "platformDashboard";
  }
  if (host.platformAuthState?.sessionKind === "enterprise-admin") {
    return "enterpriseOverview";
  }
  return null;
}

export function markSessionSeen(host: SessionSeenHost, sessionKey: string, seenAt = Date.now()) {
  const key = sessionKey.trim();
  if (!key) {
    return;
  }
  const merged = bumpSessionSeenAt(host.settings.sessionSeenAt, key, seenAt);
  if (merged === host.settings.sessionSeenAt) {
    return;
  }
  host.applySettings({
    ...host.settings,
    sessionSeenAt: merged,
  });
}

export function applySettings(host: SettingsHost, next: UiSettings) {
  const normalized = {
    ...next,
    lastActiveSessionKey: next.lastActiveSessionKey?.trim() || next.sessionKey.trim() || "main",
  };
  host.settings = normalized;
  saveSettings(normalized);
  syncBrandHeadAssets(normalized, host.basePath ?? "");
  if (next.theme !== host.theme) {
    host.theme = next.theme;
    applyResolvedTheme(host, resolveTheme(next.theme));
  }
  host.applySessionKey = host.settings.lastActiveSessionKey;
}

function applyWorkbenchSessionKeyFromLocation(host: SettingsHost, search: string, hash = "") {
  const session = resolveWorkbenchSessionKeyFromUrlSearch(search, hash);
  if (!session) {
    return;
  }
  host.sessionKey = session;
  host.workbenchTeamSelectedKey = session;
  const seenAt = Date.now();
  applySettings(host, {
    ...host.settings,
    sessionKey: session,
    lastActiveSessionKey: session,
    sessionSeenAt: bumpSessionSeenAt(host.settings.sessionSeenAt, session, seenAt),
  });
}

export function setLastActiveSessionKey(host: SettingsHost, next: string) {
  const trimmed = next.trim();
  if (!trimmed) {
    return;
  }
  if (host.settings.lastActiveSessionKey === trimmed) {
    return;
  }
  applySettings(host, { ...host.settings, lastActiveSessionKey: trimmed });
}

export function applySettingsFromUrl(host: SettingsHost) {
  if (!window.location.search && !window.location.hash) {
    return;
  }
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.search);
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);

  const gatewayUrlRaw = params.get("gatewayUrl") ?? hashParams.get("gatewayUrl");
  const nextGatewayUrl = canonicalizeEmployeeCloudGatewayUrl(gatewayUrlRaw?.trim() ?? "");
  const gatewayUrlChanged = Boolean(nextGatewayUrl && nextGatewayUrl !== host.settings.gatewayUrl);
  const tokenRaw = hashParams.get("token");
  const passwordRaw = params.get("password") ?? hashParams.get("password");
  const workbenchRaw = params.get("workbench") ?? hashParams.get("workbench");
  const settingsViewRaw = params.get("settingsView") ?? hashParams.get("settingsView");
  const seatOfferRaw = params.get("seatOffer") ?? hashParams.get("seatOffer");
  let shouldCleanUrl = false;

  if (params.has("token")) {
    params.delete("token");
    shouldCleanUrl = true;
  }

  if (tokenRaw != null) {
    const token = tokenRaw.trim();
    if (token && gatewayUrlChanged) {
      host.pendingGatewayToken = token;
    } else if (token && token !== host.settings.token) {
      applySettings(host, { ...host.settings, token });
    }
    hashParams.delete("token");
    shouldCleanUrl = true;
  }

  if (passwordRaw != null) {
    // Never hydrate password from URL params; strip only.
    params.delete("password");
    hashParams.delete("password");
    shouldCleanUrl = true;
  }

  applyWorkbenchSessionKeyFromLocation(host, url.search, url.hash);

  if (gatewayUrlRaw != null) {
    if (gatewayUrlChanged) {
      host.pendingGatewayUrl = nextGatewayUrl;
      if (!tokenRaw?.trim()) {
        host.pendingGatewayToken = null;
      }
    } else {
      host.pendingGatewayUrl = null;
      host.pendingGatewayToken = null;
    }
    params.delete("gatewayUrl");
    hashParams.delete("gatewayUrl");
    shouldCleanUrl = true;
  }

  if (workbenchRaw != null) {
    const workbench = workbenchRaw.trim().toLowerCase();
    if (workbench === "settings") {
      host.workbenchPrimaryModule = "settings";
    }
    params.delete("workbench");
    hashParams.delete("workbench");
    shouldCleanUrl = true;
  }

  if (settingsViewRaw != null) {
    const settingsView = settingsViewRaw.trim().toLowerCase();
    if (settingsView === "personal" || settingsView === "system") {
      host.workbenchPrimaryModule = "settings";
      host.workbenchSettingsView = settingsView;
    }
    params.delete("settingsView");
    hashParams.delete("settingsView");
    shouldCleanUrl = true;
  }

  if (seatOfferRaw != null) {
    const seatOffer = seatOfferRaw.trim();
    host.platformAuthSeatOfferId = seatOffer || null;
    if (seatOffer) {
      host.workbenchPrimaryModule = "settings";
      host.workbenchSettingsView = "personal";
    }
  }

  const hashAnchor = url.hash.startsWith("#") ? url.hash.slice(1).split("?")[0]?.trim() : "";
  if (hashAnchor === "operational-identity") {
    host.workbenchPrimaryModule = "settings";
    host.workbenchSettingsView = "personal";
    host.workbenchPersonalSettingsTab = "authorization";
  }

  if (!shouldCleanUrl) {
    return;
  }
  url.search = params.toString();
  const nextHash = hashParams.toString();
  url.hash = nextHash ? `#${nextHash}` : "";
  window.history.replaceState({}, "", url.toString());
}

export function setTab(host: SettingsHost, next: Tab) {
  const canonicalTab = canonicalizeTab(next);
  const authorizedTab = resolveAuthorizedTab(host, canonicalTab);
  if (typeof window !== "undefined") {
    const targetPath = pathForTab(authorizedTab, host.basePath, {
      tenantId: isEnterpriseTab(authorizedTab) ? resolveEnterpriseTenantId(host) : undefined,
    });
    const subdomainRedirect = resolveOpenBotSubdomainRedirectUrl({
      host: window.location.host,
      tab: authorizedTab,
      pathname: targetPath,
      search: window.location.search,
      hash: window.location.hash,
      protocol: window.location.protocol,
    });
    if (subdomainRedirect) {
      window.location.assign(subdomainRedirect);
      return;
    }
  }
  applyTabSelection(host, authorizedTab, {
    refreshPolicy: "always",
    syncUrl: true,
  });
}

export function setTheme(host: SettingsHost, next: ThemeMode, context?: ThemeTransitionContext) {
  const applyTheme = () => {
    host.theme = next;
    applySettings(host, { ...host.settings, theme: next });
    applyResolvedTheme(host, resolveTheme(next));
  };
  startThemeTransition({
    nextTheme: next,
    applyTheme,
    context,
    currentTheme: host.theme,
  });
}

export async function refreshActiveTab(host: SettingsHost) {
  const activeTab = canonicalizeTab(host.tab);
  if (activeTab !== host.tab) {
    host.tab = activeTab;
  }
  if (isEnterpriseTab(activeTab)) {
    await ensureEnterprisePortSessionAligned(
      host as unknown as Parameters<typeof ensureEnterprisePortSessionAligned>[0],
    );
  }
  if (host.tab === "me") {
    await Promise.all([
      refreshChat(adaptChatRefreshHost(host)),
      agentsCapability.load(adaptAgentsLoadCapabilityState(host)),
      sessionsCapability.load(adaptSessionsLoadCapabilityState(host)),
      spacesCapability.load(adaptSpacesLoadCapabilityState(host)),
      channelsCapability.load(adaptChannelsLoadCapabilityState(host), false),
      presenceCapability.load(adaptPresenceLoadCapabilityState(host)),
      cronCapability.loadStatus(adaptCronStatusCapabilityState(host)),
    ]);
  }
  if (host.tab === "personas") {
    await Promise.all([
      agentsCapability.load(adaptAgentsLoadCapabilityState(host)),
      sessionsCapability.load(adaptSessionsLoadCapabilityState(host)),
    ]);
  }
  if (host.tab === "contacts" || host.tab === "groups") {
    await Promise.all([
      sessionsCapability.load(adaptSessionsLoadCapabilityState(host)),
      channelsCapability.load(adaptChannelsLoadCapabilityState(host), false),
      presenceCapability.load(adaptPresenceLoadCapabilityState(host)),
    ]);
  }
  // Platform overview-style tabs still use shared loadOverview (TTL cached).
  if (
    activeTab === "platformDashboard" ||
    activeTab === "platformTenants" ||
    activeTab === "platformCapabilities" ||
    activeTab === "platformModels" ||
    activeTab === "platformAgents" ||
    activeTab === "platformAdvanced"
  ) {
    await loadOverview(host, { force: false });
  }
  // Enterprise modules: load only what the active surface needs (no 12-RPC fan-out).
  // Fire-and-forget so the tab chrome paints immediately; surfaces re-render on data.
  if (isEnterpriseShellTab(activeTab)) {
    void loadEnterpriseTabShell(host, activeTab, { force: false });
  }
  // Enterprise: scoped refresh per surface. A full loadOverview (~12 RPCs) on
  // every sidebar click made nav feel stuck while active styling lagged.
  if (activeTab === "enterpriseOverview") {
    await loadOverview(host);
  } else if (activeTab === "enterpriseOrganization") {
    await Promise.all([
      configCapability.load(adaptConfigLoadCapabilityState(host)),
      refreshEnterpriseOrganizationSnapshot(
        host as unknown as Parameters<typeof refreshEnterpriseOrganizationSnapshot>[0],
      ),
      loadEnterpriseOrganizationMonthlyUsage(
        host as unknown as Parameters<typeof loadEnterpriseOrganizationMonthlyUsage>[0],
      ),
    ]);
  } else if (activeTab === "enterpriseUsage") {
    await loadUsage(host as unknown as UsageState);
  } else if (activeTab === "enterpriseMesh") {
    await loadMeshShellData(toMeshShellHost(host));
  } else if (activeTab === "enterpriseSettings") {
    await loadEnterpriseOperationalIdentityOverview(host);
  } else if (activeTab === "enterpriseAgents") {
    await agentsCapability.load(adaptAgentsLoadCapabilityState(host));
  }
  if (activeTab === "platformModels") {
    await loadModelsManagement(host);
  }
  if (activeTab === "platformAdvanced") {
    await Promise.all([
      loadChannelsTab(host),
      presenceCapability.load(adaptPresenceLoadCapabilityState(host)),
      sessionsCapability.load(adaptSessionsLoadCapabilityState(host)),
      nodesCapability.load(adaptNodesLoadCapabilityState(host)),
      devicesCapability.load(adaptDevicesLoadCapabilityState(host)),
      logsCapability.load(adaptLogsLoadCapabilityState(host), { reset: true, quiet: true }),
    ]);
  }
  if (activeTab === "skills") {
    await skillsCapability.load(adaptSkillsLoadCapabilityState(host));
  }
  if (activeTab === "agents") {
    await agentsCapability.load(adaptAgentsLoadCapabilityState(host));
    await agentsCapability.loadToolsCatalog(adaptAgentsToolsCapabilityState(host));
    await configCapability.load(adaptConfigLoadCapabilityState(host));
    const agentIds = host.agentsList?.agents?.map((entry) => entry.id) ?? [];
    if (agentIds.length > 0) {
      void agentIdentityCapability.loadMany(adaptAgentIdentityLoadCapabilityState(host), agentIds);
    }
    const agentId =
      host.agentsSelectedId ?? host.agentsList?.defaultId ?? host.agentsList?.agents?.[0]?.id;
    if (agentId) {
      void agentIdentityCapability.load(adaptAgentIdentityLoadCapabilityState(host), agentId);
      if (host.agentsPanel === "skills") {
        void agentSkillsCapability.load(adaptAgentSkillsLoadCapabilityState(host), agentId);
      }
      if (host.agentsPanel === "channels") {
        void channelsCapability.load(adaptChannelsLoadCapabilityState(host), false);
      }
      if (host.agentsPanel === "cron") {
        void loadCron(host);
      }
    }
  }
  if (activeTab === "platformSystemSettings") {
    await configCapability.loadSchema(adaptConfigSchemaCapabilityState(host));
    await configCapability.load(adaptConfigLoadCapabilityState(host));
  }
}

export function inferBasePath() {
  if (typeof window === "undefined") {
    return "";
  }
  const configured = window.__OPENBOT_CONTROL_UI_BASE_PATH__;
  if (typeof configured === "string" && configured.trim()) {
    return normalizeBasePath(configured);
  }
  return inferBasePathFromPathname(window.location.pathname);
}

export function syncThemeWithSettings(host: SettingsHost) {
  host.theme = host.settings.theme ?? "system";
  applyResolvedTheme(host, resolveTheme(host.theme));
}

export function applyResolvedTheme(host: SettingsHost, resolved: ResolvedTheme) {
  host.themeResolved = resolved;
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

export function attachThemeListener(host: SettingsHost) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return;
  }
  host.themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
  host.themeMediaHandler = (event) => {
    if (host.theme !== "system") {
      return;
    }
    applyResolvedTheme(host, event.matches ? "dark" : "light");
  };
  if (typeof host.themeMedia.addEventListener === "function") {
    host.themeMedia.addEventListener("change", host.themeMediaHandler);
    return;
  }
  const legacy = host.themeMedia as MediaQueryList & {
    addListener: (cb: (event: MediaQueryListEvent) => void) => void;
  };
  legacy.addListener(host.themeMediaHandler);
}

export function detachThemeListener(host: SettingsHost) {
  if (!host.themeMedia || !host.themeMediaHandler) {
    return;
  }
  if (typeof host.themeMedia.removeEventListener === "function") {
    host.themeMedia.removeEventListener("change", host.themeMediaHandler);
    return;
  }
  const legacy = host.themeMedia as MediaQueryList & {
    removeListener: (cb: (event: MediaQueryListEvent) => void) => void;
  };
  legacy.removeListener(host.themeMediaHandler);
  host.themeMedia = null;
  host.themeMediaHandler = null;
}

function rewritePasswordResetDeepLink(basePath: string) {
  if (typeof window === "undefined") {
    return;
  }
  const next = canonicalPasswordResetLocation({
    pathname: window.location.pathname,
    search: window.location.search,
    host: window.location.host,
    basePath,
  });
  if (!next) {
    return;
  }
  const url = new URL(window.location.href);
  url.pathname = next.pathname;
  url.search = next.search;
  url.hash = next.hash;
  if (url.href !== window.location.href) {
    window.history.replaceState({}, "", url.href);
  }
}

export function syncTabWithLocation(host: SettingsHost, replace: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  rewritePasswordResetDeepLink(host.basePath ?? "");
  const locationMatch = matchTabRoute(window.location.pathname, host.basePath);
  const locationFallback =
    normalizePath(window.location.pathname) === "/"
      ? (resolveRootPathRoleTab(host) ?? locationMatch?.tab ?? "me")
      : (locationMatch?.tab ?? "me");
  const requestedTabFromLocation = tabAfterControlledLogin(host, locationFallback);
  const subdomainRedirect = resolveOpenBotSubdomainRedirectUrl({
    host: window.location.host,
    tab: requestedTabFromLocation,
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    protocol: window.location.protocol,
  });
  if (subdomainRedirect) {
    window.location.replace(subdomainRedirect);
    return;
  }
  // Tri-platform employee shell: an `/embed/employee/<surface>` route renders the
  // employee workbench (tab "me") chrome-less, focused on the mapped module. The
  // workbench already renders under tab "me", so we only route + flag chrome here
  // and intentionally skip the URL rewrite below to preserve the embed path.
  const embedRouting = resolveEmployeeEmbedRouting(
    window.location.pathname,
    host.basePath,
    window.location.search,
  );
  applyEmployeeEmbedRootClass(embedRouting !== null, embedRouting?.mobile ?? false);
  if (embedRouting) {
    applyWorkbenchSessionKeyFromLocation(host, window.location.search, window.location.hash);
    setTabFromRoute(host, resolveAuthorizedTab(host, embedRouting.tab));
    host.workbenchPrimaryModule = embedRouting.primaryModule;
    // PHONE-ONLY: "me" pins the settings module to personal (macOS embed keeps
    // full parity — it carries no `shell=mobile` marker, so settingsView is unset).
    if (embedRouting.settingsView) {
      host.workbenchSettingsView = embedRouting.settingsView;
    }
    return;
  }
  const match = matchTabRoute(window.location.pathname, host.basePath);
  const matchedFallback =
    normalizePath(window.location.pathname) === "/"
      ? (resolveRootPathRoleTab(host) ?? match?.tab ?? "me")
      : (match?.tab ?? "me");
  const requestedTab = tabAfterControlledLogin(host, matchedFallback);
  const resolved = resolveAuthorizedTab(host, requestedTab);
  const postAuthRedirect = resolveAuthorizedTabSubdomainRedirectUrl({
    host: window.location.host,
    tab: resolved,
    basePath: host.basePath,
    tenantId: isEnterpriseTab(resolved)
      ? (resolveEnterpriseTenantId(host) ?? undefined)
      : undefined,
    search: window.location.search,
    hash: window.location.hash,
    protocol: window.location.protocol,
  });
  if (postAuthRedirect) {
    window.location.replace(postAuthRedirect);
    return;
  }
  rememberEnterpriseTenant(host, match?.context?.tenantId);
  syncSkillsFilterFromUrl(host, resolved);
  setTabFromRoute(host, resolved);
  if (match && match.usedLegacyAlias) {
    const canonicalUrl = normalizePath(match.canonicalPath);
    if (canonicalUrl !== normalizePath(window.location.pathname)) {
      const url = new URL(window.location.href);
      url.pathname = canonicalUrl;
      window.history.replaceState({}, "", url.toString());
    }
  }
  syncUrlWithTab(host, resolved, replace, match?.context ?? null);
  void host.syncEnterpriseHandoverRoute(match?.context ?? null);
}

export function onPopState(host: SettingsHost) {
  if (typeof window === "undefined") {
    return;
  }
  rewritePasswordResetDeepLink(host.basePath ?? "");
  const match = matchTabRoute(window.location.pathname, host.basePath);
  if (!match) {
    return;
  }
  rememberEnterpriseTenant(host, match.context?.tenantId);

  const url = new URL(window.location.href);
  applyWorkbenchSessionKeyFromLocation(host, url.search, url.hash);

  const requested = tabAfterControlledLogin(host, match.tab);
  const employeeHome = consoleHostEmployeeHomeUrl(window.location.host);
  if (employeeHome && canonicalizeTab(requested) === "me") {
    // biz/?session=… still paints the public 注册/登录 card. Leave for www
    // before syncUrlWithTab writes that session back onto the console host.
    window.location.replace(employeeHome);
    return;
  }
  const subdomainRedirect = resolveOpenBotSubdomainRedirectUrl({
    host: window.location.host,
    tab: requested,
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    protocol: window.location.protocol,
  });
  if (subdomainRedirect) {
    window.location.replace(subdomainRedirect);
    return;
  }
  const resolved = resolveAuthorizedTab(host, requested);
  syncSkillsFilterFromUrl(host, resolved);
  setTabFromRoute(host, resolved);
  syncUrlWithTab(host, resolved, true, match.context);
  void host.syncEnterpriseHandoverRoute(match.context);
  // 同顶层 Tab 内的 query/hash/子路径变更不会更新 @state tab，必须强制重绘。
  requestOpenBotAppRerender();
  if (resolved === "platformAdvanced") {
    queueMicrotask(() => syncPlatformAdvancedPanelVisibilityLazy());
    setTimeout(() => syncPlatformAdvancedPanelVisibilityLazy(), 0);
  }
}

export function onHashChange(host: SettingsHost) {
  if (typeof window === "undefined") {
    return;
  }
  requestOpenBotAppRerender();
  if (host.tab !== "platformAdvanced") {
    return;
  }
  if (!window.location.hash.startsWith(PLATFORM_ADVANCED_HASH_PREFIX)) {
    return;
  }
  queueMicrotask(() => syncPlatformAdvancedPanelVisibilityLazy());
  setTimeout(() => syncPlatformAdvancedPanelVisibilityLazy(), 0);
}

export function setTabFromRoute(host: SettingsHost, next: Tab) {
  applyTabSelection(host, resolveAuthorizedTab(host, canonicalizeTab(next)), {
    refreshPolicy: "connected",
  });
}

function applyTabSelection(
  host: SettingsHost,
  next: Tab,
  options: { refreshPolicy: "always" | "connected"; syncUrl?: boolean },
) {
  const canonicalTab = canonicalizeTab(next);
  if (host.tab !== canonicalTab) {
    host.tab = canonicalTab;
  }
  if (canonicalTab === "platformAdvanced") {
    startLogsPolling(adaptPollingHost(host));
  } else {
    stopLogsPolling(adaptPollingHost(host));
  }
  if (canonicalTab === "platformAdvanced") {
    startDebugPolling(adaptPollingHost(host));
  } else {
    stopDebugPolling(adaptPollingHost(host));
  }

  if (options.refreshPolicy === "always" || host.connected) {
    void refreshActiveTab(host);
  }

  if (options.syncUrl) {
    syncUrlWithTab(host, canonicalTab, false);
  }
}

export function syncUrlWithTab(
  host: SettingsHost,
  tab: Tab,
  replace: boolean,
  context: import("./routing/cross-port-context.ts").CrossPortContext | null = null,
) {
  if (typeof window === "undefined") {
    return;
  }
  const employeeHome = consoleHostEmployeeHomeUrl(window.location.host);
  if (employeeHome && canonicalizeTab(tab) === "me") {
    window.location.replace(employeeHome);
    return;
  }
  const targetPath = normalizePath(
    pathForTab(tab, host.basePath, {
      tenantId: isEnterpriseTab(tab) ? resolveEnterpriseTenantId(host) : undefined,
      context,
    }),
  );
  const currentPath = normalizePath(window.location.pathname);
  const url = new URL(window.location.href);
  const preservePublicHomepageUrl =
    tab === "me" && shouldUsePublicHomepageForCurrentLocation(host.basePath ?? "", url.toString());

  if (preservePublicHomepageUrl) {
    url.searchParams.delete("session");
  } else if (tab !== "me" && tab !== "chat") {
    url.searchParams.delete("session");
  } else if (host.sessionKey) {
    url.searchParams.set("session", host.sessionKey);
  }

  if (tab === "me" && host.platformAuthSeatOfferId?.trim()) {
    url.searchParams.set("workbench", "settings");
    url.searchParams.set("settingsView", "personal");
    url.searchParams.set("seatOffer", host.platformAuthSeatOfferId.trim());
    url.hash = "seat-offer";
  }

  const preserveEnterpriseUsageSubRoute =
    (tab === "enterpriseUsage" || tab === "enterpriseBudget") &&
    hasCostBudgetUsageSubRoute(currentPath);

  // Enterprise settings sub-sections (e.g. /settings/identities, /settings/channels)
  // live within the single enterpriseSettings tab. pathForTab only resolves the
  // tab root (/settings), so without this guard popstate-driven syncUrlWithTab
  // would rewrite the URL back to the settings overview and the sub-section
  // could never open. Also preserve legacy top-level /channels until rewrite.
  const preserveEnterpriseSettingsSubSection =
    tab === "enterpriseSettings" &&
    (/\/settings\/[^/?#]+/u.test(currentPath) ||
      (/\/channels(?:\/|$)/u.test(currentPath) && !currentPath.includes("/settings/")));

  const preservePlatformAdvancedSubRoute =
    tab === "platformAdvanced" && window.location.hash.startsWith(PLATFORM_ADVANCED_HASH_PREFIX);

  const preservePlatformSubRoute =
    isPlatformTab(tab) && currentPath !== targetPath && currentPath.startsWith(`${targetPath}/`);

  if (
    currentPath !== targetPath &&
    !preserveEnterpriseUsageSubRoute &&
    !preserveEnterpriseSettingsSubSection &&
    !preservePlatformSubRoute
  ) {
    url.pathname = targetPath;
  }

  if (preservePlatformAdvancedSubRoute) {
    url.hash = window.location.hash;
  }

  if (replace) {
    window.history.replaceState({}, "", url.toString());
  } else {
    window.history.pushState({}, "", url.toString());
  }
}

export function syncUrlWithSessionKey(host: SettingsHost, sessionKey: string, replace: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set("session", sessionKey);
  if (replace) {
    window.history.replaceState({}, "", url.toString());
  } else {
    window.history.pushState({}, "", url.toString());
  }
}

/** Coalesce rapid platform/enterprise overview fan-outs. */
const OVERVIEW_TAB_CACHE_MS = 45_000;
let lastOverviewLoadAt = 0;
let overviewLoadInFlight: Promise<void> | null = null;

/** Per-profile shell caches for enterprise module navigation. */
const ENTERPRISE_SHELL_CACHE_MS = 60_000;
type EnterpriseShellProfile = "overview" | "organization" | "identity" | "mesh" | "none";
const lastEnterpriseShellLoadAt: Record<EnterpriseShellProfile, number> = {
  overview: 0,
  organization: 0,
  identity: 0,
  mesh: 0,
  none: 0,
};
const enterpriseShellInFlight: Partial<Record<EnterpriseShellProfile, Promise<void>>> = {};

export type LoadOverviewOptions = {
  /**
   * When true (default), always load — used by explicit refresh / post-mutation.
   * Tab navigation passes `{ force: false }` to reuse a 45s TTL cache.
   */
  force?: boolean;
};

function isEnterpriseShellTab(tab: Tab): boolean {
  return (
    tab === "enterpriseOverview" ||
    tab === "enterpriseOrganization" ||
    tab === "enterpriseAgents" ||
    tab === "enterpriseCapabilityCenter" ||
    tab === "enterpriseDataGovernanceCenter" ||
    tab === "enterpriseMesh" ||
    tab === "enterpriseUsage" ||
    tab === "enterpriseBudget" ||
    tab === "enterpriseSettings"
  );
}

/**
 * Map enterprise module → minimal shell load profile.
 * Surfaces that self-load (usage/capability/data-gov) get "none".
 */
export function enterpriseShellProfileForTabForTest(tab: Tab): EnterpriseShellProfile {
  return enterpriseShellProfileForTab(tab);
}

function enterpriseShellProfileForTab(tab: Tab): EnterpriseShellProfile {
  switch (tab) {
    case "enterpriseOverview":
      return "overview";
    case "enterpriseOrganization":
      return "organization";
    case "enterpriseSettings":
    case "enterpriseAgents":
      return "identity";
    case "enterpriseMesh":
      return "mesh";
    case "enterpriseUsage":
    case "enterpriseBudget":
    case "enterpriseCapabilityCenter":
    case "enterpriseDataGovernanceCenter":
      return "none";
    default:
      return "none";
  }
}

async function loadEnterpriseConfigShell(host: SettingsHost): Promise<void> {
  await Promise.all([
    configCapability.loadSchema(adaptConfigSchemaCapabilityState(host)),
    configCapability.load(adaptConfigLoadCapabilityState(host)),
  ]);
}

/**
 * Enterprise tab shell: only the RPCs that tab needs (not the platform overview fan-out).
 */
export async function loadEnterpriseTabShell(
  host: SettingsHost,
  tab: Tab,
  options: LoadOverviewOptions = {},
): Promise<void> {
  const force = options.force === true;
  const profile = enterpriseShellProfileForTab(tab);
  if (profile === "none") {
    return;
  }
  if (!force && enterpriseShellInFlight[profile]) {
    return enterpriseShellInFlight[profile];
  }
  if (!force && Date.now() - lastEnterpriseShellLoadAt[profile] < ENTERPRISE_SHELL_CACHE_MS) {
    return;
  }

  lastEnterpriseShellLoadAt[profile] = Date.now();
  const run = (async () => {
    try {
      if (profile === "overview") {
        // Full shared overview for the enterprise home dashboard only.
        // Honor outer force; loadOverview applies its own TTL when force=false.
        await loadOverview(host, { force });
        const now = Date.now();
        lastEnterpriseShellLoadAt.identity = now;
        lastEnterpriseShellLoadAt.mesh = now;
        return;
      }
      if (profile === "organization") {
        await Promise.all([
          loadEnterpriseConfigShell(host),
          refreshEnterpriseOrganizationSnapshot(
            host as unknown as Parameters<typeof refreshEnterpriseOrganizationSnapshot>[0],
          ),
          loadEnterpriseOrganizationMonthlyUsage(
            host as unknown as Parameters<typeof loadEnterpriseOrganizationMonthlyUsage>[0],
          ),
        ]);
        return;
      }
      if (profile === "identity") {
        await Promise.all([
          loadEnterpriseConfigShell(host),
          loadEnterpriseOperationalIdentityOverview(host),
        ]);
        return;
      }
      if (profile === "mesh") {
        await Promise.all([
          loadEnterpriseConfigShell(host),
          loadMeshShellData(toMeshShellHost(host)),
        ]);
      }
    } finally {
      delete enterpriseShellInFlight[profile];
    }
  })();
  enterpriseShellInFlight[profile] = run;
  return run;
}

/**
 * Shared shell data for platform overview-style surfaces (and enterprise home).
 * Tab navigation should pass `{ force: false }` so consecutive clicks reuse cache.
 */
export async function loadOverview(
  host: SettingsHost,
  options: LoadOverviewOptions = {},
): Promise<void> {
  const force = options.force !== false;
  if (!force && overviewLoadInFlight) {
    return overviewLoadInFlight;
  }
  if (!force && Date.now() - lastOverviewLoadAt < OVERVIEW_TAB_CACHE_MS) {
    return;
  }

  lastOverviewLoadAt = Date.now();
  overviewLoadInFlight = (async () => {
    try {
      await Promise.all([
        channelsCapability.load(adaptChannelsLoadCapabilityState(host), false),
        presenceCapability.load(adaptPresenceLoadCapabilityState(host)),
        sessionsCapability.load(adaptSessionsLoadCapabilityState(host)),
        skillsCapability.load(adaptSkillsLoadCapabilityState(host)),
        cronCapability.loadStatus(adaptCronStatusCapabilityState(host)),
        debugCapability.load(adaptDebugLoadCapabilityState(host)),
        agentRuntimeCapability.loadOverview(adaptAgentRuntimeOverviewCapabilityState(host)),
        refreshCapabilityGovernanceSnapshotLazy(host as CapabilityGovernanceSnapshotHost),
        // Enterprise / platform overview surfaces derive "model data"
        // (configuredProviderCount, configuredModelCount, modelMode, providerIds,
        // modelDirectory, taskPlanDirectory, routingPolicyDirectory, allowlistEntries)
        // from configValue. Without this, those panels render blank after a
        // restart whenever the user lands directly on an overview tab.
        configCapability.loadSchema(adaptConfigSchemaCapabilityState(host)),
        configCapability.load(adaptConfigLoadCapabilityState(host)),
        // Enterprise hero (totalCost / totalTokens / missingCostEntries) and platform
        // models page (7d 调用 / 成本 / topModel / topAgent) read from usageResult.
        // Without this, those summary cards render as zeros after a restart.
        loadUsage(host as unknown as UsageState),
        // Enterprise operational identity settings derive identity snapshot from
        // enterpriseOperationalIdentities. Without this, the identities section looks
        // empty until the user manually refreshes or opens the editor.
        loadEnterpriseOperationalIdentityOverview(host),
        loadMeshOwnership(host as unknown as Parameters<typeof loadMeshOwnership>[0]),
      ]);
      // Keep enterprise shell profile clocks warm after a full overview pull.
      const now = Date.now();
      lastEnterpriseShellLoadAt.overview = now;
      lastEnterpriseShellLoadAt.identity = now;
      lastEnterpriseShellLoadAt.mesh = now;
    } finally {
      overviewLoadInFlight = null;
    }
  })();
  return overviewLoadInFlight;
}

/** Test helper: clear overview / enterprise shell tab-switch caches. */
export function __resetOverviewLoadCacheForTest(): void {
  lastOverviewLoadAt = 0;
  overviewLoadInFlight = null;
  for (const key of Object.keys(lastEnterpriseShellLoadAt) as EnterpriseShellProfile[]) {
    lastEnterpriseShellLoadAt[key] = 0;
    delete enterpriseShellInFlight[key];
  }
}

export async function loadModelsManagement(host: SettingsHost) {
  const state = host as SettingsHost & Parameters<typeof loadPlatformModelsManagementSnapshot>[0];
  await loadPlatformModelsManagementSnapshot(state);
}

export async function loadChannelsTab(host: SettingsHost) {
  await Promise.all([
    channelsCapability.load(adaptChannelsLoadCapabilityState(host), true),
    configCapability.loadSchema(adaptConfigSchemaCapabilityState(host)),
    configCapability.load(adaptConfigLoadCapabilityState(host)),
  ]);
}

export async function loadCron(host: SettingsHost) {
  await Promise.all([
    channelsCapability.load(adaptChannelsLoadCapabilityState(host), false),
    cronCapability.loadStatus(adaptCronStatusCapabilityState(host)),
    cronCapability.loadJobs(adaptCronJobsCapabilityState(host)),
    cronCapability.loadModelSuggestions(adaptCronModelSuggestionsCapabilityState(host)),
  ]);
  if (host.cronRunsScope === "all") {
    await cronCapability.loadRuns(adaptCronRunsCapabilityState(host), null);
    return;
  }
  if (host.cronRunsJobId) {
    await cronCapability.loadRuns(adaptCronRunsCapabilityState(host), host.cronRunsJobId);
  }
}
