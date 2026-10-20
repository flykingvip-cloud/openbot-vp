/**
 * 套餐配置工作区：概览 / 权益与模型 / 版本发布 / 计费参数（抽屉与详情页共用）。
 */

import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import type { Plan } from "../../../capability/cost-budget-billing/index.ts";
import type { RoutingPolicy } from "../../../capability/policy-engine/index.ts";
import type {
  ResourceModelCatalogEntry,
  ResourceTier,
} from "../../../capability/resource-catalog/index.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import { policyDisplay, tierCapabilityLabels } from "./commercial-display.ts";

export type PlanWorkspaceMode = "preview" | "edit";
export type PlanEditTab = "bundle" | "models" | "billing" | "marketing" | "versions";
/** @deprecated 使用 PlanWorkspaceMode + PlanEditTab */
export type PlanConfigTab = "overview" | PlanEditTab;

export function formatActivationBlocker(code: string): string {
  if (code === "missing_binding") {
    return t("platformPricing.activationBlockerMissingBinding");
  }
  return code;
}

function renderOverviewTab(params: {
  plan: Plan;
  activeVersionNumber: number | null;
  monthlyCredits: number | null;
  maxConcurrentRuns?: number | null;
  maxWorkflows?: number | null;
  maxKnowledgeBases?: number | null;
  tierIds: string[];
  features?: {
    auditLog?: boolean;
    mfa?: boolean;
    sso?: boolean;
    vpcIsolation?: boolean;
  } | null;
  allowPrivateModels?: boolean;
  allowCustomPolicy?: boolean;
  policyId: string | null;
  catalogTiers: readonly ResourceTier[];
  catalogPolicies: readonly RoutingPolicy[];
  activationBlockers: string[];
  activeSubscriptions: number;
  mrrCents: number;
  fmtMoney: (cents: number) => string;
  onOpenModelsTab: () => void;
}): TemplateResult {
  const hasMissingBinding = params.activationBlockers.includes("missing_binding");
  const tierLabels = tierCapabilityLabels(params.tierIds, params.catalogTiers);
  const policy = params.policyId ? policyDisplay(params.policyId, params.catalogPolicies) : null;
  const governanceLabels = [
    params.features?.auditLog ? "审计日志" : null,
    params.features?.mfa ? "MFA" : null,
    params.features?.sso ? "SSO" : null,
    params.features?.vpcIsolation ? "VPC 隔离" : null,
    params.allowPrivateModels ? "BYOM" : null,
    params.allowCustomPolicy ? "自定义策略" : null,
  ].filter((label): label is string => Boolean(label));

  return html`
    <div class="platform-pricing__drawer-panel" data-testid="plan-config-overview">
      ${
        params.activationBlockers.length > 0
          ? html`
              <div class="platform-pricing__drawer-alert" data-testid="plan-config-blocker-alert">
                <div class="platform-pricing__drawer-alert-title">
                  ${t("platformPricing.planConfigBlockerTitle")}
                </div>
                <ul class="platform-pricing__drawer-alert-list">
                  ${params.activationBlockers.map(
                    (code) => html`<li>${formatActivationBlocker(code)}</li>`,
                  )}
                </ul>
                ${
                  hasMissingBinding
                    ? html`
                        <button
                          type="button"
                          class="btn btn--primary btn--sm"
                          data-testid="plan-config-fix-models-btn"
                          @click=${params.onOpenModelsTab}
                        >
                          ${t("platformPricing.configureModelsNow")}
                        </button>
                      `
                    : nothing
                }
              </div>
            `
          : nothing
      }

      <dl class="platform-pricing__drawer-kv">
        <div class="platform-pricing__drawer-kv-row">
          <dt>${t("platformPricing.basePriceMonthly")}</dt>
          <dd>${params.fmtMoney(params.plan.basePriceCents)}${t("platformPricing.perMonth")}</dd>
        </div>
        <div class="platform-pricing__drawer-kv-row">
          <dt>${t("platformPricing.commercialActiveVersion")}</dt>
          <dd>${params.activeVersionNumber != null ? `v${params.activeVersionNumber}` : "—"}</dd>
        </div>
        <div class="platform-pricing__drawer-kv-row">
          <dt>${t("platformPricing.botQuota")}</dt>
          <dd>${params.plan.botQuota} ${t("platformPricing.botsUnit")}</dd>
        </div>
        <div class="platform-pricing__drawer-kv-row">
          <dt>${t("platformPricing.commercialActiveSubs")}</dt>
          <dd>${params.activeSubscriptions}</dd>
        </div>
        <div class="platform-pricing__drawer-kv-row">
          <dt>${t("platformPricing.commercialMrr")}</dt>
          <dd>${params.fmtMoney(params.mrrCents)}</dd>
        </div>
        ${
          params.monthlyCredits != null
            ? html`
                <div class="platform-pricing__drawer-kv-row">
                  <dt>${t("platformPricing.monthlyCredits")}</dt>
                  <dd>
                    ${
                      params.monthlyCredits === 0
                        ? t("platformPricing.enterpriseBudget")
                        : `${params.monthlyCredits}${t("platformPricing.perMonth")}`
                    }
                  </dd>
                </div>
              `
            : nothing
        }
        ${
          params.maxConcurrentRuns != null
            ? html`
                <div class="platform-pricing__drawer-kv-row">
                  <dt>最大并发运行</dt>
                  <dd>${params.maxConcurrentRuns === 0 ? "不限" : params.maxConcurrentRuns}</dd>
                </div>
              `
            : nothing
        }
        ${
          params.maxWorkflows != null
            ? html`
                <div class="platform-pricing__drawer-kv-row">
                  <dt>工作流数量</dt>
                  <dd>${params.maxWorkflows === 0 ? "无限" : params.maxWorkflows}</dd>
                </div>
              `
            : nothing
        }
        ${
          params.maxKnowledgeBases != null
            ? html`
                <div class="platform-pricing__drawer-kv-row">
                  <dt>知识库数量</dt>
                  <dd>${params.maxKnowledgeBases === 0 ? "无限" : params.maxKnowledgeBases}</dd>
                </div>
              `
            : nothing
        }
        ${
          tierLabels.length > 0
            ? html`
                <div class="platform-pricing__drawer-kv-row">
                  <dt>${t("platformPricing.commercialCapabilities")}</dt>
                  <dd>${tierLabels.join(" · ")}</dd>
                </div>
              `
            : nothing
        }
        ${
          policy
            ? html`
                <div class="platform-pricing__drawer-kv-row">
                  <dt>${t("platformPricing.defaultPolicy")}</dt>
                  <dd>${policy.description ? `${policy.name} · ${policy.description}` : policy.name}</dd>
                </div>
              `
            : nothing
        }
        ${
          governanceLabels.length > 0
            ? html`
                <div class="platform-pricing__drawer-kv-row">
                  <dt>治理能力</dt>
                  <dd>${governanceLabels.join(" · ")}</dd>
                </div>
              `
            : nothing
        }
      </dl>
    </div>
  `;
}

export type PlanPreviewOverviewParams = Parameters<typeof renderOverviewTab>[0];

export function renderPlanPreviewOverview(params: PlanPreviewOverviewParams): TemplateResult {
  return renderOverviewTab(params);
}

function renderModelsTab(params: {
  tierIds: readonly string[];
  resolvedModelIds: readonly string[];
  catalogTiers: readonly ResourceTier[];
  catalogModels: readonly ResourceModelCatalogEntry[];
  onOpenBundleEditor: () => void;
  onOpenResourceCatalog: () => void;
}): TemplateResult {
  const tierLabels = tierCapabilityLabels([...params.tierIds], params.catalogTiers);
  return html`
    <div class="platform-pricing__drawer-panel" data-testid="plan-config-models">
      <p class="muted platform-pricing__drawer-panel-hint">
        ${t("platformPricing.modelsTierProjectionHint")}
      </p>
      <dl class="platform-pricing__drawer-kv">
        <div class="platform-pricing__drawer-kv-row">
          <dt>${t("platformPricing.allowedTiers")}</dt>
          <dd>
            ${
              tierLabels.length > 0
                ? tierLabels.join(" · ")
                : t("platformPricing.modelsTierProjectionNoTier")
            }
          </dd>
        </div>
      </dl>
      ${
        params.resolvedModelIds.length === 0
          ? html`
              <div class="platform-pricing__model-empty" data-testid="plan-config-models-empty">
                <div class="muted">${t("platformPricing.modelsTierProjectionNoTier")}</div>
              </div>
            `
          : html`
              <div class="platform-pricing__drawer-model-summary">
                ${t("platformPricing.modelPoolResolvedCount", {
                  count: String(params.resolvedModelIds.length),
                })}
              </div>
              <ul class="platform-pricing__model-list">
                ${params.resolvedModelIds.map(
                  (modelId) => html`
                    <li
                      class="platform-pricing__model-option platform-pricing__model-option--selected"
                      data-testid="plan-config-resolved-model-row"
                      data-model-id=${modelId}
                    >
                      <div class="platform-pricing__model-meta">
                        <div class="platform-pricing__model-name">
                          ${
                            params.catalogModels.find((model) => model.modelId === modelId)
                              ?.displayName ?? modelId
                          }
                        </div>
                        <div class="muted mono">${modelId}</div>
                      </div>
                    </li>
                  `,
                )}
              </ul>
            `
      }
      <div class="platform-pricing__drawer-actions">
        <button
          type="button"
          class="btn btn--sm btn--primary"
          data-testid="plan-config-edit-tiers-btn"
          @click=${params.onOpenBundleEditor}
        >
          ${t("platformPricing.modelsTierProjectionEditCta")}
        </button>
        <button
          type="button"
          class="btn btn--sm"
          data-testid="open-resource-catalog-btn"
          @click=${params.onOpenResourceCatalog}
        >
          ${t("platformPricing.resourceCatalogLinkAction")}
        </button>
      </div>
    </div>
  `;
}

function renderModeButton(
  mode: PlanWorkspaceMode,
  active: PlanWorkspaceMode,
  label: string,
  testId: string,
  onSelect: (mode: PlanWorkspaceMode) => void,
): TemplateResult {
  return html`
    <button
      type="button"
      class="platform-pricing__drawer-tab platform-pricing__drawer-tab--mode ${active === mode ? "is-active" : ""}"
      role="tab"
      aria-selected=${String(active === mode)}
      data-testid=${testId}
      @click=${() => onSelect(mode)}
    >
      ${label}
    </button>
  `;
}

function renderEditTabButton(
  tab: PlanEditTab,
  active: PlanEditTab,
  label: string,
  onSelect: (tab: PlanEditTab) => void,
): TemplateResult {
  return html`
    <button
      type="button"
      class="platform-pricing__drawer-tab ${active === tab ? "is-active" : ""}"
      data-testid="plan-config-tab-${tab}"
      @click=${() => onSelect(tab)}
    >
      ${label}
    </button>
  `;
}

export type PlanConfigWorkspaceParams = {
  plan: Plan;
  mode: PlanWorkspaceMode;
  editTab: PlanEditTab;
  onModeChange: (mode: PlanWorkspaceMode) => void;
  onEditTabChange: (tab: PlanEditTab) => void;
  previewContent: TemplateResult;
  activeVersionNumber: number | null;
  monthlyCredits: number | null;
  tierIds: string[];
  policyId: string | null;
  catalogTiers: readonly ResourceTier[];
  catalogPolicies: readonly RoutingPolicy[];
  activationBlockers: string[];
  activeSubscriptions: number;
  mrrCents: number;
  client: GatewayBrowserClient;
  resolvedModelIds: readonly string[];
  catalogModels: readonly ResourceModelCatalogEntry[];
  onOpenBundleEditor: () => void;
  onOpenResourceCatalog: () => void;
  marketingContent: TemplateResult;
  publishWorkflowContent: TemplateResult;
  versionsContent: TemplateResult;
  billingContent: TemplateResult;
  fmtMoney: (cents: number) => string;
};

export function renderPlanConfigWorkspace(params: PlanConfigWorkspaceParams): TemplateResult {
  return html`
    <nav class="platform-pricing__drawer-tabs platform-pricing__drawer-tabs--mode" role="tablist">
      ${renderModeButton(
        "preview",
        params.mode,
        t("platformPricing.planConfigModePreview"),
        "plan-config-mode-preview",
        params.onModeChange,
      )}
      ${renderModeButton(
        "edit",
        params.mode,
        t("platformPricing.planConfigModeEdit"),
        "plan-config-mode-edit",
        params.onModeChange,
      )}
    </nav>

    <div class="platform-pricing__workspace-body">
      ${
        params.mode === "preview"
          ? html`
              <div class="platform-pricing__drawer-panel" data-testid="plan-config-preview">
                ${params.previewContent}
              </div>
            `
          : html`
              <nav class="platform-pricing__drawer-tabs platform-pricing__drawer-tabs--nested" role="tablist">
                ${renderEditTabButton(
                  "models",
                  params.editTab,
                  t("platformPricing.planConfigTabModels"),
                  params.onEditTabChange,
                )}
                ${renderEditTabButton(
                  "billing",
                  params.editTab,
                  t("platformPricing.planConfigTabBilling"),
                  params.onEditTabChange,
                )}
                ${renderEditTabButton(
                  "marketing",
                  params.editTab,
                  t("platformPricing.planConfigTabMarketing"),
                  params.onEditTabChange,
                )}
                ${renderEditTabButton(
                  "versions",
                  params.editTab,
                  t("platformPricing.planConfigTabVersions"),
                  params.onEditTabChange,
                )}
              </nav>
              <div class="platform-pricing__workspace-body">
                ${
                  params.editTab === "models"
                    ? renderModelsTab({
                        tierIds: params.tierIds,
                        resolvedModelIds: params.resolvedModelIds,
                        catalogTiers: params.catalogTiers,
                        catalogModels: params.catalogModels,
                        onOpenBundleEditor: params.onOpenBundleEditor,
                        onOpenResourceCatalog: params.onOpenResourceCatalog,
                      })
                    : params.editTab === "billing"
                      ? html`
                          <div class="platform-pricing__drawer-panel" data-testid="plan-config-billing">
                            ${params.billingContent}
                          </div>
                        `
                      : params.editTab === "marketing"
                        ? html`
                            <div class="platform-pricing__drawer-panel" data-testid="plan-config-marketing">
                              ${params.marketingContent}
                            </div>
                          `
                        : html`
                            <div
                              class="platform-pricing__drawer-panel platform-pricing__drawer-panel--versions"
                              data-testid="plan-config-versions"
                            >
                              ${params.publishWorkflowContent}
                              ${params.versionsContent}
                            </div>
                          `
                }
              </div>
            `
      }
    </div>
  `;
}
