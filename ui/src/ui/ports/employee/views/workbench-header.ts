import { html } from "lit";
import { t, type Locale } from "../../../../i18n/index.ts";
import { icons } from "../../../icons.ts";
import { pathForTab } from "../../../navigation.ts";
import { pushAppHistoryState } from "../../../request-app-rerender.ts";
import type { ThemeMode } from "../../../theme.ts";

export type WorkbenchHeaderProps = {
  title: string;
  profileLabel: string;
  connected: boolean;
  currentLocale: Locale;
  currentTheme: ThemeMode;
  userProfileName: string;
  userProfileSignature: string;
  tenantLabel?: string;
  onLocaleChange: (locale: Locale) => void;
  onThemeChange: (theme: ThemeMode) => void;
  onOpenPersonalSettings: () => void;
  onLogout: () => void;
};

function resolveLocale(value: Locale): Locale {
  return value === "en" ? "en" : "zh-CN";
}

function resolveTheme(value: ThemeMode): ThemeMode {
  return value === "dark" ? "dark" : "light";
}

function renderMoonIcon() {
  return html`
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
  `;
}

function renderSunIcon() {
  return html`
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

function nextLocale(locale: Locale): Locale {
  return locale === "zh-CN" ? "en" : "zh-CN";
}

function nextTheme(theme: ThemeMode): ThemeMode {
  return theme === "dark" ? "light" : "dark";
}

function themeIcon(theme: ThemeMode) {
  return theme === "dark" ? renderMoonIcon() : renderSunIcon();
}

function themeLabel(theme: ThemeMode, locale: Locale) {
  if (locale === "en") {
    return theme === "dark" ? "Dark" : "Light";
  }
  return theme === "dark" ? "深色" : "浅色";
}

function closeHeaderUserMenu(event: Event) {
  const menu = (event.currentTarget as HTMLElement | null)?.closest(
    ".employee-workbench__header-usermenu",
  );
  const trigger = menu?.querySelector<HTMLElement>(".employee-workbench__header-userpill");
  trigger?.blur();
}

export function renderWorkbenchHeader(props: WorkbenchHeaderProps) {
  const locale = resolveLocale(props.currentLocale);
  const theme = resolveTheme(props.currentTheme);
  const title = props.title.trim();
  const headerClass = ["employee-workbench__header", title ? "" : "is-titleless"]
    .filter(Boolean)
    .join(" ");
  const userName = props.userProfileName.trim() || props.profileLabel || "OpenBot";
  const nextLocaleValue = nextLocale(locale);
  const nextThemeValue = nextTheme(theme);
  const userMonogram = (userName.trim()[0] ?? "U").toUpperCase();
  const userBadgeLabel =
    props.userProfileSignature.trim() ||
    props.tenantLabel?.trim() ||
    `${themeLabel(theme, locale)} · ${props.connected ? t("common.ok") : t("common.offline")}`;

  return html`
    <header class=${headerClass}>
      ${
        title
          ? html`
            <div class="employee-workbench__header-main">
              <div class="employee-workbench__header-title">${title}</div>
            </div>
          `
          : null
      }
      <div class="employee-workbench__header-meta">
        <div class="employee-workbench__header-tools">
        <button
          type="button"
          class="btn btn--sm btn--icon employee-workbench__round-btn"
          data-tone="locale"
          title=${t("common.language")}
          aria-label=${t("common.language")}
          @click=${() => props.onLocaleChange(nextLocaleValue)}
        >
          ${icons.globe}
        </button>
        <button
          type="button"
          class="btn btn--sm btn--icon employee-workbench__round-btn"
          data-tone="theme"
          title=${t("common.theme")}
          aria-label=${t("common.theme")}
          @click=${() => props.onThemeChange(nextThemeValue)}
        >
          ${themeIcon(theme)}
        </button>
        <div class="employee-workbench__header-usermenu">
          <button
            type="button"
            class="btn btn--sm btn--icon employee-workbench__round-btn employee-workbench__header-userpill"
            title=${userBadgeLabel}
            aria-label=${userName}
            aria-haspopup="menu"
          >
            <span class="employee-workbench__header-userpill-status" aria-hidden="true"></span>
            <span class="employee-workbench__header-userpill-text">${userMonogram}</span>
          </button>
          <div class="employee-workbench__header-usermenu-drop">
            <div class="employee-workbench__header-usermenu-panel" role="menu" aria-label=${userName}>
              <button
                type="button"
                class="employee-workbench__header-usermenu-item"
                role="menuitem"
                @click=${(event: Event) => {
                  closeHeaderUserMenu(event);
                  props.onOpenPersonalSettings();
                }}
              >
                ${t("frontstage.workbench.profileMenu.personalSettings")}
              </button>
              <button
                type="button"
                class="employee-workbench__header-usermenu-item"
                role="menuitem"
                data-testid="workbench-header-help"
                @click=${(event: Event) => {
                  closeHeaderUserMenu(event);
                  pushAppHistoryState(pathForTab("help"));
                }}
              >
                ${t("authHome.nav.legal.help")}
              </button>
              <button
                type="button"
                class="employee-workbench__header-usermenu-item is-danger"
                role="menuitem"
                @click=${(event: Event) => {
                  closeHeaderUserMenu(event);
                  props.onLogout();
                }}
              >
                ${t("frontstage.workbench.profileMenu.logout")}
              </button>
            </div>
          </div>
        </div>
        </div>
      </div>
    </header>
  `;
}
