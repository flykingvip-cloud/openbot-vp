import { html, nothing, type TemplateResult } from "lit";
import type { ControlUiPlatformAuthState } from "../../../src/gateway/control-ui-contract.js";
import type { MentionCandidate } from "../../../src/organization/mention-types.js";
import { parseAgentSessionKey } from "../../../src/routing/session-key.js";
import { i18n, isSupportedLocale, t, type Locale } from "../i18n/index.ts";
import {
  loadOlderShellChatHistory,
  refreshShellChat,
  type ShellChatHistoryReloadState,
} from "./app-chat-actions.ts";
import { connectGateway } from "./app-gateway.ts";
import { adaptAppPortState } from "./app-port-state.ts";
import { renderPlatformSidebarNav, renderTab } from "./app-render.helpers.ts";
import { switchShellChatSession } from "./app-session-actions.ts";
import { setTabFromRoute, syncUrlWithTab, type SettingsHost } from "./app-settings.ts";
import type { AppViewState } from "./app-view-state.ts";
import { resolveBundledBrandWordmarkSrc, resolveCustomBrandLogoSrc } from "./brand-assets.ts";
import { resolveStewardSessionDefaultsFromHello } from "./builtin-steward-selection.ts";
import { configCapability } from "./capability/config/index.ts";
import { setModelAuthorizationClient } from "./capability/model-authorization/index.ts";
import {
  adaptAppCapabilitySlices,
  adaptConfigUpdateCapabilityState,
} from "./capability/view-state.ts";
import { selectVisibleHostError } from "./channel-fault-scope.ts";
import { applyContextExpansionToScope, extractLatestUserText } from "./chat/context-expansion.ts";
import { loadChatContextSourceCatalog } from "./chat/context-scope-catalog.ts";
import type { ChatContextScopeState } from "./chat/context-scope.ts";
import { getConversationTaskProgressEntries } from "./chat/conversation-task-progress.ts";
import { resolveCronResultArtifactRecord } from "./chat/cron-result-message.ts";
import type {
  HumanAttentionAction,
  HumanAttentionActDetail,
  HumanAttentionCardView,
} from "./chat/human-attention-card.ts";
import {
  clearOwnerDecisionActionError,
  collapseOwnerDecisionCardsForBoardItem,
  dismissOwnerDecisionCard,
  markOwnerDecisionHydrationAttempted,
  noteOwnerDecisionDelivery,
  noteOwnerDecisionRecoveries,
  noteOwnerDecisionVersionRefusal,
  setOwnerDecisionActionError,
  setOwnerDecisionTodolistStatus,
  type OwnerDecisionAction,
  type OwnerDecisionCardView,
  type OwnerDecisionDetail,
  type OwnerDecisionHydrationTarget,
  formatPostPlanConfirmAdvanceUserMessage,
} from "./chat/owner-decision-card.ts";
import type { ChatQuoteDraft } from "./chat/quote-draft.ts";
import {
  formatRejectNotice,
  rejectNoticeFromPayload,
  type TaskOutcomeRejectRef,
} from "./chat/task-outcome-reject.ts";
import { labelForWorkProgressPhase } from "./chat/work-progress-phase.ts";
import {
  resolveWorkbenchChatSessionKey,
  resolveWorkbenchVisibleChatMessages,
} from "./chat/workbench-visible-messages.ts";
import {
  buildMentionCandidatesForComposer,
  collectComposerPluginMentionEntries,
} from "./components/mention/build-mention-candidates.ts";
import { isCurrentControlUiGatewayTarget } from "./controllers/control-ui-bootstrap.ts";
import { isDaibaiWorkbenchSession as checkDaibaiWorkbenchSession } from "./controllers/daibai.ts";
import {
  authorizeFocusSwitchCancel,
  authorizeFocusSwitchProceed,
  dismissFocusSwitchGate,
} from "./controllers/focus-switch-gate.ts";
import {
  cancelRuleAdaptationAdvice,
  getRuleAdaptationAdvicePanel,
  requestRuleAdaptationAdvice,
  resetRuleAdaptationAdvicePanel,
} from "./controllers/rule-adaptation-advice.ts";
import { resolveEmployeeEmbedRouting } from "./employee-shell/workbench-embed.ts";
import { resolveGatewayChatBanner } from "./gateway-connection-phase.ts";
import { icons } from "./icons.ts";
import {
  isEnterpriseResolverPath,
  isEnterpriseTab,
  isPlatformTab,
  normalizeBasePath,
  pathForTab,
  portForTab,
  subtitleForTab,
  tabGroupsForPort,
  titleForTab,
} from "./navigation.ts";
import {
  preloadEmployeeWorkbenchBundle,
  renderCrossPortShellLoadingPlaceholder,
  resolveEmployeeWorkbenchBundle,
  resolvePlatformPortBundle,
} from "./ports/cross-port-shell-lazy.ts";
import { createDaibaiTeamMembers } from "./ports/employee/daibai-team-create.ts";
import { openPersonalOperationalIdentitySection } from "./ports/employee/operational-identity-navigation.ts";
import type {
  DaibaiGapApplyDeeplink,
  DaibaiGapCtaKind,
} from "./ports/employee/views/daibai-capability-gaps.ts";
import { buildDaibaiOiEnrollmentCreateParams } from "./ports/employee/views/daibai-oi-enrollment.ts";
import { adaptEnterprisePortActionState } from "./ports/enterprise/action-state.ts";
import { adaptEnterprisePortState } from "./ports/enterprise/port-state.ts";
import { createEnterprisePortActions } from "./ports/enterprise/render-actions.ts";
import { buildEnterprisePortRenderModel } from "./ports/enterprise/render-model.ts";
import { resolveEnterpriseTenantId } from "./ports/enterprise/semantic/enterprise-read-model.ts";
import { appendMcpDiscoveryContext } from "./ports/enterprise/views/enterprise-data-capability/mcp-discovery-deeplink.ts";
import { renderEnterprisePortShell } from "./ports/enterprise/views/enterprise-shell.ts";
import {
  isEnterpriseAdminAuthenticated,
  isPlatformAdminAuthenticated,
  resolveActivePlatformAuthSession,
  shouldShowPlatformLoginEntry,
} from "./ports/platform/platform-auth-session.ts";
import { consoleHostEmployeeHomeUrl, resolveControlUiHomepageState } from "./public-home.ts";
import { decideControlledLogin } from "./routing/confirmed-session-land.ts";
import { filterTabsByPermission, resolveAuthorizedTab } from "./routing/port-permissions.ts";
import { acknowledgeDaibaiGuideForUser, isDaibaiGuideAcknowledgedForUser } from "./storage.ts";
import type { ThemeMode } from "./theme.ts";
import type {
  CollaborationSpaceSnapshotTransport,
  GatewayAgentRow,
  GatewaySessionRow,
  SharedArtifact,
} from "./types.ts";
import type { ChatAttachment } from "./ui-types.ts";
import { generateUUID } from "./uuid.ts";
import {
  computerPreviewNeedsInputClaim,
  computerPreviewNeedsOpen,
  readComputerPreviewModel,
  resolveAccountComputerAccount,
  returnComputerToChat,
  selectComputerChip,
  selectComputerSurface,
  setComputerPreviewSize,
  exitComputerFullscreenSize,
  takeoverComputerPreview,
  handBackComputerPreview,
  reconnectComputerDesktopSession,
  rotateComputerPreviewStreamCredential,
} from "./views/account-computer-preview.ts";
import { authHomeModeForControlledLogin } from "./views/auth-home-entry-mode.ts";
import { renderAuthHome, renderTrialApplyPage } from "./views/auth-home.ts";
import { renderChatCompose, renderChatContent } from "./views/chat.ts";
import {
  renderExecApprovalPrompt,
  renderLocalExecPermissionInline,
} from "./views/exec-approval.ts";
import { renderContacts, renderGroups, renderPersonas } from "./views/frontstage.ts";
import { renderGatewayUrlConfirmation } from "./views/gateway-url-confirmation.ts";
import {
  renderLocalFileApprovalInline,
  renderLocalFileApprovalPrompt,
} from "./views/local-file-approval.ts";
import { renderPlatformAuthPanel } from "./views/platform-auth-panel.ts";
import {
  renderPublicFeaturesPage,
  renderPublicHelpPage,
  renderPublicPartnerEcosystemPage,
  renderPublicPricingPage,
  renderPublicPrivacyPage,
  renderPublicSkillsMcpPage,
} from "./views/public-legal-pages.ts";
import { renderSecureFormCard } from "./views/secure-form-card.ts";
import {
  dismissAssetIncubationFromPreview,
  openSkillSaveFromPreview,
  resolveArtifactPreviewIncubationView,
} from "./wiring/asset-incubation-preview.ts";

const AVATAR_DATA_RE = /^data:/i;
const AVATAR_HTTP_RE = /^https?:\/\//i;

const ownerDecisionRecoveryLoaded = new Set<string>();

function normalizeThreadPrelude(value: unknown): TemplateResult | null {
  return value === nothing ? null : ((value as TemplateResult | null | undefined) ?? null);
}

function resolveAssistantAvatarUrl(state: AppViewState): string | undefined {
  const list = state.agentsList?.agents ?? [];
  const parsed = parseAgentSessionKey(state.sessionKey);
  const agentId = parsed?.agentId ?? state.agentsList?.defaultId ?? "main";
  const agent = list.find((entry) => entry.id === agentId);
  const identity = agent?.identity;
  const candidate = identity?.avatarUrl ?? identity?.avatar;
  if (!candidate) {
    return undefined;
  }
  if (AVATAR_DATA_RE.test(candidate) || AVATAR_HTTP_RE.test(candidate)) {
    return candidate;
  }
  return identity?.avatarUrl;
}

type ArtifactShareTarget = {
  sessionKey: string;
  label: string;
  sublabel?: string | null;
  current?: boolean;
  targetKind?: "space" | "agent";
};

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveVisibleChatMessages(state: AppViewState): unknown[] {
  return resolveWorkbenchVisibleChatMessages({
    selectedKey: state.workbenchTeamSelectedKey,
    sessionKey: state.sessionKey,
    messages: state.chatMessages,
  });
}

function extractSpaceIdentity(value: unknown): string {
  const text = stringField(value);
  if (!text) {
    return "";
  }
  if (text.startsWith("space:")) {
    return text.slice("space:".length).trim();
  }
  return /(?:^|:)space:([^:]+)$/u.exec(text)?.[1]?.trim() ?? "";
}

function findCurrentSession(state: AppViewState): GatewaySessionRow | null {
  const sessions = state.sessionsResult?.sessions ?? [];
  return sessions.find((entry) => entry.key === state.sessionKey) ?? null;
}

function findCurrentCollaborationSpace(
  state: AppViewState,
): CollaborationSpaceSnapshotTransport | null {
  const spaces = state.collaborationSpacesResult?.spaces ?? [];
  if (spaces.length === 0) {
    return null;
  }
  const currentSession = findCurrentSession(state);
  const candidates = new Set(
    [
      extractSpaceIdentity(state.sessionKey),
      extractSpaceIdentity(state.workbenchTeamSelectedKey),
      stringField(currentSession?.space),
      stringField(currentSession?.groupId),
    ].filter(Boolean),
  );
  return (
    spaces.find((space) => {
      const ids = [space.id, space.groupId].map(stringField).filter(Boolean);
      return ids.some((id) => candidates.has(id));
    }) ?? null
  );
}

function buildCurrentMentionCandidates(state: AppViewState): MentionCandidate[] {
  const session = resolveActivePlatformSession(state);
  const access = state.platformAuthState?.employeeAccess;
  const sessionEmail =
    session && "email" in session && typeof session.email === "string" ? session.email : undefined;
  return buildMentionCandidatesForComposer({
    sessionKey: resolveWorkbenchChatSessionKey({
      selectedKey: state.workbenchTeamSelectedKey,
      sessionKey: state.sessionKey,
    }),
    sessionDefaults: resolveStewardSessionDefaultsFromHello(state.hello),
    selfUserId: access?.employeeUserId,
    spaces: state.collaborationSpacesResult?.spaces,
    directory: {
      humans: state.platformAuthState?.members,
      ownedAgentIds: access?.ownedAgentIds,
      actorIdentities: [
        access?.employeeUserId,
        session?.user,
        sessionEmail,
        state.platformAuthState?.session?.email,
        state.platformAuthState?.session?.user,
      ],
      robots: [
        ...(state.workbenchCollaborationOrgBotDirectory ?? []).map((bot) => ({
          agentId: bot.agentId,
          displayName: bot.label,
          ownerUserId: bot.ownerUserId,
        })),
        ...(state.agentsList?.agents ?? []).map((agent) => ({
          agentId: agent.id,
          displayName: agent.identity?.name?.trim() || agent.name?.trim() || agent.id,
          ownerUserId: agent.ownerId,
        })),
      ],
      plugins: collectComposerPluginMentionEntries({
        operationalIdentities: state.userOperationalIdentities?.identities,
        pluginToolGroups: state.toolsCatalogResult?.groups,
      }),
    },
  });
}

function spaceMatchesIdentity(
  space: CollaborationSpaceSnapshotTransport,
  identity: string,
): boolean {
  if (!identity) {
    return false;
  }
  const normalizedIdentity = identity.toLowerCase();
  return [space.id, space.groupId, space.title]
    .map(stringField)
    .filter(Boolean)
    .some((value) => value.toLowerCase() === normalizedIdentity);
}

function resolveCollaborationSpaceSessionKey(
  state: AppViewState,
  space: CollaborationSpaceSnapshotTransport,
): string {
  const spaces = [
    stringField(space.id),
    stringField(space.groupId),
    stringField(space.title),
  ].filter(Boolean);
  const sessions = state.sessionsResult?.sessions ?? [];
  const match = sessions.find((session) => {
    const identity = extractSpaceIdentity(session.key) || stringField(session.space);
    return (
      spaces.includes(identity) ||
      spaces.includes(stringField(session.groupId)) ||
      spaces.includes(stringField(session.displayName)) ||
      spaces.includes(stringField(session.derivedTitle)) ||
      spaces.includes(stringField(session.subject)) ||
      spaces.includes(stringField(session.label))
    );
  });
  return match?.key ?? `space:${spaces[0] ?? space.id}`;
}

function resolveAgentMainSessionKey(state: AppViewState, agentId: string): string {
  if (!agentId || agentId === "main") {
    return "main";
  }
  const sessions = state.sessionsResult?.sessions ?? [];
  const match = sessions.find((session) => {
    const parsed = parseAgentSessionKey(session.key);
    return parsed?.agentId === agentId && parsed.rest === "main";
  });
  return match?.key ?? `agent:${agentId}:main`;
}

function agentDisplayName(agent: GatewayAgentRow): string {
  return (
    stringField(agent.identity?.name) ||
    stringField(agent.name) ||
    stringField(agent.ownerName) ||
    stringField(agent.id)
  );
}

function buildArtifactCollaborationTargets(state: AppViewState): ArtifactShareTarget[] {
  const currentSpace = findCurrentCollaborationSpace(state);
  const currentSession = findCurrentSession(state);
  const currentSpaceIds = [
    currentSpace?.id,
    currentSpace?.groupId,
    currentSpace?.title,
    extractSpaceIdentity(state.sessionKey),
    extractSpaceIdentity(state.workbenchTeamSelectedKey),
    currentSession?.space,
    currentSession?.groupId,
    currentSession?.displayName,
    currentSession?.derivedTitle,
    currentSession?.subject,
    currentSession?.label,
  ]
    .map(stringField)
    .filter(Boolean);
  const targets: ArtifactShareTarget[] = [];
  for (const space of state.collaborationSpacesResult?.spaces ?? []) {
    if (currentSpaceIds.some((identity) => spaceMatchesIdentity(space, identity))) {
      continue;
    }
    const label = stringField(space.title) || stringField(space.groupId) || stringField(space.id);
    if (!label) {
      continue;
    }
    if (currentSpaceIds.some((identity) => identity.toLowerCase() === label.toLowerCase())) {
      continue;
    }
    targets.push({
      sessionKey: resolveCollaborationSpaceSessionKey(state, space),
      label,
      targetKind: "space",
    });
  }
  for (const agent of state.agentsList?.agents ?? []) {
    const agentId = stringField(agent.id);
    if (!agentId) {
      continue;
    }
    const currentAgentId = parseAgentSessionKey(state.sessionKey)?.agentId ?? null;
    if (agentId === currentAgentId && !extractSpaceIdentity(state.sessionKey)) {
      continue;
    }
    const label = agentDisplayName(agent);
    if (!label) {
      continue;
    }
    targets.push({
      sessionKey: resolveAgentMainSessionKey(state, agentId),
      label,
      targetKind: "agent",
    });
  }
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = target.sessionKey || target.label;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}

function sanitizeAttachmentFileName(value: string): string {
  const normalized = value
    .trim()
    .replace(/[\\/:*?"<>|]+/gu, "_")
    .replace(/\s+/gu, " ");
  return normalized || "artifact";
}

function buildArtifactAttachment(artifact: SharedArtifact): ChatAttachment {
  const text = extractArtifactShareText(artifact);
  const fileName = `${sanitizeAttachmentFileName(artifact.title)}.md`;
  return {
    id: `artifact-share-${generateUUID()}`,
    dataUrl: `data:text/markdown;base64,${encodeBase64Utf8(text)}`,
    mimeType: "text/markdown",
    fileName,
    status: "ready",
    progress: 100,
  };
}

function extractArtifactShareText(artifact: SharedArtifact): string {
  const metadata = artifact.providerMetadata ?? {};
  const preview =
    stringField(metadata.previewText) ||
    stringField(metadata.textPreview) ||
    stringField(metadata.markdown) ||
    stringField(metadata.content) ||
    stringField(artifact.sourceMessage);
  if (preview) {
    return preview;
  }
  return [
    artifact.openUrl ? `打开链接：${artifact.openUrl}` : "",
    artifact.downloadUrl ? `下载链接：${artifact.downloadUrl}` : "",
    artifact.editUrl ? `编辑链接：${artifact.editUrl}` : "",
    `Artifact ID: ${artifact.artifactId}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function shareArtifactToCollaborationTarget(
  state: AppViewState,
  artifactId: string,
  targetSessionKey: string | undefined,
  targets: ArtifactShareTarget[],
) {
  const artifact = state.sidebarArtifactWorkspace?.artifact;
  if (!artifact || artifact.artifactId !== artifactId) {
    throw new Error("Artifact is not available for sharing");
  }
  const target =
    targets.find((entry) => entry.sessionKey === targetSessionKey) ??
    targets.find((entry) => entry.current) ??
    null;
  const sessionKey = target?.sessionKey;
  if (!sessionKey) {
    throw new Error("Share target is not available");
  }
  state.workbenchTeamSelectedKey = sessionKey;
  const employeeBundle = await preloadEmployeeWorkbenchBundle();
  employeeBundle.switchEmployeeWorkbenchSession(
    state,
    sessionKey,
    target.targetKind === "space" ? "collaboration" : "assistant",
  );
  state.chatAttachments = [buildArtifactAttachment(artifact)];
  state.chatMessage = "";
  state.setTab("me");
  state.sidebarOpen = false;
  state.sidebarArtifactWorkspace = null;
  state.sidebarContent = null;
}

function resolveWorkspaceHomepageState(params: {
  state: AppViewState;
  activePlatformSession: ReturnType<typeof resolveActivePlatformSession>;
  useBootstrapAuth: boolean;
}): ControlUiPlatformAuthState | null {
  return resolveControlUiHomepageState({
    platformAuthState: params.state.platformAuthState,
    activePlatformSession: params.activePlatformSession,
    useBootstrapAuth: params.useBootstrapAuth,
    forcePublicHomepage: params.state.forcePublicHomepage,
    basePath: params.state.basePath,
    pageUrl: typeof window === "undefined" ? undefined : window.location.href,
    gatewayConnected: params.state.connected,
  });
}

function resolveLocalUserDisplayName(state: AppViewState): string | null {
  const session = resolveActivePlatformSession(state);
  return session?.displayName?.trim() ?? session?.user?.trim() ?? null;
}

function resolveActivePlatformSession(state: AppViewState) {
  return state.hello?.auth?.provider === "trusted-proxy" && state.hello.auth.user
    ? {
        provider: "trusted-proxy" as const,
        user: state.hello.auth.user,
        displayName: state.hello.auth.displayName,
        tenantId: state.hello.auth.tenantId,
        role: state.hello.auth.role,
        scopes: state.hello.auth.scopes,
      }
    : (state.platformAuthState?.session ?? state.bootstrapAuthSession ?? null);
}

function nextShellLocale(locale: Locale): Locale {
  return locale === "zh-CN" ? "en" : "zh-CN";
}

function resolveShellTheme(value: ThemeMode): ThemeMode {
  return value === "dark" ? "dark" : "light";
}

function nextShellTheme(theme: ThemeMode): ThemeMode {
  return theme === "dark" ? "light" : "dark";
}

function renderShellThemeIcon(theme: ThemeMode) {
  return theme === "dark"
    ? html`
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          ></path>
        </svg>
      `
    : html`
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4"></circle>
          <path d="M12 2v2.5"></path>
          <path d="M12 19.5V22"></path>
          <path d="m4.93 4.93 1.77 1.77"></path>
          <path d="m17.3 17.3 1.77 1.77"></path>
          <path d="M2 12h2.5"></path>
          <path d="M19.5 12H22"></path>
          <path d="m4.93 19.07 1.77-1.77"></path>
          <path d="m17.3 6.7 1.77-1.77"></path>
        </svg>
      `;
}

function shellComputerFocusClass(state: AppViewState): string {
  if (
    state.sidebarOpen &&
    state.sidebarSurface === "computer" &&
    state.computerPreviewSize === "fullscreen"
  ) {
    return "shell--chat-focus";
  }
  return "";
}

function confirmedLoginContinue(state: AppViewState): {
  href: string | null;
  label: string | null;
} {
  const path =
    state.tab === "enterpriseLogin"
      ? "/enterprise/login"
      : state.tab === "platformLogin"
        ? "/platform/login"
        : null;
  if (!path) {
    return { href: null, label: null };
  }
  const decision = decideControlledLogin({
    path,
    auth: state.platformAuthState,
    enterpriseAuthenticated: isEnterpriseAdminAuthenticated(state),
    platformAuthenticated: isPlatformAdminAuthenticated(state),
    notice: state.platformAuthNotice,
    landReachable: (tab) => resolveAuthorizedTab(state, tab) === tab,
  });
  if (decision.action === "redirect") {
    // Same render paints the workbench. Route sync also lands this tab; this
    // covers auth arriving while the login tab is already current. Avoid
    // setTab()'s always-refresh so a disconnected paint does not fan out RPCs.
    if (state.tab !== decision.tab) {
      const host = state as unknown as SettingsHost;
      if (state.connected) {
        state.setTab(decision.tab);
      } else {
        setTabFromRoute(host, decision.tab);
        syncUrlWithTab(host, decision.tab, true);
      }
    }
    return { href: null, label: null };
  }
  if (decision.action === "stay") {
    if (decision.clearStaleSuccessNotice) {
      state.platformAuthNotice = null;
    }
    return { href: null, label: null };
  }
  return {
    href: pathForTab(decision.tab, normalizeBasePath(state.basePath ?? "")),
    label: decision.tab === "enterpriseOverview" ? "进入企业工作台" : "进入平台控制台",
  };
}

export function renderApp(state: AppViewState) {
  const confirmedLogin = confirmedLoginContinue(state);
  const capabilityState = adaptAppCapabilitySlices(state);
  const configUpdateState = adaptConfigUpdateCapabilityState(capabilityState.config);
  const enterpriseState = adaptEnterprisePortState(state);
  const enterpriseActionState = adaptEnterprisePortActionState(state);
  const portState = adaptAppPortState(state);
  const availableUpdate =
    state.updateAvailable &&
    state.updateAvailable.latestVersion !== state.updateAvailable.currentVersion
      ? state.updateAvailable
      : null;
  const gatewayChatBanner = resolveGatewayChatBanner({
    connected: state.connected,
    phase: state.gatewayConnectionPhase,
  });
  const visibleHostError = selectVisibleHostError({
    lastError: state.lastError,
    channelsError: state.channelsError,
    snapshot: state.channelsSnapshot,
  });
  const chatDisabledReason =
    gatewayChatBanner.kind === "hidden" ? null : t(gatewayChatBanner.messageKey);
  const isWorkspaceHome = state.tab === "me";
  const isPlatformSurface = isPlatformTab(state.tab);
  const isEnterpriseSurface = isEnterpriseTab(state.tab);
  const activePort = portForTab(state.tab);
  // Employee/platform shells are dynamically imported — only resolve when needed
  // so enterprise cold boot does not download those ~3MB trees.
  const employeeBundle =
    isWorkspaceHome || activePort === "employee" ? resolveEmployeeWorkbenchBundle() : null;
  const platformBundle = isPlatformSurface ? resolvePlatformPortBundle() : null;
  const basePath = normalizeBasePath(state.basePath ?? "");
  const currentLocale: Locale = isSupportedLocale(state.settings.locale)
    ? state.settings.locale
    : i18n.getLocale();
  const shellTheme = resolveShellTheme(state.theme);
  const nextLocaleValue = nextShellLocale(currentLocale);
  const nextThemeValue = nextShellTheme(shellTheme);
  const bundledBrandWordmarkSrc = resolveBundledBrandWordmarkSrc(basePath);
  const topbarAccountEntry =
    activePort === "enterprise"
      ? {
          loggedIn: isEnterpriseAdminAuthenticated(state),
          loginHref: pathForTab("enterpriseLogin", basePath),
          loginLabel: "企业登录",
          settingsHref: pathForTab("enterpriseSettings", basePath, {
            tenantId:
              state.platformAuthState?.session?.tenantId?.trim() ??
              state.bootstrapAuthSession?.tenantId?.trim() ??
              undefined,
          }),
          settingsLabel: "管理员设置",
        }
      : activePort === "platform"
        ? {
            loggedIn: isPlatformAdminAuthenticated(state),
            loginHref: pathForTab("platformLogin", basePath),
            loginLabel: "平台登录",
            settingsHref: pathForTab("platformSystemSettings", basePath),
            settingsLabel: "管理员设置",
          }
        : null;
  const topbarAccountLabel =
    activePort === "enterprise" ? "企业账户" : activePort === "platform" ? "平台账户" : null;
  const topbarAccountMonogram = (topbarAccountLabel?.trim()[0] ?? "U").toUpperCase();
  const topbarAuthMode =
    activePort === "enterprise"
      ? state.platformAuthMode === "enterprise-activate"
        ? "enterprise-activate"
        : "login"
      : activePort === "platform"
        ? state.platformAuthState?.requiresPlatformBootstrap
          ? "platform-bootstrap"
          : state.platformAuthMode === "platform-super-admin-login"
            ? "platform-super-admin-login"
            : "platform-admin-login"
        : null;
  const topbarAuthModes =
    activePort === "enterprise"
      ? ([
          "login",
          ...(state.platformAuthState?.pendingActivation || state.platformAuthInviteCode.trim()
            ? (["enterprise-activate"] as const)
            : []),
        ] as const)
      : activePort === "platform"
        ? state.platformAuthState?.requiresPlatformBootstrap
          ? (["platform-bootstrap"] as const)
          : (["platform-admin-login", "platform-super-admin-login"] as const)
        : ([] as const);
  const topbarFullLoginHref =
    activePort === "enterprise"
      ? pathForTab("enterpriseLogin", basePath)
      : activePort === "platform"
        ? pathForTab("platformLogin", basePath)
        : null;
  const topbarAuthTitle =
    activePort === "enterprise"
      ? "企业管理员登录"
      : activePort === "platform"
        ? "平台管理员登录"
        : "";
  const topbarAuthSubtitle =
    activePort === "enterprise"
      ? "登录企业控制台，或使用管理员激活码完成首次激活。"
      : activePort === "platform"
        ? "登录平台控制台；首次部署时可在这里完成超管初始化。"
        : "";
  const topbarAuthModeLabel = (mode: string) =>
    mode === "enterprise-activate"
      ? "管理员激活"
      : mode === "platform-super-admin-login"
        ? "超管登录"
        : mode === "platform-bootstrap"
          ? "初始化平台"
          : "登录";
  const topbarAuthSubmitLabel = (mode: string | null) =>
    mode === "enterprise-activate"
      ? "完成激活"
      : mode === "platform-super-admin-login"
        ? "超管登录"
        : mode === "platform-bootstrap"
          ? "初始化平台"
          : activePort === "platform"
            ? "平台登录"
            : "企业登录";
  const topbarAuthDisabled =
    topbarAuthMode === "enterprise-activate"
      ? !state.platformAuthDisplayName.trim() ||
        !state.platformAuthEmail.trim() ||
        !state.platformAuthInviteCode.trim() ||
        !state.platformAuthPassword.trim()
      : topbarAuthMode === "platform-bootstrap"
        ? !state.platformAuthDisplayName.trim() ||
          !state.platformAuthEmail.trim() ||
          !state.platformAuthPassword.trim()
        : !state.platformAuthEmail.trim() || !state.platformAuthPassword.trim();
  const openTopbarHref = (event: MouseEvent, href: string | null) => {
    if (!href) {
      return;
    }
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", href);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  };
  const topbarAccountMenu =
    topbarAccountEntry && topbarAccountEntry.loggedIn
      ? html`
          <div class="topbar-account">
            <button
              class="btn btn--sm btn--icon topbar-round-btn topbar-account__trigger topbar-account__trigger--user"
              type="button"
              title=${topbarAccountLabel ?? "账号"}
              aria-label=${topbarAccountLabel ?? "账号"}
              aria-haspopup="menu"
            >
              <span class="topbar-account__status" aria-hidden="true"></span>
              <span class="topbar-account__monogram">${topbarAccountMonogram}</span>
            </button>
            <div
              class="topbar-account__menu"
              role="menu"
              aria-label=${topbarAccountLabel ?? "账号"}
            >
              <a
                class="topbar-account__item"
                role="menuitem"
                href=${topbarAccountEntry.settingsHref}
              >
                <strong>${topbarAccountLabel}</strong>
              </a>
              <a
                class="topbar-account__item"
                role="menuitem"
                href=${topbarAccountEntry.settingsHref}
              >
                ${topbarAccountEntry.settingsLabel}
              </a>
              <button
                class="topbar-account__item is-danger"
                type="button"
                role="menuitem"
                @click=${() => void state.logoutPlatformAuth()}
              >
                退出登录
              </button>
            </div>
          </div>
        `
      : topbarAccountEntry
        ? html`
            <div class="topbar-account">
              <button
                class="btn btn--sm btn--icon topbar-round-btn topbar-account__trigger topbar-account__trigger--user"
                type="button"
                title=${topbarAccountLabel ?? topbarAccountEntry.loginLabel}
                aria-label=${topbarAccountLabel ?? topbarAccountEntry.loginLabel}
                aria-haspopup="menu"
              >
                <span class="statusDot warn"></span>
                <span class="topbar-account__monogram">${topbarAccountMonogram}</span>
              </button>
              <div
                class="topbar-account__menu topbar-account__menu--auth"
                role="menu"
                aria-label=${topbarAccountLabel ?? "登录入口"}
              >
                <div class="topbar-account__heading">
                  <strong>${topbarAuthTitle}</strong>
                  <span>${topbarAuthSubtitle}</span>
                </div>
                ${
                  topbarAuthModes.length > 1
                    ? html`
                        <div class="topbar-account__tabs">
                          ${topbarAuthModes.map(
                            (mode) => html`
                              <button
                                class="topbar-account__tab ${topbarAuthMode === mode ? "is-active" : ""}"
                                type="button"
                                @click=${() => {
                                  state.platformAuthMode = mode;
                                  state.platformAuthNotice = null;
                                }}
                              >
                                ${topbarAuthModeLabel(mode)}
                              </button>
                            `,
                          )}
                        </div>
                      `
                    : nothing
                }
                <div class="topbar-account__form">
                  ${
                    topbarAuthMode === "enterprise-activate" ||
                    topbarAuthMode === "platform-bootstrap"
                      ? html`
                          <label class="topbar-account__field">
                            <span>姓名</span>
                            <input
                              class="input"
                              .value=${state.platformAuthDisplayName}
                              @input=${(event: Event) => {
                                state.platformAuthDisplayName = (
                                  event.target as HTMLInputElement
                                ).value;
                                state.platformAuthNotice = null;
                              }}
                            />
                          </label>
                        `
                      : nothing
                  }
                  <label class="topbar-account__field">
                    <span>邮箱</span>
                    <input
                      class="input"
                      type="email"
                      .value=${state.platformAuthEmail}
                      @input=${(event: Event) => {
                        state.platformAuthEmail = (event.target as HTMLInputElement).value;
                        state.platformAuthNotice = null;
                      }}
                    />
                  </label>
                  ${
                    topbarAuthMode === "enterprise-activate"
                      ? html`
                          <label class="topbar-account__field">
                            <span>激活码</span>
                            <input
                              class="input"
                              .value=${state.platformAuthInviteCode}
                              @input=${(event: Event) => {
                                state.platformAuthInviteCode = (
                                  event.target as HTMLInputElement
                                ).value;
                                state.platformAuthNotice = null;
                              }}
                            />
                          </label>
                        `
                      : nothing
                  }
                  <label class="topbar-account__field">
                    <span>密码</span>
                    <input
                      class="input"
                      type="password"
                      .value=${state.platformAuthPassword}
                      @input=${(event: Event) => {
                        state.platformAuthPassword = (event.target as HTMLInputElement).value;
                        state.platformAuthNotice = null;
                      }}
                    />
                  </label>
                </div>
                ${
                  state.platformAuthError
                    ? html`<div class="topbar-account__notice is-danger">
                        ${state.platformAuthError}
                      </div>`
                    : state.platformAuthNotice
                      ? html`<div class="topbar-account__notice is-success">
                          ${state.platformAuthNotice}
                        </div>`
                      : nothing
                }
                <div class="topbar-account__footer">
                  <button
                    class="btn btn--primary btn--sm"
                    type="button"
                    ?disabled=${state.platformAuthBusy || topbarAuthDisabled || !topbarAuthMode}
                    @click=${() => {
                      if (!topbarAuthMode) {
                        return;
                      }
                      state.platformAuthMode = topbarAuthMode;
                      void state.submitPlatformAuth();
                    }}
                  >
                    ${state.platformAuthBusy ? "处理中..." : topbarAuthSubmitLabel(topbarAuthMode)}
                  </button>
                  ${
                    topbarFullLoginHref
                      ? html`
                          <a
                            class="topbar-account__item topbar-account__item--link"
                            href=${topbarFullLoginHref}
                            @click=${(event: MouseEvent) => openTopbarHref(event, topbarFullLoginHref)}
                          >
                            打开完整登录页
                          </a>
                        `
                      : nothing
                  }
                </div>
              </div>
            </div>
          `
        : nothing;
  const enterpriseTenantId = resolveEnterpriseTenantId(enterpriseState);
  const isEnterpriseResolver = isEnterpriseResolverPath(
    typeof window === "undefined"
      ? pathForTab(state.tab, state.basePath)
      : window.location.pathname,
    state.basePath,
  );
  const showThinking = state.onboarding ? false : state.settings.chatShowThinking;
  const assistantAvatarUrl = resolveAssistantAvatarUrl(state);
  const chatAvatarUrl = state.chatAvatarUrl ?? assistantAvatarUrl ?? null;
  const configValue = state.configFormDirty
    ? (state.configForm ?? (state.configSnapshot?.config as Record<string, unknown> | null))
    : ((state.configSnapshot?.config as Record<string, unknown> | null) ?? state.configForm);
  const enterpriseActions = createEnterprisePortActions({
    actionState: enterpriseActionState,
    capabilityState,
  });
  const customBrandLogoSrc = resolveCustomBrandLogoSrc(state.settings);
  const isDaibaiWorkbenchSession = checkDaibaiWorkbenchSession({
    tab: state.tab,
    workbenchPrimaryModule: state.workbenchPrimaryModule,
    workbenchTeamSelectedKey: state.workbenchTeamSelectedKey,
    sessionKey: state.sessionKey,
    hello: state.hello,
  });
  const daibaiAuthUser =
    state.hello?.auth?.user?.trim() ??
    state.platformAuthState?.session?.user?.trim() ??
    state.bootstrapAuthSession?.user?.trim() ??
    null;
  const dismissDaibaiGuide = () => {
    state.applySettings(acknowledgeDaibaiGuideForUser(state.settings, daibaiAuthUser ?? ""));
    state.daibaiLastMessage = null;
    state.daibaiAskResult = null;
    state.daibaiExecuteResult = null;
    state.daibaiError = null;
    state.daibaiActionError = null;
    state.daibaiPendingConfirmation = null;
  };
  const openChatSession = (sessionKey: string) => {
    state.workbenchPrimaryModule = "assistant";
    switchShellChatSession(state, sessionKey, {
      targetTab: "me",
      syncUrl: true,
    });
  };
  const resolveWorkbenchChatError = () => {
    if (!isDaibaiWorkbenchSession) {
      return visibleHostError;
    }
    return state.daibaiError ?? state.daibaiActionError ?? visibleHostError;
  };
  const buildChatSurfaceProps = (focusMode: boolean) => {
    const portState = adaptAppPortState(state);
    const collaborationTargets = buildArtifactCollaborationTargets(state);
    const mentionCandidates = buildCurrentMentionCandidates(state);
    const incubationPreview = resolveArtifactPreviewIncubationView(portState);
    const accountSession = resolveActivePlatformAuthSession(state);
    const computerAccount = resolveAccountComputerAccount({
      tenantId: accountSession?.tenantId,
      employeeUserId: state.platformAuthState?.employeeAccess?.employeeUserId,
    });
    const computerUserLabel = resolveLocalUserDisplayName(state)?.trim() || t("chat.computerYou");
    const chatSessionKey = resolveWorkbenchChatSessionKey({
      selectedKey: state.workbenchTeamSelectedKey,
      sessionKey: state.sessionKey,
    });
    // Read so Lit re-renders when the preview connection updates.
    void state.computerPreviewRevision;
    const computerPreview = readComputerPreviewModel(
      {
        sidebarOpen: state.sidebarOpen,
        sidebarSurface: state.sidebarSurface,
        computerPreviewSize: state.computerPreviewSize,
        computerNarrowChat: state.computerNarrowChat,
        computerPreviewRevision: state.computerPreviewRevision,
        sessionKey: chatSessionKey,
        assistantName: state.assistantName,
      },
      computerAccount,
    );
    return {
      sessionKey: chatSessionKey,
      usageClient: state.client,
      usageRerender: () => state.requestUpdate(),
      onSessionKeyChange: (next: string) => {
        switchShellChatSession(state, next, {
          clearAttachments: true,
          clearQueue: true,
        });
      },
      thinkingLevel: state.chatThinkingLevel,
      showThinking,
      showToolMessages: false,
      showToolCards: false,
      loading: state.chatLoading,
      sending: state.chatSending,
      compactionStatus: state.compactionStatus,
      fallbackStatus: state.fallbackStatus,
      assistantAvatarUrl: chatAvatarUrl,
      messages: resolveVisibleChatMessages(state),
      toolMessages: state.chatToolMessages,
      streamSegments: state.chatStreamSegments,
      stream: state.chatStream,
      streamStartedAt: state.chatStreamStartedAt,
      streamReplyLanguage: state.chatStreamReplyLanguage,
      thinkingNowMs: state.chatSending ? state.chatThinkingNowMs || Date.now() : undefined,
      chatRunId: state.chatRunId,
      chatStreamSessionKey: state.chatStreamSessionKey,
      thinkingProgress: state.chatThinkingProgress,
      workProgressLabel: labelForWorkProgressPhase(state.workProgressPhase),
      workProgressNarration: state.workProgressNarration,
      draft: state.chatMessage,
      quoteDraft: state.chatQuoteDraft,
      onQuoteDraftChange: (next: ChatQuoteDraft | null) => {
        state.chatQuoteDraft = next;
      },
      queue: state.chatQueue,
      connected: state.connected,
      canSend: state.connected,
      disabledReason: chatDisabledReason,
      gatewayConnectionPhase: state.gatewayConnectionPhase,
      onRetryGatewayConnection: () => {
        connectGateway(state as unknown as Parameters<typeof connectGateway>[0]);
      },
      error: resolveWorkbenchChatError(),
      sessions: state.sessionsResult,
      focusMode,
      historyHasMore: Boolean(state.chatHistoryHasMore),
      historyLoadingMore: Boolean(state.chatHistoryLoadingMore),
      onLoadOlderHistory: () => {
        void loadOlderShellChatHistory(state as unknown as ShellChatHistoryReloadState);
      },
      onRefresh: () => {
        resetRuleAdaptationAdvicePanel();
        void refreshShellChat(state as unknown as Parameters<typeof refreshShellChat>[0]);
      },
      onToggleFocusMode: () => {
        if (state.onboarding) {
          return;
        }
        state.applySettings({
          ...state.settings,
          chatFocusMode: !state.settings.chatFocusMode,
        });
      },
      onChatScroll: (event: Event) => state.handleChatScroll(event),
      onDraftChange: (next: string) => (state.chatMessage = next),
      ruleAdaptationAdvice: getRuleAdaptationAdvicePanel(),
      onRequestRuleAdaptationAdvice: () => {
        void requestRuleAdaptationAdvice({
          client: state.client,
          question: state.chatMessage.trim(),
          sessionKey: chatSessionKey,
          agentId: parseAgentSessionKey(state.sessionKey)?.agentId,
        });
      },
      onCancelRuleAdaptationAdvice: () => cancelRuleAdaptationAdvice(),
      contextScope: state.chatContextScope,
      contextSources: state.chatContextSourceCatalog ?? [],
      contextSourcesLoading: Boolean(state.chatContextSourceCatalogLoading),
      onContextScopeChange: (next: ChatContextScopeState) => {
        state.chatContextScope = next;
      },
      onLoadContextSources: () => {
        const client = state.client;
        if (!client || !state.connected || state.chatContextSourceCatalogLoading) {
          return;
        }
        state.chatContextSourceCatalogLoading = true;
        void loadChatContextSourceCatalog((method, params) => client.request(method, params ?? {}))
          .then((sources) => {
            state.chatContextSourceCatalog = sources;
          })
          .catch(() => {
            state.chatContextSourceCatalog = [];
          })
          .finally(() => {
            state.chatContextSourceCatalogLoading = false;
          });
      },
      contextExpansion: state.chatContextExpansion,
      onAcceptContextExpansion: () => {
        const suggestion = state.chatContextExpansion;
        if (!suggestion) {
          return;
        }
        const lastUserText = extractLatestUserText(state.chatMessages);
        state.chatContextScope = applyContextExpansionToScope(
          state.chatContextScope,
          suggestion.proposedSources,
        );
        state.chatContextExpansion = null;
        if (lastUserText) {
          void state.handleSendChat(lastUserText);
        }
      },
      onDismissContextExpansion: () => {
        state.chatContextExpansion = null;
      },
      attachments: state.chatAttachments,
      onAttachmentsChange: (next: typeof state.chatAttachments) => (state.chatAttachments = next),
      onAttachmentAssetResolve: async (query: {
        fileName: string;
        sizeBytes?: number;
        lastModified?: number;
        allowLatestFallback?: boolean;
      }): Promise<ChatAttachment | null> => {
        if (!state.client || !state.connected) {
          return null;
        }
        const result = await state.client.request<{
          asset?: {
            assetId: string;
            versionId: string;
            fileName: string;
            mimeType: string;
            contentHash: string;
            sizeBytes: number;
            lastModified: number;
            content: string;
          } | null;
        }>("attachment.assets.resolve", query);
        const asset = result.asset;
        if (!asset?.content) {
          return null;
        }
        return {
          id: `${asset.assetId}-${asset.versionId}`,
          dataUrl: `data:${asset.mimeType};base64,${asset.content}`,
          mimeType: asset.mimeType,
          fileName: asset.fileName,
          assetId: asset.assetId,
          versionId: asset.versionId,
          contentHash: asset.contentHash,
          sizeBytes: asset.sizeBytes,
          lastModified: asset.lastModified,
          status: "ready" as const,
          progress: 100,
        };
      },
      onAttachmentAssetUpsert: async (attachment: {
        fileName: string;
        mimeType: string;
        dataUrl: string;
        sizeBytes?: number;
        lastModified?: number;
      }): Promise<Partial<ChatAttachment> | null> => {
        if (!state.client || !state.connected) {
          return null;
        }
        const content =
          /^data:[^;]+;base64,([\s\S]+)$/.exec(attachment.dataUrl)?.[1] ?? attachment.dataUrl;
        const result = await state.client.request<{
          status: "created" | "existing" | "new-version";
          asset: {
            assetId: string;
            versionId: string;
            contentHash: string;
            sizeBytes: number;
            lastModified: number;
          };
        }>("attachment.assets.upsert", {
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          content,
          sizeBytes: attachment.sizeBytes,
          lastModified: attachment.lastModified,
        });
        return result.asset ?? null;
      },
      onSend: () => state.handleSendChat(),
      onSubmitChoice: (text: string) => {
        void state.handleSendChat(text);
      },
      onSubmitForm: (text: string, meta: { submissionId: string }) => {
        void state.handleSendChat(text, { idempotencyKey: meta.submissionId });
      },
      oguiDecisions: state.chatOguiDecisions ?? undefined,
      onStewardCallAuthorizationDecision: (action: "同意" | "不同意", authorizationId: string) => {
        void state.handleSendChat(action, {
          suppressOptimisticUserMessage: true,
          stewardCallAuthorizationId: authorizationId,
        });
      },
      onOwnerDecisionUIChange: () => {
        state.requestUpdate();
      },
      onOwnerDecisionLoadRecoveries: () => {
        const client = state.client;
        const groupId =
          extractSpaceIdentity(state.sessionKey) ||
          extractSpaceIdentity(state.workbenchTeamSelectedKey);
        if (!client || !state.connected || !groupId || ownerDecisionRecoveryLoaded.has(groupId)) {
          return;
        }
        ownerDecisionRecoveryLoaded.add(groupId);
        void client
          .request<{
            deliveries?: Array<{
              userFacing: import("./chat/owner-decision-card.ts").OwnerDecisionUserFacing;
              todolistId: string;
              version: number;
              card?: OwnerDecisionCardView;
            }>;
          }>("collaboration.task.listOwnerDecisionDeliveries", { groupId })
          .then((result) => {
            if (noteOwnerDecisionRecoveries(result?.deliveries ?? [])) {
              state.requestUpdate();
            }
          })
          .catch(() => {
            ownerDecisionRecoveryLoaded.delete(groupId);
          });
      },
      onOwnerDecisionHydrateStatuses: (targets: OwnerDecisionHydrationTarget[]) => {
        const client = state.client;
        if (!client || !state.connected || targets.length === 0) {
          return;
        }
        void (async () => {
          let changed = false;
          for (const target of targets) {
            markOwnerDecisionHydrationAttempted(target.todolistId);
            try {
              const result = await client.request<{
                todolist?: { status?: string; todolistId?: string; version?: number };
                cardDelivery?: {
                  userFacing?: import("./chat/owner-decision-card.ts").OwnerDecisionUserFacing;
                  version?: number;
                  card?: OwnerDecisionCardView;
                  todolistId?: string;
                };
              }>("collaboration.task.getTodolist", {
                groupId: target.groupId,
                taskId: target.taskId,
                todolistId: target.todolistId,
              });
              const status = result?.todolist?.status;
              if (typeof status === "string" && status.trim()) {
                setOwnerDecisionTodolistStatus(target.todolistId, status);
                changed = true;
              }
              const liveVersion = result?.todolist?.version;
              if (
                typeof target.version === "number" &&
                typeof liveVersion === "number" &&
                liveVersion !== target.version
              ) {
                noteOwnerDecisionVersionRefusal(target.decisionId);
                changed = true;
              }
              const facing = result?.cardDelivery?.userFacing;
              if (facing) {
                noteOwnerDecisionDelivery(
                  target.todolistId,
                  facing,
                  result?.cardDelivery?.version ?? result?.todolist?.version,
                );
                changed = true;
              }
            } catch {
              // Ignore hydrate failures — confirm/revise still teach status via gate errors.
            }
          }
          if (changed) {
            state.requestUpdate();
          }
        })();
      },
      onOwnerDecisionRetry: (card: OwnerDecisionCardView) => {
        void (async () => {
          const client = state.client;
          if (!client || !state.connected) {
            setOwnerDecisionActionError(
              card.decisionId,
              "未连接网关，无法重试确认请求。提案仍在，连接后可重试。",
            );
            state.requestUpdate();
            return;
          }
          try {
            const retried = await client.request<{
              todolist?: { status?: string; version?: number; todolistId?: string };
              cardDelivery?: {
                userFacing?: import("./chat/owner-decision-card.ts").OwnerDecisionUserFacing;
                version?: number;
                ok?: boolean;
                retryable?: boolean;
              };
            }>("collaboration.task.retryOwnerDecisionDelivery", {
              groupId: card.groupId,
              taskId: card.taskId,
              todolistId: card.todolistId,
              ...(typeof card.version === "number" ? { expectedVersion: card.version } : {}),
            });
            const facing = retried?.cardDelivery?.userFacing;
            if (facing) {
              noteOwnerDecisionDelivery(
                card.todolistId,
                facing,
                retried?.cardDelivery?.version ?? card.version,
              );
            }
            const status = retried?.todolist?.status;
            if (typeof status === "string" && status.trim()) {
              setOwnerDecisionTodolistStatus(card.todolistId, status);
            }
            clearOwnerDecisionActionError(card.decisionId);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setOwnerDecisionActionError(card.decisionId, message);
            state.requestUpdate();
            return;
          }
          try {
            await refreshShellChat(state as unknown as Parameters<typeof refreshShellChat>[0]);
          } catch {
            // history reload is best-effort; the delivery record remains
          }
          state.requestUpdate();
        })();
      },
      onOwnerDecision: (
        action: OwnerDecisionAction,
        card: OwnerDecisionCardView,
        detail?: OwnerDecisionDetail,
      ) => {
        void (async () => {
          if (action === "later") {
            clearOwnerDecisionActionError(card.decisionId);
            dismissOwnerDecisionCard(card.decisionId);
            state.requestUpdate();
            return;
          }
          const client = state.client;
          if (!client || !state.connected) {
            const message = "未连接网关，无法确认计划。请登录后重试。";
            setOwnerDecisionActionError(card.decisionId, message);
            state.requestUpdate();
            return;
          }
          try {
            if (action === "confirm") {
              const result = await client.request("collaboration.task.confirmTodolist", {
                groupId: card.groupId,
                taskId: card.taskId,
                todolistId: card.todolistId,
                ...(typeof card.version === "number" ? { expectedVersion: card.version } : {}),
              });
              setOwnerDecisionTodolistStatus(card.todolistId, "confirmed");
              // Authoritative human confirm → consumed so history can emit compact
              // 「执行计划已确认」even while the dialog is dismissed/folded.
              noteOwnerDecisionDelivery(
                card.todolistId,
                "consumed",
                typeof card.version === "number" ? card.version : undefined,
              );
              clearOwnerDecisionActionError(card.decisionId);
              // Confirm committed (never roll back). Fold sticky/todo/dialog away;
              // history receipt stays (dismiss ≠ wipe confirmed/consumed). Peer
              // residuals elsewhere render as「收到，并确认」. Advance failure separate.
              collapseOwnerDecisionCardsForBoardItem(card.boardItemId);
              dismissOwnerDecisionCard(card.decisionId);
              const advance = (
                result as {
                  autoAdvance?: {
                    wakeRecorded?: boolean;
                    wakeConsumed?: boolean;
                    dispatched?: boolean;
                    reason?: string;
                  };
                } | null
              )?.autoAdvance;
              // Confirm committed (never roll back). Surface queue / blocked / dispatch
              // failures even when wakeRecorded===true — not only wakeRecorded===false.
              state.lastError = formatPostPlanConfirmAdvanceUserMessage(advance);
            } else if (action === "revise") {
              const reason = detail?.reason?.trim() || "退回修订（来自对话决策卡）";
              await client.request("collaboration.task.reviseTodolist", {
                groupId: card.groupId,
                taskId: card.taskId,
                todolistId: card.todolistId,
                reason,
                ...(typeof card.version === "number" ? { expectedVersion: card.version } : {}),
              });
              setOwnerDecisionTodolistStatus(card.todolistId, "revise_requested");
              clearOwnerDecisionActionError(card.decisionId);
              collapseOwnerDecisionCardsForBoardItem(card.boardItemId);
              dismissOwnerDecisionCard(card.decisionId);
              state.lastError = null;
            } else {
              return;
            }
          } catch (err) {
            // Do not refresh on failure: reloadShellChatHistory clears lastError,
            // which made confirm/revise look like no-ops when ACL/RPC failed.
            // Keep the error on the card only — avoid a second shell lastError banner.
            const message = err instanceof Error ? err.message : String(err);
            setOwnerDecisionActionError(card.decisionId, message);
            state.requestUpdate();
            return;
          }
          try {
            await refreshShellChat(state as unknown as Parameters<typeof refreshShellChat>[0]);
          } catch {
            // ignore refresh failures
          }
          state.requestUpdate();
        })();
      },
      onHumanAttentionAct: (
        action: HumanAttentionAction,
        card: HumanAttentionCardView,
        detail?: HumanAttentionActDetail,
      ) => {
        void (async () => {
          const client = state.client;
          if (!client || !state.connected) {
            state.lastError = "未连接网关，无法处理人工接管卡片。请登录后重试。";
            state.requestUpdate();
            return;
          }
          try {
            const result = await client.request<{
              todo?: { status?: string };
              evidence?: Record<string, unknown>;
              heartbeatCleared?: boolean;
            }>("collaboration.task.actHumanAttention", {
              todoId: card.todoId,
              action,
              expectedVersion: card.version,
              expectedFingerprint: card.fingerprint,
              ...(detail?.transferOwnerId ? { transferOwnerId: detail.transferOwnerId } : {}),
              ...(detail?.note ? { note: detail.note } : {}),
            });
            if (
              result?.evidence &&
              (action === "view_evidence" ||
                action === "view_failure_reason" ||
                action === "view_artifact")
            ) {
              state.lastError = null;
              // Surface evidence in a simple dialog for operators.
              const body = JSON.stringify(result.evidence, null, 2);
              if (typeof window !== "undefined") {
                window.alert(body.slice(0, 4000));
              }
            } else {
              state.lastError = null;
            }
            try {
              await refreshShellChat(state as unknown as Parameters<typeof refreshShellChat>[0]);
            } catch {
              // ignore
            }
          } catch (err) {
            state.lastError = err instanceof Error ? err.message : String(err);
          }
          state.requestUpdate();
        })();
      },
      canAbort: Boolean(state.chatRunId),
      canUndo: Boolean(state.chatRunId),
      onAbort: () => void state.handleAbortChat(),
      onUndo: () => void state.handleSendChat("/undo"),
      checkpoints: state.chatCheckpoints,
      pendingRestoreCheckpointId: state.pendingRestoreCheckpointId,
      restoreInFlightCheckpointId: state.restoreInFlightCheckpointId,
      onRequestRestoreCheckpoint: (checkpointId: string) =>
        state.requestRestoreCheckpoint(checkpointId),
      onCancelRestoreCheckpoint: () => state.cancelRestoreCheckpoint(),
      onConfirmRestoreCheckpoint: (checkpointId: string) =>
        void state.confirmRestoreCheckpoint(checkpointId),
      onQueueRemove: (id: string) => state.removeQueuedMessage(id),
      onRejectTaskOutcome: async (ref: TaskOutcomeRejectRef) => {
        const client = state.client;
        if (!client) {
          const result = { ok: false as const, code: "unauthorized" };
          state.taskOutcomeRejectNotice = {
            key: `${ref.taskId}:${ref.outcomeVersion}`,
            text: formatRejectNotice(result),
          };
          state.requestUpdate();
          return result;
        }
        try {
          const payload = await client.request("task.outcome.rejectResult", {
            taskId: ref.taskId,
            agentId: ref.agentId,
            outcomeVersion: ref.outcomeVersion,
          });
          const result = rejectNoticeFromPayload(payload);
          state.taskOutcomeRejectNotice = {
            key: `${ref.taskId}:${ref.outcomeVersion}`,
            text: formatRejectNotice(result),
          };
          state.requestUpdate();
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const result = {
            ok: false as const,
            code: message.includes("missing scope") ? "forbidden" : "unauthorized",
          };
          state.taskOutcomeRejectNotice = {
            key: `${ref.taskId}:${ref.outcomeVersion}`,
            text: formatRejectNotice(result),
          };
          state.requestUpdate();
          return result;
        }
      },
      taskOutcomeRejectNotice: state.taskOutcomeRejectNotice,
      onNewSession: () => state.handleSendChat("/new", { restoreDraft: true }),
      showNewMessages: state.chatNewMessagesBelow && !state.chatManualRefreshInFlight,
      onScrollToBottom: () => state.scrollToBottom(),
      sidebarOpen: state.sidebarOpen,
      sidebarPreviewMode: state.sidebarPreviewMode,
      computerPreview,
      onComputerSelectSurface: (surface: "artifact" | "computer") => {
        selectComputerSurface(state, surface);
        // The computer tab opens a cold desktop. Resizing must not mint a stream.
        // Default AI control: selecting 电脑 alone does not takeControl; only
        // explicit 接管 / auth handoff (NeedsInputClaim) remints an input grant.
        if (
          surface === "computer" &&
          (computerPreviewNeedsOpen(computerPreview) ||
            computerPreviewNeedsInputClaim(state, {
              formLocked: Boolean(state.secureFormOffered),
              authHandoffActive: Boolean(
                state.secureFormHandoff && state.secureFormHandoff.sessionKey === chatSessionKey,
              ),
            }))
        ) {
          void state.refreshAccountComputerPreview?.("open");
        }
      },
      onComputerSetSize: (size: "docked" | "expanded" | "fullscreen") => {
        setComputerPreviewSize(state, size);
      },
      onComputerTakeover: () => {
        // Decision C: gateway takeControl cancels pending forms; clear the card locally.
        if (state.secureFormOffered) {
          state.secureFormValues = {};
          state.secureFormOffered = null;
          state.secureFormError = null;
        }
        takeoverComputerPreview(state, computerUserLabel, { sessionKey: chatSessionKey });
        void state.refreshAccountComputerPreview?.("open");
      },
      onComputerHandBack: () => {
        handBackComputerPreview(state);
        void state.refreshAccountComputerPreview?.("open");
      },
      onComputerReconnectStream: (reason?: "network" | "stream" | "credential") => {
        reconnectComputerDesktopSession(state, reason);
      },
      onComputerStreamCredentialInvalid: () => {
        rotateComputerPreviewStreamCredential(state);
      },
      onComputerEnd: () => {
        if (state.secureFormOffered) {
          state.secureFormValues = {};
          state.secureFormOffered = null;
          state.secureFormError = null;
        }
        void state.refreshAccountComputerPreview?.("end");
      },
      onComputerOpen: () => {
        state.sidebarOpen = true;
        state.sidebarSurface = "computer";
        void state.refreshAccountComputerPreview?.("open");
      },
      onComputerNarrowReturn: () => {
        returnComputerToChat(state);
      },
      onComputerChip: () => {
        selectComputerChip(state);
        if (computerPreviewNeedsOpen(computerPreview)) {
          void state.refreshAccountComputerPreview?.("open");
        }
      },
      sidebarContent: state.sidebarContent,
      sidebarError: state.sidebarError,
      artifactWorkspace: state.sidebarArtifactWorkspace,
      deliverableSaveState: state.sidebarDeliverableSaveState,
      deliverableSaveToast: state.sidebarDeliverableSaveToast,
      collaborationTargets,
      splitRatio: state.splitRatio,
      onOpenSidebar: (content: string) => state.handleOpenSidebar(content),
      onOpenArtifact: (artifactId: string) => state.handleOpenArtifact(artifactId),
      unavailableArtifactIds: state.artifactPreviewMissIds,
      onCloseSidebar: () => state.handleCloseSidebar(),
      onSplitRatioChange: (ratio: number) => state.handleSplitRatioChange(ratio),
      onSaveDeliverable: state.connected
        ? (mode?: "save_as") => void state.handleSaveSidebarDeliverable(mode)
        : undefined,
      onConfirmDeliverableOverwrite: () => state.handleConfirmDeliverableOverwrite(),
      onConfirmDeliverableSaveAs: () => state.handleConfirmDeliverableSaveAs(),
      onCancelDeliverableSaveDecision: () => state.handleCancelDeliverableSaveDecision(),
      onDeliverableSaveAsFilenameChange: (filename: string) =>
        state.handleDeliverableSaveAsFilenameChange(filename),
      onDeliverableInlineEditApplied: (content: string) =>
        state.handleDeliverableInlineEditApplied(content),
      assetIncubationLevel: incubationPreview.level,
      assetIncubationReason: incubationPreview.reason,
      showWeakAssetIncubationHint: incubationPreview.showWeakHint,
      showSystemAssetIncubationHint: incubationPreview.showSystemSuggest,
      showEnterpriseSubmitFromIncubation: incubationPreview.showEnterpriseSubmitAction,
      onOpenSkillSaveFromPreview: state.connected
        ? (preferEnterprise?: boolean) =>
            openSkillSaveFromPreview(portState, Boolean(preferEnterprise), () =>
              portState.requestUpdate(),
            )
        : undefined,
      onDismissAssetIncubationFromPreview: () =>
        dismissAssetIncubationFromPreview(portState, () => portState.requestUpdate()),
      onGrantArtifactToTarget: state.connected
        ? (artifactId: string, targetSessionKey?: string) =>
            shareArtifactToCollaborationTarget(
              state,
              artifactId,
              targetSessionKey,
              collaborationTargets,
            )
        : undefined,
      assistantName: state.assistantName,
      assistantAvatar: state.assistantAvatar,
      assistantAgentId: state.assistantAgentId,
      participantAgents: state.agentsList?.agents ?? [],
      localUserDisplayName: resolveLocalUserDisplayName(state),
      mentionCandidates,
      onOpenCronTaskDetail: (jobId: string) => {
        const bundle = employeeBundle ?? resolveEmployeeWorkbenchBundle();
        if (bundle) {
          bundle.openEmployeeCronTaskDetail(state, jobId);
        }
      },
      onOpenCronTaskResult: (message: unknown) => {
        const artifact = resolveCronResultArtifactRecord(message);
        const artifactId =
          artifact && typeof artifact.artifactId === "string" ? artifact.artifactId : null;
        if (artifactId) {
          state.handleOpenArtifact(artifactId);
        }
      },
      conversationTaskProgressEntries: getConversationTaskProgressEntries(),
      focusSwitchGate: state.chatFocusSwitchGate,
      onFocusSwitchKeepCurrent: () => {
        dismissFocusSwitchGate(state);
      },
      onFocusSwitchParkAndStart: () => {
        authorizeFocusSwitchProceed(state);
        void state.handleSendChat(undefined, {
          focusSwitchProceed: true,
          suppressOptimisticUserMessage: true,
        });
      },
      onFocusSwitchCancelAndStart: () => {
        authorizeFocusSwitchCancel(state);
        void state.handleSendChat(undefined, {
          focusSwitchCancel: true,
          suppressOptimisticUserMessage: true,
        });
      },
      loginMethodChoice:
        state.loginMethodChoice?.sessionKey === state.sessionKey ? state.loginMethodChoice : null,
      loginSaveOffer:
        state.loginSaveOffer?.sessionKey === state.sessionKey ? state.loginSaveOffer : null,
      loginCardBusy: state.loginCardBusy,
      loginCardError: state.loginCardError,
      onLoginMethodChoose: (choiceId: string, method: "password" | "qr") =>
        void state.handleAccountComputerLoginChoose(choiceId, method),
      onLoginSaveDecision: (saveId: string, save: boolean) =>
        void state.handleAccountComputerLoginSave(saveId, save),
      secureFormOffered:
        state.secureFormOffered?.sessionKey === state.sessionKey ? state.secureFormOffered : null,
      secureFormHandoff:
        state.secureFormHandoff?.sessionKey === state.sessionKey ? state.secureFormHandoff : null,
      secureFormReceipt: state.secureFormReceipt,
      secureFormValues: state.secureFormValues,
      secureFormBusy: state.secureFormBusy,
      secureFormError: state.secureFormError,
      onSecureFormFieldInput: (fieldId: string, value: string) =>
        state.handleSecureFormFieldInput(fieldId, value),
      onSecureFormSubmit: () => void state.handleSecureFormSubmit(),
      onSecureFormClose: () => void state.handleSecureFormClose(),
      onSecureFormUseComputer: () => void state.handleSecureFormUseComputer(),
      onSecureFormHandoffReturn: () => void state.handleSecureFormHandoffReturn(),
      onSecureFormHandoffDismiss: () => state.handleSecureFormHandoffDismiss(),
    };
  };
  const needsEmployeeWorkbenchChrome = isWorkspaceHome || activePort === "employee";
  const workbenchThreadPrelude = !needsEmployeeWorkbenchChrome
    ? null
    : !employeeBundle
      ? null
      : isDaibaiWorkbenchSession
        ? employeeBundle.renderDaibaiThreadPrelude(
            {
              daibaiLoading: state.daibaiLoading,
              daibaiAskResult: state.daibaiAskResult,
              daibaiExecuteResult: state.daibaiExecuteResult,
              daibaiActionLoading: state.daibaiActionLoading,
              daibaiActionPendingId: state.daibaiActionPendingId,
              daibaiActionError: state.daibaiActionError,
              daibaiPendingConfirmation: state.daibaiPendingConfirmation,
              meetingPendingConfirmation: state.meetingPendingConfirmation,
              meetingConfirmationLoading: state.meetingConfirmationLoading,
              meetingConfirmationError: state.meetingConfirmationError,
              meetingConfirmationOldCardInvalid: state.meetingConfirmationOldCardInvalid,
              meetingConfirmRelease: state.meetingConfirmRelease,
              onAskDaibai: (message?: string) =>
                message ? state.handleSendChat(message) : state.handleSendChat(),
              onExecuteDaibaiAction: (actionId, payload) =>
                state.executeDaibaiAction(actionId, payload),
              onConfirmDaibaiPendingAction: () => state.confirmDaibaiPendingAction(),
              onCancelDaibaiPendingConfirmation: () => state.cancelDaibaiPendingConfirmation(),
              onConfirmMeetingPendingApproval: () => state.confirmMeetingPendingApproval(),
              onCancelMeetingPendingConfirmation: () => state.cancelMeetingPendingConfirmation(),
              onDismissMeetingConfirmRelease: () => state.dismissMeetingConfirmRelease(),
              onOpenDaibaiHelp: (params) => state.openDaibaiHelpFromModule(params),
            },
            {
              guideAcknowledged: isDaibaiGuideAcknowledgedForUser(state.settings, daibaiAuthUser),
              guidanceUserId: daibaiAuthUser,
              onDismissGuide: dismissDaibaiGuide,
              onGuidanceControlChange: () => state.requestUpdate(),
              onCreateDaibaiTeam: (members) => createDaibaiTeamMembers(state, members),
              onOpenAgentCreator: () => {
                const clickSidebarAssistantAdd = (): boolean => {
                  const button = document.querySelector<HTMLButtonElement>(
                    'button.employee-workbench__group-add[aria-label="add AI 助手"]',
                  );
                  if (!button) {
                    return false;
                  }
                  button.click();
                  return true;
                };
                const openCreatorSheetDirectly = () => {
                  // Same drawer the sidebar AI 助手 + opens when the control is not mounted.
                  state.workbenchAgentCreatorName = "";
                  state.workbenchAgentCreatorEmoji = "";
                  state.workbenchAgentCreatorStep = "intent";
                  state.workbenchAgentCreatorRoleSource = "ai";
                  state.workbenchAgentCreatorBusy = false;
                  state.workbenchAgentCreatorError = null;
                  state.workbenchSpaceCreatorOpen = false;
                  state.workbenchAgentCreatorOpen = true;
                  state.requestUpdate();
                };
                if (state.settings.navCollapsed) {
                  state.applySettings({
                    ...state.settings,
                    navCollapsed: false,
                  });
                }
                if (clickSidebarAssistantAdd()) {
                  return;
                }
                window.setTimeout(() => {
                  if (!clickSidebarAssistantAdd()) {
                    openCreatorSheetDirectly();
                  }
                }, 0);
              },
              onOpenMyRobotsSetup: () => {
                // Same destination as 系统设置 → 我的机器人 (not 个人设置).
                state.workbenchPrimaryModule = "settings";
                state.workbenchSettingsView = "system";
                state.workbenchSystemSettingsTab = "robots";
                state.workbenchGroupProfileView = "chat";
              },
              onApplyCapabilityGap: (
                cta: DaibaiGapCtaKind,
                _item?: unknown,
                _member?: unknown,
                deeplink?: DaibaiGapApplyDeeplink,
              ) => {
                const port = adaptAppPortState(state);
                const tenantId =
                  state.platformAuthState?.session?.tenantId?.trim() ||
                  state.bootstrapAuthSession?.tenantId?.trim() ||
                  state.hello?.auth?.tenantId?.trim() ||
                  "";
                switch (cta) {
                  case "oauth_authorize":
                    openPersonalOperationalIdentitySection(
                      port,
                      { authorizationIdentityTab: "personal", openEditor: false },
                      () => state.requestUpdate?.(),
                    );
                    break;
                  case "apply_personal_oi":
                  case "apply_enterprise_oi": {
                    // Secondary path only. Primary submit is onSubmitOiEnrollment.
                    const rawAgentId =
                      _member &&
                      typeof _member === "object" &&
                      "agentId" in _member &&
                      typeof _member.agentId === "string"
                        ? _member.agentId.trim()
                        : "";
                    openPersonalOperationalIdentitySection(
                      port,
                      {
                        authorizationIdentityTab:
                          cta === "apply_enterprise_oi" ? "enterprise" : "personal",
                        openEditor: false,
                        ...(rawAgentId ? { agentId: rawAgentId } : {}),
                      },
                      () => state.requestUpdate?.(),
                    );
                    break;
                  }
                  case "bind_knowledge":
                    state.workbenchPrimaryModule = "knowledge";
                    state.requestUpdate?.();
                    break;
                  case "mcp_admin_save":
                  case "mcp_scan_apply": {
                    // mcp_scan_apply here is the secondary EDC path only.
                    // Primary submit uses onSubmitMcpScanApproval (governance-approvals.create).
                    const edc =
                      cta === "mcp_scan_apply" && deeplink?.edc === "authorization"
                        ? "authorization"
                        : "capabilities";
                    const baseHref = `${pathForTab(
                      "enterpriseDataGovernanceCenter",
                      state.basePath,
                      {
                        tenantId: tenantId || null,
                      },
                    )}?edc=${edc}`;
                    const href =
                      cta === "mcp_scan_apply" && deeplink?.mcpServer
                        ? appendMcpDiscoveryContext(baseHref, {
                            mcpServer: deeplink.mcpServer,
                            mcpTool: deeplink.mcpTool,
                            capabilityId: deeplink.capabilityId,
                            requestId: deeplink.approvalId,
                          })
                        : baseHref;
                    if (typeof window !== "undefined") {
                      window.history.pushState({}, "", href);
                      window.dispatchEvent(new PopStateEvent("popstate"));
                    }
                    break;
                  }
                  case "contact_admin_seat":
                    // Informational only — no silent entitlement grant.
                    state.workbenchPrimaryModule = "settings";
                    state.workbenchSettingsView = "personal";
                    state.workbenchPersonalSettingsTab = "account";
                    state.requestUpdate?.();
                    break;
                  default:
                    break;
                }
              },
              onRequestMcpDiscovery: async (request) => {
                const client = state.client;
                if (!client) {
                  throw new Error("未连接网关，无法扫描企业 MCP");
                }
                const tenantId =
                  state.platformAuthState?.session?.tenantId?.trim() ||
                  state.bootstrapAuthSession?.tenantId?.trim() ||
                  state.hello?.auth?.tenantId?.trim() ||
                  "";
                // Seat comes from the session. Do not send seatId / employeeId.
                // catalogId / templateId ask the server to prefilter with the shared hints.
                return client.request("enterprise-data.mcp-discovery.for-seat", {
                  ...(tenantId ? { tenantId } : {}),
                  ...(request?.catalogId ? { catalogId: request.catalogId } : {}),
                  ...(request?.templateId ? { templateId: request.templateId } : {}),
                });
              },
              onSubmitMcpScanApproval: async (input) => {
                const client = state.client;
                if (!client) {
                  throw new Error("未连接网关，无法提交审批");
                }
                const tenantId =
                  state.platformAuthState?.session?.tenantId?.trim() ||
                  state.bootstrapAuthSession?.tenantId?.trim() ||
                  state.hello?.auth?.tenantId?.trim() ||
                  "";
                // Employee create only — never mcp-mapping.upsert / grants.upsert here.
                const result = await client.request<{
                  request?: { approvalId?: string };
                }>("enterprise-data.governance-approvals.create", {
                  ...(tenantId ? { tenantId } : {}),
                  category: "mcp_tool_mapping",
                  mcpServer: input.mcpServer,
                  mcpTool: input.mcpTool,
                  discoveryStatusSnapshot: input.discoveryStatusSnapshot,
                  catalogId: input.catalogId,
                  templateId: input.templateId,
                  clientRequestId: input.clientRequestId,
                  ...(input.reason ? { reason: input.reason } : {}),
                });
                const approvalId =
                  typeof result?.request?.approvalId === "string"
                    ? result.request.approvalId.trim()
                    : "";
                if (!approvalId) {
                  throw new Error("提交成功但未返回申请号");
                }
                return { approvalId };
              },
              oiIdentityContext: {
                personalIdentities: state.userOperationalIdentities?.identities ?? null,
                personalGrants: state.userOperationalIdentities?.grants ?? null,
                enterpriseIdentitiesByAgent:
                  state.userOperationalIdentities?.enterpriseAccessByAgent ?? null,
                enterpriseSeatIdentities:
                  state.userOperationalIdentities?.enterpriseSeatIdentities ?? null,
              },
              onSubmitOiEnrollment: async (input) => {
                const client = state.client;
                if (!client) {
                  throw new Error("未连接网关，无法提交审批");
                }
                const tenantId =
                  state.platformAuthState?.session?.tenantId?.trim() ||
                  state.bootstrapAuthSession?.tenantId?.trim() ||
                  state.hello?.auth?.tenantId?.trim() ||
                  "";
                const built = buildDaibaiOiEnrollmentCreateParams({
                  ...input,
                  tenantId,
                });
                if (!built.ok) {
                  throw new Error(built.message);
                }
                // Employee create only. Does not open an identity or write a grant.
                const result = await client.request<{
                  request?: { approvalId?: string };
                }>("enterprise-data.governance-approvals.create", built.params);
                const approvalId =
                  typeof result?.request?.approvalId === "string"
                    ? result.request.approvalId.trim()
                    : "";
                if (!approvalId) {
                  throw new Error("提交成功但未返回申请号");
                }
                return { approvalId };
              },
              onListMyApplications: async () => {
                const client = state.client;
                if (!client) {
                  throw new Error("未连接网关，无法读取我的申请");
                }
                const tenantId =
                  state.platformAuthState?.session?.tenantId?.trim() ||
                  state.bootstrapAuthSession?.tenantId?.trim() ||
                  state.hello?.auth?.tenantId?.trim() ||
                  "";
                // Read-only list. Non-admin is forced to requestedBy=self in the gateway.
                return client.request(
                  "enterprise-data.governance-approvals.list",
                  tenantId ? { tenantId } : {},
                );
              },
              onCancelMyApplication: async (approvalId: string) => {
                const client = state.client;
                if (!client) {
                  throw new Error("未连接网关，无法撤回申请");
                }
                const tenantId =
                  state.platformAuthState?.session?.tenantId?.trim() ||
                  state.bootstrapAuthSession?.tenantId?.trim() ||
                  state.hello?.auth?.tenantId?.trim() ||
                  "";
                await client.request("enterprise-data.governance-approvals.cancel", {
                  ...(tenantId ? { tenantId } : {}),
                  approvalId,
                });
              },
              showStewardFooter: true,
            },
          )
        : employeeBundle.renderWorkbenchGrowthThreadPrelude(state);
  // Meeting/org-notice steward confirm sits under the transcript (epilogue), not in the top-pinned prelude.
  const meetingThreadEpilogue =
    needsEmployeeWorkbenchChrome && employeeBundle && isDaibaiWorkbenchSession
      ? employeeBundle.renderMeetingConfirmationCard({
          meetingPendingConfirmation: state.meetingPendingConfirmation,
          meetingConfirmationLoading: state.meetingConfirmationLoading,
          meetingConfirmationError: state.meetingConfirmationError,
          meetingConfirmationOldCardInvalid: state.meetingConfirmationOldCardInvalid,
          meetingConfirmRelease: state.meetingConfirmRelease,
          onConfirmMeetingPendingApproval: () => state.confirmMeetingPendingApproval(),
          onCancelMeetingPendingConfirmation: () => state.cancelMeetingPendingConfirmation(),
          onDismissMeetingConfirmRelease: () => state.dismissMeetingConfirmRelease(),
        })
      : null;
  // Local Mac exec approval is part of the dialogue the user is already in.
  const localExecThreadEpilogue =
    needsEmployeeWorkbenchChrome && employeeBundle
      ? renderLocalExecPermissionInline(state)
      : nothing;
  const localFileThreadEpilogue =
    needsEmployeeWorkbenchChrome && employeeBundle ? renderLocalFileApprovalInline(state) : nothing;
  const workbenchThreadEpilogue =
    meetingThreadEpilogue ||
    localExecThreadEpilogue !== nothing ||
    localFileThreadEpilogue !== nothing
      ? html`${meetingThreadEpilogue ?? nothing}${localExecThreadEpilogue}${localFileThreadEpilogue}`
      : null;
  const workbenchChatProps =
    needsEmployeeWorkbenchChrome && employeeBundle
      ? {
          ...buildChatSurfaceProps(false),
          renderMode: "workbench-compact" as const,
          threadPrelude: normalizeThreadPrelude(workbenchThreadPrelude),
          threadEpilogue: normalizeThreadPrelude(workbenchThreadEpilogue),
        }
      : null;
  const workbenchComposer = workbenchChatProps ? renderChatCompose(workbenchChatProps) : nothing;
  const workbenchChat = workbenchChatProps
    ? renderChatContent(workbenchChatProps, workbenchComposer)
    : nothing;
  const useBootstrapAuth = isCurrentControlUiGatewayTarget({
    gatewayUrl: state.settings.gatewayUrl,
  });
  const activePlatformSession = resolveActivePlatformSession(state);
  const workspaceHomepageState = resolveWorkspaceHomepageState({
    state,
    activePlatformSession,
    useBootstrapAuth,
  });
  const workbenchAuthPanel = workspaceHomepageState
    ? (() => {
        const panel = renderPlatformAuthPanel({
          basePath,
          state: workspaceHomepageState,
          session: activePlatformSession,
          mode: state.platformAuthMode,
          busy: state.platformAuthBusy,
          error: state.platformAuthError,
          notice: state.platformAuthNotice,
          email: state.platformAuthEmail,
          password: state.platformAuthPassword,
          displayName: state.platformAuthDisplayName,
          platformAdminDisplayName: state.platformAuthPlatformAdminDisplayName,
          tenantName: state.platformAuthTenantName,
          seatTitle: state.platformAuthSeatTitle,
          inviteCode: state.platformAuthInviteCode,
          currentPassword: state.platformAuthCurrentPassword,
          newPassword: state.platformAuthNewPassword,
          policyTrialDays: state.platformAuthPolicyTrialDays,
          policySeatCount: state.platformAuthPolicySeatCount,
          policyUpgradeUrl: state.platformAuthPolicyUpgradeUrl,
          policyContactAdvisorUrl: state.platformAuthPolicyContactAdvisorUrl,
          instanceEnterpriseId: state.platformAuthInstanceEnterpriseId,
          instanceTrialDays: state.platformAuthInstanceTrialDays,
          instanceSeatCount: state.platformAuthInstanceSeatCount,
          instanceUpgradeUrl: state.platformAuthInstanceUpgradeUrl,
          instanceContactAdvisorUrl: state.platformAuthInstanceContactAdvisorUrl,
          platformAdminEmail: state.platformAuthPlatformAdminEmail,
          platformAdminPassword: state.platformAuthPlatformAdminPassword,
          platformAdminScopes: state.platformAuthPlatformAdminScopes,
          compact: true,
          onModeChange: (next) => {
            state.platformAuthMode = next;
            state.platformAuthNotice = null;
          },
          onEmailChange: (next) => {
            state.platformAuthEmail = next;
            state.platformAuthNotice = null;
          },
          onPasswordChange: (next) => {
            state.platformAuthPassword = next;
            state.platformAuthNotice = null;
          },
          onDisplayNameChange: (next) => {
            state.platformAuthDisplayName = next;
            state.platformAuthNotice = null;
          },
          onPlatformAdminDisplayNameChange: (next) => {
            state.platformAuthPlatformAdminDisplayName = next;
            state.platformAuthNotice = null;
          },
          onTenantNameChange: (next) => {
            state.platformAuthTenantName = next;
            state.platformAuthNotice = null;
          },
          onSeatTitleChange: (next) => {
            state.platformAuthSeatTitle = next;
            state.platformAuthNotice = null;
          },
          onInviteCodeChange: (next) => {
            state.platformAuthInviteCode = next;
            state.platformAuthNotice = null;
          },
          onCurrentPasswordChange: (next) => {
            state.platformAuthCurrentPassword = next;
            state.platformAuthNotice = null;
          },
          onNewPasswordChange: (next) => {
            state.platformAuthNewPassword = next;
            state.platformAuthNotice = null;
          },
          onPolicyTrialDaysChange: (next) => {
            state.platformAuthPolicyTrialDays = next;
            state.platformAuthNotice = null;
          },
          onPolicySeatCountChange: (next) => {
            state.platformAuthPolicySeatCount = next;
            state.platformAuthNotice = null;
          },
          onPolicyUpgradeUrlChange: (next) => {
            state.platformAuthPolicyUpgradeUrl = next;
            state.platformAuthNotice = null;
          },
          onPolicyContactAdvisorUrlChange: (next) => {
            state.platformAuthPolicyContactAdvisorUrl = next;
            state.platformAuthNotice = null;
          },
          onInstanceEnterpriseIdChange: (next) => {
            state.platformAuthInstanceEnterpriseId = next;
            state.platformAuthNotice = null;
          },
          onInstanceTrialDaysChange: (next) => {
            state.platformAuthInstanceTrialDays = next;
            state.platformAuthNotice = null;
          },
          onInstanceSeatCountChange: (next) => {
            state.platformAuthInstanceSeatCount = next;
            state.platformAuthNotice = null;
          },
          onInstanceUpgradeUrlChange: (next) => {
            state.platformAuthInstanceUpgradeUrl = next;
            state.platformAuthNotice = null;
          },
          onInstanceContactAdvisorUrlChange: (next) => {
            state.platformAuthInstanceContactAdvisorUrl = next;
            state.platformAuthNotice = null;
          },
          onPlatformAdminEmailChange: (next) => {
            state.platformAuthPlatformAdminEmail = next;
            state.platformAuthNotice = null;
          },
          onPlatformAdminPasswordChange: (next) => {
            state.platformAuthPlatformAdminPassword = next;
            state.platformAuthNotice = null;
          },
          onPlatformAdminScopesChange: (next) => {
            state.platformAuthPlatformAdminScopes = [...next];
            state.platformAuthNotice = null;
          },
          onSubmit: () => void state.submitPlatformAuth(),
          onCreatePlatformAdmin: () => void state.createPlatformAdmin(),
          onRemovePlatformAdmin: (user) => void state.removePlatformAdmin(user),
          onLogout: () => void state.logoutPlatformAuth(),
          onCreateInvite: () => void state.createPlatformAuthInvite(),
          onRevokeInvite: (code) => void state.revokePlatformAuthInvite(code),
          onRemoveMember: (user) => void state.removePlatformAuthMember(user),
          onChangePassword: () => void state.changePlatformAuthPassword(),
          onUpdateTrialPolicy: () => void state.updatePlatformTrialPolicy(),
          onUpdateTrialInstance: () => void state.updatePlatformTrialInstance(),
        });
        return panel === nothing ? null : panel;
      })()
    : null;
  // Native employee shells open `/embed/employee/*`. Never paint the public
  // marketing auth-home there — it looks like "jumped back to the website" in
  // the WKWebView. Emit a host-detectable marker instead.
  const employeeEmbedRouting =
    typeof window !== "undefined"
      ? resolveEmployeeEmbedRouting(window.location.pathname, basePath, window.location.search)
      : null;
  const showWorkspaceAuthHome =
    isWorkspaceHome && Boolean(workbenchAuthPanel) && !employeeEmbedRouting;
  if (employeeEmbedRouting && workbenchAuthPanel) {
    // Hydration guard: bootstrap config may still be in-flight. Avoid flashing a
    // hard "session required" marker that native shells treat as auth failure.
    if (!state.platformAuthState) {
      return html`
        <div
          class="employee-embed-hydrating"
          data-openbot-embed-auth="hydrating"
          role="status"
          style="
            display: flex;
            min-height: 100vh;
            align-items: center;
            justify-content: center;
            padding: 24px;
            color: #666;
            background: #f6f5f2;
            font-family: system-ui, sans-serif;
          "
        >
          正在同步工作台会话…
        </div>
      `;
    }
    return html`
      <div
        class="employee-embed-auth-required"
        data-openbot-embed-auth="required"
        role="status"
        style="
          display: flex;
          min-height: 100vh;
          align-items: center;
          justify-content: center;
          padding: 24px;
          text-align: center;
          font-family: system-ui, sans-serif;
          color: #444;
          background: #f6f5f2;
        "
      >
        <div>
          <div style="font-weight: 600; margin-bottom: 8px">工作台会话未就绪</div>
          <div style="font-size: 14px; line-height: 1.5; color: #666">
            请返回 App 重新登录。若账号尚未加入企业，请先使用邀请码完成加入。
          </div>
        </div>
      </div>
    `;
  }
  if (state.tab === "trialApply") {
    return renderTrialApplyPage({
      brandLogoSrc: customBrandLogoSrc,
      basePath,
      currentLocale,
      state: workspaceHomepageState ?? state.platformAuthState,
      mode:
        state.platformAuthMode === "enterprise-activate"
          ? "enterprise-activate"
          : "enterprise-create",
      busy: state.platformAuthBusy,
      error: state.platformAuthError,
      notice: state.platformAuthNotice,
      email: state.platformAuthEmail,
      password: state.platformAuthPassword,
      displayName: state.platformAuthDisplayName,
      tenantName: state.platformAuthTenantName,
      expectedUsers: state.platformAuthExpectedUsers,
      useCase: state.platformAuthUseCase,
      companySize: state.platformAuthCompanySize,
      needsDemo: state.platformAuthNeedsDemo,
      industry: state.platformAuthIndustry,
      trialStep: state.platformAuthTrialStep,
      inviteCode: state.platformAuthInviteCode,
      onModeChange: (next) => {
        state.platformAuthMode = next;
        state.platformAuthTrialStep = 1;
        state.platformAuthNotice = null;
      },
      onEmailChange: (next) => {
        state.platformAuthEmail = next;
        state.platformAuthNotice = null;
      },
      onPasswordChange: (next) => {
        state.platformAuthPassword = next;
        state.platformAuthNotice = null;
      },
      onDisplayNameChange: (next) => {
        state.platformAuthDisplayName = next;
        state.platformAuthNotice = null;
      },
      onTenantNameChange: (next) => {
        state.platformAuthTenantName = next;
        state.platformAuthNotice = null;
      },
      onExpectedUsersChange: (next) => {
        state.platformAuthExpectedUsers = next;
        state.platformAuthNotice = null;
      },
      onUseCaseChange: (next) => {
        state.platformAuthUseCase = next;
        state.platformAuthNotice = null;
      },
      onCompanySizeChange: (next) => {
        state.platformAuthCompanySize = next;
        state.platformAuthNotice = null;
      },
      onNeedsDemoChange: (next) => {
        state.platformAuthNeedsDemo = next;
        state.platformAuthNotice = null;
      },
      onIndustryChange: (next) => {
        state.platformAuthIndustry = next;
        state.platformAuthNotice = null;
      },
      onTrialStepChange: (next) => {
        state.platformAuthTrialStep = next;
        state.platformAuthNotice = null;
      },
      onInviteCodeChange: (next) => {
        state.platformAuthInviteCode = next;
        state.platformAuthNotice = null;
      },
      onLocaleChange: (next) => {
        void i18n.setLocale(next);
        state.applySettings({
          ...state.settings,
          locale: next,
          localePinnedByUser: true,
        });
      },
      onForgotAccountHelp: () => {
        state.platformAuthNotice = t("authHome.authLinks.accountHelp");
      },
      onSubmit: (mode) => {
        state.platformAuthMode = mode;
        void state.submitPlatformTrialApply();
      },
    });
  }
  const publicLegalPageParams = {
    brandLogoSrc: customBrandLogoSrc,
    basePath,
    currentLocale,
    onLocaleChange: (next: typeof currentLocale) => {
      void i18n.setLocale(next);
      state.applySettings({
        ...state.settings,
        locale: next,
        localePinnedByUser: true,
      });
    },
  };
  if (state.tab === "pricing") {
    return renderPublicPricingPage({
      ...publicLegalPageParams,
      client: state.client,
    });
  }
  if (state.tab === "features") {
    return renderPublicFeaturesPage(publicLegalPageParams);
  }
  if (state.tab === "skillMcp") {
    return renderPublicSkillsMcpPage(publicLegalPageParams);
  }
  if (state.tab === "partnerEcosystem") {
    return renderPublicPartnerEcosystemPage(publicLegalPageParams);
  }
  if (state.tab === "privacy") {
    return renderPublicPrivacyPage(publicLegalPageParams);
  }
  if (state.tab === "help") {
    return renderPublicHelpPage(publicLegalPageParams);
  }
  // Platform surfaces (admin.openbot.love) require an authenticated platform-admin
  // session. When platform auth is enabled but no admin session is active, render the
  // dedicated platform login page instead of leaking the content shell behind a topbar
  // popup. Once the visitor authenticates, submitPlatformAuth() lands them on
  // platformDashboard with data loaded via connect().
  const platformSurfaceRequiresLogin = isPlatformSurface && shouldShowPlatformLoginEntry(state);
  if (
    state.tab === "enterpriseLogin" ||
    state.tab === "platformLogin" ||
    platformSurfaceRequiresLogin
  ) {
    const isPlatformLogin = state.tab === "platformLogin" || platformSurfaceRequiresLogin;
    return renderAuthHome({
      brandLogoSrc: customBrandLogoSrc,
      basePath,
      client: state.client,
      currentLocale,
      state: workspaceHomepageState ?? state.platformAuthState,
      mode: authHomeModeForControlledLogin({
        isPlatformLogin,
        platformAuthMode: state.platformAuthMode,
      }),
      membershipChoices: state.platformAuthMembershipChoices,
      membershipId: state.platformAuthMembershipId,
      onMembershipIdChange: (next) => {
        state.platformAuthMembershipId = next;
      },
      busy: state.platformAuthBusy,
      error: state.platformAuthError,
      notice: state.platformAuthNotice,
      email: state.platformAuthEmail,
      password: state.platformAuthPassword,
      displayName: state.platformAuthDisplayName,
      tenantName: state.platformAuthTenantName,
      expectedUsers: state.platformAuthExpectedUsers,
      useCase: state.platformAuthUseCase,
      companySize: state.platformAuthCompanySize,
      needsDemo: state.platformAuthNeedsDemo,
      industry: state.platformAuthIndustry,
      trialStep: state.platformAuthTrialStep,
      inviteCode: state.platformAuthInviteCode,
      mfaCode: state.platformAuthMfaCode,
      mfaStage: state.platformAuthMfaStage,
      mfaEnrollment: state.platformAuthMfaEnrollment,
      onMfaCodeChange: (next) => {
        state.platformAuthMfaCode = next;
        state.platformAuthNotice = null;
      },
      onModeChange: (next) => {
        state.platformAuthMode = next;
        state.platformAuthNotice = null;
      },
      onEmailChange: (next) => {
        state.platformAuthEmail = next;
        state.platformAuthNotice = null;
      },
      onPasswordChange: (next) => {
        state.platformAuthPassword = next;
        state.platformAuthNotice = null;
      },
      onDisplayNameChange: (next) => {
        state.platformAuthDisplayName = next;
        state.platformAuthNotice = null;
      },
      onTenantNameChange: (next) => {
        state.platformAuthTenantName = next;
        state.platformAuthNotice = null;
      },
      onExpectedUsersChange: (next) => {
        state.platformAuthExpectedUsers = next;
        state.platformAuthNotice = null;
      },
      onUseCaseChange: (next) => {
        state.platformAuthUseCase = next;
        state.platformAuthNotice = null;
      },
      onCompanySizeChange: (next) => {
        state.platformAuthCompanySize = next;
        state.platformAuthNotice = null;
      },
      onNeedsDemoChange: (next) => {
        state.platformAuthNeedsDemo = next;
        state.platformAuthNotice = null;
      },
      onIndustryChange: (next) => {
        state.platformAuthIndustry = next;
        state.platformAuthNotice = null;
      },
      onTrialStepChange: (next) => {
        state.platformAuthTrialStep = next;
        state.platformAuthNotice = null;
      },
      onInviteCodeChange: (next) => {
        state.platformAuthInviteCode = next;
        state.platformAuthNotice = null;
      },
      onLocaleChange: (next) => {
        void i18n.setLocale(next);
        state.applySettings({
          ...state.settings,
          locale: next,
          localePinnedByUser: true,
        });
      },
      onForgotAccountHelp: () => {
        state.platformAuthNotice = t("authHome.authLinks.accountHelp");
      },
      entryVariant: isPlatformLogin ? "platform" : "enterprise",
      continueHref: confirmedLogin.href,
      continueLabel: confirmedLogin.label,
      onSubmit: (mode) => {
        state.platformAuthMode = mode;
        state.platformAuthLoginIntent = isPlatformLogin ? "platform-admin" : "enterprise-admin";
        void state.submitPlatformAuth();
      },
    });
  }
  if (showWorkspaceAuthHome) {
    if (typeof window !== "undefined") {
      const employeeHome = consoleHostEmployeeHomeUrl(window.location.host);
      if (employeeHome) {
        window.location.replace(employeeHome);
        return html``;
      }
    }
    return renderAuthHome({
      brandLogoSrc: customBrandLogoSrc,
      basePath,
      client: state.client,
      currentLocale,
      state: workspaceHomepageState,
      mode: state.platformAuthMode,
      busy: state.platformAuthBusy,
      error: state.platformAuthError,
      notice: state.platformAuthNotice,
      email: state.platformAuthEmail,
      password: state.platformAuthPassword,
      displayName: state.platformAuthDisplayName,
      tenantName: state.platformAuthTenantName,
      expectedUsers: state.platformAuthExpectedUsers,
      useCase: state.platformAuthUseCase,
      companySize: state.platformAuthCompanySize,
      needsDemo: state.platformAuthNeedsDemo,
      industry: state.platformAuthIndustry,
      trialStep: state.platformAuthTrialStep,
      inviteCode: state.platformAuthInviteCode,
      mfaCode: state.platformAuthMfaCode,
      mfaStage: state.platformAuthMfaStage,
      mfaEnrollment: state.platformAuthMfaEnrollment,
      membershipChoices: state.platformAuthMembershipChoices,
      membershipId: state.platformAuthMembershipId,
      onMembershipIdChange: (next) => {
        state.platformAuthMembershipId = next;
      },
      onMfaCodeChange: (next) => {
        state.platformAuthMfaCode = next;
        state.platformAuthNotice = null;
      },
      onModeChange: (next) => {
        state.platformAuthMode = next;
        state.platformAuthTrialStep = 1;
        state.platformAuthNotice = null;
      },
      onEmailChange: (next) => {
        state.platformAuthEmail = next;
        state.platformAuthNotice = null;
      },
      onPasswordChange: (next) => {
        state.platformAuthPassword = next;
        state.platformAuthNotice = null;
      },
      onDisplayNameChange: (next) => {
        state.platformAuthDisplayName = next;
        state.platformAuthNotice = null;
      },
      onTenantNameChange: (next) => {
        state.platformAuthTenantName = next;
        state.platformAuthNotice = null;
      },
      onExpectedUsersChange: (next) => {
        state.platformAuthExpectedUsers = next;
        state.platformAuthNotice = null;
      },
      onUseCaseChange: (next) => {
        state.platformAuthUseCase = next;
        state.platformAuthNotice = null;
      },
      onCompanySizeChange: (next) => {
        state.platformAuthCompanySize = next;
        state.platformAuthNotice = null;
      },
      onNeedsDemoChange: (next) => {
        state.platformAuthNeedsDemo = next;
        state.platformAuthNotice = null;
      },
      onIndustryChange: (next) => {
        state.platformAuthIndustry = next;
        state.platformAuthNotice = null;
      },
      onTrialStepChange: (next) => {
        state.platformAuthTrialStep = next;
        state.platformAuthNotice = null;
      },
      onInviteCodeChange: (next) => {
        state.platformAuthInviteCode = next;
        state.platformAuthNotice = null;
      },
      onLocaleChange: (next) => {
        void i18n.setLocale(next);
        state.applySettings({
          ...state.settings,
          locale: next,
          localePinnedByUser: true,
        });
      },
      onForgotAccountHelp: () => {
        state.platformAuthNotice = t("authHome.authLinks.accountHelp");
      },
      entryVariant: "public",
      onSubmit: (mode) => {
        state.platformAuthMode = mode;
        if (
          state.platformAuthMode === "enterprise-create" ||
          state.platformAuthMode === "platform-enterprise-create"
        ) {
          const inferredTenantName =
            state.platformAuthTenantName.trim() ||
            state.platformAuthDisplayName.trim() ||
            state.platformAuthEmail.trim().split("@")[0] ||
            "OpenBot Workspace";
          state.platformAuthTenantName = inferredTenantName;
        }
        if (state.platformAuthMode === "enterprise-create") {
          void state.submitPlatformTrialApply();
          return;
        }
        void state.submitPlatformAuth();
      },
    });
  }
  const observationHost = document.querySelector("openbot-app");
  const enterpriseRenderModel = buildEnterprisePortRenderModel({
    state: enterpriseState,
    actions: enterpriseActions,
    configValue,
    currentTenantId: enterpriseTenantId,
    showResolver: isEnterpriseResolver,
  });
  // 员工工作台「我的可用模型」只读区块通过单例获取网关客户端（同 governance 范式）。
  setModelAuthorizationClient(state.client);
  const workbenchContent = !needsEmployeeWorkbenchChrome
    ? nothing
    : !employeeBundle
      ? renderCrossPortShellLoadingPlaceholder("employee")
      : employeeBundle.renderWorkbench({
          ...employeeBundle.buildEmployeeWorkbenchProps({
            state: portState,
            // workbenchChat is `nothing` until the employee bundle is ready; props require TemplateResult.
            chatContent: workbenchChat === nothing ? html`` : workbenchChat,
            // Composer lives inside `.chat-main` so preview stays inspect-only.
            chatComposer: null,
            authPanel: workbenchAuthPanel,
          }),
          requestUpdate: () => state.requestUpdate(),
          bundledBrandLogoSrc: bundledBrandWordmarkSrc,
          computerFullscreen:
            state.sidebarOpen &&
            state.sidebarSurface === "computer" &&
            state.computerPreviewSize === "fullscreen",
          onExitComputerFullscreen: () => {
            setComputerPreviewSize(state, exitComputerFullscreenSize());
          },
        });
  const platformSurfaceContent = (() => {
    if (!isPlatformSurface) {
      return nothing;
    }
    if (!platformBundle) {
      return renderCrossPortShellLoadingPlaceholder("platform");
    }
    const platformState = platformBundle.adaptPlatformPortState(state);
    const platformActionState = platformBundle.adaptPlatformPortActionState(state);
    const platformActions = platformBundle.createPlatformPortActions({
      actionState: platformActionState,
      capabilityState,
    });
    const platformRenderModel = platformBundle.buildPlatformPortRenderModel({
      state: platformState,
      actions: platformActions,
      configValue,
    });
    return platformBundle.renderPlatformPortShell({
      ...platformRenderModel,
      observationHost,
    });
  })();
  const showGlobalUpdateBanner = !isPlatformSurface;

  if (isWorkspaceHome && !showWorkspaceAuthHome) {
    return html`
      <div
        class="shell shell--workspace shell--workspace-immersive ${state.onboarding ? "shell--onboarding" : ""} ${shellComputerFocusClass(state)}"
      >
        <main class="content content--workspace content--workspace-immersive">
          ${
            availableUpdate
              ? html`<div class="update-banner callout danger" role="alert">
                  <strong>Update available:</strong> v${availableUpdate.latestVersion} (running
                  v${availableUpdate.currentVersion}).
                  <button
                    class="btn btn--sm update-banner__btn"
                    ?disabled=${state.updateRunning || !state.connected}
                    @click=${() => configCapability.runUpdate(configUpdateState)}
                  >
                    ${state.updateRunning ? "Updating…" : "Update now"}
                  </button>
                </div>`
              : nothing
          }
          ${workbenchContent}
        </main>
        ${renderGlobalApprovalOverlays(state, {
          localCardInline: Boolean(workbenchChatProps),
          localFileCardInline: Boolean(workbenchChatProps),
        })}
      </div>
    `;
  }

  return html`
    <div
      class="shell ${state.settings.navCollapsed ? "shell--nav-collapsed" : ""} ${state.onboarding ? "shell--onboarding" : ""} ${shellComputerFocusClass(state)}"
    >
      <header class="topbar">
        <div class="topbar-left">
          <button
            class="nav-collapse-toggle"
            @click=${() =>
              state.applySettings({
                ...state.settings,
                navCollapsed: !state.settings.navCollapsed,
              })}
            title="${state.settings.navCollapsed ? t("nav.expand") : t("nav.collapse")}"
            aria-label="${state.settings.navCollapsed ? t("nav.expand") : t("nav.collapse")}"
          >
            <span class="nav-collapse-toggle__icon">${icons.menu}</span>
          </button>
          <div class="brand">
            <div class="brand-logo brand-logo--wide">
              <img src=${customBrandLogoSrc ?? bundledBrandWordmarkSrc} alt="openbot" />
            </div>
          </div>
        </div>
        <div class="topbar-status">
          <button
            type="button"
            class="btn btn--sm btn--icon topbar-round-btn"
            data-tone="locale"
            title=${t("common.language")}
            aria-label=${t("common.language")}
            @click=${() => {
              void i18n.setLocale(nextLocaleValue);
              state.applySettings({
                ...state.settings,
                locale: nextLocaleValue,
                localePinnedByUser: true,
              });
            }}
          >
            ${icons.globe}
          </button>
          <button
            type="button"
            class="btn btn--sm btn--icon topbar-round-btn"
            data-tone="theme"
            title=${t("common.theme")}
            aria-label=${t("common.theme")}
            @click=${(event: MouseEvent) => {
              const element = event.currentTarget as HTMLElement;
              state.setTheme(nextThemeValue, {
                element,
                ...(event.clientX || event.clientY
                  ? { pointerClientX: event.clientX, pointerClientY: event.clientY }
                  : {}),
              });
            }}
          >
            ${renderShellThemeIcon(shellTheme)}
          </button>
          ${topbarAccountMenu}
        </div>
      </header>
      <aside class="nav ${state.settings.navCollapsed ? "nav--collapsed" : ""}">
        ${
          activePort === "platform"
            ? renderPlatformSidebarNav(state)
            : tabGroupsForPort(activePort).map((group) => {
                const visibleTabs = filterTabsByPermission(state, group.tabs);
                const isActivePortGroup = group.label === activePort;
                const isPrimaryOnlyGroup =
                  isActivePortGroup && tabGroupsForPort(activePort).length === 1;
                const renderedTabs =
                  visibleTabs.length === 0 && isActivePortGroup ? [...group.tabs] : visibleTabs;
                if (renderedTabs.length === 0) {
                  return nothing;
                }
                const isGroupCollapsed = state.settings.navGroupsCollapsed[group.label] ?? false;
                const hasActiveTab = renderedTabs.some((tab) => tab === state.tab);
                return html`
                  <div
                    class="nav-group ${isGroupCollapsed && !hasActiveTab ? "nav-group--collapsed" : ""} ${
                      isPrimaryOnlyGroup ? "nav-group--primary" : ""
                    }"
                  >
                    ${
                      isPrimaryOnlyGroup
                        ? nothing
                        : html`
                            <button
                              class="nav-label"
                              @click=${() => {
                                const next = { ...state.settings.navGroupsCollapsed };
                                next[group.label] = !isGroupCollapsed;
                                state.applySettings({
                                  ...state.settings,
                                  navGroupsCollapsed: next,
                                });
                              }}
                              aria-expanded=${!isGroupCollapsed}
                            >
                              <span class="nav-label__text">${t(`nav.${group.label}`)}</span>
                              ${
                                isActivePortGroup
                                  ? html`<span class="nav-label__badge"
                                      >${t("nav.currentPort")}</span
                                    >`
                                  : nothing
                              }
                              <span class="nav-label__chevron"
                                >${isGroupCollapsed ? "+" : "−"}</span
                              >
                            </button>
                          `
                    }
                    <div class="nav-group__items">
                      ${renderedTabs.map((tab) => renderTab(state, tab))}
                    </div>
                  </div>
                `;
              })
        }
      </aside>
      <main class="content">
        ${
          availableUpdate && showGlobalUpdateBanner
            ? html`<div class="update-banner callout danger" role="alert">
                <strong>Update available:</strong> v${availableUpdate.latestVersion} (running
                v${availableUpdate.currentVersion}).
                <button
                  class="btn btn--sm update-banner__btn"
                  ?disabled=${state.updateRunning || !state.connected}
                  @click=${() => configCapability.runUpdate(configUpdateState)}
                >
                  ${state.updateRunning ? "Updating…" : "Update now"}
                </button>
              </div>`
            : nothing
        }
        ${
          state.tab === "usage" ||
          state.tab === "me" ||
          isEnterpriseTab(state.tab) ||
          isPlatformTab(state.tab)
            ? nothing
            : html`
                <section class="content-header">
                  <div>
                    <div class="page-title">${titleForTab(state.tab)}</div>
                    <div class="page-sub">${subtitleForTab(state.tab)}</div>
                  </div>
                  <div class="page-meta">
                    ${visibleHostError ? html`<div class="pill danger">${visibleHostError}</div>` : nothing}
                  </div>
                </section>
              `
        }
        ${
          state.tab === "personas"
            ? renderPersonas({
                connected: state.connected,
                agentsList: state.agentsList,
                sessionsResult: state.sessionsResult,
                channelsSnapshot: state.channelsSnapshot,
                presenceEntries: state.presenceEntries,
                activeSessionKey: state.sessionKey,
                onOpenChat: openChatSession,
                onOpenControlSection: (section) => state.setTab(section),
              })
            : nothing
        }
        ${
          state.tab === "contacts"
            ? renderContacts({
                connected: state.connected,
                agentsList: state.agentsList,
                sessionsResult: state.sessionsResult,
                channelsSnapshot: state.channelsSnapshot,
                presenceEntries: state.presenceEntries,
                activeSessionKey: state.sessionKey,
                onOpenChat: openChatSession,
                onOpenControlSection: (section) => state.setTab(section),
              })
            : nothing
        }
        ${
          state.tab === "groups"
            ? renderGroups({
                connected: state.connected,
                agentsList: state.agentsList,
                sessionsResult: state.sessionsResult,
                channelsSnapshot: state.channelsSnapshot,
                presenceEntries: state.presenceEntries,
                activeSessionKey: state.sessionKey,
                onOpenChat: openChatSession,
                onOpenControlSection: (section) => state.setTab(section),
              })
            : nothing
        }
        ${platformSurfaceContent}
        ${isEnterpriseSurface ? renderEnterprisePortShell(enterpriseRenderModel) : nothing}
      </main>
      ${renderGlobalApprovalOverlays(state, {
        localCardInline: Boolean(workbenchChatProps),
        localFileCardInline: Boolean(workbenchChatProps),
      })}
    </div>
  `;
}

function renderGlobalApprovalOverlays(
  state: AppViewState,
  opts?: { localCardInline?: boolean; localFileCardInline?: boolean },
) {
  return html`${renderExecApprovalPrompt(state, opts)} ${renderLocalFileApprovalPrompt(state, {
    inline: opts?.localFileCardInline,
  })}
    ${renderSecureFormCard(state)} ${renderGatewayUrlConfirmation(state)}`;
}
