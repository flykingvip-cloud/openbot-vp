import { html } from "lit";
import { OPERATIONAL_IDENTITY_SECTION_ID } from "../operational-identity-navigation.ts";
import {
  buildUserOperationalIdentityAddNav,
  type UserOperationalIdentityNav,
} from "../semantic/view-controller-facade.ts";
import { renderOperationalIdentitySection } from "./workbench-operational-identity-section.ts";
import { sortReadyCatalog } from "./workbench-personal-authorization-catalog.ts";
import type { SettingsContract } from "./workbench-stage-contracts.ts";

export { sortReadyCatalog } from "./workbench-personal-authorization-catalog.ts";

/**
 * Category header row in the left nav (e.g. 绑定账户 / 授权管理). Rendered with a
 * filled background so it reads as a section heading, visually distinct from the
 * individual provider menu items nested beneath it.
 */
function renderAuthNavCategory(params: {
  key: UserOperationalIdentityNav;
  label: string;
  active: boolean;
  onSelect: (nav: UserOperationalIdentityNav) => void;
}) {
  return html`
    <button
      type="button"
      class="employee-workbench__auth-nav-category ${params.active ? "is-active" : ""}"
      aria-current=${params.active ? "page" : "false"}
      @click=${() => params.onSelect(params.key)}
    >
      ${params.label}
    </button>
  `;
}

function renderAuthNavItem(params: {
  key: UserOperationalIdentityNav;
  label: string;
  active: boolean;
  configured?: boolean;
  disabled?: boolean;
  onSelect: (nav: UserOperationalIdentityNav) => void;
}) {
  return html`
    <button
      type="button"
      class="employee-workbench__auth-nav-item ${params.active ? "is-active" : ""} ${params.configured ? "is-configured" : ""}"
      ?disabled=${Boolean(params.disabled)}
      aria-current=${params.active ? "page" : "false"}
      @click=${() => params.onSelect(params.key)}
    >
      <span class="employee-workbench__auth-nav-item-label">${params.label}</span>
      ${
        params.configured
          ? html`
              <span class="employee-workbench__auth-nav-item-badge">已配置</span>
            `
          : ""
      }
    </button>
  `;
}

export function renderPersonalAuthorizationPanel(settings: SettingsContract) {
  const snapshot = settings.userOperationalIdentitySnapshot;
  const catalog = snapshot?.providerCatalog ?? [];
  const readyCatalog = sortReadyCatalog(catalog.filter((entry) => entry.registrationReady));
  const feishu = catalog.find((entry) => entry.provider === "feishu-personal");
  if (feishu && !readyCatalog.some((entry) => entry.provider === "feishu-personal")) {
    readyCatalog.push({ ...feishu, label: "飞书" });
  }
  const configuredProviders = new Set(
    (snapshot?.identities ?? [])
      .filter(
        (identity) =>
          identity.status === "active" ||
          identity.status === "reauth_required" ||
          identity.status === "expired",
      )
      .map((identity) => identity.provider),
  );
  const activeNav = settings.userOperationalIdentityNav ?? "bound";
  const onNav = (nav: UserOperationalIdentityNav) => {
    settings.onUserOperationalIdentityNavChange?.(nav);
  };

  return html`
    <div
      class="employee-workbench__settings-section employee-workbench__settings-section--personal-tab employee-workbench__settings-section--personal-authorization"
    >
      <div class="employee-workbench__auth-split">
        <nav class="employee-workbench__auth-split-nav" aria-label="授权配置项">
          <div class="employee-workbench__auth-nav-group">
            ${renderAuthNavCategory({
              key: "bound",
              label: "绑定账户",
              active: activeNav === "bound",
              onSelect: onNav,
            })}
            ${readyCatalog.map((entry) =>
              renderAuthNavItem({
                key: buildUserOperationalIdentityAddNav(entry.provider),
                label: entry.label,
                active: activeNav === buildUserOperationalIdentityAddNav(entry.provider),
                configured: configuredProviders.has(entry.provider),
                onSelect: onNav,
              }),
            )}
          </div>
        </nav>

        <div
          id=${OPERATIONAL_IDENTITY_SECTION_ID}
          class="employee-workbench__auth-split-main"
          role="tabpanel"
          aria-live="polite"
        >
          ${renderOperationalIdentitySection(settings, { embedded: true })}
        </div>
      </div>
    </div>
  `;
}
