import { html, nothing } from "lit";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import { pushAppHistoryState, requestOpenBotAppRerender } from "../../../request-app-rerender.ts";
import type { OperationalIdentityGovernancePanelProps } from "../../../views/operational-identity-governance-panel.ts";
import type { PlatformAuthPanelProps } from "../../../views/platform-auth-panel.ts";
import type { PlatformPortReadModel } from "../semantic/platform-read-model.ts";
import type { PlatformPageViewModels } from "../view-models/types.ts";
import type { PlatformPortRenderModel } from "../view-types.ts";

export type PlatformSurfaceTab =
  | "platformDashboard"
  | "platformTenants"
  | "platformPricing"
  | "platformCapabilities"
  | "platformModels"
  | "platformAgents"
  | "platformObservation"
  | "platformDiagnosis"
  | "platformAdvanced"
  | "platformSystemSettings"
  | "platformProductization"
  | "platformKeyAccounts";

export type PlatformSurfaceProps = {
  tab: PlatformSurfaceTab;
  basePath: string;
  client?: GatewayBrowserClient | null;
  readModel: PlatformPortReadModel;
  observationHost?: object | null;
  channelsProps: PlatformPortRenderModel["channelsProps"];
  skillsProps?: PlatformPortRenderModel["skillsProps"];
  instancesProps?: PlatformPortRenderModel["instancesProps"];
  nodesProps?: PlatformPortRenderModel["nodesProps"];
  sessionsProps?: PlatformPortRenderModel["sessionsProps"];
  logsProps?: PlatformPortRenderModel["logsProps"];
  authPanelProps?: PlatformAuthPanelProps | null;
  operationalIdentityGovernancePanel?: OperationalIdentityGovernancePanelProps;
  pageViewModels?: PlatformPageViewModels;
  actions: PlatformPortRenderModel["surfaceActions"];
  /** Operator scopes used to isolate 产品化 and 大客户管理. */
  scopes?: readonly string[] | null;
  sessionKind?: string | null;
  gatewayMethods?: readonly string[] | null;
  connected?: boolean;
};

export type SurfaceStat = {
  label: string;
  value: string;
  tone?: "ok" | "warn";
};

export type SurfaceSection = {
  title: string;
  subtitle: string;
  stats?: SurfaceStat[];
  chips?: string[];
  notes?: string[];
};

/** 平台子页 Tab 切换时强制宿主重绘（与企业端 requestEnterpriseAppRerender 对称）。 */
export function requestPlatformSurfaceRerender(): void {
  requestOpenBotAppRerender();
}

export function followPortHref(event: MouseEvent, href: string) {
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
  pushAppHistoryState(href);
}

export function renderSurfaceCard(params: {
  title: string;
  subtitle: string;
  stats: SurfaceStat[];
  chips?: string[];
  notes?: string[];
}) {
  return html`
    <section class="card">
      <div class="card-title">${params.title}</div>
      <div class="card-sub">${params.subtitle}</div>
      <div class="stat-grid stat-grid--compact card-follow">
        ${params.stats.map(
          (stat) => html`
            <div class="stat stat--compact">
              <div class="stat-label">${stat.label}</div>
              <div
                class="stat-value ${stat.tone === "ok" ? "ok" : stat.tone === "warn" ? "warn" : ""}"
              >
                ${stat.value}
              </div>
            </div>
          `,
        )}
      </div>
      ${
        params.chips?.length
          ? html`
              <div class="chip-row card-follow">
                ${params.chips.map((chip) => html`<span class="chip mono">${chip}</span>`)}
              </div>
            `
          : nothing
      }
      ${
        params.notes?.length
          ? html`
              <div class="list card-follow">
                ${params.notes.map(
                  (note) => html`
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-sub">${note}</div>
                      </div>
                    </div>
                  `,
                )}
              </div>
            `
          : nothing
      }
    </section>
  `;
}

export function renderDashboardSummary(params: {
  subtitle: string;
  stats: SurfaceStat[];
  notes?: string[];
}) {
  return html`
    <section class="card">
      <div class="card-sub">${params.subtitle}</div>
      <div class="stat-grid stat-grid--compact card-follow">
        ${params.stats.map(
          (stat) => html`
            <div class="stat stat--compact">
              <div class="stat-label">${stat.label}</div>
              <div
                class="stat-value ${stat.tone === "ok" ? "ok" : stat.tone === "warn" ? "warn" : ""}"
              >
                ${stat.value}
              </div>
            </div>
          `,
        )}
      </div>
      ${
        params.notes?.length
          ? html`
              <div class="chip-row card-follow">
                ${params.notes.map((note) => html`<span class="chip">${note}</span>`)}
              </div>
            `
          : nothing
      }
    </section>
  `;
}

export function renderSectionGrid(sections: SurfaceSection[]) {
  return html`
    <div class="grid grid-cols-3 card-follow">
      ${sections.map(
        (section) => html`
          <section class="card">
            <div class="card-title">${section.title}</div>
            <div class="card-sub">${section.subtitle}</div>
            ${
              section.stats?.length
                ? html`
                    <div class="grid grid-cols-2 card-follow">
                      ${section.stats.map(
                        (stat) => html`
                          <div class="stat">
                            <div class="stat-label">${stat.label}</div>
                            <div
                              class="stat-value ${stat.tone === "ok" ? "ok" : stat.tone === "warn" ? "warn" : ""}"
                            >
                              ${stat.value}
                            </div>
                          </div>
                        `,
                      )}
                    </div>
                  `
                : nothing
            }
            ${
              section.chips?.length
                ? html`
                    <div class="chip-row card-follow">
                      ${section.chips.map((chip) => html`<span class="chip mono">${chip}</span>`)}
                    </div>
                  `
                : nothing
            }
            ${
              section.notes?.length
                ? html`
                    <div class="list card-follow">
                      ${section.notes.map(
                        (note) => html`
                          <div class="list-item">
                            <div class="list-main">
                              <div class="list-sub">${note}</div>
                            </div>
                          </div>
                        `,
                      )}
                    </div>
                  `
                : nothing
            }
          </section>
        `,
      )}
    </div>
  `;
}

export function renderWorkspacePanel(params: {
  title: string;
  subtitle: string;
  actionLabel: string;
  onAction: () => unknown;
  items: Array<{ title: string; subtitle?: string; meta?: string; href?: string }>;
  empty: string;
}) {
  return html`
    <section class="card card-follow">
      <div class="row row--split">
        <div>
          <div class="card-title">${params.title}</div>
          <div class="card-sub">${params.subtitle}</div>
        </div>
        <button class="btn" @click=${params.onAction}>${params.actionLabel}</button>
      </div>
      <div class="list card-follow">
        ${
          params.items.length === 0
            ? html`<div class="muted">${params.empty}</div>`
            : params.items.map((item) =>
                item.href
                  ? html`
                      <a
                        class="list-item list-item-route"
                        href=${item.href}
                        @click=${(event: MouseEvent) => followPortHref(event, item.href!)}
                      >
                        <div class="list-main">
                          <div class="list-title">${item.title}</div>
                          ${item.subtitle ? html`<div class="list-sub">${item.subtitle}</div>` : nothing}
                        </div>
                        ${item.meta ? html`<div class="list-meta">${item.meta}</div>` : nothing}
                      </a>
                    `
                  : html`
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">${item.title}</div>
                          ${item.subtitle ? html`<div class="list-sub">${item.subtitle}</div>` : nothing}
                        </div>
                        ${item.meta ? html`<div class="list-meta">${item.meta}</div>` : nothing}
                      </div>
                    `,
              )
        }
      </div>
    </section>
  `;
}

export function platformEnterpriseStatusLabel(status: "trial" | "paid" | "suspended" | "expired") {
  switch (status) {
    case "trial":
      return "试用中";
    case "paid":
      return "正式租户";
    case "suspended":
      return "已暂停";
    case "expired":
      return "试用到期";
    default:
      return status;
  }
}

export function platformEnterpriseSourceLabel(source: "self-service" | "platform-created") {
  return source === "platform-created" ? "平台创建" : "自助试用";
}
