import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { t } from "../i18n/index.ts";
import { manuallyRefreshShellChat } from "./app-chat-actions.ts";
import { switchShellChatSession } from "./app-session-actions.ts";
import type { AppViewState } from "./app-view-state.ts";
import { icons, type IconName } from "./icons.ts";
import {
  iconForTab,
  isEnterpriseTab,
  navItemDescriptionForTab,
  normalizePath,
  pathForTab,
  titleForTab,
  type Tab,
} from "./navigation.ts";
import { resolvePlatformDomainAccess } from "./ports/platform/domain-access.ts";
import { pushAppHistoryState } from "./request-app-rerender.ts";
import type { SessionsListResult } from "./types.ts";

type SessionDefaultsSnapshot = {
  mainSessionKey?: string;
  mainKey?: string;
};

type PlatformNavEntry = {
  id: string;
  label: string;
  tab: Tab;
  icon?: IconName;
  hash?: string;
  pathSuffix?: string;
  /** `tab` matches the tab only. Suffix matches pathSuffix. Root-or-suffix also matches the tab root. */
  matchMode?: "tab" | "suffix" | "tab-root-or-suffix" | "root";
  activeOnTab?: boolean;
};

type PlatformNavSection = {
  id: string;
  label: string;
  /** Delivery-ops subtitle. Not a sales label. */
  subtitle?: string;
  icon: IconName;
  entries: PlatformNavEntry[];
};

export const PLATFORM_NAV_SECTIONS: PlatformNavSection[] = [
  {
    id: "platform-productization",
    label: "发布与制品",
    subtitle: "版本·通道·对账",
    icon: "layers",
    entries: [
      {
        id: "pz-overview",
        label: "发布概览",
        tab: "platformProductization",
        pathSuffix: "",
        matchMode: "root",
      },
      {
        id: "pz-artifacts",
        label: "制品",
        tab: "platformProductization",
        pathSuffix: "/artifacts",
        matchMode: "suffix",
      },
      {
        id: "pz-channels",
        label: "通道",
        tab: "platformProductization",
        pathSuffix: "/channels",
        matchMode: "suffix",
      },
      {
        id: "pz-reconcile",
        label: "digest 对账",
        tab: "platformProductization",
        pathSuffix: "/reconcile",
        matchMode: "suffix",
      },
      {
        id: "pz-l1",
        label: "L1 只读",
        tab: "platformProductization",
        pathSuffix: "/l1",
        matchMode: "suffix",
      },
      {
        id: "pz-surfaces",
        label: "表面矩阵",
        tab: "platformProductization",
        pathSuffix: "/surfaces",
        matchMode: "suffix",
      },
      {
        id: "pz-windows",
        label: "发布窗口",
        tab: "platformProductization",
        pathSuffix: "/windows",
        matchMode: "suffix",
      },
      {
        id: "pz-audit",
        label: "审计",
        tab: "platformProductization",
        pathSuffix: "/audit",
        matchMode: "suffix",
      },
    ],
  },
  {
    id: "platform-key-accounts",
    label: "大客户管理",
    subtitle: "白牌·预装·授权·安装",
    icon: "building",
    entries: [
      {
        id: "ka-delivery",
        label: "交付状态",
        tab: "platformKeyAccounts",
        pathSuffix: "",
        matchMode: "root",
      },
      {
        id: "ka-ledger",
        label: "伙伴台账",
        tab: "platformKeyAccounts",
        pathSuffix: "/partners",
        matchMode: "suffix",
      },
      {
        id: "ka-detail",
        label: "伙伴详情",
        tab: "platformKeyAccounts",
        pathSuffix: "/partners/KA-0011",
        matchMode: "suffix",
      },
      {
        id: "ka-white-label",
        label: "白牌配置",
        tab: "platformKeyAccounts",
        pathSuffix: "/white-label",
        matchMode: "suffix",
      },
      {
        id: "ka-preinstall",
        label: "预装包关联",
        tab: "platformKeyAccounts",
        pathSuffix: "/preinstall",
        matchMode: "suffix",
      },
      {
        id: "ka-settlement",
        label: "结算对账入口",
        tab: "platformKeyAccounts",
        pathSuffix: "/settlement",
        matchMode: "suffix",
      },
      {
        id: "ka-audit",
        label: "域内审计",
        tab: "platformKeyAccounts",
        pathSuffix: "/audit",
        matchMode: "suffix",
      },
      {
        id: "ka-terms",
        label: "合作条款摘要",
        tab: "platformKeyAccounts",
        pathSuffix: "/terms",
        matchMode: "suffix",
      },
      {
        id: "ka-shipments",
        label: "出货批次",
        tab: "platformKeyAccounts",
        pathSuffix: "/shipments",
        matchMode: "suffix",
      },
    ],
  },
  {
    id: "platform-tenants",
    label: "租户管理",
    icon: "users",
    entries: [
      { id: "tenant-operations", label: "租户运营", tab: "platformTenants", activeOnTab: true },
    ],
  },
  {
    id: "platform-pricing",
    label: "套餐与定价",
    icon: "dollarSign",
    entries: [{ id: "pricing", label: "套餐与定价", tab: "platformPricing", activeOnTab: true }],
  },
  {
    id: "platform-capabilities",
    label: "能力中心",
    icon: "sparkles",
    entries: [
      { id: "ai-capabilities", label: "能力中心", tab: "platformCapabilities", activeOnTab: true },
    ],
  },
  {
    id: "platform-models",
    label: "模型管理",
    icon: "cpu",
    entries: [{ id: "models", label: "模型管理", tab: "platformModels", activeOnTab: true }],
  },
  {
    id: "platform-agents",
    label: "资产管理",
    icon: "brain",
    entries: [{ id: "agents", label: "资产管理", tab: "platformAgents", activeOnTab: true }],
  },
  {
    id: "platform-observation",
    label: "平台观测",
    icon: "activity",
    entries: [
      { id: "observation", label: "平台观测", tab: "platformObservation", activeOnTab: true },
    ],
  },
  {
    id: "platform-advanced",

    label: "高级治理",
    icon: "server",
    entries: [{ id: "advanced", label: "高级治理", tab: "platformAdvanced", activeOnTab: true }],
  },
  {
    id: "platform-system",
    label: "系统设置",
    icon: "settings",
    entries: [
      { id: "settings", label: "系统设置", tab: "platformSystemSettings", activeOnTab: true },
    ],
  },
];

function resolveEnterpriseTenantId(state: AppViewState): string | null {
  const helloTenantId = state.hello?.auth?.tenantId?.trim();
  if (helloTenantId) {
    return helloTenantId;
  }
  const trustedTenantId =
    state.platformAuthState?.session?.tenantId?.trim() ??
    state.bootstrapAuthSession?.tenantId?.trim();
  if (trustedTenantId) {
    return trustedTenantId;
  }
  return state.settings.recentEnterpriseTenantIds?.[0]?.trim() ?? null;
}

export function renderTab(state: AppViewState, tab: Tab) {
  const enterpriseTenantId = isEnterpriseTab(tab) ? resolveEnterpriseTenantId(state) : null;
  const isEnterpriseTenantLocked =
    isEnterpriseTab(tab) && tab !== "enterpriseOverview" && !enterpriseTenantId;
  const tabSubtitle = navItemDescriptionForTab(tab);
  const href = pathForTab(tab, state.basePath, {
    tenantId: enterpriseTenantId ?? undefined,
  });
  const active = state.tab === tab;
  const metaLabel = isEnterpriseTenantLocked
    ? t("nav.tenantRequired")
    : active
      ? t("nav.currentModule")
      : null;
  return html`
    <a
      href=${href}
      class="nav-item ${active ? "active" : ""} ${isEnterpriseTenantLocked ? "nav-item--gated" : ""}"
      aria-disabled="false"
      @click=${(event: MouseEvent) => {
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
          // Optimistic tab paint before popstate/refresh RPCs finish.
          if (state.tab !== tab) {
            state.tab = tab;
          }
          pushAppHistoryState(href);
          return;
        }
        state.setTab(tab);
      }}
      title=${`${titleForTab(tab)} · ${tabSubtitle}`}
    >
      <span class="nav-item__icon" aria-hidden="true">${icons[iconForTab(tab)]}</span>
      <span class="nav-item__body">
        <span class="nav-item__text">${titleForTab(tab)}</span>
        ${metaLabel ? html`<span class="nav-item__meta">${metaLabel}</span>` : null}
      </span>
    </a>
  `;
}

function platformNavHref(state: AppViewState, entry: PlatformNavEntry): string {
  return `${pathForTab(entry.tab, state.basePath)}${entry.pathSuffix ?? ""}${entry.hash ?? ""}`;
}

function platformNavEntryActive(state: AppViewState, entry: PlatformNavEntry): boolean {
  if (entry.matchMode === "root" && typeof window !== "undefined") {
    const current = normalizePath(window.location.pathname);
    const root = normalizePath(pathForTab(entry.tab, state.basePath));
    return current === root;
  }
  if (
    (entry.matchMode === "suffix" || entry.matchMode === "tab-root-or-suffix") &&
    typeof window !== "undefined"
  ) {
    const current = normalizePath(window.location.pathname);
    const root = normalizePath(pathForTab(entry.tab, state.basePath));
    const target = normalizePath(
      `${pathForTab(entry.tab, state.basePath)}${entry.pathSuffix ?? ""}`,
    );
    const onSuffix = current === target || current.startsWith(`${target}/`);
    if (entry.matchMode === "tab-root-or-suffix") {
      return current === root || onSuffix;
    }
    return onSuffix;
  }
  return entry.activeOnTab === true && state.tab === entry.tab;
}

function handleSidebarRouteClick(event: MouseEvent, state: AppViewState, tab: Tab, href: string) {
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
    if (state.tab !== tab) {
      state.tab = tab;
    }
    pushAppHistoryState(href);
    return;
  }
  state.setTab(tab);
}

function renderPlatformNavLink(
  state: AppViewState,
  entry: PlatformNavEntry,
  options?: { primary?: boolean },
) {
  const href = platformNavHref(state, entry);
  const active = platformNavEntryActive(state, entry);
  return html`
    <a
      href=${href}
      class="nav-item nav-item--platform ${options?.primary ? "nav-item--platform-primary" : "nav-item--platform-sub"} ${
        active ? "active" : ""
      }"
      @click=${(event: MouseEvent) => handleSidebarRouteClick(event, state, entry.tab, href)}
      title=${`${entry.label} · ${titleForTab(entry.tab)}`}
    >
      ${
        entry.icon
          ? html`<span class="nav-item__icon" aria-hidden="true">${icons[entry.icon]}</span>`
          : nothing
      }
      <span class="nav-item__body">
        <span class="nav-item__text">${entry.label}</span>
      </span>
    </a>
  `;
}

export function visiblePlatformNavSections(scopes?: readonly string[] | null) {
  const access = resolvePlatformDomainAccess(scopes);
  return PLATFORM_NAV_SECTIONS.filter((section) => {
    if (section.id === "platform-productization") {
      return access.productization;
    }
    if (section.id === "platform-key-accounts") {
      return access.keyAccounts;
    }
    return true;
  });
}

function platformNavScopes(state: AppViewState): readonly string[] | undefined {
  return state.platformAuthState?.session?.scopes ?? state.bootstrapAuthSession?.scopes;
}

export function renderPlatformSidebarNav(state: AppViewState) {
  const overviewEntry: PlatformNavEntry = {
    id: "platform-overview",
    label: "平台总览",
    tab: "platformDashboard",
    icon: "barChart",
    activeOnTab: true,
  };

  return html`
    <div class="nav-platform-tree">
      ${renderPlatformNavLink(state, overviewEntry, { primary: true })}
      ${visiblePlatformNavSections(platformNavScopes(state)).map((section) => {
        // Single-entry sections render as flat top-level links (no collapsible group)
        if (section.entries.length === 1) {
          const entry = section.entries[0];
          const flatEntry: PlatformNavEntry = {
            ...entry,
            label: section.label,
            icon: section.icon,
          };
          return renderPlatformNavLink(state, flatEntry, { primary: true });
        }
        const isGroupCollapsed = state.settings.navGroupsCollapsed[section.id] ?? false;
        const hasActiveEntry = section.entries.some((entry) =>
          platformNavEntryActive(state, entry),
        );
        return html`
          <div
            class="nav-platform-section ${
              isGroupCollapsed && !hasActiveEntry ? "nav-platform-section--collapsed" : ""
            }"
          >
            <button
              class="nav-platform-section__button"
              @click=${() => {
                const next = { ...state.settings.navGroupsCollapsed };
                next[section.id] = !isGroupCollapsed;
                state.applySettings({
                  ...state.settings,
                  navGroupsCollapsed: next,
                });
              }}
              aria-expanded=${!isGroupCollapsed || hasActiveEntry}
            >
              <span class="nav-platform-section__icon" aria-hidden="true">${icons[section.icon]}</span>
              <span class="nav-platform-section__copy">
                <span class="nav-platform-section__label">${section.label}</span>
                ${
                  section.subtitle
                    ? html`<span class="nav-platform-section__subtitle">${section.subtitle}</span>`
                    : nothing
                }
              </span>
              <span class="nav-platform-section__chevron" aria-hidden="true">${isGroupCollapsed ? "+" : "−"}</span>
            </button>
            <div class="nav-platform-section__items">
              ${section.entries.map((entry) => renderPlatformNavLink(state, entry))}
            </div>
          </div>
        `;
      })}
    </div>
  `;
}

function renderCronFilterIcon(hiddenCount: number) {
  return html`
    <span style="position: relative; display: inline-flex; align-items: center;">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
      ${
        hiddenCount > 0
          ? html`<span
            style="
              position: absolute;
              top: -5px;
              right: -6px;
              background: var(--color-accent, #6366f1);
              color: #fff;
              border-radius: 999px;
              font-size: 9px;
              line-height: 1;
              padding: 1px 3px;
              pointer-events: none;
            "
          >${hiddenCount}</span
          >`
          : ""
      }
    </span>
  `;
}

export function renderChatControls(state: AppViewState) {
  const mainSessionKey = resolveMainSessionKey(state.hello, state.sessionsResult);
  const hideCron = state.sessionsHideCron ?? true;
  const hiddenCronCount = hideCron
    ? countHiddenCronSessions(state.sessionKey, state.sessionsResult)
    : 0;
  const sessionOptions = resolveSessionOptions(
    state.sessionKey,
    state.sessionsResult,
    mainSessionKey,
    hideCron,
  );
  const disableThinkingToggle = state.onboarding;
  const disableFocusToggle = state.onboarding;
  const showThinking = state.onboarding ? false : state.settings.chatShowThinking;
  const focusActive = state.onboarding ? true : state.settings.chatFocusMode;
  // Refresh icon
  const refreshIcon = html`
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
      <path d="M21 3v5h-5"></path>
    </svg>
  `;
  const focusIcon = html`
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M4 7V4h3"></path>
      <path d="M20 7V4h-3"></path>
      <path d="M4 17v3h3"></path>
      <path d="M20 17v3h-3"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `;
  return html`
    <div class="chat-controls">
      <label class="field chat-controls__session">
        <select
          .value=${state.sessionKey}
          ?disabled=${!state.connected}
          @change=${(e: Event) => {
            const next = (e.target as HTMLSelectElement).value;
            switchShellChatSession(state, next, {
              syncUrl: true,
              replaceUrl: true,
              refreshAvatar: false,
            });
          }}
        >
          ${repeat(
            sessionOptions,
            (entry) => entry.key,
            (entry) =>
              html`<option value=${entry.key} title=${entry.key}>
                ${entry.displayName ?? entry.key}
              </option>`,
          )}
        </select>
      </label>
      <button
        class="btn btn--sm btn--icon"
        ?disabled=${state.chatLoading || !state.connected}
        @click=${async () => {
          await manuallyRefreshShellChat(
            state as unknown as Parameters<typeof manuallyRefreshShellChat>[0],
            { includeSessions: true },
          );
        }}
        title=${t("chat.refreshTitle")}
      >
        ${refreshIcon}
      </button>
      <span class="chat-controls__separator">|</span>
      <button
        class="btn btn--sm btn--icon ${showThinking ? "active" : ""}"
        ?disabled=${disableThinkingToggle}
        @click=${() => {
          if (disableThinkingToggle) {
            return;
          }
          state.applySettings({
            ...state.settings,
            chatShowThinking: !state.settings.chatShowThinking,
          });
        }}
        aria-pressed=${showThinking}
        title=${disableThinkingToggle ? t("chat.onboardingDisabled") : t("chat.thinkingToggle")}
      >
        ${icons.brain}
      </button>
      <button
        class="btn btn--sm btn--icon ${focusActive ? "active" : ""}"
        ?disabled=${disableFocusToggle}
        @click=${() => {
          if (disableFocusToggle) {
            return;
          }
          state.applySettings({
            ...state.settings,
            chatFocusMode: !state.settings.chatFocusMode,
          });
        }}
        aria-pressed=${focusActive}
        title=${disableFocusToggle ? t("chat.onboardingDisabled") : t("chat.focusToggle")}
      >
        ${focusIcon}
      </button>
      <button
        class="btn btn--sm btn--icon ${hideCron ? "active" : ""}"
        @click=${() => {
          state.sessionsHideCron = !hideCron;
        }}
        aria-pressed=${hideCron}
        title=${
          hideCron
            ? hiddenCronCount > 0
              ? t("chat.showCronSessionsHidden", { count: String(hiddenCronCount) })
              : t("chat.showCronSessions")
            : t("chat.hideCronSessions")
        }
      >
        ${renderCronFilterIcon(hiddenCronCount)}
      </button>
    </div>
  `;
}

function resolveMainSessionKey(
  hello: AppViewState["hello"],
  sessions: SessionsListResult | null,
): string | null {
  const snapshot = hello?.snapshot as { sessionDefaults?: SessionDefaultsSnapshot } | undefined;
  const mainSessionKey = snapshot?.sessionDefaults?.mainSessionKey?.trim();
  if (mainSessionKey) {
    return mainSessionKey;
  }
  const mainKey = snapshot?.sessionDefaults?.mainKey?.trim();
  if (mainKey) {
    return mainKey;
  }
  if (sessions?.sessions?.some((row) => row.key === "main")) {
    return "main";
  }
  return null;
}

/* ── Channel display labels ────────────────────────────── */
const CHANNEL_LABELS: Record<string, string> = {
  bluebubbles: "iMessage",
  telegram: "Telegram",
  discord: "Discord",
  signal: "Signal",
  slack: "Slack",
  whatsapp: "WhatsApp",
  matrix: "Matrix",
  email: "Email",
  sms: "SMS",
};

const KNOWN_CHANNEL_KEYS = Object.keys(CHANNEL_LABELS);

/** Parsed type / context extracted from a session key. */
export type SessionKeyInfo = {
  /** Prefix for typed sessions (Subagent:/Cron:). Empty for others. */
  prefix: string;
  /** Human-readable fallback when no label / displayName is available. */
  fallbackName: string;
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Parse a session key to extract type information and a human-readable
 * fallback display name.  Exported for testing.
 */
export function parseSessionKey(key: string): SessionKeyInfo {
  const normalized = key.toLowerCase();

  // ── Main session ─────────────────────────────────
  if (key === "main" || key === "agent:main:main") {
    return { prefix: "", fallbackName: "Main Session" };
  }

  // ── Subagent ─────────────────────────────────────
  if (key.includes(":subagent:")) {
    return { prefix: "Subagent:", fallbackName: "Subagent:" };
  }

  // ── Cron job ─────────────────────────────────────
  if (normalized.startsWith("cron:") || key.includes(":cron:")) {
    return { prefix: "Cron:", fallbackName: "Cron Job:" };
  }

  // ── Direct chat  (agent:<x>:<channel>:direct:<id>) ──
  const directMatch = key.match(/^agent:[^:]+:([^:]+):direct:(.+)$/);
  if (directMatch) {
    const channel = directMatch[1];
    const identifier = directMatch[2];
    const channelLabel = CHANNEL_LABELS[channel] ?? capitalize(channel);
    return { prefix: "", fallbackName: `${channelLabel} · ${identifier}` };
  }

  // ── Group chat  (agent:<x>:<channel>:group:<id>) ────
  const groupMatch = key.match(/^agent:[^:]+:([^:]+):group:(.+)$/);
  if (groupMatch) {
    const channel = groupMatch[1];
    const channelLabel = CHANNEL_LABELS[channel] ?? capitalize(channel);
    return { prefix: "", fallbackName: `${channelLabel} Group` };
  }

  // ── Channel-prefixed legacy keys (e.g. "bluebubbles:g-…") ──
  for (const ch of KNOWN_CHANNEL_KEYS) {
    if (key === ch || key.startsWith(`${ch}:`)) {
      return { prefix: "", fallbackName: `${CHANNEL_LABELS[ch]} Session` };
    }
  }

  // ── Unknown — return key as-is ───────────────────
  return { prefix: "", fallbackName: key };
}

export function resolveSessionDisplayName(
  key: string,
  row?: SessionsListResult["sessions"][number],
): string {
  const label = row?.label?.trim() || "";
  const displayName = row?.displayName?.trim() || "";
  const { prefix, fallbackName } = parseSessionKey(key);

  const applyTypedPrefix = (name: string): string => {
    if (!prefix) {
      return name;
    }
    const prefixPattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*`, "i");
    return prefixPattern.test(name) ? name : `${prefix} ${name}`;
  };

  if (label && label !== key) {
    return applyTypedPrefix(label);
  }
  if (displayName && displayName !== key) {
    return applyTypedPrefix(displayName);
  }
  return fallbackName;
}

export function isCronSessionKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith("cron:")) {
    return true;
  }
  if (!normalized.startsWith("agent:")) {
    return false;
  }
  const parts = normalized.split(":").filter(Boolean);
  if (parts.length < 3) {
    return false;
  }
  const rest = parts.slice(2).join(":");
  return rest.startsWith("cron:");
}

function resolveSessionOptions(
  sessionKey: string,
  sessions: SessionsListResult | null,
  mainSessionKey?: string | null,
  hideCron = false,
) {
  const seen = new Set<string>();
  const options: Array<{ key: string; displayName?: string }> = [];

  const resolvedMain = mainSessionKey && sessions?.sessions?.find((s) => s.key === mainSessionKey);
  const resolvedCurrent = sessions?.sessions?.find((s) => s.key === sessionKey);

  // Add main session key first
  if (mainSessionKey) {
    seen.add(mainSessionKey);
    options.push({
      key: mainSessionKey,
      displayName: resolveSessionDisplayName(mainSessionKey, resolvedMain || undefined),
    });
  }

  // Add current session key next — always include it even if it's a cron session,
  // so the active session is never silently dropped from the select.
  if (!seen.has(sessionKey)) {
    seen.add(sessionKey);
    options.push({
      key: sessionKey,
      displayName: resolveSessionDisplayName(sessionKey, resolvedCurrent),
    });
  }

  // Add sessions from the result, optionally filtering out cron sessions.
  if (sessions?.sessions) {
    for (const s of sessions.sessions) {
      if (!seen.has(s.key) && !(hideCron && isCronSessionKey(s.key))) {
        seen.add(s.key);
        options.push({
          key: s.key,
          displayName: resolveSessionDisplayName(s.key, s),
        });
      }
    }
  }

  return options;
}

/** Count sessions with a cron: key that would be hidden when hideCron=true. */
function countHiddenCronSessions(sessionKey: string, sessions: SessionsListResult | null): number {
  if (!sessions?.sessions) {
    return 0;
  }
  // Don't count the currently active session even if it's a cron.
  return sessions.sessions.filter((s) => isCronSessionKey(s.key) && s.key !== sessionKey).length;
}
