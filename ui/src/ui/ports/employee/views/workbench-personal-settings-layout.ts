import { html, nothing, type TemplateResult } from "lit";
import type { WorkbenchAuthorizationIdentityTab } from "./workbench-types.ts";

export function renderPersonalSettingsTabIntro(title: string, subtitle?: string) {
  return html`
    <div
      class="employee-workbench__settings-section-head employee-workbench__settings-section-head--personal-tab"
    >
      <div class="employee-workbench__settings-section-title">${title}</div>
      ${
        subtitle
          ? html`
              <div class="employee-workbench__settings-section-subtitle">${subtitle}</div>
            `
          : nothing
      }
    </div>
  `;
}

export function renderAuthorizationIdentitySegment(params: {
  active: WorkbenchAuthorizationIdentityTab;
  onSelect: (tab: WorkbenchAuthorizationIdentityTab) => void;
}) {
  const tabs: Array<{ id: WorkbenchAuthorizationIdentityTab; label: string }> = [
    { id: "personal", label: "个人" },
    { id: "enterprise", label: "企业" },
  ];
  return html`
    <div
      class="employee-workbench__authorization-identity-tabs"
      role="tablist"
      aria-label="身份类型"
    >
      ${tabs.map(
        (tab) => html`
          <button
            type="button"
            class="employee-workbench__authorization-identity-tab ${params.active === tab.id ? "is-active" : ""}"
            role="tab"
            aria-selected=${params.active === tab.id ? "true" : "false"}
            @click=${() => params.onSelect(tab.id)}
          >
            ${tab.label}
          </button>
        `,
      )}
    </div>
  `;
}

export function renderPersonalSettingsPanel(params: {
  title: string;
  subtitle?: string;
  modifier?: string;
  content: TemplateResult;
}) {
  return html`
    <section class="employee-workbench__settings-personal-panel ${params.modifier ?? ""}">
      <header class="employee-workbench__settings-personal-panel-head">
        <div class="employee-workbench__settings-personal-panel-copy">
          <div class="employee-workbench__settings-personal-panel-title">${params.title}</div>
          ${
            params.subtitle
              ? html`
                <div class="employee-workbench__settings-personal-panel-subtitle">
                  ${params.subtitle}
                </div>
              `
              : nothing
          }
        </div>
      </header>
      <div class="employee-workbench__settings-personal-panel-body">${params.content}</div>
    </section>
  `;
}

export function renderPersonalSettingsSection(content: TemplateResult) {
  return html`
    <div
      class="employee-workbench__settings-section employee-workbench__settings-section--personal-tab"
    >
      ${content}
    </div>
  `;
}

export function renderPersonalTabIntro(title: string, subtitle: string) {
  return renderPersonalSettingsTabIntro(title, subtitle);
}

export function renderPersonalPanel(params: {
  title: string;
  subtitle?: string;
  modifier?: string;
  content: TemplateResult;
}) {
  return renderPersonalSettingsPanel(params);
}

export function joinPersonalDisplayLabels(
  labels: string[] | undefined,
  fallbackIds: string[] | undefined,
) {
  const resolved = (labels ?? []).map((item) => item.trim()).filter(Boolean);
  if (resolved.length > 0) {
    return resolved;
  }
  return (fallbackIds ?? []).map((item) => item.trim()).filter(Boolean);
}

export function renderPersonalSettingsRow(label: string, value: unknown, className = "") {
  return html`
    <div class="employee-workbench__settings-row">
      <div class="employee-workbench__settings-label">${label}</div>
      <div class="employee-workbench__settings-value ${className}">${value}</div>
    </div>
  `;
}

export function renderPersonalSettingsChipRow(label: string, items: string[], emptyLabel: string) {
  const chips = items.map((item) => item.trim()).filter(Boolean);
  return html`
    <div class="employee-workbench__settings-row employee-workbench__settings-row--chips">
      <div class="employee-workbench__settings-label">${label}</div>
      <div class="employee-workbench__settings-value">
        ${
          chips.length > 0
            ? html`
              <div class="employee-workbench__settings-chip-list">
                ${chips.map(
                  (item) => html`
                    <span class="employee-workbench__settings-chip">${item}</span>
                  `,
                )}
              </div>
            `
            : emptyLabel
        }
      </div>
    </div>
  `;
}

export function renderPersonalMetaList(rows: TemplateResult[]) {
  return html`
    <div class="employee-workbench__settings-list employee-workbench__settings-list--meta">
      ${rows}
    </div>
  `;
}

export function personalThemeLabel(theme: string, locale: string) {
  if (locale === "en") {
    if (theme === "system") {
      return "System";
    }
    return theme === "dark" ? "Dark" : "Light";
  }
  if (theme === "system") {
    return "跟随系统";
  }
  return theme === "dark" ? "深色" : "浅色";
}

function renderSegmentButton(params: {
  active: boolean;
  label: string;
  description?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return html`
    <button
      type="button"
      class="employee-workbench__settings-segment ${params.active ? "is-active" : ""}"
      ?aria-pressed=${params.active}
      ?disabled=${Boolean(params.disabled)}
      title=${params.description ?? params.label}
      @click=${params.onClick}
    >
      <span class="employee-workbench__settings-segment-label">${params.label}</span>
      ${
        params.description
          ? html`
            <span class="employee-workbench__settings-segment-copy">${params.description}</span>
          `
          : nothing
      }
    </button>
  `;
}

export function renderPersonalSegmentRail(
  segments: Array<Parameters<typeof renderSegmentButton>[0]>,
) {
  return html`
    <div class="employee-workbench__settings-segments employee-workbench__settings-segments--rail">
      ${segments.map((segment) => renderSegmentButton(segment))}
    </div>
  `;
}

export function renderPersonalPreferenceField(label: string, content: TemplateResult) {
  return html`
    <div class="employee-workbench__settings-personal-field">
      <div class="employee-workbench__settings-personal-field-label">${label}</div>
      <div class="employee-workbench__settings-personal-field-control">${content}</div>
    </div>
  `;
}

export function renderPersonalToggleRow(params: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: (checked: boolean) => void;
}) {
  return html`
    <button
      type="button"
      class="employee-workbench__settings-toggle ${params.checked ? "is-active" : ""}"
      role="switch"
      aria-checked=${String(params.checked)}
      ?disabled=${Boolean(params.disabled)}
      @click=${() => params.onToggle(!params.checked)}
    >
      <span class="employee-workbench__settings-toggle-copy">
        <span class="employee-workbench__settings-toggle-title">${params.title}</span>
        <span class="employee-workbench__settings-toggle-description">${params.description}</span>
      </span>
      <span class="employee-workbench__settings-toggle-track" aria-hidden="true">
        <span class="employee-workbench__settings-toggle-thumb"></span>
      </span>
    </button>
  `;
}
