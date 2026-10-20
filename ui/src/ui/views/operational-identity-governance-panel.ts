/**
 * Operational Identity Governance — read-only monitoring panel (P2 Task 2.4).
 *
 * Renders the user-owned operational identity governance overview for the
 * platform/enterprise console. Scope is resolved server-side; platform sessions
 * see a per-tenant breakdown, enterprise sessions see their own tenant.
 *
 * @module views/operational-identity-governance-panel
 */

import { html, nothing, type TemplateResult } from "lit";
import type {
  GovernanceLifecycleEventView,
  GovernanceUsageEventView,
  OperationalIdentityGovernanceOverview,
} from "../controllers/operational-identity-governance.ts";
import { renderIcon } from "../icons.ts";

export type OperationalIdentityGovernancePanelProps = {
  overview: OperationalIdentityGovernanceOverview | null;
  loading: boolean;
  error: string | null;
  /** When set to enterprise, platform-scoped payloads are blocked from rendering. */
  viewContext?: "platform" | "enterprise";
  /** Optional link to the enterprise identity management section. */
  identitiesHref?: string | null;
};

const SCOPE_LABEL: Record<string, string> = {
  platform: "平台（全部租户）",
  tenant: "本企业",
  self: "本人",
};

const LIFECYCLE_LABEL: Record<GovernanceLifecycleEventView["action"], string> = {
  created: "新建",
  reauthorized: "重新授权",
  revoked: "已吊销",
};

type GovernanceMetric = {
  label: string;
  value: number;
  tone?: "ok" | "warn";
};

function renderGovernanceMetrics(metrics: GovernanceMetric[]): TemplateResult {
  return html`
    <div class="enterprise-settings-stat-grid enterprise-governance-panel__metrics">
      ${metrics.map(
        (metric) => html`
          <div class="enterprise-settings-stat">
            <span class="enterprise-settings-stat__label">${metric.label}</span>
            <strong class="enterprise-settings-stat__value ${metric.tone ? `is-${metric.tone}` : ""}"
              >${metric.value}</strong
            >
          </div>
        `,
      )}
    </div>
  `;
}

function buildGovernanceMetrics(
  overview: OperationalIdentityGovernanceOverview,
): GovernanceMetric[] {
  const { totals } = overview;
  return [
    { label: "身份总数", value: totals.identities },
    { label: "活跃", value: totals.active, tone: totals.active > 0 ? "ok" : undefined },
    {
      label: "待重授权",
      value: totals.reauthRequired,
      tone: totals.reauthRequired > 0 ? "warn" : undefined,
    },
    { label: "已过期", value: totals.expired, tone: totals.expired > 0 ? "warn" : undefined },
    { label: "活跃授权", value: overview.activeGrants },
    {
      label: "待绑定请求",
      value: overview.pendingBindingRequests,
      tone: overview.pendingBindingRequests > 0 ? "warn" : undefined,
    },
  ];
}

function renderDenials(events: GovernanceUsageEventView[]): TemplateResult {
  if (events.length === 0) {
    return html`
      <div class="enterprise-settings-empty enterprise-governance-panel__empty">近期无拒绝事件。</div>
    `;
  }
  return html`
    <ul class="enterprise-settings-row-list">
      ${events.map(
        (event) => html`
          <li class="enterprise-settings-row enterprise-settings-row--warn">
            <div class="enterprise-settings-row__main">
              <div class="enterprise-settings-row__title">${event.provider}</div>
              <div class="enterprise-settings-row__meta">
                ${event.action} · ${event.denialCode ?? "denied"}
              </div>
            </div>
            <span class="enterprise-mesh-badge enterprise-mesh-badge--danger">${event.ownerId}</span>
          </li>
        `,
      )}
    </ul>
  `;
}

function renderLifecycle(events: GovernanceLifecycleEventView[]): TemplateResult {
  if (events.length === 0) {
    return html`
      <div class="enterprise-settings-empty enterprise-governance-panel__empty">近期无生命周期事件。</div>
    `;
  }
  return html`
    <ul class="enterprise-settings-row-list">
      ${events.map(
        (event) => html`
          <li class="enterprise-settings-row">
            <div class="enterprise-settings-row__main">
              <div class="enterprise-settings-row__title">${event.provider}</div>
              <div class="enterprise-settings-row__meta">${event.ownerId}</div>
            </div>
            <span class="enterprise-mesh-badge">${LIFECYCLE_LABEL[event.action]}</span>
          </li>
        `,
      )}
    </ul>
  `;
}

const ENTERPRISE_SCOPE_MISMATCH_MESSAGE =
  "当前会话无法解析本企业作用域。请使用企业管理员账号登录，或确认已选择正确的企业租户。";

function renderPanelShell(params: {
  useEnterpriseShell: boolean;
  scopeLabel?: string;
  identitiesHref?: string | null;
  content: TemplateResult;
}): TemplateResult {
  const { useEnterpriseShell, scopeLabel, identitiesHref, content } = params;
  if (useEnterpriseShell) {
    return html`
      <article class="enterprise-card enterprise-settings-panel enterprise-governance-panel">
        <div class="enterprise-settings-panel__head">
          <span class="enterprise-settings-panel__icon"
            >${renderIcon("globe", "enterprise-settings-panel__icon-svg")}</span
          >
          <div>
            <div class="enterprise-settings-panel__title">运营身份监管</div>
            <div class="enterprise-settings-panel__sub">
              本企业运营身份、授权与拒绝事件监控${scopeLabel ? html` · 作用域：${scopeLabel}` : nothing}
            </div>
          </div>
          ${
            identitiesHref
              ? html`<a class="btn btn--sm enterprise-settings-panel__head-action" href=${identitiesHref}
                  >管理身份</a
                >`
              : nothing
          }
        </div>
        ${content}
      </article>
    `;
  }
  return html`
    <section class="card enterprise-governance-panel enterprise-governance-panel--platform" aria-label="运营身份监管">
      <div class="enterprise-settings-panel__head">
        <span class="enterprise-settings-panel__icon"
          >${renderIcon("globe", "enterprise-settings-panel__icon-svg")}</span
        >
        <div>
          <div class="enterprise-settings-panel__title">运营身份监管</div>
          <div class="enterprise-settings-panel__sub">
            ${scopeLabel ? `作用域：${scopeLabel}` : "运营身份、授权与拒绝事件监控。"}
          </div>
        </div>
      </div>
      ${content}
    </section>
  `;
}

function renderOverviewBody(overview: OperationalIdentityGovernanceOverview): TemplateResult {
  return html`
    ${renderGovernanceMetrics(buildGovernanceMetrics(overview))}

    ${
      overview.tenantBreakdown && overview.tenantBreakdown.length > 0
        ? html`
            <div class="enterprise-governance-subsection">
              <div class="enterprise-governance-subsection__title">按企业下钻</div>
              <ul class="enterprise-settings-row-list">
                ${overview.tenantBreakdown.map(
                  (entry) => html`
                    <li class="enterprise-settings-row">
                      <div class="enterprise-settings-row__main">
                        <div class="enterprise-settings-row__title">${entry.tenantId}</div>
                        <div class="enterprise-settings-row__meta">
                          身份 ${entry.identities} · 授权 ${entry.activeGrants} · 拒绝 ${entry.denials}
                        </div>
                      </div>
                    </li>
                  `,
                )}
              </ul>
            </div>
          `
        : nothing
    }

    <div class="enterprise-governance-subsections">
      <div class="enterprise-governance-subsection">
        <div class="enterprise-governance-subsection__title">近期拒绝</div>
        ${renderDenials(overview.recentDenials)}
      </div>
      <div class="enterprise-governance-subsection">
        <div class="enterprise-governance-subsection__title">生命周期审计</div>
        ${renderLifecycle(overview.recentLifecycle)}
      </div>
    </div>
  `;
}

export function renderOperationalIdentityGovernancePanel(
  props: OperationalIdentityGovernancePanelProps,
): TemplateResult {
  const useEnterpriseShell = props.viewContext === "enterprise";

  if (props.error && !props.overview) {
    return renderPanelShell({
      useEnterpriseShell,
      identitiesHref: props.identitiesHref,
      content: html`<div class="enterprise-settings-empty" role="alert">${props.error}</div>`,
    });
  }
  if (!props.overview) {
    return renderPanelShell({
      useEnterpriseShell,
      identitiesHref: props.identitiesHref,
      content: html`
        <div class="enterprise-settings-empty" aria-busy=${props.loading ? "true" : "false"}>
          ${props.loading ? "正在加载监管数据…" : "暂无监管数据。"}
        </div>
      `,
    });
  }
  if (props.viewContext === "enterprise" && props.overview.scope.kind === "platform") {
    return renderPanelShell({
      useEnterpriseShell,
      identitiesHref: props.identitiesHref,
      content: html`<div class="enterprise-settings-empty" role="alert">${ENTERPRISE_SCOPE_MISMATCH_MESSAGE}</div>`,
    });
  }

  const scopeLabel = SCOPE_LABEL[props.overview.scope.kind] ?? props.overview.scope.kind;
  return renderPanelShell({
    useEnterpriseShell,
    scopeLabel,
    identitiesHref: props.identitiesHref,
    content: renderOverviewBody(props.overview),
  });
}
