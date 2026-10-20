/**
 * 平台定价页 — AI 能力治理（Tier 能力层 / 模型池 / 路由策略）。
 */

import { html, nothing } from "lit";
import { t } from "../../../../i18n/index.ts";
import { createPolicyEngineGateway } from "../../../capability/policy-engine/index.ts";
import type { RoutingPolicy } from "../../../capability/policy-engine/index.ts";
import { createResourceCatalogGateway } from "../../../capability/resource-catalog/index.ts";
import type {
  CreditWeight,
  ResourceModelCatalogEntry,
  ResourceTier,
  TierUsageStat,
} from "../../../capability/resource-catalog/index.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import {
  renderEnterpriseKpiGrid,
  type EnterpriseKpiItem,
} from "../../../views/enterprise-kpi-card.ts";
import {
  createGatewayLoadRetry,
  isTransientGatewayError,
  type GatewayLoadRetryController,
} from "./gateway-load-retry.ts";
import {
  ECONOMICS_PREVIEW_EXAMPLE_CREDITS,
  buildPolicyRoutingPreview,
  estimateTasksForCredits,
  groupModelsByTier,
  sortTiers,
  type TierModelGroup,
} from "./resource-catalog-display.ts";
import {
  ROUTING_STRATEGY_REFERENCES,
  buildGovernanceOverviewKpis,
  buildGovernanceSystemSignals,
  buildPlanAuthorizationRows,
  countEnterprisesServingTier,
  fmtGovernanceMoney,
  formatTierFailureRate,
  formatTierLatencyMs,
  formatTierTaskCount,
  plansUnlockingTier,
  policyByStrategy,
  routingSummaryForTier,
  tierDisplayCode,
  tierCardHeadline,
  tierUsageStatById,
} from "./resource-catalog-governance.ts";
import {
  buildPlanMarginPreviews,
  type ResourceCatalogSectionOptions,
} from "./resource-catalog-plan-preview.ts";

type SectionState = {
  loading: boolean;
  busy: boolean;
  error: string | null;
  notice: string | null;
  tiers: ResourceTier[];
  models: ResourceModelCatalogEntry[];
  creditWeights: CreditWeight[];
  policies: RoutingPolicy[];
  missingFromCatalog: string[];
  tierUsageStats: TierUsageStat[];
  /** 每模型成本输入草稿（分/1M token，字符串态）。 */
  modelCostDrafts: Record<string, { input?: string; output?: string }>;
  /** 正在保存成本的模型 id。 */
  savingModelId: string | null;
};

const state: SectionState = {
  loading: false,
  busy: false,
  error: null,
  notice: null,
  tiers: [],
  models: [],
  creditWeights: [],
  policies: [],
  missingFromCatalog: [],
  tierUsageStats: [],
  modelCostDrafts: {},
  savingModelId: null,
};

type ResourceCatalogFocusSection = "models" | "routing" | "economics";

let lastClient: GatewayBrowserClient | null = null;
let loaded = false;
let rerenderFn: (() => void) | null = null;
let loadRetry: GatewayLoadRetryController | null = null;
let pendingScrollTarget: "routing" | "economics" | null = null;

function cancelLoadRetry(): void {
  loadRetry?.cancel();
  loadRetry = null;
}

function scheduleScrollFocus(): void {
  if (!pendingScrollTarget) {
    return;
  }
  const target = pendingScrollTarget;
  pendingScrollTarget = null;
  requestAnimationFrame(() => {
    const selector =
      target === "routing"
        ? '[data-testid="governance-domain-routing"]'
        : '[data-testid="resource-economics-advanced"]';
    const node = document.querySelector(selector);
    if (node instanceof HTMLDetailsElement) {
      node.open = true;
    }
    node?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

function tierSubtitle(tier: ResourceTier): string {
  if (tier.description?.trim()) {
    return tier.description.trim();
  }
  const code = tierDisplayCode(tier);
  if (code === "A") {
    return t("resourceCatalog.tierSubtitleA");
  }
  if (code === "B") {
    return t("resourceCatalog.tierSubtitleB");
  }
  if (code === "C") {
    return t("resourceCatalog.tierSubtitleC");
  }
  return tier.id;
}

function routingStrategyMeaning(strategy: string): string {
  switch (strategy) {
    case "cheapest":
      return t("resourceCatalog.policyStrategyCost");
    case "balanced":
      return t("resourceCatalog.policyStrategyBalanced");
    case "best_quality":
      return t("resourceCatalog.policyStrategyQuality");
    case "bandit":
      return t("resourceCatalog.policyStrategyBandit");
    case "failover":
      return t("resourceCatalog.routingStrategyFailover");
    case "latency_first":
      return t("resourceCatalog.routingStrategyLatencyFirst");
    default:
      return strategy;
  }
}

function gatewayOf(client: GatewayBrowserClient) {
  return createResourceCatalogGateway(client);
}

function creditCostForTier(tierId: string): number {
  return state.creditWeights.find((entry) => entry.tier === tierId)?.creditCost ?? 0;
}

function policyStrategyLabel(strategy: RoutingPolicy["selectorStrategy"]): string {
  switch (strategy) {
    case "cheapest":
      return t("resourceCatalog.policyStrategyCost");
    case "balanced":
      return t("resourceCatalog.policyStrategyBalanced");
    case "best_quality":
      return t("resourceCatalog.policyStrategyQuality");
    case "bandit":
      return t("resourceCatalog.policyStrategyBandit");
    default:
      return strategy;
  }
}

let loadGeneration = 0;

function retryCatalogLoad(client: GatewayBrowserClient): void {
  cancelLoadRetry();
  loaded = false;
  state.loading = false;
  void load(client);
}

async function load(client: GatewayBrowserClient): Promise<void> {
  const generation = ++loadGeneration;
  state.loading = true;
  state.error = null;
  rerenderFn?.();
  try {
    const [overview, policyRes] = await Promise.all([
      gatewayOf(client).overview(),
      createPolicyEngineGateway(client).list(),
    ]);
    if (generation !== loadGeneration) {
      return;
    }
    state.tiers = overview.tiers;
    state.models = overview.models;
    state.creditWeights = overview.creditWeights;
    state.policies = policyRes.policies;
    state.missingFromCatalog = overview.missingFromCatalog;
    state.tierUsageStats = overview.tierUsageStats ?? [];
    state.loading = false;
    loaded = true;
    cancelLoadRetry();
  } catch (err) {
    if (generation !== loadGeneration) {
      return;
    }
    state.loading = false;
    if (isTransientGatewayError(err)) {
      loaded = false;
      state.error = null;
      if (!loadRetry) {
        loadRetry = createGatewayLoadRetry(
          () => {
            if (lastClient === client && !loaded && !state.loading) {
              void load(client);
            }
          },
          {
            onExhausted: () => {
              loadRetry = null;
              state.error = err instanceof Error ? err.message : t("resourceCatalog.loadFailed");
              rerenderFn?.();
            },
          },
        );
      }
    } else {
      loaded = true;
      cancelLoadRetry();
      state.error = err instanceof Error ? err.message : t("resourceCatalog.loadFailed");
    }
  }
  if (generation !== loadGeneration) {
    return;
  }
  rerenderFn?.();
  if (loaded && pendingScrollTarget) {
    scheduleScrollFocus();
  }
}

function ensureLoaded(client: GatewayBrowserClient, rerender: () => void): void {
  rerenderFn = rerender;
  if (!client.connected) {
    cancelLoadRetry();
    state.loading = false;
    loaded = false;
    state.error = t("resourceCatalog.gatewayDisconnected");
    return;
  }
  if (lastClient !== client) {
    lastClient = client;
    loaded = false;
    cancelLoadRetry();
  }
  if (loaded || state.loading) {
    return;
  }
  void load(client);
}

async function handleSeed(client: GatewayBrowserClient): Promise<void> {
  state.busy = true;
  state.notice = null;
  rerenderFn?.();
  try {
    const result = await gatewayOf(client).seedFromConfig();
    state.notice = t("resourceCatalog.seedDone", {
      created: String(result.seed.created),
      skipped: String(result.seed.skipped),
    });
    await load(client);
  } catch (err) {
    state.error = err instanceof Error ? err.message : t("resourceCatalog.syncFailed");
  } finally {
    state.busy = false;
    rerenderFn?.();
  }
}

// ── 模型供应商成本编辑（写 catalog → 驱动 ledger 真实 providerCost）─────────
function parseCostCents(raw: string | undefined, fallback: number): number | null {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.floor(value);
}

function modelCostFieldValue(model: ResourceModelCatalogEntry, field: "input" | "output"): string {
  const draft = state.modelCostDrafts[model.modelId];
  const drafted = field === "input" ? draft?.input : draft?.output;
  if (drafted !== undefined) {
    return drafted;
  }
  return String(field === "input" ? model.inputCostPer1MCents : model.outputCostPer1MCents);
}

function setModelCostDraft(modelId: string, field: "input" | "output", value: string): void {
  const prev = state.modelCostDrafts[modelId] ?? {};
  state.modelCostDrafts[modelId] = { ...prev, [field]: value };
  rerenderFn?.();
}

function modelCostDirty(model: ResourceModelCatalogEntry): boolean {
  const draft = state.modelCostDrafts[model.modelId];
  if (!draft) {
    return false;
  }
  const inputChanged =
    draft.input !== undefined && draft.input !== String(model.inputCostPer1MCents);
  const outputChanged =
    draft.output !== undefined && draft.output !== String(model.outputCostPer1MCents);
  return inputChanged || outputChanged;
}

function tierCodeLabelForId(tierId: string): string {
  const tier = state.tiers.find((entry) => entry.id === tierId);
  return tier ? `Tier ${tierDisplayCode(tier)}` : tierId;
}

function fmtCostYuanPer1M(cents: number): string {
  return `¥${(cents / 100).toFixed(2)} ${t("resourceCatalog.modelCostPer1M")}`;
}

async function handleSaveModelCost(
  client: GatewayBrowserClient,
  model: ResourceModelCatalogEntry,
): Promise<void> {
  const draft = state.modelCostDrafts[model.modelId];
  const inputCents = parseCostCents(draft?.input, model.inputCostPer1MCents);
  const outputCents = parseCostCents(draft?.output, model.outputCostPer1MCents);
  if (inputCents === null || outputCents === null) {
    state.error = t("resourceCatalog.modelCostInvalid");
    rerenderFn?.();
    return;
  }
  state.savingModelId = model.modelId;
  state.error = null;
  state.notice = null;
  rerenderFn?.();
  try {
    await gatewayOf(client).upsertModel({
      modelId: model.modelId,
      tier: model.tier,
      inputCostPer1MCents: inputCents,
      outputCostPer1MCents: outputCents,
    });
    delete state.modelCostDrafts[model.modelId];
    state.notice = t("resourceCatalog.modelCostSaved", { model: model.displayName });
    await load(client);
  } catch (err) {
    state.error = err instanceof Error ? err.message : t("resourceCatalog.syncFailed");
  } finally {
    state.savingModelId = null;
    rerenderFn?.();
  }
}

function renderModelCostRow(client: GatewayBrowserClient, model: ResourceModelCatalogEntry) {
  const saving = state.savingModelId === model.modelId;
  const dirty = modelCostDirty(model);
  const unpriced = model.inputCostPer1MCents === 0 && model.outputCostPer1MCents === 0;
  const inputValue = modelCostFieldValue(model, "input");
  const outputValue = modelCostFieldValue(model, "output");
  const inputCents = parseCostCents(inputValue, model.inputCostPer1MCents);
  const outputCents = parseCostCents(outputValue, model.outputCostPer1MCents);
  return html`
    <tr data-testid="model-cost-row-${model.modelId}">
      <td>
        <div class="resource-governance__model-row-name">${model.displayName}</div>
        <div class="muted resource-governance__model-row-id">
          ${model.modelId}${
            unpriced
              ? html` ·
                  <span
                    class="resource-governance__cost-unpriced"
                    data-testid="model-cost-unpriced-${model.modelId}"
                    >${t("resourceCatalog.modelCostUnpriced")}</span
                  >`
              : nothing
          }
        </div>
      </td>
      <td>${tierCodeLabelForId(model.tier)}</td>
      <td>
        <input
          class="platform-pricing__input resource-governance__cost-input"
          type="number"
          min="0"
          step="1"
          data-testid="model-cost-input-${model.modelId}"
          .value=${inputValue}
          ?disabled=${state.busy || saving}
          @input=${(e: Event) =>
            setModelCostDraft(model.modelId, "input", (e.target as HTMLInputElement).value)}
        />
        <div class="muted resource-governance__cost-hint">
          ${
            inputCents === null
              ? t("resourceCatalog.modelCostInvalid")
              : fmtCostYuanPer1M(inputCents)
          }
        </div>
      </td>
      <td>
        <input
          class="platform-pricing__input resource-governance__cost-input"
          type="number"
          min="0"
          step="1"
          data-testid="model-cost-output-${model.modelId}"
          .value=${outputValue}
          ?disabled=${state.busy || saving}
          @input=${(e: Event) =>
            setModelCostDraft(model.modelId, "output", (e.target as HTMLInputElement).value)}
        />
        <div class="muted resource-governance__cost-hint">
          ${
            outputCents === null
              ? t("resourceCatalog.modelCostInvalid")
              : fmtCostYuanPer1M(outputCents)
          }
        </div>
      </td>
      <td>
        <button
          type="button"
          class="btn btn--sm"
          data-testid="model-cost-save-${model.modelId}"
          ?disabled=${state.busy || saving || !dirty}
          @click=${() => void handleSaveModelCost(client, model)}
        >
          ${saving ? t("resourceCatalog.modelCostSaving") : t("resourceCatalog.modelCostSave")}
        </button>
      </td>
    </tr>
  `;
}

function renderModelCostDomain(client: GatewayBrowserClient) {
  const models = state.models.toSorted((a, b) => a.modelId.localeCompare(b.modelId));
  return html`
    <section class="resource-governance__domain" data-testid="governance-domain-model-cost">
      <div class="resource-governance__domain-title">
        ${t("resourceCatalog.governanceDomainModelCost")}
      </div>
      <div class="muted resource-governance__model-cost-hint">
        ${t("resourceCatalog.modelCostHint")}
      </div>
      ${
        models.length === 0
          ? html`<div class="muted">${t("resourceCatalog.noModels")}</div>`
          : html`
              <div class="resource-governance__health-table-wrap">
                <table class="resource-governance__model-table" data-testid="model-cost-table">
                  <thead>
                    <tr>
                      <th>${t("resourceCatalog.governanceModelName")}</th>
                      <th>${t("resourceCatalog.tier")}</th>
                      <th>${t("resourceCatalog.providerCostInput")}</th>
                      <th>${t("resourceCatalog.providerCostOutput")}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${models.map((model) => renderModelCostRow(client, model))}
                  </tbody>
                </table>
              </div>
            `
      }
    </section>
  `;
}

function governanceSignalLabel(
  signal: ReturnType<typeof buildGovernanceSystemSignals>[number],
): string {
  switch (signal.messageKey) {
    case "governanceStatusOk":
      return t("resourceCatalog.governanceStatusOk");
    case "governanceStatusTierPressure":
      return t("resourceCatalog.governanceStatusTierPressure", {
        tier: signal.tierCode ?? "",
      });
    case "governanceStatusHighFailure":
      return t("resourceCatalog.governanceStatusHighFailure", {
        tier: signal.tierCode ?? "",
      });
    case "governanceStatusDisabledModels":
      return t("resourceCatalog.governanceStatusDisabledModels", {
        n: String(signal.disabledModelCount ?? 0),
      });
  }
}

function renderGovernanceOverview(
  groups: TierModelGroup[],
  options: ResourceCatalogSectionOptions,
) {
  const kpis = buildGovernanceOverviewKpis(state.models, state.tiers, options);
  const kpiItems: EnterpriseKpiItem[] = [
    {
      label: t("resourceCatalog.governanceKpiActiveModels"),
      value: String(kpis.activeModels),
    },
    {
      label: t("resourceCatalog.governanceKpiTierCount"),
      value: String(kpis.tierCount),
    },
    {
      label: t("resourceCatalog.governanceKpiEnterprises"),
      value: kpis.enterpriseCount !== null ? String(kpis.enterpriseCount) : "—",
    },
    {
      label: t("resourceCatalog.governanceKpiPeriodCost"),
      value: kpis.periodCostCents !== null ? fmtGovernanceMoney(kpis.periodCostCents) : "—",
    },
  ];
  const signals = buildGovernanceSystemSignals(groups, state.tierUsageStats, state.models);
  return html`
    <section class="resource-governance__overview" data-testid="governance-overview">
      ${renderEnterpriseKpiGrid(kpiItems)}
      <div class="resource-governance__status-block">
        <div class="resource-governance__section-label">
          ${t("resourceCatalog.governanceSystemStatusTitle")}
        </div>
        <ul class="resource-governance__status-list">
          ${signals.map(
            (signal) => html`
              <li
                class="resource-governance__status-item is-${signal.tone}"
                data-testid="governance-signal-${signal.id}"
              >
                <span class="resource-governance__status-dot" aria-hidden="true"></span>
                ${governanceSignalLabel(signal)}
              </li>
            `,
          )}
        </ul>
      </div>
    </section>
  `;
}

function renderTierGovernanceCard(
  _client: GatewayBrowserClient,
  group: TierModelGroup,
  options: ResourceCatalogSectionOptions,
) {
  const linkedPlans = plansUnlockingTier(group.tier.id, options);
  const routingSummary = routingSummaryForTier(group.tier.id, options, state.policies);
  const servingEnterprises = countEnterprisesServingTier(group.tier.id, options);
  const creditCost = group.creditCost ?? creditCostForTier(group.tier.id);
  const layerLabel = tierSubtitle(group.tier);
  const modelPoolCount = group.models.filter((model) => model.enabled).length;

  return html`
    <article
      class="resource-governance__tier-card"
      data-testid="resource-tier-card-${group.tier.id}"
    >
      <header class="resource-governance__tier-card-head">
        <div class="resource-governance__tier-card-title">
          ${tierCardHeadline(group.tier, layerLabel)}
        </div>
      </header>
      <dl class="resource-governance__kv-stack resource-governance__kv-stack--card">
        <div class="resource-governance__kv-row">
          <dt>${t("resourceCatalog.governanceTierCredits")}</dt>
          <dd>${t("resourceCatalog.governanceCreditsPerRequest", { n: String(creditCost) })}</dd>
        </div>
        <div class="resource-governance__kv-row">
          <dt>${t("resourceCatalog.governanceTierRouting")}</dt>
          <dd>${routingSummary}</dd>
        </div>
        <div class="resource-governance__kv-row">
          <dt>${t("resourceCatalog.governanceTierModelPoolCount")}</dt>
          <dd>${modelPoolCount}</dd>
        </div>
        <div class="resource-governance__kv-row">
          <dt>${t("resourceCatalog.governanceTierServingEnterprises")}</dt>
          <dd>${servingEnterprises}</dd>
        </div>
        <div class="resource-governance__kv-row">
          <dt>${t("resourceCatalog.governanceTierLinkedPlans")}</dt>
          <dd>
            ${linkedPlans.length > 0 ? linkedPlans.map((plan) => plan.name).join(" / ") : "—"}
          </dd>
        </div>
      </dl>
      <div class="resource-governance__tier-card-actions">
        ${
          options.onOpenTier
            ? html`
                <button
                  type="button"
                  class="btn btn--sm"
                  data-testid="tier-edit-${group.tier.id}"
                  ?disabled=${state.busy}
                  @click=${() => options.onOpenTier?.(group.tier.id)}
                >
                  ${t("resourceCatalog.governanceEditTier")}
                </button>
                <button
                  type="button"
                  class="btn btn--sm"
                  data-testid="tier-manage-pool-${group.tier.id}"
                  ?disabled=${state.busy}
                  @click=${() => options.onOpenTier?.(group.tier.id, "modelPool")}
                >
                  ${t("resourceCatalog.governanceManageModelPool")}
                </button>
              `
            : nothing
        }
      </div>
    </article>
  `;
}

function renderTierGovernanceDomain(
  client: GatewayBrowserClient,
  groups: TierModelGroup[],
  options: ResourceCatalogSectionOptions,
) {
  if (groups.length === 0) {
    return html`
      <section class="resource-governance__domain" data-testid="governance-domain-tier">
        <div class="resource-governance__domain-title">
          ${t("resourceCatalog.governanceDomainTier")}
        </div>
        <div class="muted">${t("resourceCatalog.noModels")}</div>
      </section>
    `;
  }
  return html`
    <section class="resource-governance__domain" data-testid="governance-domain-tier">
      <div class="resource-governance__domain-title">
        ${t("resourceCatalog.governanceDomainTier")}
      </div>
      <div class="resource-governance__tier-card-grid">
        ${groups.map((group) => renderTierGovernanceCard(client, group, options))}
      </div>
    </section>
  `;
}

function renderRoutingGovernanceDomain() {
  const activePolicies = state.policies
    .filter((policy) => policy.status === "active")
    .toSorted((left, right) => left.name.localeCompare(right.name));
  return html`
    <section class="resource-governance__domain" data-testid="governance-domain-routing">
      <div class="resource-governance__domain-title">
        ${t("resourceCatalog.governanceDomainRouting")}
      </div>
      <div class="resource-governance__policy-card-grid">
        ${activePolicies.map((policy) => {
          const preview = buildPolicyRoutingPreview(policy, state.models, state.tiers);
          const primary = preview[0];
          const fallback = preview[1];
          const primaryTier = state.tiers.find((tier) => tier.id === primary?.tier);
          const maxCredits = primaryTier ? creditCostForTier(primaryTier.id) : null;
          return html`
            <article
              class="resource-governance__policy-card"
              data-testid="resource-policy-card-${policy.id}"
            >
              <div class="resource-governance__policy-card-title">${policy.name}</div>
              <div class="muted resource-governance__policy-card-strategy">
                ${policyStrategyLabel(policy.selectorStrategy)}
              </div>
              <dl class="resource-governance__kv-stack resource-governance__kv-stack--compact">
                <div class="resource-governance__kv-row">
                  <dt>${t("resourceCatalog.governancePolicyPrimary")}</dt>
                  <dd>${primary?.displayName ?? "—"}</dd>
                </div>
                <div class="resource-governance__kv-row">
                  <dt>${t("resourceCatalog.governancePolicyFallback")}</dt>
                  <dd>${fallback?.displayName ?? "—"}</dd>
                </div>
                <div class="resource-governance__kv-row">
                  <dt>${t("resourceCatalog.governancePolicyMaxCost")}</dt>
                  <dd>
                    ${
                      maxCredits
                        ? html`${maxCredits}
                            <span class="muted">${t("resourceCatalog.creditsPerTaskShort")}</span>`
                        : "—"
                    }
                  </dd>
                </div>
              </dl>
            </article>
          `;
        })}
      </div>
      <details class="resource-governance__inline-advanced">
        <summary>${t("resourceCatalog.routingAdvancedTitle")}</summary>
        ${renderRoutingStrategyTable()}
      </details>
    </section>
  `;
}

function renderPlanAuthorizationDomain(
  tiers: ResourceTier[],
  options: ResourceCatalogSectionOptions,
) {
  const rows = buildPlanAuthorizationRows(tiers, options, state.policies);
  if (rows.length === 0) {
    return nothing;
  }
  return html`
    <section class="resource-governance__domain" data-testid="governance-domain-plan-auth">
      <div class="resource-governance__domain-title">
        ${t("resourceCatalog.governanceDomainPlanAuth")}
      </div>
      <div class="resource-governance__plan-auth-grid">
        ${rows.map(
          (row) => html`
            <article
              class="resource-governance__plan-auth-card"
              data-testid="plan-auth-card-${row.planId}"
            >
              <div class="resource-governance__plan-auth-name">${row.planName}</div>
              <dl class="resource-governance__kv-stack resource-governance__kv-stack--compact">
                <div class="resource-governance__kv-row">
                  <dt>${t("resourceCatalog.governancePlanAuthTier")}</dt>
                  <dd>${row.tierLabels}</dd>
                </div>
                <div class="resource-governance__kv-row">
                  <dt>${t("resourceCatalog.governancePlanAuthPolicy")}</dt>
                  <dd>${row.policyLabel}</dd>
                </div>
                <div class="resource-governance__kv-row">
                  <dt>${t("resourceCatalog.governancePlanAuthConcurrency")}</dt>
                  <dd>${row.maxConcurrentLabel}</dd>
                </div>
                <div class="resource-governance__kv-row">
                  <dt>${t("resourceCatalog.governancePlanAuthBots")}</dt>
                  <dd>${row.maxBotsLabel}</dd>
                </div>
              </dl>
            </article>
          `,
        )}
      </div>
    </section>
  `;
}

function renderCostRiskDomain(
  _client: GatewayBrowserClient,
  options: ResourceCatalogSectionOptions,
) {
  const sortedTiers = sortTiers(state.tiers);
  return html`
    <section class="resource-governance__domain" data-testid="governance-domain-cost-risk">
      <div class="resource-governance__domain-title">
        ${t("resourceCatalog.governanceDomainCostRisk")}
      </div>
      <div class="resource-governance__cost-risk-grid">
        ${sortedTiers.map((tier) => {
          const saved = creditCostForTier(tier.id);
          return html`
            <div class="resource-governance__cost-cap" data-testid="tier-cost-cap-${tier.id}">
              <div class="resource-governance__cost-cap-label">Tier ${tierDisplayCode(tier)}</div>
              <div class="resource-governance__cost-cap-value">
                ${saved}
                <span class="muted">${t("resourceCatalog.creditsPerTaskShort")}</span>
              </div>
            </div>
          `;
        })}
      </div>
      <details
        class="resource-governance__inline-advanced"
        data-testid="resource-economics-advanced"
      >
        <summary>${t("resourceCatalog.economicsAdvancedTitle")}</summary>
        <div class="resource-governance__advanced-body">
          ${renderEconomicsPreview()} ${renderPlanMarginPreview(options)}
        </div>
      </details>
    </section>
  `;
}

function renderHealthDomain(groups: TierModelGroup[]) {
  return html`
    <section class="resource-governance__domain" data-testid="governance-domain-health">
      <div class="resource-governance__domain-title">
        ${t("resourceCatalog.governanceDomainHealth")}
      </div>
      <div class="resource-governance__health-table-wrap">
        <table class="resource-governance__health-table" data-testid="governance-health-table">
          <thead>
            <tr>
              <th>${t("resourceCatalog.governanceHealthTier")}</th>
              <th>${t("resourceCatalog.governanceHealthCalls")}</th>
              <th>${t("resourceCatalog.governanceHealthLatency")}</th>
              <th>${t("resourceCatalog.governanceHealthFailure")}</th>
            </tr>
          </thead>
          <tbody>
            ${groups.map((group) => {
              const usage = tierUsageStatById(state.tierUsageStats, group.tier.id);
              const latencyLabel = formatTierLatencyMs(usage?.avgLatencyMs);
              const failureLabel = formatTierFailureRate(usage?.failureRate);
              return html`
                <tr data-testid="governance-health-row-${group.tier.id}">
                  <td>Tier ${tierDisplayCode(group.tier)}</td>
                  <td>
                    ${formatTierTaskCount(usage?.taskCount ?? 0)}
                    <span class="muted">${t("resourceCatalog.tierCallsSuffix")}</span>
                  </td>
                  <td class=${latencyLabel ? "" : "muted"}>
                    ${latencyLabel || t("resourceCatalog.tierStatsUnavailable")}
                  </td>
                  <td class=${failureLabel ? "" : "muted"}>
                    ${failureLabel || t("resourceCatalog.tierStatsUnavailable")}
                  </td>
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderRoutingStrategyTable() {
  return html`
    <div class="resource-governance__routing-table-wrap">
      <table class="resource-governance__routing-table">
        <thead>
          <tr>
            <th>${t("resourceCatalog.routingStrategyCol")}</th>
            <th>${t("resourceCatalog.routingMeaningCol")}</th>
            <th>${t("resourceCatalog.routingBuiltinCol")}</th>
          </tr>
        </thead>
        <tbody>
          ${ROUTING_STRATEGY_REFERENCES.map((entry) => {
            const policy = policyByStrategy(entry.id, state.policies);
            const builtinLabel = entry.implemented
              ? (policy?.name ?? "—")
              : entry.id === "failover"
                ? t("resourceCatalog.routingStrategyFailoverHint")
                : t("resourceCatalog.routingStrategyLatencyHint");
            return html`
              <tr data-testid="routing-strategy-row-${entry.id}">
                <td><code>${entry.id}</code></td>
                <td>${routingStrategyMeaning(entry.id)}</td>
                <td class="muted">${builtinLabel}</td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    </div>
  `;
}

function renderGovernanceWorkspace(
  client: GatewayBrowserClient,
  options: ResourceCatalogSectionOptions,
) {
  const groups = groupModelsByTier({
    tiers: state.tiers,
    models: state.models,
    creditWeights: state.creditWeights,
  });
  return html`
    <div class="resource-governance__workspace" data-testid="resource-governance-workspace">
      ${renderGovernanceOverview(groups, options)}
      ${renderTierGovernanceDomain(client, groups, options)} ${renderRoutingGovernanceDomain()}
      ${renderPlanAuthorizationDomain(state.tiers, options)}
      ${renderCostRiskDomain(client, options)} ${renderModelCostDomain(client)}
      ${renderHealthDomain(groups)}
    </div>
  `;
}

function renderEconomicsPreview() {
  const sortedTiers = sortTiers(state.tiers);
  const exampleCredits = ECONOMICS_PREVIEW_EXAMPLE_CREDITS;
  return html`
    <section class="card platform-economics__panel" data-testid="resource-economics-preview">
      <div class="card-title">${t("resourceCatalog.economicsPreviewTitle")}</div>
      <div class="card-sub">
        ${t("resourceCatalog.economicsPreviewSub", { credits: String(exampleCredits) })}
      </div>
      <div class="resource-catalog__preview-grid">
        ${sortedTiers.map((tier) => {
          const saved = creditCostForTier(tier.id);
          const savedTasks = estimateTasksForCredits(exampleCredits, saved);
          return html`
            <div class="resource-catalog__preview-card">
              <div class="resource-catalog__preview-tier">${tier.name}</div>
              <div class="resource-catalog__preview-credits">
                ${saved} ${t("resourceCatalog.creditsPerTaskShort")}
              </div>
              <div class="resource-catalog__preview-tasks">
                ${t("resourceCatalog.economicsTasksAtTier", { count: String(savedTasks) })}
              </div>
            </div>
          `;
        })}
      </div>
    </section>
  `;
}

function renderPlanMarginPreview(options: ResourceCatalogSectionOptions) {
  const rows = buildPlanMarginPreviews({
    plans: options.plans ?? [],
    savedWeights: state.creditWeights,
    draftWeights: state.creditWeights,
    options,
  });
  const hasProjection = Boolean(options.economicsProjectionContext);
  return html`
    <section class="card platform-economics__panel" data-testid="resource-plan-margin-preview">
      <div class="card-title">${t("resourceCatalog.planMarginPreviewTitle")}</div>
      ${
        !hasProjection
          ? html`<div class="muted card-follow--sm">
              ${t("resourceCatalog.planMarginPreviewEmpty")}
            </div>`
          : rows.length === 0
            ? html`<div class="muted card-follow--sm">
                ${t("resourceCatalog.planMarginPreviewNoPlans")}
              </div>`
            : html`
                <div class="resource-catalog__plan-margin-table-wrap">
                  <table class="resource-catalog__plan-margin-table">
                    <thead>
                      <tr>
                        <th>${t("resourceCatalog.planMarginColPlan")}</th>
                        <th>${t("resourceCatalog.planMarginColSaved")}</th>
                        <th>${t("resourceCatalog.planMarginColDraft")}</th>
                        <th>${t("resourceCatalog.planMarginColSavedTasks")}</th>
                        <th>${t("resourceCatalog.planMarginColDraftTasks")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${rows.map(
                        (row) => html`
                          <tr
                            class=${row.marginChanged ? "resource-catalog__plan-margin-row--changed" : ""}
                            data-testid="resource-plan-margin-row-${row.planId}"
                          >
                            <td>
                              <div class="resource-catalog__plan-margin-name">${row.planName}</div>
                              ${
                                row.monthlyCredits
                                  ? html`<div class="muted resource-catalog__plan-margin-quota">
                                      ${t("resourceCatalog.monthlyCreditsQuota", {
                                        n: String(row.monthlyCredits),
                                      })}
                                    </div>`
                                  : nothing
                              }
                            </td>
                            <td>${row.savedMarginLabel}</td>
                            <td
                              class=${row.marginChanged ? "resource-catalog__plan-margin-changed" : ""}
                            >
                              ${row.draftMarginLabel}
                            </td>
                            <td>${row.savedTasksLabel}</td>
                            <td
                              class=${row.marginChanged ? "resource-catalog__plan-margin-changed" : ""}
                            >
                              ${row.draftTasksLabel}
                            </td>
                          </tr>
                        `,
                      )}
                    </tbody>
                  </table>
                </div>
              `
      }
    </section>
  `;
}

function renderCatalogHeader(client: GatewayBrowserClient) {
  return html`
    <section class="card platform-economics__panel">
      <div class="platform-economics__panel-head">
        <div>
          <div class="card-title">${t("resourceCatalog.title")}</div>
          <div class="card-sub">${t("resourceCatalog.governanceConsoleSub")}</div>
        </div>
        <button
          class="btn"
          type="button"
          ?disabled=${state.busy}
          @click=${() => void handleSeed(client)}
        >
          ${state.busy ? t("resourceCatalog.syncing") : t("resourceCatalog.syncFromConfig")}
        </button>
      </div>
      ${
        state.missingFromCatalog.length > 0
          ? html`
              <div class="callout info card-follow--sm">
                ${t("resourceCatalog.missingHint", { n: String(state.missingFromCatalog.length) })}
              </div>
            `
          : nothing
      }
    </section>
  `;
}

export function reloadPlatformResourceCatalogSection(
  client: GatewayBrowserClient,
  rerender: () => void,
): void {
  rerenderFn = rerender;
  lastClient = client;
  loaded = false;
  cancelLoadRetry();
  void load(client);
}

export function __resetResourceCatalogSectionForTest(): void {
  state.loading = false;
  state.busy = false;
  state.error = null;
  state.notice = null;
  state.tiers = [];
  state.models = [];
  state.creditWeights = [];
  state.policies = [];
  state.missingFromCatalog = [];
  state.tierUsageStats = [];
  state.modelCostDrafts = {};
  state.savingModelId = null;
  lastClient = null;
  loaded = false;
  rerenderFn = null;
  cancelLoadRetry();
  pendingScrollTarget = null;
}

export function focusPlatformResourceCatalogSubTab(
  tab: ResourceCatalogFocusSection,
  client: GatewayBrowserClient,
  rerender: () => void,
): void {
  if (tab === "routing" || tab === "economics") {
    pendingScrollTarget = tab;
  } else {
    pendingScrollTarget = null;
  }
  reloadPlatformResourceCatalogSection(client, rerender);
  if (loaded && pendingScrollTarget) {
    scheduleScrollFocus();
  }
}

export function renderPlatformResourceCatalogSection(
  client: GatewayBrowserClient,
  rerender: () => void,
  options: ResourceCatalogSectionOptions = {},
) {
  ensureLoaded(client, rerender);

  if (state.loading) {
    return html`
      <div class="muted" data-testid="resource-catalog-loading">
        <p>${t("resourceCatalog.loading")}</p>
        <button
          class="btn btn--sm"
          type="button"
          data-testid="resource-catalog-retry"
          @click=${() => retryCatalogLoad(client)}
        >
          ${t("resourceCatalog.retryLoad")}
        </button>
      </div>
    `;
  }

  return html`
    <div class="platform-resource-catalog" data-testid="resource-catalog-panel">
      ${state.error ? html`<div class="callout warning">${state.error}</div>` : nothing}
      ${state.notice ? html`<div class="callout">${state.notice}</div>` : nothing}
      ${renderCatalogHeader(client)} ${renderGovernanceWorkspace(client, options)}
    </div>
  `;
}
