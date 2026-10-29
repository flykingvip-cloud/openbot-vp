const KEY = "openbot.control.settings.v1";
const TOKEN_SESSION_KEY_PREFIX = "openbot.control.token.v1:";
const DEFAULT_NAV_GROUPS_COLLAPSED = {
  frontstage: false,
  console: true,
} satisfies Record<string, boolean>;

import { canonicalizeWorkbenchChatSessionKey } from "../../../src/sessions/session-key-utils.ts";
import { isSupportedLocale } from "../i18n/index.ts";
import { normalizeCustomBrandLogoDataUrl } from "./brand-assets.ts";
import { inferBasePathFromPathname, normalizeBasePath } from "./navigation.ts";
import { canonicalizeEmployeeCloudGatewayUrl } from "./routing/canonical-employee-gateway.ts";
import {
  resolvePreferredOpenBotGatewayUrl,
  shouldDiscardPublicHomeGatewayUrl,
} from "./routing/openbot-subdomain-redirect.ts";
import {
  hasDeprecatedWorkbenchTeamMetadata,
  type DeprecatedPersistedWorkbenchTeamState,
} from "./storage-legacy.ts";
import type { ThemeMode } from "./theme.ts";

type PersistedUiSettings = Omit<UiSettings, "token"> & {
  token?: never;
  /** One-time migration: default sidebar to icon-only compact layout. */
  navCompactLayoutApplied?: boolean;
};

type ParsedUiSettings = Partial<PersistedUiSettings> &
  Partial<DeprecatedPersistedWorkbenchTeamState>;

function shouldPreferChineseLocaleForCurrentHost(): boolean {
  if (typeof location === "undefined") {
    return false;
  }
  const host = location.host.trim().toLowerCase();
  return host === "openbot.love" || host === "www.openbot.love";
}

function resolveDefaultLocale(): string | undefined {
  if (shouldPreferChineseLocaleForCurrentHost()) {
    return "zh-CN";
  }
  return undefined;
}

export type UiSettings = {
  gatewayUrl: string;
  token: string;
  sessionKey: string;
  lastActiveSessionKey: string;
  sessionSeenAt: Record<string, number>;
  recentEnterpriseTenantIds?: string[];
  theme: ThemeMode;
  chatFocusMode: boolean;
  chatShowThinking: boolean;
  splitRatio: number; // Sidebar split ratio (0.4 to 0.7, default 0.6)
  navCollapsed: boolean; // Collapsible sidebar state
  navGroupsCollapsed: Record<string, boolean>; // Which nav groups are collapsed
  daibaiGuideAcknowledged?: boolean;
  daibaiGuideAcknowledgedUsers?: Record<string, true>;
  lastAuthenticatedUser?: string;
  locale?: string;
  localePinnedByUser?: boolean;
  customBrandLogoDataUrl?: string;
  workbenchProfileName?: string;
  workbenchProfileNote?: string;
};

function getSessionStorage(): Storage | null {
  if (typeof window !== "undefined" && window.sessionStorage) {
    return window.sessionStorage;
  }
  if (typeof sessionStorage !== "undefined") {
    return sessionStorage;
  }
  return null;
}

function normalizeGatewayTokenScope(gatewayUrl: string): string {
  const trimmed = gatewayUrl.trim();
  if (!trimmed) {
    return "default";
  }
  try {
    const base =
      typeof location !== "undefined"
        ? `${location.protocol}//${location.host}${location.pathname || "/"}`
        : undefined;
    const parsed = base ? new URL(trimmed, base) : new URL(trimmed);
    const pathname =
      parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "") || parsed.pathname;
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return trimmed;
  }
}

function tokenSessionKeyForGateway(gatewayUrl: string): string {
  return `${TOKEN_SESSION_KEY_PREFIX}${normalizeGatewayTokenScope(gatewayUrl)}`;
}

function configuredControlUiBasePath(): string {
  if (typeof window === "undefined") {
    return "";
  }
  const configured = window.__OPENBOT_CONTROL_UI_BASE_PATH__;
  return typeof configured === "string" && configured.trim() ? normalizeBasePath(configured) : "";
}

function loadSessionToken(gatewayUrl: string): string {
  try {
    const storage = getSessionStorage();
    if (!storage) {
      return "";
    }
    const currentKey = tokenSessionKeyForGateway(gatewayUrl);
    const currentToken = storage.getItem(currentKey)?.trim() ?? "";
    return currentToken;
  } catch {
    return "";
  }
}

function persistSessionToken(gatewayUrl: string, token: string) {
  try {
    const storage = getSessionStorage();
    if (!storage) {
      return;
    }
    const key = tokenSessionKeyForGateway(gatewayUrl);
    const normalized = token.trim();
    if (normalized) {
      storage.setItem(key, normalized);
      return;
    }
    storage.removeItem(key);
  } catch {
    // best-effort
  }
}

function sanitizeTenantIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const unique = Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ).slice(0, 8);
  return unique.length > 0 ? unique : undefined;
}

function sanitizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 120) : undefined;
}

export function loadSettings(): UiSettings {
  const defaultUrl = (() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const basePath = configuredControlUiBasePath() || inferBasePathFromPathname(location.pathname);
    return `${proto}://${location.host}${basePath}`;
  })();

  const defaults: UiSettings = {
    gatewayUrl: defaultUrl,
    token: loadSessionToken(defaultUrl),
    sessionKey: "main",
    lastActiveSessionKey: "main",
    sessionSeenAt: { main: Date.now() },
    recentEnterpriseTenantIds: undefined,
    theme: "system",
    chatFocusMode: false,
    chatShowThinking: true,
    splitRatio: 0.6,
    navCollapsed: true,
    navGroupsCollapsed: { ...DEFAULT_NAV_GROUPS_COLLAPSED },
    daibaiGuideAcknowledged: false,
    daibaiGuideAcknowledgedUsers: undefined,
    lastAuthenticatedUser: undefined,
    locale: resolveDefaultLocale(),
    customBrandLogoDataUrl: undefined,
  };

  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as ParsedUiSettings;
    const shouldDropLegacyWorkbenchTeamState = hasDeprecatedWorkbenchTeamMetadata(parsed);
    const shouldApplyNavCompactDefault = parsed.navCompactLayoutApplied !== true;
    const savedGatewayUrl =
      typeof parsed.gatewayUrl === "string" && parsed.gatewayUrl.trim()
        ? parsed.gatewayUrl.trim()
        : defaults.gatewayUrl;
    const gatewayUrl =
      typeof location !== "undefined"
        ? resolvePreferredOpenBotGatewayUrl({
            gatewayUrl: shouldDiscardPublicHomeGatewayUrl({
              savedGatewayUrl,
              pageHost: location.host,
            })
              ? defaults.gatewayUrl
              : savedGatewayUrl,
            pageHost: location.host,
            pageProtocol: location.protocol,
            basePath: configuredControlUiBasePath() || inferBasePathFromPathname(location.pathname),
          })
        : canonicalizeEmployeeCloudGatewayUrl(savedGatewayUrl);
    const settings = {
      gatewayUrl,
      // Gateway auth is intentionally in-memory only; only the current tab token is loaded.
      token: loadSessionToken(gatewayUrl),
      sessionKey:
        typeof parsed.sessionKey === "string" && parsed.sessionKey.trim()
          ? canonicalizeWorkbenchChatSessionKey(parsed.sessionKey.trim())
          : defaults.sessionKey,
      lastActiveSessionKey:
        typeof parsed.lastActiveSessionKey === "string" && parsed.lastActiveSessionKey.trim()
          ? canonicalizeWorkbenchChatSessionKey(parsed.lastActiveSessionKey.trim())
          : typeof parsed.sessionKey === "string" && parsed.sessionKey.trim()
            ? canonicalizeWorkbenchChatSessionKey(parsed.sessionKey.trim())
            : defaults.lastActiveSessionKey,
      sessionSeenAt:
        typeof parsed.sessionSeenAt === "object" && parsed.sessionSeenAt !== null
          ? Object.fromEntries(
              Object.entries(parsed.sessionSeenAt).filter(
                ([key, value]) => key.trim() && typeof value === "number" && Number.isFinite(value),
              ),
            )
          : defaults.sessionSeenAt,
      recentEnterpriseTenantIds: sanitizeTenantIds(parsed.recentEnterpriseTenantIds),
      theme:
        parsed.theme === "light" || parsed.theme === "dark" || parsed.theme === "system"
          ? parsed.theme
          : defaults.theme,
      chatFocusMode:
        typeof parsed.chatFocusMode === "boolean" ? parsed.chatFocusMode : defaults.chatFocusMode,
      chatShowThinking:
        typeof parsed.chatShowThinking === "boolean"
          ? parsed.chatShowThinking
          : defaults.chatShowThinking,
      splitRatio:
        typeof parsed.splitRatio === "number" &&
        parsed.splitRatio >= 0.4 &&
        parsed.splitRatio <= 0.7
          ? parsed.splitRatio
          : defaults.splitRatio,
      navCollapsed: shouldApplyNavCompactDefault
        ? true
        : typeof parsed.navCollapsed === "boolean"
          ? parsed.navCollapsed
          : defaults.navCollapsed,
      navGroupsCollapsed:
        typeof parsed.navGroupsCollapsed === "object" && parsed.navGroupsCollapsed !== null
          ? {
              ...DEFAULT_NAV_GROUPS_COLLAPSED,
              ...parsed.navGroupsCollapsed,
            }
          : defaults.navGroupsCollapsed,
      daibaiGuideAcknowledged:
        typeof parsed.daibaiGuideAcknowledged === "boolean"
          ? parsed.daibaiGuideAcknowledged
          : defaults.daibaiGuideAcknowledged,
      daibaiGuideAcknowledgedUsers:
        typeof parsed.daibaiGuideAcknowledgedUsers === "object" &&
        parsed.daibaiGuideAcknowledgedUsers !== null
          ? Object.fromEntries(
              Object.entries(parsed.daibaiGuideAcknowledgedUsers).filter(
                ([key, value]) => key.trim() && value,
              ),
            )
          : defaults.daibaiGuideAcknowledgedUsers,
      lastAuthenticatedUser: sanitizeOptionalText(parsed.lastAuthenticatedUser),
      locale:
        parsed.localePinnedByUser === true && isSupportedLocale(parsed.locale)
          ? parsed.locale
          : (defaults.locale ?? (isSupportedLocale(parsed.locale) ? parsed.locale : undefined)),
      localePinnedByUser: parsed.localePinnedByUser === true ? true : undefined,
      customBrandLogoDataUrl: normalizeCustomBrandLogoDataUrl(parsed.customBrandLogoDataUrl),
      workbenchProfileName: sanitizeOptionalText(parsed.workbenchProfileName),
      workbenchProfileNote: sanitizeOptionalText(parsed.workbenchProfileNote),
    };
    if ("token" in parsed || shouldDropLegacyWorkbenchTeamState || shouldApplyNavCompactDefault) {
      persistSettings(settings, { navCompactLayoutApplied: true });
    }
    return settings;
  } catch {
    return defaults;
  }
}

export function saveSettings(next: UiSettings) {
  persistSettings(next);
}

export function isDaibaiGuideAcknowledgedForUser(
  settings: Pick<UiSettings, "daibaiGuideAcknowledged" | "daibaiGuideAcknowledgedUsers">,
  userKey: string | null | undefined,
): boolean {
  const normalized = userKey?.trim();
  if (!normalized) {
    return Boolean(settings.daibaiGuideAcknowledged);
  }
  if (settings.daibaiGuideAcknowledgedUsers?.[normalized]) {
    return true;
  }
  return Boolean(settings.daibaiGuideAcknowledged);
}

export function acknowledgeDaibaiGuideForUser(settings: UiSettings, userKey: string): UiSettings {
  const normalized = userKey.trim();
  if (!normalized) {
    return { ...settings, daibaiGuideAcknowledged: true };
  }
  return {
    ...settings,
    daibaiGuideAcknowledgedUsers: {
      ...settings.daibaiGuideAcknowledgedUsers,
      [normalized]: true,
    },
  };
}

function readPersistedNavCompactLayoutApplied(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return false;
    }
    const parsed = JSON.parse(raw) as PersistedUiSettings;
    return parsed.navCompactLayoutApplied === true;
  } catch {
    return false;
  }
}

function persistSettings(next: UiSettings, options?: { navCompactLayoutApplied?: boolean }) {
  persistSessionToken(next.gatewayUrl, next.token);
  const navCompactLayoutApplied =
    options?.navCompactLayoutApplied === true || readPersistedNavCompactLayoutApplied();
  const persisted: PersistedUiSettings = {
    gatewayUrl: canonicalizeEmployeeCloudGatewayUrl(next.gatewayUrl),
    sessionKey: next.sessionKey,
    lastActiveSessionKey: next.lastActiveSessionKey,
    sessionSeenAt: next.sessionSeenAt,
    ...(next.recentEnterpriseTenantIds?.length
      ? { recentEnterpriseTenantIds: next.recentEnterpriseTenantIds }
      : {}),
    theme: next.theme,
    chatFocusMode: next.chatFocusMode,
    chatShowThinking: next.chatShowThinking,
    splitRatio: next.splitRatio,
    navCollapsed: next.navCollapsed,
    navGroupsCollapsed: next.navGroupsCollapsed,
    ...(navCompactLayoutApplied ? { navCompactLayoutApplied: true } : {}),
    ...(next.daibaiGuideAcknowledged ? { daibaiGuideAcknowledged: true } : {}),
    ...(next.daibaiGuideAcknowledgedUsers &&
    Object.keys(next.daibaiGuideAcknowledgedUsers).length > 0
      ? { daibaiGuideAcknowledgedUsers: next.daibaiGuideAcknowledgedUsers }
      : {}),
    ...(sanitizeOptionalText(next.lastAuthenticatedUser)
      ? { lastAuthenticatedUser: sanitizeOptionalText(next.lastAuthenticatedUser) }
      : {}),
    ...(next.locale && next.localePinnedByUser
      ? { locale: next.locale, localePinnedByUser: true }
      : {}),
    ...(next.customBrandLogoDataUrl ? { customBrandLogoDataUrl: next.customBrandLogoDataUrl } : {}),
    ...(sanitizeOptionalText(next.workbenchProfileName)
      ? { workbenchProfileName: sanitizeOptionalText(next.workbenchProfileName) }
      : {}),
    ...(sanitizeOptionalText(next.workbenchProfileNote)
      ? { workbenchProfileNote: sanitizeOptionalText(next.workbenchProfileNote) }
      : {}),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(persisted));
  } catch {
    // QuotaExceeded or private-mode: drop bulky brand art first so unread
    // cursors still survive refresh (false badges after reload).
    try {
      const { customBrandLogoDataUrl: _logo, ...withoutLogo } = persisted as PersistedUiSettings & {
        customBrandLogoDataUrl?: string;
      };
      localStorage.setItem(KEY, JSON.stringify(withoutLogo));
    } catch {
      try {
        // Do NOT replace with a shrunk config — that would drop unrelated
        // persisted fields (locale, profile, guide acks, …). Merge the
        // critical unread/session cursor into whatever is already stored.
        let existing: Record<string, unknown> = {};
        try {
          const raw = localStorage.getItem(KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              existing = parsed as Record<string, unknown>;
            }
          }
        } catch {
          existing = {};
        }
        const { customBrandLogoDataUrl: _ignoredLogo, ...existingWithoutLogo } = existing as Record<
          string,
          unknown
        > & { customBrandLogoDataUrl?: unknown };
        localStorage.setItem(
          KEY,
          JSON.stringify({
            ...existingWithoutLogo,
            gatewayUrl: persisted.gatewayUrl,
            sessionKey: persisted.sessionKey,
            lastActiveSessionKey: persisted.lastActiveSessionKey,
            sessionSeenAt: persisted.sessionSeenAt,
            theme: persisted.theme,
            chatFocusMode: persisted.chatFocusMode,
            chatShowThinking: persisted.chatShowThinking,
            splitRatio: persisted.splitRatio,
            navCollapsed: persisted.navCollapsed,
            navGroupsCollapsed: persisted.navGroupsCollapsed,
            ...(persisted.navCompactLayoutApplied
              ? { navCompactLayoutApplied: persisted.navCompactLayoutApplied }
              : {}),
          }),
        );
      } catch {
        // Give up silently — next interaction retries.
      }
    }
  }
}
