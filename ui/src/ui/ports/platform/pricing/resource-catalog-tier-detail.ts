/**
 * Tier 二级治理页 — 基础能力 / 模型池 / 路由 / 成本 / 套餐授权 / 运行健康。
 */

import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import { createResourceCatalogGateway } from "../../../capability/resource-catalog/gateway-client.ts";
import type {
  ResourceModelCatalogEntry,
  ResourceTier,
  TierFailoverMode,
  TierFailoverRule,
  TierModelPoolResult,
  TierUsageStat,
} from "../../../capability/resource-catalog/index.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import {
  createGatewayLoadRetry,
  isTransientGatewayError,
  type GatewayLoadRetryController,
} from "./gateway-load-retry.ts";
import {
  groupModelsByTier,
  parseCreditWeightDraft,
  sortTiers,
} from "./resource-catalog-display.ts";
import {
  buildPlanAuthorizationRows,
  countEnterprisesServingTier,
  formatTierFailureRate,
  formatTierLatencyMs,
  formatTierTaskCount,
  modelCostLevelLabel,
  plansUnlockingTier,
  routingSummaryForTier,
  tierDisplayCode,
  tierHeadline,
  tierUsageStatById,
} from "./resource-catalog-governance.ts";
import type { ResourceCatalogSectionOptions } from "./resource-catalog-plan-preview.ts";

type TierDetailState = {
  loading: boolean;
  busy: boolean;
  error: string | null;
  notice: string | null;
  tier: ResourceTier | null;
  tiers: ResourceTier[];
  models: ResourceModelCatalogEntry[];
  creditCost: number;
  creditDraft: string;
  nameDraft: string;
  descriptionDraft: string;
  pool: TierModelPoolResult | null;
  tierUsageStats: TierUsageStat[];
  failoverEnabled: boolean;
  failoverFailureRatePct: string;
  failoverMinSample: string;
  failoverMaxFailures: string;
  failoverLatencyMs: string;
  failoverCooldownSec: string;
  failoverMode: TierFailoverMode;
  failoverFallbackTierId: string;
};

const state: TierDetailState = {
  loading: false,
  busy: false,
  error: null,
  notice: null,
  tier: null,
  tiers: [],
  models: [],
  creditCost: 0,
  creditDraft: "0",
  nameDraft: "",
  descriptionDraft: "",
  pool: null,
  tierUsageStats: [],
  failoverEnabled: false,
  failoverFailureRatePct: "10",
  failoverMinSample: "20",
  failoverMaxFailures: "3",
  failoverLatencyMs: "0",
  failoverCooldownSec: "60",
  failoverMode: "next_in_pool",
  failoverFallbackTierId: "",
};

let lastClient: GatewayBrowserClient | null = null;
let lastTierId: string | null = null;
let loaded = false;
let rerenderFn: (() => void) | null = null;
let loadRetry: GatewayLoadRetryController | null = null;

function cancelLoadRetry(): void {
  loadRetry?.cancel();
  loadRetry = null;
}

function scheduleTierDetailHashFocus(): void {
  if (typeof window === "undefined" || window.location.hash !== "#model-pool") {
    return;
  }
  requestAnimationFrame(() => {
    document
      .querySelector('[data-testid="tier-detail-section-model-pool"]')
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

function gatewayOf(client: GatewayBrowserClient) {
  return createResourceCatalogGateway(client);
}

function syncTierDrafts(tier: ResourceTier, creditCost: number): void {
  state.tier = tier;
  state.nameDraft = tier.name;
  state.descriptionDraft = tier.description ?? "";
  state.creditCost = creditCost;
  state.creditDraft = String(creditCost);
}

function defaultFailoverRule(tierId: string): TierFailoverRule {
  return {
    tier: tierId,
    enabled: false,
    failureRateThreshold: 0.1,
    minSampleSize: 20,
    maxConsecutiveFailures: 3,
    latencyThresholdMs: 0,
    cooldownSeconds: 60,
    mode: "next_in_pool",
    fallbackTierId: null,
    fallbackModelId: null,
    updatedAt: "",
  };
}

function syncFailoverDrafts(rule: TierFailoverRule): void {
  state.failoverEnabled = rule.enabled;
  state.failoverFailureRatePct =
    rule.failureRateThreshold === null
      ? ""
      : String(Math.round(rule.failureRateThreshold * 1000) / 10);
  state.failoverMinSample = String(rule.minSampleSize);
  state.failoverMaxFailures = String(rule.maxConsecutiveFailures);
  state.failoverLatencyMs = String(rule.latencyThresholdMs);
  state.failoverCooldownSec = String(rule.cooldownSeconds);
  state.failoverMode = rule.enabled ? rule.mode : "disabled";
  state.failoverFallbackTierId = rule.fallbackTierId ?? "";
}

let loadGeneration = 0;

function retryTierDetailLoad(client: GatewayBrowserClient, tierId: string): void {
  cancelLoadRetry();
  loaded = false;
  state.loading = false;
  void load(client, tierId);
}

async function load(client: GatewayBrowserClient, tierId: string): Promise<void> {
  const generation = ++loadGeneration;
  state.loading = true;
  state.error = null;
  rerenderFn?.();
  try {
    const [overview, resolved] = await Promise.all([
      gatewayOf(client).overview(),
      gatewayOf(client).resolveTiers({ tierIds: [tierId] }),
    ]);
    if (generation !== loadGeneration) {
      return;
    }
    const tier = overview.tiers.find((entry) => entry.id === tierId) ?? null;
    if (!tier) {
      state.loading = false;
      loaded = true;
      state.error = t("resourceCatalog.tierDetailNotFound");
      rerenderFn?.();
      return;
    }
    const creditCost =
      overview.creditWeights.find((entry) => entry.tier === tierId)?.creditCost ?? 0;
    state.models = overview.models;
    state.tiers = overview.tiers;
    state.pool = resolved.pool;
    state.tierUsageStats = overview.tierUsageStats ?? [];
    const failoverRule =
      overview.failoverRules?.find((entry) => entry.tier === tierId) ?? defaultFailoverRule(tierId);
    syncFailoverDrafts(failoverRule);
    syncTierDrafts(tier, creditCost);
    state.loading = false;
    loaded = true;
    cancelLoadRetry();
    scheduleTierDetailHashFocus();
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
            if (lastClient === client && lastTierId === tierId && !loaded && !state.loading) {
              void load(client, tierId);
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
}

function ensureLoaded(client: GatewayBrowserClient, tierId: string, rerender: () => void): void {
  rerenderFn = rerender;
  if (!client.connected) {
    cancelLoadRetry();
    state.loading = false;
    loaded = false;
    state.error = t("resourceCatalog.gatewayDisconnected");
    return;
  }
  if (lastClient !== client || lastTierId !== tierId) {
    lastClient = client;
    lastTierId = tierId;
    loaded = false;
    cancelLoadRetry();
  }
  if (loaded || state.loading) {
    return;
  }
  void load(client, tierId);
}

export function reloadPlatformResourceCatalogTierDetail(
  client: GatewayBrowserClient,
  tierId: string,
  rerender: () => void,
): void {
  rerenderFn = rerender;
  lastClient = client;
  lastTierId = tierId;
  loaded = false;
  cancelLoadRetry();
  void load(client, tierId);
}

export function __resetResourceCatalogTierDetailForTest(): void {
  state.loading = false;
  state.busy = false;
  state.error = null;
  state.notice = null;
  state.tier = null;
  state.tiers = [];
  state.models = [];
  state.creditCost = 0;
  state.creditDraft = "0";
  state.nameDraft = "";
  state.descriptionDraft = "";
  state.pool = null;
  state.tierUsageStats = [];
  state.failoverEnabled = false;
  state.failoverFailureRatePct = "10";
  state.failoverMinSample = "20";
  state.failoverMaxFailures = "3";
  state.failoverLatencyMs = "0";
  state.failoverCooldownSec = "60";
  state.failoverMode = "next_in_pool";
  state.failoverFallbackTierId = "";
  lastClient = null;
  lastTierId = null;
  loaded = false;
  rerenderFn = null;
  cancelLoadRetry();
}

function tierModels(tierId: string): ResourceModelCatalogEntry[] {
  return state.models
    .filter((model) => model.tier === tierId)
    .toSorted((left, right) => left.displayName.localeCompare(right.displayName));
}

function modelCostLevelI18n(level: ReturnType<typeof modelCostLevelLabel>): string {
  switch (level) {
    case "low":
      return t("resourceCatalog.governanceCostLevelLow");
    case "mid":
      return t("resourceCatalog.governanceCostLevelMid");
    case "high":
      return t("resourceCatalog.governanceCostLevelHigh");
  }
}

async function handleSaveBasics(client: GatewayBrowserClient, tierId: string): Promise<void> {
  const tier = state.tier;
  if (!tier) {
    return;
  }
  const name = state.nameDraft.trim();
  if (!name) {
    state.error = t("resourceCatalog.tierDetailNameRequired");
    rerenderFn?.();
    return;
  }
  state.busy = true;
  state.error = null;
  state.notice = null;
  rerenderFn?.();
  try {
    const result = await gatewayOf(client).upsertTier({
      id: tierId,
      code: tier.code,
      name,
      description: state.descriptionDraft.trim(),
      sortOrder: tier.sortOrder,
      status: tier.status,
    });
    syncTierDrafts(result.tier, state.creditCost);
    state.notice = t("resourceCatalog.tierDetailBasicsSaved");
  } catch (err) {
    state.error = err instanceof Error ? err.message : t("resourceCatalog.tierDetailSaveFailed");
  } finally {
    state.busy = false;
    rerenderFn?.();
  }
}

async function handleSaveCredit(client: GatewayBrowserClient, tierId: string): Promise<void> {
  const parsed = parseCreditWeightDraft(state.creditDraft);
  if (parsed === null) {
    state.error = t("resourceCatalog.creditWeightInvalid");
    rerenderFn?.();
    return;
  }
  state.busy = true;
  state.error = null;
  state.notice = null;
  rerenderFn?.();
  try {
    await gatewayOf(client).upsertCreditWeight({ tier: tierId, creditCost: parsed });
    state.creditCost = parsed;
    state.creditDraft = String(parsed);
    state.notice = t("resourceCatalog.creditWeightSaved", { tier: tierId });
  } catch (err) {
    state.error = err instanceof Error ? err.message : t("resourceCatalog.creditWeightSaveFailed");
  } finally {
    state.busy = false;
    rerenderFn?.();
  }
}

async function handleToggleModel(
  client: GatewayBrowserClient,
  model: ResourceModelCatalogEntry,
): Promise<void> {
  state.busy = true;
  rerenderFn?.();
  try {
    await gatewayOf(client).upsertModel({
      modelId: model.modelId,
      tier: model.tier,
      enabled: !model.enabled,
    });
    if (lastTierId) {
      await load(client, lastTierId);
    }
  } catch (err) {
    state.error = err instanceof Error ? err.message : t("resourceCatalog.modelUpdateFailed");
    state.busy = false;
    rerenderFn?.();
  }
}

async function handleModelTierChange(
  client: GatewayBrowserClient,
  tierId: string,
  modelId: string,
  nextTier: string,
): Promise<void> {
  if (nextTier === tierId) {
    return;
  }
  state.busy = true;
  rerenderFn?.();
  try {
    await gatewayOf(client).upsertModel({ modelId, tier: nextTier });
    await load(client, tierId);
    state.notice = t("resourceCatalog.tierDetailModelMoved");
  } catch (err) {
    state.error = err instanceof Error ? err.message : t("resourceCatalog.modelUpdateFailed");
  } finally {
    state.busy = false;
    rerenderFn?.();
  }
}

function parseFailoverFailureRate(): number | null {
  const raw = state.failoverFailureRatePct.trim();
  if (!raw) {
    return null;
  }
  const pct = Number(raw);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return null;
  }
  return pct / 100;
}

function parseNonNegativeIntDraft(raw: string): number | null {
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.floor(value);
}

async function handleSaveFailover(client: GatewayBrowserClient, tierId: string): Promise<void> {
  const enabled = state.failoverEnabled;
  const mode: TierFailoverMode = enabled ? state.failoverMode : "disabled";
  const failureRateThreshold = enabled ? parseFailoverFailureRate() : null;
  if (enabled && state.failoverFailureRatePct.trim() && failureRateThreshold === null) {
    state.error = t("resourceCatalog.creditWeightInvalid");
    rerenderFn?.();
    return;
  }
  const minSampleSize = parseNonNegativeIntDraft(state.failoverMinSample);
  const maxConsecutiveFailures = parseNonNegativeIntDraft(state.failoverMaxFailures);
  const latencyThresholdMs = parseNonNegativeIntDraft(state.failoverLatencyMs);
  const cooldownSeconds = parseNonNegativeIntDraft(state.failoverCooldownSec);
  if (
    minSampleSize === null ||
    maxConsecutiveFailures === null ||
    latencyThresholdMs === null ||
    cooldownSeconds === null
  ) {
    state.error = t("resourceCatalog.creditWeightInvalid");
    rerenderFn?.();
    return;
  }
  const fallbackTierId = state.failoverFallbackTierId.trim();
  if (enabled && mode === "fallback_tier" && !fallbackTierId) {
    state.error = t("resourceCatalog.tierDetailFailoverFallbackRequired");
    rerenderFn?.();
    return;
  }
  state.busy = true;
  state.error = null;
  state.notice = null;
  rerenderFn?.();
  try {
    const result = await gatewayOf(client).upsertFailoverRule({
      tier: tierId,
      enabled,
      failureRateThreshold,
      minSampleSize,
      maxConsecutiveFailures,
      latencyThresholdMs,
      cooldownSeconds,
      mode,
      fallbackTierId: mode === "fallback_tier" ? fallbackTierId : null,
      fallbackModelId: null,
    });
    syncFailoverDrafts(result.failoverRule);
    state.notice = t("resourceCatalog.tierDetailFailoverSaved");
  } catch (err) {
    state.error =
      err instanceof Error ? err.message : t("resourceCatalog.tierDetailFailoverSaveFailed");
  } finally {
    state.busy = false;
    rerenderFn?.();
  }
}

async function handleImportModel(
  client: GatewayBrowserClient,
  tierId: string,
  model: ResourceModelCatalogEntry,
): Promise<void> {
  state.busy = true;
  rerenderFn?.();
  try {
    await gatewayOf(client).upsertModel({ modelId: model.modelId, tier: tierId });
    await load(client, tierId);
    state.notice = t("resourceCatalog.tierDetailModelImported", { name: model.displayName });
  } catch (err) {
    state.error = err instanceof Error ? err.message : t("resourceCatalog.modelUpdateFailed");
  } finally {
    state.busy = false;
    rerenderFn?.();
  }
}

function otherTierModels(tierId: string): ResourceModelCatalogEntry[] {
  return state.models
    .filter((model) => model.tier !== tierId)
    .toSorted((left, right) => left.displayName.localeCompare(right.displayName));
}

function tierLabel(tierId: string): string {
  const tier = state.tiers.find((entry) => entry.id === tierId);
  return tier ? `Tier ${tierDisplayCode(tier)}` : tierId;
}

function renderSection(titleKey: string, body: TemplateResult, testId: string): TemplateResult {
  return html`
    <section class="resource-governance__tier-detail-section" data-testid=${testId}>
      <div class="resource-governance__domain-title">${t(titleKey)}</div>
      ${body}
    </section>
  `;
}

function renderBasicsPanel(client: GatewayBrowserClient, tierId: string): TemplateResult {
  return renderSection(
    "resourceCatalog.tierDetailSectionBasics",
    html`
      <div class="resource-governance__tier-detail-form">
        <label class="platform-pricing__field-stacked">
          <span class="platform-pricing__field-stacked-label"
            >${t("resourceCatalog.tierDetailFieldName")}</span
          >
          <input
            class="platform-pricing__input"
            type="text"
            data-testid="tier-detail-name"
            ?disabled=${state.busy}
            .value=${state.nameDraft}
            @input=${(e: Event) => {
              state.nameDraft = (e.target as HTMLInputElement).value;
              rerenderFn?.();
            }}
          />
        </label>
        <label class="platform-pricing__field-stacked">
          <span class="platform-pricing__field-stacked-label"
            >${t("resourceCatalog.tierDetailFieldDescription")}</span
          >
          <textarea
            class="platform-pricing__input"
            rows="3"
            data-testid="tier-detail-description"
            ?disabled=${state.busy}
            .value=${state.descriptionDraft}
            @input=${(e: Event) => {
              state.descriptionDraft = (e.target as HTMLTextAreaElement).value;
              rerenderFn?.();
            }}
          ></textarea>
        </label>
        <dl class="resource-governance__kv-stack">
          <div class="resource-governance__kv-row">
            <dt>${t("resourceCatalog.tierDetailFieldCode")}</dt>
            <dd><code>Tier ${tierDisplayCode(state.tier!)}</code></dd>
          </div>
          <div class="resource-governance__kv-row">
            <dt>${t("resourceCatalog.tierDetailFieldStatus")}</dt>
            <dd>
              ${state.tier?.status === "active" ? t("resourceCatalog.enabled") : t("resourceCatalog.disabled")}
            </dd>
          </div>
        </dl>
        <button
          type="button"
          class="btn btn--primary"
          data-testid="tier-detail-save-basics"
          ?disabled=${state.busy}
          @click=${() => void handleSaveBasics(client, tierId)}
        >
          ${state.busy ? t("resourceCatalog.syncing") : t("resourceCatalog.saveChanges")}
        </button>
      </div>
    `,
    "tier-detail-section-basics",
  );
}

function renderModelPoolPanel(client: GatewayBrowserClient, tierId: string): TemplateResult {
  const models = tierModels(tierId);
  const poolCount = state.pool?.modelIds.length ?? models.filter((model) => model.enabled).length;
  return renderSection(
    "resourceCatalog.tierDetailSectionModelPool",
    html`
      <div class="muted resource-governance__tier-detail-hint">
        ${t("resourceCatalog.tierDetailModelPoolHint", { count: String(poolCount) })}
      </div>
      <div class="resource-governance__health-table-wrap">
        <table class="resource-governance__model-table" data-testid="tier-detail-model-pool">
          <thead>
            <tr>
              <th>${t("resourceCatalog.governanceModelName")}</th>
              <th>${t("resourceCatalog.governanceModelStatus")}</th>
              <th>${t("resourceCatalog.governanceModelCostLevel")}</th>
              <th>${t("resourceCatalog.governanceModelPriority")}</th>
              <th>${t("resourceCatalog.tier")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${
              models.length === 0
                ? html`
                    <tr>
                      <td colspan="6" class="muted">${t("resourceCatalog.noModelsInTier")}</td>
                    </tr>
                  `
                : models.map(
                    (model, index) => html`
                      <tr data-testid="tier-detail-model-row-${model.modelId}">
                        <td>
                          <div class="resource-governance__model-row-name">
                            ${model.displayName}
                          </div>
                          <div class="muted resource-governance__model-row-id">
                            ${model.modelId}
                          </div>
                        </td>
                        <td>
                          <span
                            class="resource-governance__status-pill ${model.enabled ? "is-ok" : "is-muted"}"
                          >
                            ${model.enabled ? t("resourceCatalog.enabled") : t("resourceCatalog.disabled")}
                          </span>
                        </td>
                        <td>${modelCostLevelI18n(modelCostLevelLabel(state.creditCost))}</td>
                        <td>${index + 1}</td>
                        <td>
                          <select
                            class="platform-pricing__input resource-governance__model-tier-select"
                            ?disabled=${state.busy}
                            data-testid="tier-detail-model-tier-${model.modelId}"
                            @change=${(e: Event) => {
                              const nextTier = (e.target as HTMLSelectElement).value;
                              void handleModelTierChange(client, tierId, model.modelId, nextTier);
                            }}
                          >
                            ${sortTiers(state.tiers).map(
                              (tier) => html`
                                <option value=${tier.id} ?selected=${model.tier === tier.id}>
                                  ${tier.name}
                                </option>
                              `,
                            )}
                          </select>
                        </td>
                        <td>
                          <button
                            type="button"
                            class="btn btn--sm"
                            data-testid="tier-detail-toggle-model-${model.modelId}"
                            ?disabled=${state.busy}
                            @click=${() => void handleToggleModel(client, model)}
                          >
                            ${
                              model.enabled
                                ? t("resourceCatalog.tierDetailDisableModel")
                                : t("resourceCatalog.tierDetailEnableModel")
                            }
                          </button>
                        </td>
                      </tr>
                    `,
                  )
            }
          </tbody>
        </table>
      </div>
      ${renderImportModelsPanel(client, tierId)}
    `,
    "tier-detail-section-model-pool",
  );
}

function renderImportModelsPanel(
  client: GatewayBrowserClient,
  tierId: string,
): TemplateResult | typeof nothing {
  const candidates = otherTierModels(tierId);
  if (candidates.length === 0) {
    return nothing;
  }
  return html`
    <details class="resource-governance__inline-advanced" data-testid="tier-detail-import-models">
      <summary>${t("resourceCatalog.tierDetailSectionImportModels")}</summary>
      <div class="resource-governance__health-table-wrap card-follow--sm">
        <table class="resource-governance__model-table">
          <thead>
            <tr>
              <th>${t("resourceCatalog.governanceModelName")}</th>
              <th>${t("resourceCatalog.tier")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${candidates.map(
              (model) => html`
                <tr data-testid="tier-detail-import-row-${model.modelId}">
                  <td>
                    <div class="resource-governance__model-row-name">${model.displayName}</div>
                    <div class="muted resource-governance__model-row-id">${model.modelId}</div>
                  </td>
                  <td>${tierLabel(model.tier)}</td>
                  <td>
                    <button
                      type="button"
                      class="btn btn--sm"
                      data-testid="tier-detail-import-${model.modelId}"
                      ?disabled=${state.busy}
                      @click=${() => void handleImportModel(client, tierId, model)}
                    >
                      ${t("resourceCatalog.tierDetailMoveToTier")}
                    </button>
                  </td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </details>
  `;
}

function renderRoutingPanel(
  tierId: string,
  options: ResourceCatalogSectionOptions,
): TemplateResult {
  const policies = options.catalogPolicies ?? [];
  const summary = routingSummaryForTier(tierId, options, policies);
  return renderSection(
    "resourceCatalog.tierDetailSectionRouting",
    html`
      <dl class="resource-governance__kv-stack">
        <div class="resource-governance__kv-row">
          <dt>${t("resourceCatalog.governanceTierRouting")}</dt>
          <dd>${summary}</dd>
        </div>
        <div class="resource-governance__kv-row">
          <dt>${t("resourceCatalog.tierDetailResolvedPool")}</dt>
          <dd>${state.pool?.modelIds.length ?? 0}</dd>
        </div>
      </dl>
      <div class="muted resource-governance__tier-detail-hint">
        ${t("resourceCatalog.tierDetailRoutingHint")}
      </div>
    `,
    "tier-detail-section-routing",
  );
}

function renderCostPanel(client: GatewayBrowserClient, tierId: string): TemplateResult {
  return renderSection(
    "resourceCatalog.tierDetailSectionCost",
    html`
      <label class="resource-governance__inline-edit">
        <span class="resource-governance__metric-label"
          >${t("resourceCatalog.governanceTierCredits")}</span
        >
        <input
          class="platform-pricing__input resource-governance__credit-input"
          type="number"
          min="0"
          step="1"
          data-testid="tier-detail-credit-input"
          ?disabled=${state.busy}
          .value=${state.creditDraft}
          @input=${(e: Event) => {
            state.creditDraft = (e.target as HTMLInputElement).value;
            rerenderFn?.();
          }}
        />
        <span class="muted">${t("resourceCatalog.creditsPerTaskShort")}</span>
      </label>
      <div class="card-follow--sm">
        <button
          type="button"
          class="btn btn--primary"
          data-testid="tier-detail-save-credit"
          ?disabled=${state.busy}
          @click=${() => void handleSaveCredit(client, tierId)}
        >
          ${state.busy ? t("resourceCatalog.syncing") : t("resourceCatalog.creditWeightSave")}
        </button>
      </div>
    `,
    "tier-detail-section-cost",
  );
}

function renderFailoverPanel(client: GatewayBrowserClient, tierId: string): TemplateResult {
  const otherTiers = sortTiers(state.tiers).filter((tier) => tier.id !== tierId);
  return renderSection(
    "resourceCatalog.tierDetailSectionFailover",
    html`
      <div class="muted resource-governance__tier-detail-hint">
        ${t("resourceCatalog.tierDetailFailoverHint")}
      </div>
      <label class="resource-governance__inline-edit card-follow--sm">
        <input
          type="checkbox"
          ?checked=${state.failoverEnabled}
          ?disabled=${state.busy}
          data-testid="tier-detail-failover-enabled"
          @change=${(e: Event) => {
            state.failoverEnabled = (e.target as HTMLInputElement).checked;
            if (!state.failoverEnabled) {
              state.failoverMode = "disabled";
            } else if (state.failoverMode === "disabled") {
              state.failoverMode = "next_in_pool";
            }
            rerenderFn?.();
          }}
        />
        <span>${t("resourceCatalog.tierDetailFailoverEnabled")}</span>
      </label>
      <div class="resource-governance__tier-detail-form card-follow--sm">
        <label class="platform-pricing__field-stacked">
          <span class="platform-pricing__field-stacked-label"
            >${t("resourceCatalog.tierDetailFailoverFailureRate")}</span
          >
          <input
            class="platform-pricing__input"
            type="number"
            min="0"
            max="100"
            step="0.1"
            ?disabled=${state.busy || !state.failoverEnabled}
            data-testid="tier-detail-failover-failure-rate"
            .value=${state.failoverFailureRatePct}
            @input=${(e: Event) => {
              state.failoverFailureRatePct = (e.target as HTMLInputElement).value;
              rerenderFn?.();
            }}
          />
        </label>
        <label class="platform-pricing__field-stacked">
          <span class="platform-pricing__field-stacked-label"
            >${t("resourceCatalog.tierDetailFailoverMinSample")}</span
          >
          <input
            class="platform-pricing__input"
            type="number"
            min="0"
            step="1"
            ?disabled=${state.busy || !state.failoverEnabled}
            data-testid="tier-detail-failover-min-sample"
            .value=${state.failoverMinSample}
            @input=${(e: Event) => {
              state.failoverMinSample = (e.target as HTMLInputElement).value;
              rerenderFn?.();
            }}
          />
        </label>
        <label class="platform-pricing__field-stacked">
          <span class="platform-pricing__field-stacked-label"
            >${t("resourceCatalog.tierDetailFailoverMaxFailures")}</span
          >
          <input
            class="platform-pricing__input"
            type="number"
            min="0"
            step="1"
            ?disabled=${state.busy || !state.failoverEnabled}
            data-testid="tier-detail-failover-max-failures"
            .value=${state.failoverMaxFailures}
            @input=${(e: Event) => {
              state.failoverMaxFailures = (e.target as HTMLInputElement).value;
              rerenderFn?.();
            }}
          />
        </label>
        <label class="platform-pricing__field-stacked">
          <span class="platform-pricing__field-stacked-label"
            >${t("resourceCatalog.tierDetailFailoverLatency")}</span
          >
          <input
            class="platform-pricing__input"
            type="number"
            min="0"
            step="1"
            ?disabled=${state.busy || !state.failoverEnabled}
            data-testid="tier-detail-failover-latency"
            .value=${state.failoverLatencyMs}
            @input=${(e: Event) => {
              state.failoverLatencyMs = (e.target as HTMLInputElement).value;
              rerenderFn?.();
            }}
          />
        </label>
        <label class="platform-pricing__field-stacked">
          <span class="platform-pricing__field-stacked-label"
            >${t("resourceCatalog.tierDetailFailoverCooldown")}</span
          >
          <input
            class="platform-pricing__input"
            type="number"
            min="0"
            step="1"
            ?disabled=${state.busy || !state.failoverEnabled}
            data-testid="tier-detail-failover-cooldown"
            .value=${state.failoverCooldownSec}
            @input=${(e: Event) => {
              state.failoverCooldownSec = (e.target as HTMLInputElement).value;
              rerenderFn?.();
            }}
          />
        </label>
        <label class="platform-pricing__field-stacked">
          <span class="platform-pricing__field-stacked-label"
            >${t("resourceCatalog.tierDetailFailoverMode")}</span
          >
          <select
            class="platform-pricing__input"
            ?disabled=${state.busy || !state.failoverEnabled}
            data-testid="tier-detail-failover-mode"
            .value=${state.failoverMode}
            @change=${(e: Event) => {
              state.failoverMode = (e.target as HTMLSelectElement).value as TierFailoverMode;
              rerenderFn?.();
            }}
          >
            <option value="next_in_pool">
              ${t("resourceCatalog.tierDetailFailoverModeNextInPool")}
            </option>
            <option value="fallback_tier">
              ${t("resourceCatalog.tierDetailFailoverModeFallbackTier")}
            </option>
          </select>
        </label>
        ${
          state.failoverEnabled && state.failoverMode === "fallback_tier"
            ? html`
                <label class="platform-pricing__field-stacked">
                  <span class="platform-pricing__field-stacked-label"
                    >${t("resourceCatalog.tierDetailFailoverFallbackTier")}</span
                  >
                  <select
                    class="platform-pricing__input"
                    ?disabled=${state.busy}
                    data-testid="tier-detail-failover-fallback-tier"
                    .value=${state.failoverFallbackTierId}
                    @change=${(e: Event) => {
                      state.failoverFallbackTierId = (e.target as HTMLSelectElement).value;
                      rerenderFn?.();
                    }}
                  >
                    <option value="">${t("resourceCatalog.tierDetailFailoverModeDisabled")}</option>
                    ${otherTiers.map(
                      (tier) => html` <option value=${tier.id}>${tier.name}</option> `,
                    )}
                  </select>
                </label>
              `
            : nothing
        }
        <button
          type="button"
          class="btn btn--primary"
          data-testid="tier-detail-save-failover"
          ?disabled=${state.busy}
          @click=${() => void handleSaveFailover(client, tierId)}
        >
          ${state.busy ? t("resourceCatalog.syncing") : t("resourceCatalog.saveChanges")}
        </button>
      </div>
    `,
    "tier-detail-section-failover",
  );
}

function renderPlanAuthPanel(
  tierId: string,
  options: ResourceCatalogSectionOptions,
): TemplateResult {
  const plans = plansUnlockingTier(tierId, options);
  const rows = buildPlanAuthorizationRows(
    state.tiers,
    options,
    options.catalogPolicies ?? [],
  ).filter((row) => plans.some((plan) => plan.id === row.planId));
  return renderSection(
    "resourceCatalog.tierDetailSectionPlanAuth",
    html`
      ${
        rows.length === 0
          ? html`<div class="muted">${t("resourceCatalog.tierDetailNoPlans")}</div>`
          : html`
              <div class="resource-governance__plan-auth-grid">
                ${rows.map(
                  (row) => html`
                    <article class="resource-governance__plan-auth-card">
                      <div class="resource-governance__plan-auth-name">${row.planName}</div>
                      <dl
                        class="resource-governance__kv-stack resource-governance__kv-stack--compact"
                      >
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
            `
      }
    `,
    "tier-detail-section-plan-auth",
  );
}

function renderHealthPanel(tierId: string, options: ResourceCatalogSectionOptions): TemplateResult {
  const usage = tierUsageStatById(state.tierUsageStats, tierId);
  const latencyLabel = formatTierLatencyMs(usage?.avgLatencyMs);
  const failureLabel = formatTierFailureRate(usage?.failureRate);
  return renderSection(
    "resourceCatalog.tierDetailSectionHealth",
    html`
      <dl class="resource-governance__kv-stack">
        <div class="resource-governance__kv-row">
          <dt>${t("resourceCatalog.governanceHealthCalls")}</dt>
          <dd>
            ${formatTierTaskCount(usage?.taskCount ?? 0)}
            <span class="muted">${t("resourceCatalog.tierCallsSuffix")}</span>
          </dd>
        </div>
        <div class="resource-governance__kv-row">
          <dt>${t("resourceCatalog.governanceHealthLatency")}</dt>
          <dd class=${latencyLabel ? "" : "muted"}>
            ${latencyLabel || t("resourceCatalog.tierStatsUnavailable")}
          </dd>
        </div>
        <div class="resource-governance__kv-row">
          <dt>${t("resourceCatalog.governanceHealthFailure")}</dt>
          <dd class=${failureLabel ? "" : "muted"}>
            ${failureLabel || t("resourceCatalog.tierStatsUnavailable")}
          </dd>
        </div>
        <div class="resource-governance__kv-row">
          <dt>${t("resourceCatalog.governanceTierServingEnterprises")}</dt>
          <dd>${countEnterprisesServingTier(tierId, options)}</dd>
        </div>
      </dl>
    `,
    "tier-detail-section-health",
  );
}

export type ResourceCatalogTierDetailOptions = ResourceCatalogSectionOptions & {
  basePath: string;
  onBack: () => void;
};

export function renderPlatformResourceCatalogTierDetail(
  client: GatewayBrowserClient,
  tierId: string,
  rerender: () => void,
  options: ResourceCatalogTierDetailOptions,
): TemplateResult {
  ensureLoaded(client, tierId, rerender);

  if (state.loading) {
    return html`
      <div class="muted" data-testid="resource-catalog-loading">
        <p>${t("resourceCatalog.loading")}</p>
        <button
          class="btn btn--sm"
          type="button"
          data-testid="resource-catalog-retry"
          @click=${() => retryTierDetailLoad(client, tierId)}
        >
          ${t("resourceCatalog.retryLoad")}
        </button>
      </div>
    `;
  }

  if (!state.tier) {
    return html`
      <div class="resource-governance__tier-detail-page" data-testid="tier-detail-page">
        ${state.error ? html`<div class="callout warning">${state.error}</div>` : nothing}
        <button type="button" class="btn" data-testid="tier-detail-back" @click=${options.onBack}>
          ${t("resourceCatalog.tierDetailBack")}
        </button>
      </div>
    `;
  }

  const groups = groupModelsByTier({
    tiers: [state.tier],
    models: state.models,
    creditWeights: [{ tier: tierId, creditCost: state.creditCost, updatedAt: "" }],
  });
  const subtitle = groups[0]?.tier.description?.trim() || state.tier.name;

  return html`
    <div class="resource-governance__tier-detail-page" data-testid="tier-detail-page">
      <header class="resource-governance__tier-detail-header">
        <button
          type="button"
          class="btn btn--sm"
          data-testid="tier-detail-back"
          @click=${options.onBack}
        >
          ${t("resourceCatalog.tierDetailBack")}
        </button>
        <div>
          <h2 class="resource-governance__tier-detail-title">${tierHeadline(state.tier)}</h2>
          <div class="muted">${subtitle}</div>
        </div>
      </header>
      ${state.error ? html`<div class="callout warning">${state.error}</div>` : nothing}
      ${state.notice ? html`<div class="callout">${state.notice}</div>` : nothing}
      <div class="resource-governance__tier-detail-sections">
        ${renderBasicsPanel(client, tierId)} ${renderModelPoolPanel(client, tierId)}
        ${renderRoutingPanel(tierId, options)} ${renderCostPanel(client, tierId)}
        ${renderFailoverPanel(client, tierId)} ${renderPlanAuthPanel(tierId, options)}
        ${renderHealthPanel(tierId, options)}
      </div>
    </div>
  `;
}
