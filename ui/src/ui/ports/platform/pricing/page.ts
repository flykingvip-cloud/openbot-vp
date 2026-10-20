/**
 * 平台端「套餐与定价管理」表面（platformPricing 路由）。
 *
 * 平台管理员定义套餐（Plan）与定价规则（seat/usage/extra × key）。价格唯一真相，
 * 企业端只读消费（R1 / R2 / R3 / R14）。读写经 `platform-plan-bundle.*` 一体化 RPC。
 *
 * 版本生命周期（R24 / R25）：
 * - 套餐展开 → 版本列表（status 徽标 + active 标识 + vN）。
 * - 新建草稿（draft）→ 编辑草稿定价 → 激活（activate）。
 * - 激活前展示后端 diff（与当前 active 对比）+ 影响提示（不影响已有订阅）+ 二次确认。
 */

import { html, nothing, type TemplateResult } from "lit";
import { i18n, t } from "../../../../i18n/index.ts";
import type {
  Plan,
  PlanVersion,
  PricingDiff,
} from "../../../capability/cost-budget-billing/index.ts";
import { createCostEconomicsGateway } from "../../../capability/cost-economics/index.ts";
import type { EconomicsOverviewResponse } from "../../../capability/cost-economics/index.ts";
import { createPlatformPlanBundleGateway } from "../../../capability/platform-plan-bundle/index.ts";
import type {
  PlatformPlanBundleOverviewResponse,
  PlatformPlanBundleVersionRow,
} from "../../../capability/platform-plan-bundle/index.ts";
import {
  createPlatformPricingCatalogGateway,
  type PricingCatalogViewModel,
} from "../../../capability/platform-pricing-catalog/index.ts";
import {
  createPlatformSubscriptionsGateway,
  type PlatformCommercialSummary,
} from "../../../capability/platform-subscriptions/index.ts";
import { createPolicyEngineGateway } from "../../../capability/policy-engine/index.ts";
import type { RoutingPolicy } from "../../../capability/policy-engine/index.ts";
import { createResourceCatalogGateway } from "../../../capability/resource-catalog/index.ts";
import type {
  ResourceModelCatalogEntry,
  ResourceTier,
} from "../../../capability/resource-catalog/index.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import { pushAppHistoryState, requestOpenBotAppRerender } from "../../../request-app-rerender.ts";
import { renderPricingPage } from "../../../views/pricing-v3/pricing-page.ts";
import {
  renderPlatformCommerceWorkbench,
  reloadPlatformCommerceWorkbench,
  __resetPlatformCommerceWorkbenchForTest,
} from "../commerce/page.ts";
import type { PlatformSurfaceProps } from "../shared/surface.ts";
import { followPortHref } from "../shared/surface.ts";
import {
  buildAorTaskTypeSelectOptions,
  resolveAorTaskTypeDefaultEvaluator,
} from "./aor-form-options.ts";
import {
  computeEntitlementDiff,
  groupVersionsForTimeline,
  policyDisplay,
  tierCapabilityLabels,
  type EntitlementDiffRow,
} from "./commercial-display.ts";
import { clearEconomicsFocus, setEconomicsFocus } from "./economics-focus.ts";
import {
  renderPlatformEconomicsSection,
  reloadPlatformEconomicsSection,
  __resetEconomicsSectionForTest,
} from "./economics-section.ts";
import {
  createGatewayLoadRetry,
  isTransientGatewayError,
  isTransientGatewayErrorMessage,
  type GatewayLoadRetryController,
} from "./gateway-load-retry.ts";
import {
  renderPlanActivateConfirmPanel,
  type ModelBindingDiff,
} from "./plan-activate-confirm-panel.ts";
import {
  planCommercialMetrics,
  planDisplayMeta,
  versionCommercialMeta,
  versionLockedSubscriptions,
} from "./plan-commercial-meta.ts";
import {
  formatActivationBlocker,
  renderPlanConfigWorkspace,
  renderPlanPreviewOverview,
  type PlanEditTab,
  type PlanWorkspaceMode,
} from "./plan-config-workspace.ts";
import {
  auditPlanBindingConsistency,
  mapRpcConsistencyIssues,
  type PlanConsistencyIssue,
} from "./plan-consistency-audit.ts";
import {
  buildAorExecutionForSave,
  buildDraftAorEditor,
  buildDraftModelBudgets,
  buildDraftModelQuota,
  buildEntitlementEditorFromMeta,
  buildEntitlementPayloadForSave,
  buildModelBudgetsForSave,
  buildModelQuotaForSave,
  marketingFeaturesFromForm,
  marketingFeaturesToForm,
  type DraftAorEditor,
  type EntitlementEditor,
  type ModelBudgetFormEntry,
  type ModelQuotaFormEntry,
} from "./plan-form-helpers.ts";
import { resolvePlanVersionHealth } from "./plan-health-summary.ts";
import {
  buildMatchingProfileFromFormData,
  buildNextMarketingTags,
  requestSetMarketingTags,
  requestSetMatchingProfile,
  type PlanMarketingTag,
} from "./plan-marketing-actions.ts";
import {
  renderPlanPublishWorkflow,
  type PublishStepId,
  type PublishWorkflowInput,
} from "./plan-publish-workflow.ts";
import {
  buildActivateConfirmState,
  buildDeleteConfirmState,
  buildDraftEditorState,
  draftMetersToPayload,
  meterSemanticsLabel,
  requestActivateVersion,
  requestCreateDraftVersion,
  requestDeleteVersion,
  requestDeprecateVersion,
  requestSaveDraftVersion,
  type DraftEditorState,
  type DraftMeterRow,
  type DraftPricingRow,
} from "./plan-version-actions.ts";
import { renderDeleteConfirmPanel, renderDraftEditorPanel } from "./plan-version-panels.ts";
import { renderPricingComparison } from "./pricing-comparison-view.ts";
import type { BillingCycle } from "./pricing-cycle.ts";
import { __resetPricingOperatingDashboardForTest } from "./pricing-operating-dashboard.ts";
import {
  renderPlatformResourceCatalogSection,
  reloadPlatformResourceCatalogSection,
  focusPlatformResourceCatalogSubTab,
  __resetResourceCatalogSectionForTest,
} from "./resource-catalog-section.ts";
import {
  renderPlatformResourceCatalogTierDetail,
  __resetResourceCatalogTierDetailForTest,
} from "./resource-catalog-tier-detail.ts";
import {
  platformPricingCreateHref,
  platformPricingHomeHref,
  platformPricingHref,
  platformPricingPlanHref,
  platformPricingTierHref,
  maybeRedirectLegacyPricingPath,
  parsePricingSubTab,
  resolvePricingRoute,
  type PlanDetailRoute,
  type PricingSubTab,
} from "./route.ts";
import { renderUnitEconomicsDrawer } from "./unit-economics-drawer.ts";
import { computeActivationMarginDelta, formatMarginRateDelta } from "./unit-economics.ts";

// ── 模块级状态（SPA 生命周期）─────────────────────────────────────────────
type CreateAorEditor = DraftAorEditor;

type PricingPageState = {
  plans: Plan[];
  loading: boolean;
  error: string | null;
  notice: string | null;
  catalogTiers: ResourceTier[];
  catalogPolicies: RoutingPolicy[];
  catalogModels: ResourceModelCatalogEntry[];
  resolvedTierModelIds: string[];
  // 创建套餐表单
  formName: string;
  formBasePriceYuan: string;
  formBotQuota: string;
  formViewerPriceYuan: string;
  formCreatorPriceYuan: string;
  formAiTokenPriceCents: string;
  /** 显式 MeterDefinition 表单（创建/编辑套餐） */
  formMeters: DraftMeterRow[];
  formAllowedModelIds: string[];
  formModelQuota: Record<string, ModelQuotaFormEntry>;
  formModelBudgets: Record<string, ModelBudgetFormEntry>;
  formModelSearch: string;
  formAor: CreateAorEditor;
  formEntitlement: EntitlementEditor;
  formSlogan: string;
  formTargetAudience: string;
  formMarketingFeatures: string;
  busy: boolean;
  // 版本管理（按 planId 缓存）
  expandedPlanId: string | null;
  bundleCatalog: string[];
  versionsByPlan: Record<string, PlanVersion[]>;
  versionMetaById: Record<string, PlatformPlanBundleVersionRow>;
  versionsLoading: boolean;
  // 草稿编辑器（针对某个 draft 版本）
  draftEditor: DraftEditorState | null;
  // 删除确认（针对某个可删除版本）
  deleteConfirm: { planId: string; versionId: string; versionNumber: number } | null;
  // 激活确认（含后端 diff）
  activateConfirm: {
    planId: string;
    versionId: string;
    versionNumber: number;
    diff: PricingDiff | null;
    bindingDiff: ModelBindingDiff | null;
    entitlementDiff: EntitlementDiffRow[];
    diffLoading: boolean;
  } | null;
  allocationPreviews: Record<
    string,
    {
      allowedTiers: string[];
      entitledModelCount: number;
      roleProfiles: Array<{ role: string; label: string; modelCount: number; tierIds: string[] }>;
    }
  >;
  commercialSummary: PlatformCommercialSummary | null;
  economicsOverview: EconomicsOverviewResponse | null;
  unitEconomicsDrawerPlanId: string | null;
  planDetailPlanId: string | null;
  bindingConsistencyIssues: PlanConsistencyIssue[] | null;
  bindingConsistencyLoading: boolean;
  pricingCatalog: PricingCatalogViewModel | null;
  pricingCatalogLoading: boolean;
  pricingCatalogError: string | null;
};

const state: PricingPageState = {
  plans: [],
  loading: false,
  error: null,
  notice: null,
  catalogTiers: [],
  catalogPolicies: [],
  catalogModels: [],
  resolvedTierModelIds: [],
  formName: "",
  formBasePriceYuan: "0",
  formBotQuota: "10",
  formViewerPriceYuan: "10",
  formCreatorPriceYuan: "30",
  formAiTokenPriceCents: "0.002",
  formMeters: [
    {
      key: "ai_token",
      unit: "token",
      includedQuota: "",
      includedMode: "usage_priced",
      overageMode: "block",
    },
  ],
  formAllowedModelIds: [],
  formModelQuota: {},
  formModelBudgets: {},
  formModelSearch: "",
  formAor: {
    enabled: false,
    taskTypeId: "",
    selectorStrategy: "balanced",
    evaluatorMode: "",
  },
  formEntitlement: {
    monthlyCredits: "0",
    aiBasic: "",
    aiPro: "",
    aiElite: "",
    maxConcurrentRuns: "",
    maxWorkflows: "",
    maxKnowledgeBases: "",
    overagePolicyType: "block",
    allowBurstConcurrency: false,
    allowedTiers: [],
    allowedPolicies: [],
    policyId: "balanced",
    auditLog: false,
    mfa: false,
    sso: false,
    vpcIsolation: false,
    allowPrivateModels: false,
    allowCustomPolicy: false,
  },
  formSlogan: "",
  formTargetAudience: "",
  formMarketingFeatures: "",
  busy: false,
  expandedPlanId: null,
  bundleCatalog: [],
  versionsByPlan: {},
  versionMetaById: {},
  versionsLoading: false,
  draftEditor: null,
  deleteConfirm: null,
  activateConfirm: null,
  allocationPreviews: {},
  commercialSummary: null,
  economicsOverview: null,
  unitEconomicsDrawerPlanId: null,
  planDetailPlanId: null,
  bindingConsistencyIssues: null,
  bindingConsistencyLoading: false,
  pricingCatalog: null,
  pricingCatalogLoading: false,
  pricingCatalogError: null,
};

let lastClient: GatewayBrowserClient | null = null;
let lastGatewayReconnectClient: GatewayBrowserClient | null = null;
let loaded = false;
let rerenderFn: (() => void) | null = null;
let loadPlansRetry: GatewayLoadRetryController | null = null;
let loadPlansInFlight: Promise<void> | null = null;
let reconnectReloadTimer: number | null = null;
let softRetryAtMs: number | null = null;
let loadPlansEpoch = 0;
let loadedEpochKey: string | null = null;
let inflightEpochKey: string | null = null;

const pricingClientIds = new WeakMap<GatewayBrowserClient, number>();
let nextPricingClientId = 1;
let lastPricingBasePath = "";

let pricingSubTab: PricingSubTab = "packages";

/** 档位对比视图选中的计费周期（月度/季度/年度），模块级 SPA 状态。 */
let pricingComparisonCycle: BillingCycle = "monthly";

/** 创建套餐页：预览 / 编辑 模式。 */
let createWorkspaceMode: PlanWorkspaceMode = "edit";
let editWorkspaceMode: PlanWorkspaceMode = "edit";
/** 已灌入统一编辑表单的 planId，避免重复覆盖用户未保存的编辑。 */
let bundleFormPlanId: string | null = null;

type PlanBundleFormPrefix = "create" | "edit";

function pricingClientId(client: GatewayBrowserClient): number {
  let id = pricingClientIds.get(client);
  if (id === undefined) {
    id = nextPricingClientId;
    nextPricingClientId += 1;
    pricingClientIds.set(client, id);
  }
  return id;
}

function currentLoadPlansEpochKey(client: GatewayBrowserClient): string {
  return `${pricingClientId(client)}::epoch:${loadPlansEpoch}`;
}

function bumpLoadPlansEpoch(): void {
  loadPlansEpoch += 1;
  loaded = false;
  loadedEpochKey = null;
}

function setPricingComparisonCycle(cycle: BillingCycle): void {
  pricingComparisonCycle = cycle;
  requestOpenBotAppRerender();
}

function openResourceCatalogFromPlan(basePath: string, client: GatewayBrowserClient): void {
  focusPlatformResourceCatalogSubTab("routing", client, () => rerenderFn?.());
  setPricingSubTab("resourceCatalog", client, { basePath });
}

function buildPublishWorkflowInput(plan: Plan): PublishWorkflowInput {
  const versions = state.versionsByPlan[plan.id] ?? [];
  const drafts = versions.filter((entry) => entry.status === "draft");
  const primaryDraft = drafts.toSorted((a, b) => b.version - a.version)[0] ?? null;
  const activeVersion = versions.find((entry) => entry.id === plan.currentVersionId) ?? null;
  const draftMeta = primaryDraft ? versionMetaOf(primaryDraft.id) : null;
  const activeMeta = activeVersion ? versionMetaOf(activeVersion.id) : null;
  const configureDone =
    draftMeta != null &&
    !draftMeta.activationBlockers.includes("missing_binding") &&
    draftMeta.bindingState !== "missing";
  const diffCount =
    primaryDraft && activeVersion
      ? computeEntitlementDiff(activeMeta, draftMeta, state.catalogTiers, state.catalogPolicies)
          .length
      : 0;
  const lockedOnActive =
    activeVersion != null
      ? versionLockedSubscriptions(plan.id, activeVersion.id, state.commercialSummary)
      : 0;

  return {
    hasDraft: primaryDraft != null,
    hasActiveVersion: activeVersion != null,
    configureDone,
    diffCount,
    activationReady: draftMeta?.activationReady ?? false,
    lockedSubscriptions: lockedOnActive,
  };
}

function syncPackagesHomeFromUrl(): void {
  if (typeof window === "undefined") {
    return;
  }
}

function syncPricingSubTabFromUrl(): void {
  if (typeof window === "undefined") {
    return;
  }
  const route = resolvePricingRoute(window.location.pathname, lastPricingBasePath);
  if (route.view === "tierDetail") {
    pricingSubTab = "resourceCatalog";
    return;
  }
  if (route.view === "home") {
    pricingSubTab = parsePricingSubTab(window.location.search);
  }
}

function normalizePricingHref(href: string): string {
  if (typeof window === "undefined") {
    return href;
  }
  try {
    return (
      new URL(href, window.location.origin).pathname + new URL(href, window.location.origin).search
    );
  } catch {
    return href;
  }
}

function setPricingSubTab(
  tab: PricingSubTab,
  client?: GatewayBrowserClient | null,
  options?: { basePath?: string; skipNavigate?: boolean },
): void {
  pricingSubTab = tab;
  const basePath = options?.basePath ?? lastPricingBasePath;
  if (!options?.skipNavigate && typeof window !== "undefined") {
    const currentRoute = resolvePricingRoute(window.location.pathname, basePath);
    const href = platformPricingHomeHref(basePath, { tab });
    if (currentRoute.view === "home") {
      const currentPath = normalizePricingHref(window.location.pathname + window.location.search);
      const nextPath = normalizePricingHref(href);
      if (currentPath !== nextPath) {
        navigatePricingHref(href);
      }
    } else if (
      currentRoute.view === "planDetail" ||
      currentRoute.view === "create" ||
      currentRoute.view === "tierDetail"
    ) {
      navigatePricingHref(href);
    }
  }
  if (client) {
    if (tab === "resourceCatalog") {
      reloadPlatformResourceCatalogSection(client, () => rerenderFn?.());
    } else if (tab === "economics") {
      reloadPlatformEconomicsSection(client, () => rerenderFn?.());
    } else if (tab === "commerce") {
      reloadPlatformCommerceWorkbench(client);
    } else if (tab === "packages" && (!loaded || lastClient !== client)) {
      void loadPlans(client);
    }
  }
  rerenderFn?.();
}

function primaryDraftOf(planId: string): PlanVersion | null {
  const drafts = (state.versionsByPlan[planId] ?? []).filter((entry) => entry.status === "draft");
  return drafts.toSorted((left, right) => right.version - left.version)[0] ?? null;
}

function editableVersionOf(planId: string): PlanVersion | null {
  const draft = primaryDraftOf(planId);
  if (draft) {
    return draft;
  }
  return (
    state.versionsByPlan[planId]?.find(
      (entry) => entry.id === state.plans.find((plan) => plan.id === planId)?.currentVersionId,
    ) ?? activeVersionOf(planId)
  );
}

function editableVersionMetaOf(planId: string): PlatformPlanBundleVersionRow | null {
  const version = editableVersionOf(planId);
  return version ? versionMetaOf(version.id) : null;
}

function handlePublishWorkflowStep(
  client: GatewayBrowserClient,
  basePath: string,
  plan: Plan,
  step: PublishStepId,
): void {
  if (step === "configure") {
    navigateToPlanDetail(basePath, client, plan.id, { mode: "edit", editTab: "models" });
    return;
  }
  if (step === "draft") {
    const panel = document.querySelector<HTMLButtonElement>('[data-testid="create-draft-btn"]');
    panel?.focus();
    panel?.scrollIntoView({ block: "nearest" });
    return;
  }
  if (step === "preview" || step === "activate") {
    const draft = primaryDraftOf(plan.id);
    if (draft) {
      void openActivateConfirm(client, plan.id, draft);
    }
    return;
  }
  if (step === "refresh") {
    const active = activeVersionOf(plan.id);
    if (active) {
      void loadAllocationPreview(client, active.id);
    }
  }
}

function openTierGovernanceDetail(
  basePath: string,
  client: GatewayBrowserClient,
  tierId: string,
  focus?: "modelPool",
): void {
  setPricingSubTab("resourceCatalog", client, { basePath, skipNavigate: true });
  navigatePricingHref(platformPricingTierHref(basePath, tierId, focus));
  rerenderFn?.();
}

function navigatePricingHref(href: string): void {
  pushAppHistoryState(href);
}

function retryPricingLoads(client: GatewayBrowserClient): void {
  loadPlansRetry?.cancel();
  loadPlansRetry = null;
  state.loading = false;
  loaded = false;
  loadedEpochKey = null;
  loadPlansInFlight = null;
  inflightEpochKey = null;
  void loadPlans(client, { force: true });
  reloadPlatformResourceCatalogSection(client, () => rerenderFn?.());
}

function renderGatewayReconnectHint(client: GatewayBrowserClient): TemplateResult | typeof nothing {
  if (!loadPlansRetry) {
    return nothing;
  }
  return html`
    <div
      class="platform-pricing__gateway-reconnect-hint"
      data-testid="pricing-gateway-reconnect-hint"
    >
      <p class="muted">${t("platformPricing.gatewayReconnectingHint")}</p>
      <button
        type="button"
        class="btn btn--sm"
        data-testid="pricing-gateway-retry"
        @click=${() => retryPricingLoads(client)}
      >
        ${t("platformPricing.retryLoad")}
      </button>
    </div>
  `;
}

function renderPackagesPrereqBanner(client: GatewayBrowserClient, basePath: string) {
  if (state.catalogTiers.length > 0 || state.loading) {
    return nothing;
  }
  return html`
    <div class="platform-pricing__prereq" data-testid="pricing-prereq-banner">
      <div>
        <div class="platform-pricing__prereq-title">${t("platformPricing.prereqTitle")}</div>
      </div>
      <button
        type="button"
        class="btn btn--sm"
        data-testid="pricing-prereq-action"
        @click=${() => setPricingSubTab("resourceCatalog", client, { basePath })}
      >
        ${t("platformPricing.prereqAction")}
      </button>
    </div>
  `;
}

function renderPricingSubTabs(
  active: PricingSubTab,
  client: GatewayBrowserClient,
  basePath: string,
) {
  const tabs: Array<{ id: PricingSubTab; label: string; hint: string }> = [
    {
      id: "packages",
      label: t("platformPricing.tabPackages"),
      hint: t("platformPricing.tabPackagesHint"),
    },
    {
      id: "economics",
      label: t("platformPricing.tabEconomics"),
      hint: t("platformPricing.tabEconomicsHint"),
    },
    {
      id: "commerce",
      label: t("platformPricing.tabCommerce"),
      hint: t("platformPricing.tabCommerceHint"),
    },
    {
      id: "resourceCatalog",
      label: t("platformPricing.tabResourceCatalog"),
      hint: t("platformPricing.tabResourceCatalogHint"),
    },
  ];
  return html`
    <header class="platform-pricing__tab-header" data-testid="pricing-sub-tabs">
      <nav
        class="platform-pricing__tab-segment"
        role="tablist"
        aria-label=${t("platformPricing.title")}
      >
        ${tabs.map(
          (tab) => html`
            <button
              type="button"
              class="platform-pricing__tab-segment-btn ${active === tab.id ? "is-active" : ""}"
              role="tab"
              aria-selected=${String(active === tab.id)}
              title=${tab.hint}
              data-testid="pricing-tab-${tab.id}"
              @click=${() => setPricingSubTab(tab.id, client, { basePath })}
            >
              ${tab.label}
            </button>
          `,
        )}
      </nav>
    </header>
  `;
}

function bundleGatewayOf(client: GatewayBrowserClient) {
  return createPlatformPlanBundleGateway(client);
}

function pricingCatalogGatewayOf(client: GatewayBrowserClient) {
  return createPlatformPricingCatalogGateway(client);
}

async function loadPricingCatalog(client: GatewayBrowserClient): Promise<void> {
  if (state.pricingCatalog) {
    return;
  }
  state.pricingCatalogLoading = true;
  state.pricingCatalogError = null;
  rerenderFn?.();
  try {
    state.pricingCatalog = await pricingCatalogGatewayOf(client).catalog();
  } catch (err) {
    state.pricingCatalog = null;
    state.pricingCatalogError = err instanceof Error ? err.message : "加载套餐预览失败";
  } finally {
    state.pricingCatalogLoading = false;
    rerenderFn?.();
  }
}

function subscriptionsGatewayOf(client: GatewayBrowserClient) {
  return createPlatformSubscriptionsGateway(client);
}

async function loadCommercialSummary(client: GatewayBrowserClient): Promise<void> {
  try {
    state.commercialSummary = await subscriptionsGatewayOf(client).summary();
  } catch {
    state.commercialSummary = null;
  }
}

async function loadEconomicsOverview(client: GatewayBrowserClient): Promise<void> {
  try {
    state.economicsOverview = await createCostEconomicsGateway(client).economicsOverview();
  } catch {
    state.economicsOverview = null;
  }
}

async function loadBindingConsistency(client: GatewayBrowserClient): Promise<void> {
  state.bindingConsistencyLoading = true;
  rerenderFn?.();
  const localIssues = auditPlanBindingConsistency({
    plans: state.plans,
    versionMetaById: state.versionMetaById,
    catalog: state.bundleCatalog,
  });
  try {
    const res = await bundleGatewayOf(client).consistency();
    const rpcIssues = mapRpcConsistencyIssues(res.issues, state.plans);
    // RPC 为权威来源（含孤儿 binding）；空结果时回退 overview 投影。
    state.bindingConsistencyIssues = rpcIssues.length > 0 ? rpcIssues : localIssues;
  } catch {
    state.bindingConsistencyIssues = null;
  } finally {
    state.bindingConsistencyLoading = false;
    rerenderFn?.();
  }
}

async function loadAllocationPreview(
  client: GatewayBrowserClient,
  versionId: string,
): Promise<void> {
  try {
    const res = await bundleGatewayOf(client).previewAllocation(versionId);
    state.allocationPreviews[versionId] = {
      allowedTiers: res.preview.allowedTiers,
      entitledModelCount: res.preview.entitledModelCount,
      roleProfiles: res.preview.roleProfiles.map((p) => ({
        role: p.role,
        label: p.label,
        modelCount: p.modelCount,
        tierIds: p.tierIds,
      })),
    };
    rerenderFn?.();
  } catch (err) {
    state.error = err instanceof Error ? err.message : "分配预览加载失败";
    rerenderFn?.();
  }
}

async function loadPlans(
  client: GatewayBrowserClient,
  options?: { force?: boolean },
): Promise<void> {
  const epochKey = currentLoadPlansEpochKey(client);
  if (loadPlansInFlight && !options?.force) {
    return loadPlansInFlight;
  }
  if (!options?.force && loadedEpochKey === epochKey) {
    return;
  }
  let resolveInFlight: ((value?: void | PromiseLike<void>) => void) | undefined;
  const run = new Promise<void>((resolve) => {
    resolveInFlight = resolve;
  });
  loadPlansInFlight = run;
  inflightEpochKey = epochKey;
  void (async () => {
    if (options?.force) {
      state.pricingCatalog = null;
    }
    state.loading = true;
    state.error = null;
    rerenderFn?.();
    const ancillaryErrors: string[] = [];
    try {
      const res = await bundleGatewayOf(client).overview({
        debugSource: "platformPricing.loadPlans",
        debugModuleUrl: import.meta.url,
      });
      applyBundleOverview(res);

      const catalogTask = createResourceCatalogGateway(client)
        .overview()
        .then((catalogOverview) => {
          state.catalogTiers = catalogOverview.tiers.filter((t) => t.status === "active");
          state.catalogModels = catalogOverview.models;
          applyBundleOverview(res);
        })
        .catch((err) => {
          ancillaryErrors.push(err instanceof Error ? err.message : "加载资源目录失败");
        });

      const policyTask = createPolicyEngineGateway(client)
        .list()
        .then((policyRes) => {
          state.catalogPolicies = policyRes.policies.filter((p) => p.status === "active");
        })
        .catch((err) => {
          ancillaryErrors.push(err instanceof Error ? err.message : "加载路由策略失败");
        });

      await Promise.all([
        catalogTask,
        policyTask,
        loadCommercialSummary(client),
        loadEconomicsOverview(client),
        loadBindingConsistency(client),
        loadPricingCatalog(client),
      ]);

      if (ancillaryErrors.length > 0) {
        state.notice = state.plans.length > 0 ? t("platformPricing.partialLoadNotice") : null;
        if (state.plans.length === 0) {
          state.error = ancillaryErrors[0] ?? t("platformPricing.loadFailed");
        } else {
          state.error = null;
        }
      }
      state.loading = false;
      loaded = true;
      loadedEpochKey = epochKey;
      loadPlansRetry?.cancel();
      loadPlansRetry = null;
    } catch (err) {
      state.loading = false;
      if (isTransientGatewayError(err)) {
        loaded = false;
        loadedEpochKey = null;
        state.error = null;
        const retryAfterMs = (err as { details?: { retryAfterMs?: unknown } } | null | undefined)
          ?.details?.retryAfterMs;
        const normalizedRetryAfterMs =
          typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0
            ? retryAfterMs
            : null;
        if (normalizedRetryAfterMs !== null) {
          softRetryAtMs = Date.now() + normalizedRetryAfterMs;
          state.notice = `平台服务繁忙，约 ${Math.ceil(normalizedRetryAfterMs / 1000)} 秒后自动重试。`;
        }
        if (!loadPlansRetry) {
          loadPlansRetry = createGatewayLoadRetry(
            () => {
              if (lastClient === client && !loaded && !state.loading) {
                void loadPlans(client, { force: true });
              }
            },
            {
              onExhausted: () => {
                loadPlansRetry = null;
                softRetryAtMs = null;
                state.error = t("platformPricing.loadFailed");
                rerenderFn?.();
              },
            },
          );
        }
      } else {
        loaded = true;
        loadedEpochKey = epochKey;
        loadPlansRetry?.cancel();
        loadPlansRetry = null;
        softRetryAtMs = null;
        state.notice = null;
        state.error = err instanceof Error ? err.message : t("platformPricing.loadFailed");
      }
    } finally {
      rerenderFn?.();
      loadPlansInFlight = null;
      inflightEpochKey = null;
      if (resolveInFlight) {
        resolveInFlight();
        resolveInFlight = undefined;
      }
    }
  })();
  return run;
}

function cancelLoadPlansRetry(): void {
  loadPlansRetry?.cancel();
  loadPlansRetry = null;
  softRetryAtMs = null;
}

function cancelReconnectReloadTimer(): void {
  if (reconnectReloadTimer !== null && typeof window !== "undefined") {
    window.clearTimeout(reconnectReloadTimer);
  }
  reconnectReloadTimer = null;
}

/** Gateway hello/reconnect 成功后触发：刷新套餐与当前子 Tab 数据。 */
export function refreshPlatformPricingAfterGatewayConnect(
  client: GatewayBrowserClient | null,
): void {
  if (!client) {
    return;
  }
  if (softRetryAtMs !== null && Date.now() < softRetryAtMs) {
    return;
  }
  if (loadPlansInFlight || state.loading) {
    return;
  }
  if (lastGatewayReconnectClient === client && loaded) {
    return;
  }
  lastGatewayReconnectClient = client;
  cancelLoadPlansRetry();
  cancelReconnectReloadTimer();
  bumpLoadPlansEpoch();
  lastClient = client;
  if (typeof window !== "undefined") {
    reconnectReloadTimer = window.setTimeout(() => {
      reconnectReloadTimer = null;
      if (!loadPlansInFlight && !state.loading) {
        void loadPlans(client, { force: true });
      }
    }, 350);
  } else {
    void loadPlans(client, { force: true });
  }
  if (pricingSubTab === "economics") {
    reloadPlatformEconomicsSection(client, () => rerenderFn?.());
  } else if (pricingSubTab === "resourceCatalog") {
    reloadPlatformResourceCatalogSection(client, () => rerenderFn?.());
  } else if (pricingSubTab === "commerce") {
    reloadPlatformCommerceWorkbench(client);
  }
}

async function syncResourceCatalogInline(client: GatewayBrowserClient): Promise<void> {
  state.busy = true;
  state.error = null;
  state.notice = null;
  rerenderFn?.();
  try {
    await createResourceCatalogGateway(client).seedFromConfig();
    state.notice = t("platformPricing.syncResourceCatalogDone");
    bumpLoadPlansEpoch();
    await loadPlans(client, { force: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "同步失败";
    state.error = msg.includes("unknown method") ? t("platformPricing.gatewayStaleHint") : msg;
  } finally {
    state.busy = false;
    rerenderFn?.();
  }
}

async function loadVersions(client: GatewayBrowserClient, planId: string): Promise<void> {
  void planId;
  if (state.versionsLoading) {
    return;
  }
  state.versionsLoading = true;
  rerenderFn?.();
  try {
    const res = await bundleGatewayOf(client).overview({
      debugSource: "platformPricing.loadVersions",
      debugModuleUrl: import.meta.url,
    });
    applyBundleOverview(res);
  } catch (err) {
    state.error = err instanceof Error ? err.message : "加载版本失败";
  }
  state.versionsLoading = false;
  rerenderFn?.();
}

function ensureLoaded(client: GatewayBrowserClient | null, rerender: () => void): void {
  rerenderFn = rerender;
  if (!client || !client.connected) {
    lastClient = client;
    loadedEpochKey = null;
    inflightEpochKey = null;
    loadPlansInFlight = null;
    state.loading = false;
    if (!client) {
      loaded = false;
      cancelLoadPlansRetry();
    }
    return;
  }
  if (loadPlansInFlight || inflightEpochKey === currentLoadPlansEpochKey(client)) {
    return;
  }
  const clientChanged = lastClient !== client;
  const pendingTransientRetry =
    !loaded &&
    !state.loading &&
    (loadPlansRetry !== null || isTransientGatewayErrorMessage(state.error));
  if (pendingTransientRetry) {
    return;
  }
  if ((loadedEpochKey === currentLoadPlansEpochKey(client) && !clientChanged) || state.loading) {
    return;
  }
  lastClient = client;
  void loadPlans(client);
}

function applyBundleOverview(overview: PlatformPlanBundleOverviewResponse): void {
  const catalogModelIds = state.catalogModels.map((model) => model.modelId);
  state.bundleCatalog = uniqueSorted([...overview.catalog, ...catalogModelIds]);
  state.plans = overview.plans.map((row) => row.plan);
  if (overview.pricingCatalog) {
    state.pricingCatalog = overview.pricingCatalog;
    state.pricingCatalogLoading = false;
    state.pricingCatalogError = null;
  }
  state.versionsByPlan = Object.fromEntries(
    overview.plans.map((row) => [
      row.plan.id,
      row.versions.map(
        (version): PlanVersion => ({
          id: version.versionId,
          planId: row.plan.id,
          version: version.version,
          status: version.status,
          snapshot: version.snapshot,
          createdAt: "",
          createdByUserId: "",
        }),
      ),
    ]),
  );
  state.versionMetaById = Object.fromEntries(
    overview.plans.flatMap((row) => row.versions.map((version) => [version.versionId, version])),
  );
}

async function syncResolvedTierModels(
  client: GatewayBrowserClient,
  tierIds: readonly string[],
): Promise<void> {
  const nextTierIds = uniqueSorted(tierIds);
  if (nextTierIds.length === 0) {
    state.resolvedTierModelIds = [];
    rerenderFn?.();
    return;
  }
  try {
    const res = await createResourceCatalogGateway(client).resolveTiers({ tierIds: nextTierIds });
    state.resolvedTierModelIds = uniqueSorted(res.pool.modelIds);
  } catch {
    state.resolvedTierModelIds = [];
  }
  rerenderFn?.();
}

/**
 * 由已选 Tier 同步解析模型池（不发 RPC，使用已加载的 `state.catalogModels`）。
 * 用于无法异步等待的渲染/保存路径（例如内联草稿编辑器）。与后端 resolveTiers 同义：
 * 仅取 enabled 且属于所选 Tier 的模型。
 */
function resolveModelIdsFromTiersSync(tierIds: readonly string[]): string[] {
  const tierSet = new Set(uniqueSorted(tierIds));
  if (tierSet.size === 0) {
    return [];
  }
  return uniqueSorted(
    state.catalogModels
      .filter((model) => model.enabled && tierSet.has(model.tier))
      .map((model) => model.modelId),
  );
}

function yuanToCents(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function centsToYuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

function fmtMoney(cents: number | null): string {
  if (cents === null) {
    return "—";
  }
  return `¥${(cents / 100).toFixed(2)}`;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))].toSorted();
}

/** 解析容量类输入（并发/工作流/知识库）：空 -> undefined；非法/负数 -> 0；否则取整。 */
function parseMaxConcurrentRuns(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function computeModelBindingDiff(
  fromMeta: PlatformPlanBundleVersionRow | null,
  toMeta: PlatformPlanBundleVersionRow | null,
): ModelBindingDiff | null {
  if (!fromMeta?.binding && !toMeta?.binding) {
    return null;
  }
  const fromModels = uniqueSorted(fromMeta?.binding?.allowedModelIds ?? []);
  const toModels = uniqueSorted(toMeta?.binding?.allowedModelIds ?? []);
  const toSet = new Set(toModels);
  const fromSet = new Set(fromModels);
  const addedModelIds = toModels.filter((id) => !fromSet.has(id));
  const removedModelIds = fromModels.filter((id) => !toSet.has(id));

  const fromQuota = fromMeta?.binding?.modelQuota ?? {};
  const toQuota = toMeta?.binding?.modelQuota ?? {};
  const quotaKeys = uniqueSorted([...Object.keys(fromQuota), ...Object.keys(toQuota)]);
  const sameQuotaEntry = (
    a: { maxRequests?: number; maxTokens?: number } | undefined,
    b: { maxRequests?: number; maxTokens?: number } | undefined,
  ): boolean =>
    (a?.maxRequests ?? null) === (b?.maxRequests ?? null) &&
    (a?.maxTokens ?? null) === (b?.maxTokens ?? null);
  const quotaChangedModelIds = quotaKeys.filter(
    (key) => !sameQuotaEntry(fromQuota[key], toQuota[key]),
  );

  const fromAor = fromMeta?.binding?.aorExecution;
  const toAor = toMeta?.binding?.aorExecution;
  const aorChanged =
    (fromAor?.taskTypeId ?? null) !== (toAor?.taskTypeId ?? null) ||
    (fromAor?.selectorStrategy ?? null) !== (toAor?.selectorStrategy ?? null) ||
    (fromAor?.evaluatorMode ?? null) !== (toAor?.evaluatorMode ?? null);

  return { addedModelIds, removedModelIds, quotaChangedModelIds, aorChanged };
}

function renderSegmentedMultiSelect(params: {
  items: Array<{ id: string; label: string }>;
  selectedIds: readonly string[];
  groupTestId: string;
  itemTestId: string;
  kind: "tier" | "policy";
  onToggle: (id: string, nextActive: boolean) => void;
}): TemplateResult {
  return html`
    <div class="platform-pricing__segmented" data-testid=${params.groupTestId} role="group">
      ${params.items.map((item) => {
        const active = params.selectedIds.includes(item.id);
        return html`
          <button
            type="button"
            class="platform-pricing__segment ${active ? "is-active" : ""}"
            data-testid=${params.itemTestId}
            data-tier-id=${params.kind === "tier" ? item.id : nothing}
            data-policy-id=${params.kind === "policy" ? item.id : nothing}
            ?disabled=${state.busy}
            aria-pressed=${active ? "true" : "false"}
            @click=${() => params.onToggle(item.id, !active)}
          >
            ${item.label}
          </button>
        `;
      })}
    </div>
  `;
}

function renderSegmentedBooleanSelect(params: {
  items: Array<{ id: string; label: string; active: boolean }>;
  groupTestId: string;
  itemTestId: string;
  kind: string;
  onToggle: (id: string, nextActive: boolean) => void;
}): TemplateResult {
  return html`
    <div
      class="platform-pricing__segmented-multiselect platform-pricing__segmented-multiselect--compact"
      data-testid=${params.groupTestId}
    >
      ${params.items.map((item) => {
        const inputId = `${params.groupTestId}-${item.id}`;
        return html`
          <label
            class="platform-pricing__segmented-chip ${item.active ? "is-active" : ""}"
            for=${inputId}
          >
            <input
              id=${inputId}
              type="checkbox"
              class="platform-pricing__segmented-input"
              data-testid=${params.itemTestId}
              data-governance-id=${item.id}
              .checked=${item.active}
              ?disabled=${state.busy}
              @change=${(event: Event) =>
                params.onToggle(item.id, (event.target as HTMLInputElement).checked)}
            />
            <span class="platform-pricing__segmented-chip-label">${item.label}</span>
          </label>
        `;
      })}
    </div>
  `;
}

function marketingPresentationPayload() {
  return {
    slogan: state.formSlogan.trim() || undefined,
    targetAudience: state.formTargetAudience.trim() || undefined,
    marketingFeatures: marketingFeaturesFromForm(state.formMarketingFeatures),
  };
}

function inlineTextareaField(
  label: string,
  value: string,
  onInput: (v: string) => void,
  options?: { hint?: string; placeholder?: string; testId?: string; rows?: number },
): TemplateResult {
  return html`
    <label class="platform-pricing__field-inline">
      <span class="platform-pricing__field-label">${label}</span>
      <div class="platform-pricing__field-control">
        <textarea
          class="platform-pricing__input platform-pricing__textarea"
          rows=${options?.rows ?? 4}
          data-testid=${options?.testId ?? nothing}
          placeholder=${options?.placeholder ?? nothing}
          .value=${value}
          ?disabled=${state.busy}
          @input=${(e: Event) => onInput((e.target as HTMLTextAreaElement).value)}
        ></textarea>
        ${options?.hint ? html`<span class="platform-pricing__form-hint">${options.hint}</span>` : nothing}
      </div>
    </label>
  `;
}

function renderMarketingPresentationSection(
  testIdPrefix: PlanBundleFormPrefix = "create",
): TemplateResult {
  return html`
    <section class="platform-pricing__editor-section" data-testid="${testIdPrefix}-form-marketing">
      <h3 class="platform-pricing__section-heading">${t("platformPricing.sectionMarketing")}</h3>
      <div class="platform-pricing__field-row-stack">
        ${inlineField(
          t("platformPricing.planSlogan"),
          state.formSlogan,
          (v) => {
            state.formSlogan = v;
            rerenderFn?.();
          },
          {
            testId: `${testIdPrefix}-plan-slogan`,
            placeholder: t("platformPricing.planSloganPlaceholder"),
          },
        )}
        ${inlineField(
          t("platformPricing.planTargetAudience"),
          state.formTargetAudience,
          (v) => {
            state.formTargetAudience = v;
            rerenderFn?.();
          },
          {
            testId: `${testIdPrefix}-plan-audience`,
            placeholder: t("platformPricing.planTargetAudiencePlaceholder"),
          },
        )}
        ${inlineTextareaField(
          t("platformPricing.planMarketingFeatures"),
          state.formMarketingFeatures,
          (v) => {
            state.formMarketingFeatures = v;
            rerenderFn?.();
          },
          {
            testId: `${testIdPrefix}-plan-marketing-features`,
            placeholder: t("platformPricing.planMarketingFeaturesPlaceholder"),
            hint: t("platformPricing.planMarketingFeaturesHint"),
            rows: 5,
          },
        )}
      </div>
    </section>
  `;
}

function inlineField(
  label: string,
  value: string,
  onInput: (v: string) => void,
  options?: {
    type?: string;
    hint?: string;
    placeholder?: string;
    testId?: string;
    dataModelId?: string;
  },
): TemplateResult {
  const type = options?.type ?? "text";
  return html`
    <label class="platform-pricing__field-inline">
      <span class="platform-pricing__field-label">${label}</span>
      <div class="platform-pricing__field-control">
        <input
          type=${type}
          class="platform-pricing__input"
          data-testid=${options?.testId ?? nothing}
          data-model-id=${options?.dataModelId ?? nothing}
          placeholder=${options?.placeholder ?? nothing}
          .value=${value}
          ?disabled=${state.busy}
          @input=${(e: Event) => onInput((e.target as HTMLInputElement).value)}
        />
        ${options?.hint ? html`<span class="platform-pricing__form-hint">${options.hint}</span>` : nothing}
      </div>
    </label>
  `;
}

function inlineSelectField(
  label: string,
  value: string,
  selectOptions: Array<{ value: string; label: string }>,
  onChange: (v: string) => void,
  options?: { testId?: string; placeholder?: string },
): TemplateResult {
  return html`
    <label class="platform-pricing__field-inline">
      <span class="platform-pricing__field-label">${label}</span>
      <div class="platform-pricing__field-control">
        <select
          class="platform-pricing__input"
          data-testid=${options?.testId ?? nothing}
          .value=${value}
          ?disabled=${state.busy}
          @change=${(e: Event) => onChange((e.target as HTMLSelectElement).value)}
        >
          ${options?.placeholder ? html`<option value="">${options.placeholder}</option>` : nothing}
          ${selectOptions.map((opt) => html`<option value=${opt.value}>${opt.label}</option>`)}
        </select>
      </div>
    </label>
  `;
}

function policySelectorStrategy(policyId: string | null): string {
  if (!policyId) {
    return "balanced";
  }
  const policy = state.catalogPolicies.find((entry) => entry.id === policyId);
  return policy?.selectorStrategy ?? "balanced";
}

const AOR_SELECTOR_OPTIONS = [
  { value: "cheapest", label: "cheapest" },
  { value: "best_quality", label: "best_quality" },
  { value: "balanced", label: "balanced" },
  { value: "bandit", label: "bandit" },
] as const;

function aorEvaluatorSelectOptions(): Array<{ value: string; label: string }> {
  return [
    { value: "content", label: t("platformPricing.aorEvaluatorContent") },
    { value: "workspace", label: t("platformPricing.aorEvaluatorWorkspace") },
  ];
}

function applyAorPatch(
  aor: DraftAorEditor,
  onPatch: (patch: Partial<DraftAorEditor>) => void,
  patch: Partial<DraftAorEditor>,
): void {
  let resolved = { ...patch };
  const nextTaskTypeId = (resolved.taskTypeId ?? aor.taskTypeId).trim();
  if (resolved.taskTypeId !== undefined && nextTaskTypeId) {
    if (!aor.evaluatorMode.trim() || resolved.taskTypeId !== aor.taskTypeId) {
      resolved = {
        ...resolved,
        evaluatorMode: resolveAorTaskTypeDefaultEvaluator(nextTaskTypeId),
      };
    }
  }
  if (resolved.enabled === true && !(resolved.evaluatorMode ?? aor.evaluatorMode).trim()) {
    resolved = {
      ...resolved,
      evaluatorMode: nextTaskTypeId
        ? resolveAorTaskTypeDefaultEvaluator(nextTaskTypeId)
        : "content",
    };
  }
  onPatch(resolved);
}

function renderAorEnableCheckbox(
  aor: DraftAorEditor,
  testIdPrefix: PlanBundleFormPrefix | "draft",
  onPatch: (patch: Partial<DraftAorEditor>) => void,
): TemplateResult {
  return html`
    <label
      class="platform-pricing__checkbox-row platform-pricing__checkbox-row--inline platform-pricing__aor-enable"
      @click=${(event: Event) => event.stopPropagation()}
    >
      <input
        type="checkbox"
        data-testid="${testIdPrefix}-aor-enabled"
        .checked=${aor.enabled}
        ?disabled=${state.busy}
        @change=${(e: Event) =>
          applyAorPatch(aor, onPatch, { enabled: (e.target as HTMLInputElement).checked })}
      />
      <span>${t("platformPricing.aorEnabledLabel")}</span>
    </label>
  `;
}

function renderAorFields(
  aor: DraftAorEditor,
  testIdPrefix: PlanBundleFormPrefix | "draft",
  onPatch: (patch: Partial<DraftAorEditor>) => void,
): TemplateResult {
  const taskTypeOptions = buildAorTaskTypeSelectOptions(i18n.getLocale(), aor.taskTypeId);
  return html`
    <div class="platform-pricing__field-row-stack" data-testid="${testIdPrefix}-aor-editor">
      ${
        aor.enabled
          ? html`
              ${inlineSelectField(
                t("platformPricing.aorTaskType"),
                aor.taskTypeId,
                taskTypeOptions,
                (v) => applyAorPatch(aor, onPatch, { taskTypeId: v }),
                {
                  testId: `${testIdPrefix}-aor-task-type`,
                  placeholder: t("platformPricing.aorTaskTypePlaceholder"),
                },
              )}
              ${inlineSelectField(
                t("platformPricing.aorSelector"),
                aor.selectorStrategy,
                [...AOR_SELECTOR_OPTIONS],
                (v) => onPatch({ selectorStrategy: v as DraftAorEditor["selectorStrategy"] }),
                { testId: `${testIdPrefix}-aor-selector` },
              )}
              ${inlineSelectField(
                t("platformPricing.aorEvaluator"),
                aor.evaluatorMode,
                aorEvaluatorSelectOptions(),
                (v) => onPatch({ evaluatorMode: v }),
                { testId: `${testIdPrefix}-aor-evaluator` },
              )}
            `
          : nothing
      }
    </div>
  `;
}

function defaultFormMeters(): DraftMeterRow[] {
  return [
    {
      key: "ai_token",
      unit: "token",
      includedQuota: "",
      includedMode: "usage_priced",
      overageMode: "block",
    },
  ];
}

function patchFormMeter(idx: number, patch: Partial<DraftMeterRow>): void {
  const row = state.formMeters[idx];
  if (!row) {
    return;
  }
  state.formMeters[idx] = { ...row, ...patch };
  rerenderFn?.();
}

function renderFormMetersEditor(testIdPrefix: PlanBundleFormPrefix): TemplateResult {
  return html`
    <div class="platform-pricing__field-row-stack" data-testid="${testIdPrefix}-form-meters">
      <div class="card-sub">计量合同（MeterDefinition）</div>
      <p class="muted platform-pricing__form-hint">
        区分：套餐内免费 / 套餐内按量收费 · 禁止超额 / 允许付费超额。提交完整 key / unit /
        includedQuota / chargeIncludedAtUsagePrice / allowOverage。
      </p>
      ${state.formMeters.map(
        (m, idx) => html`
          <div
            class="row row--tight row--wrap card-lead"
            data-testid="${testIdPrefix}-meter-row"
            data-meter-key=${m.key}
          >
            <label class="muted">
              key
              <input
                type="text"
                .value=${m.key}
                data-testid="${testIdPrefix}-meter-key"
                @input=${(e: Event) =>
                  patchFormMeter(idx, { key: (e.target as HTMLInputElement).value })}
              />
            </label>
            <label class="muted">
              unit
              <select
                data-testid="${testIdPrefix}-meter-unit"
                @change=${(e: Event) =>
                  patchFormMeter(idx, {
                    unit: (e.target as HTMLSelectElement).value as DraftMeterRow["unit"],
                  })}
              >
                ${(["credit", "token", "cent", "count"] as const).map(
                  (u) => html` <option value=${u} ?selected=${m.unit === u}>${u}</option> `,
                )}
              </select>
            </label>
            <label class="muted">
              配额
              <input
                type="number"
                min="0"
                step="1"
                .value=${m.includedQuota}
                data-testid="${testIdPrefix}-meter-quota"
                @input=${(e: Event) =>
                  patchFormMeter(idx, { includedQuota: (e.target as HTMLInputElement).value })}
              />
            </label>
            <select
              data-testid="${testIdPrefix}-meter-included-mode"
              @change=${(e: Event) =>
                patchFormMeter(idx, {
                  includedMode: (e.target as HTMLSelectElement)
                    .value as DraftMeterRow["includedMode"],
                })}
            >
              <option value="free" ?selected=${m.includedMode === "free"}>套餐内免费</option>
              <option value="usage_priced" ?selected=${m.includedMode === "usage_priced"}>
                套餐内按量收费
              </option>
            </select>
            <select
              data-testid="${testIdPrefix}-meter-overage-mode"
              @change=${(e: Event) =>
                patchFormMeter(idx, {
                  overageMode: (e.target as HTMLSelectElement)
                    .value as DraftMeterRow["overageMode"],
                })}
            >
              <option value="block" ?selected=${m.overageMode === "block"}>禁止超额</option>
              <option value="paid" ?selected=${m.overageMode === "paid"}>允许付费超额</option>
            </select>
            <span class="muted" data-testid="${testIdPrefix}-meter-semantics">
              ${meterSemanticsLabel(m)}
            </span>
            <button
              type="button"
              class="btn btn--sm"
              data-testid="${testIdPrefix}-meter-remove"
              @click=${() => {
                state.formMeters = state.formMeters.filter((_, i) => i !== idx);
                rerenderFn?.();
              }}
            >
              删除
            </button>
          </div>
        `,
      )}
      <button
        type="button"
        class="btn btn--sm"
        data-testid="${testIdPrefix}-meter-add"
        @click=${() => {
          state.formMeters = [
            ...state.formMeters,
            {
              key: "",
              unit: "count",
              includedQuota: "",
              includedMode: "free",
              overageMode: "block",
            },
          ];
          rerenderFn?.();
        }}
      >
        添加计量
      </button>
    </div>
  `;
}

function renderBasicInfoSection(testIdPrefix: PlanBundleFormPrefix = "create"): TemplateResult {
  return html`
    <section class="platform-pricing__editor-section" data-testid="${testIdPrefix}-form-basic-seat">
      <h3 class="platform-pricing__section-heading">${t("platformPricing.sectionBasic")}</h3>
      <div class="platform-pricing__field-row-stack">
        ${inlineField(
          t("platformPricing.planName"),
          state.formName,
          (v) => {
            state.formName = v;
            rerenderFn?.();
          },
          { testId: `${testIdPrefix}-plan-name` },
        )}
        ${inlineField(
          t("platformPricing.basePriceMonthly"),
          state.formBasePriceYuan,
          (v) => {
            state.formBasePriceYuan = v;
          },
          { type: "number", testId: `${testIdPrefix}-base-price` },
        )}
        ${inlineField(
          t("platformPricing.botQuota"),
          state.formBotQuota,
          (v) => {
            state.formBotQuota = v;
          },
          { type: "number", testId: `${testIdPrefix}-bot-quota` },
        )}
        ${inlineField(
          t("platformPricing.viewerSeatPrice"),
          state.formViewerPriceYuan,
          (v) => {
            state.formViewerPriceYuan = v;
          },
          { type: "number", testId: `${testIdPrefix}-viewer-price` },
        )}
        ${inlineField(
          t("platformPricing.creatorSeatPrice"),
          state.formCreatorPriceYuan,
          (v) => {
            state.formCreatorPriceYuan = v;
          },
          { type: "number", testId: `${testIdPrefix}-creator-price` },
        )}
      </div>
      ${renderFormMetersEditor(testIdPrefix)}
    </section>
  `;
}

function renderResolvedTierModelPreview(params: {
  modelIds: readonly string[];
  catalogModels: readonly ResourceModelCatalogEntry[];
  testIdPrefix: PlanBundleFormPrefix | "draft";
}): TemplateResult {
  if (params.modelIds.length === 0) {
    return html`
      <div
        class="platform-pricing__model-empty"
        data-testid="${params.testIdPrefix}-model-preview-empty"
      >
        <div class="muted">${t("platformPricing.sectionModelsResolvedEmpty")}</div>
      </div>
    `;
  }
  return html`
    <div class="platform-pricing__model-panel" data-testid="${params.testIdPrefix}-model-preview">
      <div class="platform-pricing__form-hint">
        ${t("platformPricing.modelPoolResolvedCount", { count: String(params.modelIds.length) })}
      </div>
      <ul class="platform-pricing__model-list">
        ${params.modelIds.map(
          (modelId) => html`
            <li
              class="platform-pricing__model-option platform-pricing__model-option--selected"
              data-testid="resolved-model-row"
              data-model-id=${modelId}
            >
              <div class="platform-pricing__model-meta">
                <div class="platform-pricing__model-name">
                  ${params.catalogModels.find((model) => model.modelId === modelId)?.displayName ?? modelId}
                </div>
                <div class="muted mono">${modelId}</div>
              </div>
            </li>
          `,
        )}
      </ul>
    </div>
  `;
}

/**
 * 高级模型控制：每模型 guardrail（modelQuota：请求/Token 上限）+ 模型级预算（modelBudgets：
 * Credits/花费上限）。Phase 1 从主流程降级到可折叠高级区；Phase 4 在同区加入模型级预算。
 * 两者口径独立，均不决定套餐 Credits 总额度。仅对当前自动解析出的模型池可编辑。
 */
function renderAdvancedModelControl(params: {
  modelIds: readonly string[];
  catalogModels: readonly ResourceModelCatalogEntry[];
  modelQuota: Record<string, ModelQuotaFormEntry>;
  onQuotaChange: (modelId: string, field: "maxRequests" | "maxTokens", value: string) => void;
  modelBudgets: Record<string, ModelBudgetFormEntry>;
  onBudgetChange: (
    modelId: string,
    field: "monthlyCreditsCap" | "spendCapCents",
    value: string,
  ) => void;
  testIdPrefix: PlanBundleFormPrefix | "draft";
}): TemplateResult {
  return html`
    <details
      class="platform-pricing__advanced-control"
      data-testid="${params.testIdPrefix}-advanced-model-control"
    >
      <summary class="platform-pricing__advanced-control-summary">
        ${t("platformPricing.sectionAdvancedModelControl")}
      </summary>
      <div class="platform-pricing__advanced-control-body">
        <div class="platform-pricing__form-hint">
          ${t("platformPricing.sectionAdvancedModelControlHint")}
        </div>
        ${
          params.modelIds.length === 0
            ? html`
                <div
                  class="muted"
                  data-testid="${params.testIdPrefix}-advanced-model-control-empty"
                >
                  ${t("platformPricing.advancedModelControlEmpty")}
                </div>
              `
            : html`
                <ul class="platform-pricing__model-list">
                  ${params.modelIds.map((modelId) => {
                    const entry = params.modelQuota[modelId];
                    const budget = params.modelBudgets[modelId];
                    return html`
                      <li
                        class="platform-pricing__model-option"
                        data-testid="advanced-model-quota-row"
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
                        <div class="platform-pricing__advanced-model-caps">
                          ${inlineField(
                            t("platformPricing.modelQuotaShort"),
                            entry?.maxRequests ?? "",
                            (value) => params.onQuotaChange(modelId, "maxRequests", value),
                            {
                              type: "number",
                              testId: `${params.testIdPrefix}-model-quota`,
                              dataModelId: modelId,
                            },
                          )}
                          ${inlineField(
                            t("platformPricing.modelTokenCapShort"),
                            entry?.maxTokens ?? "",
                            (value) => params.onQuotaChange(modelId, "maxTokens", value),
                            {
                              type: "number",
                              testId: `${params.testIdPrefix}-model-token-cap`,
                              dataModelId: modelId,
                            },
                          )}
                          ${inlineField(
                            t("platformPricing.modelBudgetCreditsCapShort"),
                            budget?.monthlyCreditsCap ?? "",
                            (value) => params.onBudgetChange(modelId, "monthlyCreditsCap", value),
                            {
                              type: "number",
                              testId: `${params.testIdPrefix}-model-budget-credits`,
                              dataModelId: modelId,
                            },
                          )}
                          ${inlineField(
                            t("platformPricing.modelBudgetSpendCapShort"),
                            budget?.spendCapCents ?? "",
                            (value) => params.onBudgetChange(modelId, "spendCapCents", value),
                            {
                              type: "number",
                              testId: `${params.testIdPrefix}-model-budget-spend`,
                              dataModelId: modelId,
                            },
                          )}
                        </div>
                      </li>
                    `;
                  })}
                </ul>
              `
        }
      </div>
    </details>
  `;
}

function draftResolvedModelIds(editor: DraftEditorState): string[] {
  return editor.entitlement.allowedTiers.length > 0
    ? resolveModelIdsFromTiersSync(editor.entitlement.allowedTiers)
    : uniqueSorted(editor.allowedModelIds);
}

/**
 * 内联草稿编辑器的模型区：与主套餐编辑页一致，Tier 自动解析模型池（只读预览），
 * modelQuota 下沉到高级控制。旧草稿若仅有 allowedModelIds（无 Tier）仍按其展示。
 */
function renderDraftModelSection(editor: DraftEditorState): TemplateResult {
  const modelIds = draftResolvedModelIds(editor);
  return html`
    <div class="platform-pricing__form-hint">${t("platformPricing.sectionModelsResolvedHint")}</div>
    ${renderResolvedTierModelPreview({
      modelIds,
      catalogModels: state.catalogModels,
      testIdPrefix: "draft",
    })}
    ${renderAdvancedModelControl({
      modelIds,
      catalogModels: state.catalogModels,
      testIdPrefix: "draft",
      modelQuota: editor.modelQuota,
      onQuotaChange: (modelId, field, value) => {
        const prev = editor.modelQuota[modelId] ?? { maxRequests: "", maxTokens: "" };
        editor.modelQuota = {
          ...editor.modelQuota,
          [modelId]: { ...prev, [field]: value },
        };
        rerenderFn?.();
      },
      modelBudgets: editor.modelBudgets,
      onBudgetChange: (modelId, field, value) => {
        const prev = editor.modelBudgets[modelId] ?? {
          monthlyCreditsCap: "",
          spendCapCents: "",
        };
        editor.modelBudgets = {
          ...editor.modelBudgets,
          [modelId]: { ...prev, [field]: value },
        };
        rerenderFn?.();
      },
    })}
  `;
}

function normalizeEntitlementPolicyEditor(editor: EntitlementEditor): void {
  if (editor.allowedPolicies.length === 0) {
    editor.allowedPolicies = [editor.policyId.trim() || "balanced"];
    return;
  }
  const policyId = editor.policyId.trim() || editor.allowedPolicies[0] || "balanced";
  if (!editor.allowedPolicies.includes(policyId)) {
    editor.allowedPolicies = uniqueSorted([...editor.allowedPolicies, policyId]);
  }
  editor.policyId = policyId;
}

function setAllowedPolicyChecked(
  editor: EntitlementEditor,
  policyId: string,
  checked: boolean,
): void {
  normalizeEntitlementPolicyEditor(editor);
  const next = new Set(editor.allowedPolicies);
  if (checked) {
    next.add(policyId);
    if (next.size === 1) {
      editor.policyId = policyId;
    }
  } else {
    next.delete(policyId);
    if (editor.policyId === policyId) {
      editor.allowedPolicies = uniqueSorted([...next]);
      editor.policyId = editor.allowedPolicies[0] ?? "balanced";
      return;
    }
  }
  editor.allowedPolicies = uniqueSorted([...next]);
  if (editor.allowedPolicies.length === 0) {
    const fallback =
      state.catalogPolicies.find((policy) => policy.id === "balanced")?.id ??
      state.catalogPolicies[0]?.id ??
      "balanced";
    editor.policyId = fallback;
    editor.allowedPolicies = [fallback];
  }
}

function renderEntitlementEditor(
  editor: EntitlementEditor,
  testIdPrefix: PlanBundleFormPrefix | "draft",
): TemplateResult {
  const activeTiers = state.catalogTiers.length > 0 ? state.catalogTiers : [];
  const activePolicies = state.catalogPolicies.length > 0 ? state.catalogPolicies : [];
  normalizeEntitlementPolicyEditor(editor);
  const selectableDefaultPolicies = activePolicies.filter((policy) =>
    editor.allowedPolicies.includes(policy.id),
  );
  return html`
    <div
      class="platform-pricing__entitlement-compact"
      data-testid="${testIdPrefix}-entitlement-editor"
    >
      ${inlineField(
        t("platformPricing.monthlyCredits"),
        editor.monthlyCredits,
        (v) => {
          editor.monthlyCredits = v;
        },
        {
          type: "number",
          placeholder: t("platformPricing.monthlyCreditsPlaceholder"),
          testId: `${testIdPrefix}-monthly-credits`,
        },
      )}
      <div class="platform-pricing__subsection-label">AI 授权（基础 / 专业 / 高级）</div>
      ${inlineField(
        "基础 AI 授权",
        editor.aiBasic,
        (v) => {
          editor.aiBasic = v;
        },
        {
          type: "number",
          placeholder: "数量",
          testId: `${testIdPrefix}-ai-basic`,
        },
      )}
      ${inlineField(
        "专业 AI 授权",
        editor.aiPro,
        (v) => {
          editor.aiPro = v;
        },
        {
          type: "number",
          placeholder: "数量",
          testId: `${testIdPrefix}-ai-pro`,
        },
      )}
      ${inlineField(
        "高级 AI 授权",
        editor.aiElite,
        (v) => {
          editor.aiElite = v;
        },
        {
          type: "number",
          placeholder: "数量",
          testId: `${testIdPrefix}-ai-elite`,
        },
      )}
      <div class="platform-pricing__subsection-label">
        ${t("platformPricing.workforceCapacitySection")}
      </div>
      ${inlineField(
        t("platformPricing.maxConcurrentRuns"),
        editor.maxConcurrentRuns,
        (v) => {
          editor.maxConcurrentRuns = v;
        },
        {
          type: "number",
          hint: t("platformPricing.maxConcurrentRunsPlaceholder"),
          testId: `${testIdPrefix}-max-concurrent-runs`,
        },
      )}
      ${inlineField(
        "工作流数量",
        editor.maxWorkflows,
        (v) => {
          editor.maxWorkflows = v;
        },
        {
          type: "number",
          placeholder: "0 = 不限",
          testId: `${testIdPrefix}-max-workflows`,
        },
      )}
      ${inlineField(
        "知识库数量",
        editor.maxKnowledgeBases,
        (v) => {
          editor.maxKnowledgeBases = v;
        },
        {
          type: "number",
          placeholder: "0 = 不限",
          testId: `${testIdPrefix}-max-knowledge-bases`,
        },
      )}
      <div class="platform-pricing__field-inline">
        <span class="platform-pricing__field-label">${t("platformPricing.overagePolicy")}</span>
        <div class="platform-pricing__field-control">
          <div class="platform-pricing__overage-control-row">
            <select
              class="platform-pricing__input"
              data-testid="${testIdPrefix}-overage-policy-type"
              .value=${editor.overagePolicyType}
              ?disabled=${state.busy}
              @change=${(e: Event) => {
                editor.overagePolicyType = (e.target as HTMLSelectElement)
                  .value as EntitlementEditor["overagePolicyType"];
                rerenderFn?.();
              }}
            >
              <option value="block">${t("platformPricing.overagePolicyBlock")}</option>
              <option value="credits_only">${t("platformPricing.overagePolicyCreditsOnly")}</option>
              <option value="pay_as_you_go">${t("platformPricing.overagePolicyPayAsYouGo")}</option>
            </select>
            <label
              class="platform-pricing__checkbox-row platform-pricing__checkbox-row--inline"
              title=${t("platformPricing.allowBurstConcurrency")}
            >
              <input
                type="checkbox"
                data-testid="${testIdPrefix}-allow-burst-concurrency"
                .checked=${editor.allowBurstConcurrency}
                ?disabled=${state.busy}
                @change=${(e: Event) => {
                  editor.allowBurstConcurrency = (e.target as HTMLInputElement).checked;
                  rerenderFn?.();
                }}
              />
              <span>${t("platformPricing.allowBurstConcurrency")}</span>
            </label>
          </div>
        </div>
      </div>
      <div class="platform-pricing__field-inline platform-pricing__field-inline--top">
        <span class="platform-pricing__field-label">治理能力</span>
        <div class="platform-pricing__field-control">
          ${renderSegmentedBooleanSelect({
            items: [
              { id: "audit-log", label: "审计日志", active: editor.auditLog },
              { id: "mfa", label: "MFA", active: editor.mfa },
              { id: "sso", label: "SSO", active: editor.sso },
              { id: "vpc", label: "VPC 隔离", active: editor.vpcIsolation },
              { id: "byom", label: "BYOM", active: editor.allowPrivateModels },
              { id: "custom-policy", label: "自定义策略", active: editor.allowCustomPolicy },
            ],
            groupTestId: `${testIdPrefix}-governance-editor`,
            itemTestId: `${testIdPrefix}-governance-checkbox`,
            kind: "governance",
            onToggle: (id, nextActive) => {
              if (id === "audit-log") {
                editor.auditLog = nextActive;
              } else if (id === "mfa") {
                editor.mfa = nextActive;
              } else if (id === "sso") {
                editor.sso = nextActive;
              } else if (id === "vpc") {
                editor.vpcIsolation = nextActive;
              } else if (id === "byom") {
                editor.allowPrivateModels = nextActive;
              } else if (id === "custom-policy") {
                editor.allowCustomPolicy = nextActive;
              }
              rerenderFn?.();
            },
          })}
        </div>
      </div>
      <div class="platform-pricing__field-inline platform-pricing__field-inline--top">
        <span class="platform-pricing__field-label">${t("platformPricing.allowedTiers")}</span>
        <div class="platform-pricing__field-control">
          ${
            activeTiers.length > 0
              ? renderSegmentedMultiSelect({
                  items: activeTiers.map((tier) => ({ id: tier.id, label: tier.name })),
                  selectedIds: editor.allowedTiers,
                  groupTestId: `${testIdPrefix}-tier-editor`,
                  itemTestId: `${testIdPrefix}-tier-checkbox`,
                  kind: "tier",
                  onToggle: (tierId, nextActive) => {
                    const next = new Set(editor.allowedTiers);
                    if (nextActive) {
                      next.add(tierId);
                    } else {
                      next.delete(tierId);
                    }
                    editor.allowedTiers = uniqueSorted([...next]);
                    if (lastClient) {
                      void syncResolvedTierModels(lastClient, editor.allowedTiers);
                    }
                    rerenderFn?.();
                  },
                })
              : html`
                  <div class="muted">${t("platformPricing.noTiersHint")}</div>
                  <button
                    class="btn"
                    type="button"
                    data-testid="pricing-sync-tiers-inline"
                    ?disabled=${state.busy || !lastClient}
                    @click=${() => lastClient && void syncResourceCatalogInline(lastClient)}
                  >
                    ${t("platformPricing.loadModelsFromGateway")}
                  </button>
                `
          }
        </div>
      </div>
      ${
        activePolicies.length > 0
          ? html`
              <div class="platform-pricing__field-inline platform-pricing__field-inline--top">
                <span class="platform-pricing__field-label"
                  >${t("platformPricing.routingPolicies")}</span
                >
                <div class="platform-pricing__field-control">
                  ${
                    selectableDefaultPolicies.length > 1
                      ? html`
                          <label class="platform-pricing__policy-default-inline">
                            <span>${t("platformPricing.defaultPolicyShort")}</span>
                            <select
                              class="platform-pricing__input"
                              data-testid="${testIdPrefix}-policy-select"
                              .value=${editor.policyId}
                              ?disabled=${state.busy}
                              @change=${(e: Event) => {
                                editor.policyId = (e.target as HTMLSelectElement).value;
                                normalizeEntitlementPolicyEditor(editor);
                                rerenderFn?.();
                              }}
                            >
                              ${selectableDefaultPolicies.map(
                                (policy) => html`
                                  <option value=${policy.id}>${policy.name}</option>
                                `,
                              )}
                            </select>
                          </label>
                        `
                      : nothing
                  }
                  ${renderSegmentedMultiSelect({
                    items: activePolicies.map((policy) => ({ id: policy.id, label: policy.name })),
                    selectedIds: editor.allowedPolicies,
                    groupTestId: `${testIdPrefix}-policy-editor`,
                    itemTestId: `${testIdPrefix}-policy-checkbox`,
                    kind: "policy",
                    onToggle: (policyId, nextActive) => {
                      setAllowedPolicyChecked(editor, policyId, nextActive);
                      rerenderFn?.();
                    },
                  })}
                </div>
              </div>
            `
          : html` <div class="muted">${t("platformPricing.noPoliciesHint")}</div> `
      }
    </div>
  `;
}

function statusLabel(status: PlanVersion["status"]): string {
  switch (status) {
    case "active":
      return t("platformPricing.statusActive");
    case "draft":
      return t("platformPricing.statusDraft");
    case "deprecated":
      return t("platformPricing.statusDeprecated");
    default:
      return status;
  }
}

// ── 套餐创建 ───────────────────────────────────────────────────────────────
function resetCreateFormState(): void {
  state.formName = "";
  state.formBasePriceYuan = "0";
  state.formBotQuota = "10";
  state.formViewerPriceYuan = "10";
  state.formCreatorPriceYuan = "30";
  state.formAiTokenPriceCents = "0.002";
  state.formMeters = defaultFormMeters();
  state.formAllowedModelIds = [];
  state.formModelQuota = {};
  state.formModelBudgets = {};
  state.resolvedTierModelIds = [];
  state.formModelSearch = "";
  state.formAor = {
    enabled: false,
    taskTypeId: "",
    selectorStrategy: "balanced",
    evaluatorMode: "",
  };
  state.formEntitlement = {
    monthlyCredits: "0",
    aiBasic: "",
    aiPro: "",
    aiElite: "",
    maxConcurrentRuns: "",
    maxWorkflows: "",
    maxKnowledgeBases: "",
    overagePolicyType: "block",
    allowBurstConcurrency: false,
    allowedTiers: [],
    allowedPolicies: [],
    policyId: "balanced",
    auditLog: false,
    mfa: false,
    sso: false,
    vpcIsolation: false,
    allowPrivateModels: false,
    allowCustomPolicy: false,
  };
  state.formSlogan = "";
  state.formTargetAudience = "";
  state.formMarketingFeatures = "";
  createWorkspaceMode = "edit";
}

function pricingYuanFromSnapshot(
  version: PlanVersion | null | undefined,
  type: DraftPricingRow["type"],
  key: string,
  fallback = "0",
): string {
  const row = version?.snapshot.pricing.find((entry) => entry.type === type && entry.key === key);
  return row ? centsToYuan(row.priceCents) : fallback;
}

function populateFormFromPlan(plan: Plan): void {
  const editable = editableVersionOf(plan.id);
  const editableMeta = editable ? versionMetaOf(editable.id) : null;
  const editableTiers = uniqueSorted(
    editableMeta?.binding?.allowedTiers ?? editableMeta?.entitlementSnapshot?.allowedTiers ?? [],
  );
  const resolvedModelIds =
    editableTiers.length > 0
      ? state.catalogModels
          .filter((model) => model.enabled && editableTiers.includes(model.tier))
          .map((model) => model.modelId)
      : (editableMeta?.binding?.allowedModelIds ?? []);

  state.formName = plan.name;
  state.formBasePriceYuan = centsToYuan(plan.basePriceCents);
  state.formBotQuota = String(plan.botQuota ?? 0);
  state.formViewerPriceYuan = pricingYuanFromSnapshot(editable, "seat", "viewer", "10");
  state.formCreatorPriceYuan = pricingYuanFromSnapshot(editable, "seat", "creator", "30");
  state.formAiTokenPriceCents = pricingYuanFromSnapshot(editable, "usage", "ai_token", "0.002");
  // 从冻结 snapshot.meters 回填可编辑 MeterDefinition
  {
    const meters = editable?.snapshot.meters ?? [];
    state.formMeters =
      meters.length > 0
        ? meters.map((m) => ({
            key: m.key,
            unit: m.unit,
            includedQuota: m.includedQuota !== undefined ? String(m.includedQuota) : "",
            includedMode: m.chargeIncludedAtUsagePrice
              ? ("usage_priced" as const)
              : ("free" as const),
            overageMode: m.allowOverage ? ("paid" as const) : ("block" as const),
          }))
        : defaultFormMeters();
  }
  state.formAllowedModelIds = uniqueSorted(resolvedModelIds);
  state.resolvedTierModelIds = uniqueSorted(resolvedModelIds);
  state.formModelQuota = buildDraftModelQuota(editableMeta);
  state.formModelBudgets = buildDraftModelBudgets(editableMeta);
  state.formModelSearch = "";
  state.formEntitlement = buildEntitlementEditorFromMeta(
    editableMeta,
    state.catalogPolicies[0]?.id ?? "balanced",
  );
  state.formAor = buildDraftAorEditor(editableMeta);
  state.formSlogan = plan.slogan ?? "";
  state.formTargetAudience = plan.targetAudience ?? "";
  state.formMarketingFeatures = marketingFeaturesToForm(plan.marketingFeatures);
  bundleFormPlanId = plan.id;
  editWorkspaceMode = "edit";
}

function ensurePlanBundleFormPopulated(plan: Plan): void {
  if (bundleFormPlanId === plan.id) {
    return;
  }
  populateFormFromPlan(plan);
}

function resetPlanBundleFormState(): void {
  bundleFormPlanId = null;
  editWorkspaceMode = "edit";
}

async function submitCreate(client: GatewayBrowserClient, basePath: string): Promise<void> {
  if (!state.formName.trim()) {
    state.error = "请填写套餐名称";
    rerenderFn?.();
    return;
  }
  if (
    state.formAor.enabled &&
    (!state.formAor.taskTypeId.trim() || !state.formAor.evaluatorMode.trim())
  ) {
    state.error = "启用 AOR 时需填写任务类型与 evaluator 模式";
    rerenderFn?.();
    return;
  }
  if (state.formEntitlement.allowedTiers.length === 0) {
    state.error = t("platformPricing.requireAtLeastOneTier");
    rerenderFn?.();
    return;
  }
  const resolvedAllowedModelIds = uniqueSorted(state.resolvedTierModelIds);
  state.busy = true;
  state.error = null;
  state.notice = null;
  rerenderFn?.();
  try {
    const entitlement = buildEntitlementPayloadForSave(state.formEntitlement);
    const createPricing = [
      { type: "seat" as const, key: "viewer", priceCents: yuanToCents(state.formViewerPriceYuan) },
      {
        type: "seat" as const,
        key: "creator",
        priceCents: yuanToCents(state.formCreatorPriceYuan),
      },
      {
        type: "usage" as const,
        key: "ai_token",
        priceCents: yuanToCents(state.formAiTokenPriceCents),
      },
    ];
    const createMeters = draftMetersToPayload(state.formMeters);
    await bundleGatewayOf(client).create({
      name: state.formName.trim(),
      billingCycle: "monthly",
      basePriceCents: yuanToCents(state.formBasePriceYuan),
      botQuota: Number.parseInt(state.formBotQuota, 10) || 0,
      seatQuota: {},
      pricing: createPricing,
      ...(createMeters.length > 0 ? { meters: createMeters } : {}),
      allowedModelIds: resolvedAllowedModelIds,
      ...entitlement,
      ...(buildModelQuotaForSave(resolvedAllowedModelIds, state.formModelQuota)
        ? { modelQuota: buildModelQuotaForSave(resolvedAllowedModelIds, state.formModelQuota)! }
        : {}),
      ...(buildModelBudgetsForSave(resolvedAllowedModelIds, state.formModelBudgets)
        ? {
            modelBudgets: buildModelBudgetsForSave(
              resolvedAllowedModelIds,
              state.formModelBudgets,
            )!,
          }
        : {}),
      ...(buildAorExecutionForSave(state.formAor)
        ? { aorExecution: buildAorExecutionForSave(state.formAor)! }
        : {}),
      ...marketingPresentationPayload(),
    });
    const createdName = state.formName.trim();
    state.notice = `套餐「${createdName}」已创建`;
    state.busy = false;
    resetCreateFormState();
    bumpLoadPlansEpoch();
    await loadPlans(client, { force: true });
    navigatePricingHref(platformPricingHref(basePath));
  } catch (err) {
    state.busy = false;
    state.error = err instanceof Error ? err.message : "创建套餐失败";
    rerenderFn?.();
  }
}

async function submitUpdate(
  client: GatewayBrowserClient,
  basePath: string,
  planId: string,
): Promise<void> {
  if (!state.formName.trim()) {
    state.error = "请填写套餐名称";
    rerenderFn?.();
    return;
  }
  if (
    state.formAor.enabled &&
    (!state.formAor.taskTypeId.trim() || !state.formAor.evaluatorMode.trim())
  ) {
    state.error = "启用 AOR 时需填写任务类型与 evaluator 模式";
    rerenderFn?.();
    return;
  }
  if (state.formEntitlement.allowedTiers.length === 0) {
    state.error = t("platformPricing.requireAtLeastOneTier");
    rerenderFn?.();
    return;
  }
  const resolvedAllowedModelIds = uniqueSorted(state.resolvedTierModelIds);
  state.busy = true;
  state.error = null;
  state.notice = null;
  rerenderFn?.();
  try {
    const entitlement = buildEntitlementPayloadForSave(state.formEntitlement);
    const updatePricing = [
      { type: "seat" as const, key: "viewer", priceCents: yuanToCents(state.formViewerPriceYuan) },
      {
        type: "seat" as const,
        key: "creator",
        priceCents: yuanToCents(state.formCreatorPriceYuan),
      },
      {
        type: "usage" as const,
        key: "ai_token",
        priceCents: yuanToCents(state.formAiTokenPriceCents),
      },
    ];
    const updateMeters = draftMetersToPayload(state.formMeters);
    const result = await bundleGatewayOf(client).update({
      planId,
      name: state.formName.trim(),
      basePriceCents: yuanToCents(state.formBasePriceYuan),
      botQuota: Number.parseInt(state.formBotQuota, 10) || 0,
      pricing: updatePricing,
      ...(updateMeters.length > 0 ? { meters: updateMeters } : {}),
      allowedModelIds: resolvedAllowedModelIds,
      ...entitlement,
      ...(buildModelQuotaForSave(resolvedAllowedModelIds, state.formModelQuota)
        ? { modelQuota: buildModelQuotaForSave(resolvedAllowedModelIds, state.formModelQuota)! }
        : {}),
      ...(buildModelBudgetsForSave(resolvedAllowedModelIds, state.formModelBudgets)
        ? {
            modelBudgets: buildModelBudgetsForSave(
              resolvedAllowedModelIds,
              state.formModelBudgets,
            )!,
          }
        : {}),
      ...(buildAorExecutionForSave(state.formAor)
        ? { aorExecution: buildAorExecutionForSave(state.formAor)! }
        : {}),
      ...marketingPresentationPayload(),
    });
    state.notice = t("platformPricing.draftCreated", {
      n: String(result.version.version),
    });
    state.busy = false;
    resetPlanBundleFormState();
    bumpLoadPlansEpoch();
    await Promise.all([loadPlans(client, { force: true }), loadVersions(client, planId)]);
    navigatePricingHref(platformPricingHref(basePath));
  } catch (err) {
    state.busy = false;
    state.error = err instanceof Error ? err.message : "保存套餐失败";
    rerenderFn?.();
  }
}

// ── 版本管理 ───────────────────────────────────────────────────────────────
function navigateToPlanDetail(
  basePath: string,
  client: GatewayBrowserClient,
  planId: string,
  route: Partial<PlanDetailRoute> | PlanEditTab | "overview" = { mode: "preview" },
): void {
  state.planDetailPlanId = planId;
  pricingSubTab = "packages";
  const resolved =
    typeof route === "string"
      ? route === "overview"
        ? { mode: "preview" as const, editTab: "models" as const }
        : { mode: "edit" as const, editTab: route }
      : route.mode === "edit"
        ? { mode: "edit" as const, editTab: route.editTab ?? ("models" as PlanEditTab) }
        : { mode: "preview" as const, editTab: route.editTab ?? ("models" as PlanEditTab) };
  navigatePricingHref(platformPricingPlanHref(basePath, planId, resolved));
  ensurePlanDetailLoaded(client, planId, resolved.mode, resolved.editTab);
  rerenderFn?.();
}

function ensurePlanDetailLoaded(
  client: GatewayBrowserClient,
  planId: string,
  mode: PlanWorkspaceMode,
  editTab: PlanEditTab,
): void {
  void mode;
  void editTab;
  if (!state.versionsByPlan[planId] && !state.versionsLoading) {
    void loadVersions(client, planId);
  }
}

/** 取某套餐当前 active 版本（用于 diff 基线）。 */
function activeVersionOf(planId: string): PlanVersion | null {
  return (state.versionsByPlan[planId] ?? []).find((v) => v.status === "active") ?? null;
}

function versionMetaOf(versionId: string): PlatformPlanBundleVersionRow | null {
  return state.versionMetaById[versionId] ?? null;
}

async function createDraft(client: GatewayBrowserClient, plan: Plan): Promise<void> {
  state.busy = true;
  state.error = null;
  state.notice = null;
  rerenderFn?.();
  try {
    const active = activeVersionOf(plan.id);
    const activeMeta = active ? versionMetaOf(active.id) : null;
    const pricing = (active?.snapshot.pricing ?? []).map((p) => ({
      type: p.type,
      key: p.key,
      priceCents: p.priceCents,
    }));
    // Phase 1: derive the new draft's model pool from the active version's tiers
    // (fallback to its legacy allowedModelIds when no tier is set).
    const activeTiers = uniqueSorted(
      activeMeta?.binding?.allowedTiers ?? activeMeta?.entitlementSnapshot?.allowedTiers ?? [],
    );
    const resolvedModelIds =
      activeTiers.length > 0
        ? resolveModelIdsFromTiersSync(activeTiers)
        : uniqueSorted(activeMeta?.binding?.allowedModelIds ?? []);
    const res = await requestCreateDraftVersion({
      gateway: bundleGatewayOf(client),
      planId: plan.id,
      pricing,
      versionMeta: activeMeta,
      resolvedModelIds,
      defaultPolicyId: state.catalogPolicies[0]?.id ?? "balanced",
    });
    state.notice = t("platformPricing.draftCreated");
    state.busy = false;
    await loadVersions(client, plan.id);
    openDraftEditor(plan.id, res.version);
  } catch (err) {
    state.busy = false;
    state.error = err instanceof Error ? err.message : "创建草稿失败";
    rerenderFn?.();
  }
}

function openDraftEditor(planId: string, version: PlanVersion): void {
  const meta = versionMetaOf(version.id);
  state.draftEditor = buildDraftEditorState({
    planId,
    version,
    versionMeta: meta,
    bundleCatalog: state.bundleCatalog,
    defaultPolicyId: state.catalogPolicies[0]?.id ?? "balanced",
    centsToYuan,
  });
  state.activateConfirm = null;
  rerenderFn?.();
}

async function saveDraft(client: GatewayBrowserClient): Promise<void> {
  const editor = state.draftEditor;
  if (!editor) {
    return;
  }
  state.busy = true;
  state.error = null;
  rerenderFn?.();
  try {
    if (editor.aor.enabled && (!editor.aor.taskTypeId.trim() || !editor.aor.evaluatorMode.trim())) {
      state.busy = false;
      state.error = "启用 AOR 时需填写任务类型与 evaluator 模式";
      rerenderFn?.();
      return;
    }
    // Phase 1：模型池由所选 Tier 自动派生（旧草稿无 Tier 时回退原 allowedModelIds），
    // 与后端保持 allowedModelIds 兼容；modelQuota 在 requestSaveDraftVersion 内按池过滤。
    const resolvedModelIds = draftResolvedModelIds(editor);
    editor.allowedModelIds = resolvedModelIds;
    // Tier 主配置校验：新草稿必须先选 Tier；旧草稿（无 Tier 但有历史 allowedModelIds）仍可保存。
    if (editor.entitlement.allowedTiers.length === 0 && resolvedModelIds.length === 0) {
      state.busy = false;
      state.error = t("platformPricing.requireAtLeastOneTier");
      rerenderFn?.();
      return;
    }
    await requestSaveDraftVersion({
      gateway: bundleGatewayOf(client),
      editor,
      resolvedModelIds,
      yuanToCents,
    });
    state.notice = t("platformPricing.draftCreated");
    state.draftEditor = null;
    state.busy = false;
    await loadVersions(client, editor.planId);
  } catch (err) {
    state.busy = false;
    state.error = err instanceof Error ? err.message : "保存草稿失败";
    rerenderFn?.();
  }
}

/** 打开激活确认，并向后端请求 diff（与当前 active 对比）。 */
async function openActivateConfirm(
  client: GatewayBrowserClient,
  planId: string,
  version: PlanVersion,
): Promise<void> {
  const active = activeVersionOf(planId);
  state.activateConfirm = buildActivateConfirmState({
    planId,
    version,
    activeVersion: active,
    catalogTiers: state.catalogTiers,
    catalogPolicies: state.catalogPolicies,
    getVersionMeta: (versionId) => versionMetaOf(versionId),
    computeModelBindingDiff,
    computeEntitlementDiff,
  });
  state.draftEditor = null;
  rerenderFn?.();
  if (!active) {
    // 无 active（理论上首版本已 active；此处保守处理）→ 无 diff 基线。
    if (state.activateConfirm) {
      state.activateConfirm.diffLoading = false;
    }
    rerenderFn?.();
    return;
  }
  try {
    const res = await bundleGatewayOf(client).diff({
      fromVersionId: active.id,
      toVersionId: version.id,
    });
    if (state.activateConfirm && state.activateConfirm.versionId === version.id) {
      state.activateConfirm.diff = res.diff;
      state.activateConfirm.diffLoading = false;
    }
  } catch (err) {
    state.error = err instanceof Error ? err.message : "计算差异失败";
    if (state.activateConfirm) {
      state.activateConfirm.diffLoading = false;
    }
  }
  rerenderFn?.();
}

async function confirmActivate(client: GatewayBrowserClient): Promise<void> {
  const confirm = state.activateConfirm;
  if (!confirm) {
    return;
  }
  state.busy = true;
  state.error = null;
  rerenderFn?.();
  try {
    await requestActivateVersion({
      gateway: bundleGatewayOf(client),
      planId: confirm.planId,
      versionId: confirm.versionId,
    });
    state.notice = t("platformPricing.versionActivated");
    state.activateConfirm = null;
    state.busy = false;
    bumpLoadPlansEpoch();
    await Promise.all([loadVersions(client, confirm.planId), loadPlans(client, { force: true })]);
  } catch (err) {
    state.busy = false;
    state.error = err instanceof Error ? err.message : "激活失败";
    rerenderFn?.();
  }
}

async function deprecateVersion(
  client: GatewayBrowserClient,
  planId: string,
  versionId: string,
): Promise<void> {
  state.busy = true;
  state.error = null;
  rerenderFn?.();
  try {
    await requestDeprecateVersion({
      gateway: bundleGatewayOf(client),
      planId,
      versionId,
    });
    state.notice = t("platformPricing.versionDeprecated");
    state.busy = false;
    bumpLoadPlansEpoch();
    await Promise.all([loadVersions(client, planId), loadPlans(client, { force: true })]);
  } catch (err) {
    state.busy = false;
    state.error = err instanceof Error ? err.message : "废弃失败";
    rerenderFn?.();
  }
}

// ── 渲染 ───────────────────────────────────────────────────────────────────

/** 编辑生效版本：以 active 版本定价为初值创建草稿，打开编辑器（修改后可二次激活发布）。 */
async function editActiveVersion(client: GatewayBrowserClient, planId: string): Promise<void> {
  const active = activeVersionOf(planId);
  if (!active) {
    state.error = "未找到生效版本";
    rerenderFn?.();
    return;
  }
  state.busy = true;
  state.error = null;
  rerenderFn?.();
  try {
    const pricing = active.snapshot.pricing.map((p) => ({
      type: p.type,
      key: p.key,
      priceCents: p.priceCents,
    }));
    const activeMeta = versionMetaOf(active.id);
    const activeTiers = uniqueSorted(
      activeMeta?.binding?.allowedTiers ?? activeMeta?.entitlementSnapshot?.allowedTiers ?? [],
    );
    const resolvedModelIds =
      activeTiers.length > 0
        ? resolveModelIdsFromTiersSync(activeTiers)
        : uniqueSorted(activeMeta?.binding?.allowedModelIds ?? []);
    const res = await requestCreateDraftVersion({
      gateway: bundleGatewayOf(client),
      planId,
      pricing,
      versionMeta: activeMeta,
      resolvedModelIds,
      defaultPolicyId: state.catalogPolicies[0]?.id ?? "balanced",
    });
    state.busy = false;
    await loadVersions(client, planId);
    openDraftEditor(planId, res.version);
  } catch (err) {
    state.busy = false;
    state.error = err instanceof Error ? err.message : "创建草稿失败";
    rerenderFn?.();
  }
}

function openDeleteConfirm(planId: string, version: PlanVersion): void {
  state.deleteConfirm = buildDeleteConfirmState(planId, version);
  state.draftEditor = null;
  state.activateConfirm = null;
  rerenderFn?.();
}

async function confirmDelete(client: GatewayBrowserClient): Promise<void> {
  const confirm = state.deleteConfirm;
  if (!confirm) {
    return;
  }
  state.busy = true;
  state.error = null;
  rerenderFn?.();
  try {
    await requestDeleteVersion({
      gateway: bundleGatewayOf(client),
      planId: confirm.planId,
      versionId: confirm.versionId,
    });
    state.notice = "版本已删除。";
    state.deleteConfirm = null;
    state.busy = false;
    bumpLoadPlansEpoch();
    await Promise.all([loadVersions(client, confirm.planId), loadPlans(client, { force: true })]);
  } catch (err) {
    state.busy = false;
    state.error = err instanceof Error ? err.message : "删除失败";
    rerenderFn?.();
  }
}

async function updatePlanMarketingTags(
  client: GatewayBrowserClient,
  planId: string,
  marketingTags: PlanMarketingTag[],
): Promise<void> {
  state.busy = true;
  state.error = null;
  state.notice = null;
  rerenderFn?.();
  try {
    const res = await requestSetMarketingTags({
      gateway: bundleGatewayOf(client),
      planId,
      marketingTags,
    });
    const index = state.plans.findIndex((entry) => entry.id === planId);
    if (index >= 0) {
      state.plans[index] = res.plan;
    }
    state.notice = t("platformPricing.marketingTagsSaved");
    state.busy = false;
    rerenderFn?.();
  } catch (err) {
    state.busy = false;
    state.error = err instanceof Error ? err.message : t("platformPricing.marketingTagsSaveFailed");
    rerenderFn?.();
  }
}

function togglePlanMarketingTag(
  client: GatewayBrowserClient,
  plan: Plan,
  tag: PlanMarketingTag,
  checked: boolean,
): void {
  const current = plan.marketingTags ?? [];
  const next = buildNextMarketingTags(current, tag, checked);
  void updatePlanMarketingTags(client, plan.id, next);
}

function renderPlanMarketingTags(client: GatewayBrowserClient, plan: Plan): TemplateResult {
  const tags = plan.marketingTags ?? [];
  return html`
    <div class="platform-pricing__marketing-tags" data-testid="plan-marketing-tags-${plan.id}">
      <span class="muted platform-pricing__marketing-tags-label"
        >${t("platformPricing.marketingTagsLabel")}</span
      >
      <label class="platform-pricing__marketing-tag">
        <input
          type="checkbox"
          data-testid="marketing-tag-default-${plan.id}"
          .checked=${tags.includes("default")}
          ?disabled=${state.busy}
          @change=${(event: Event) => {
            togglePlanMarketingTag(
              client,
              plan,
              "default",
              (event.target as HTMLInputElement).checked,
            );
          }}
        />
        ${t("platformPricing.marketingDefault")}
      </label>
      <label class="platform-pricing__marketing-tag">
        <input
          type="checkbox"
          data-testid="marketing-tag-recommended-${plan.id}"
          .checked=${tags.includes("recommended")}
          ?disabled=${state.busy}
          @change=${(event: Event) => {
            togglePlanMarketingTag(
              client,
              plan,
              "recommended",
              (event.target as HTMLInputElement).checked,
            );
          }}
        />
        ${t("platformPricing.marketingRecommended")}
      </label>
    </div>
  `;
}

async function savePlanMatchingProfile(
  client: GatewayBrowserClient,
  planId: string,
  form: HTMLFormElement,
): Promise<void> {
  const matchingProfile = buildMatchingProfileFromFormData(new FormData(form));
  state.busy = true;
  state.error = null;
  state.notice = null;
  rerenderFn?.();
  try {
    const res = await requestSetMatchingProfile({
      gateway: bundleGatewayOf(client),
      planId,
      matchingProfile,
    });
    const index = state.plans.findIndex((entry) => entry.id === planId);
    if (index >= 0) {
      state.plans[index] = res.plan;
    }
    state.notice = t("platformPricing.matchingProfileSaved");
    state.busy = false;
    rerenderFn?.();
  } catch (err) {
    state.busy = false;
    state.error =
      err instanceof Error ? err.message : t("platformPricing.matchingProfileSaveFailed");
    rerenderFn?.();
  }
}

function renderPlanMatchingProfile(client: GatewayBrowserClient, plan: Plan): TemplateResult {
  const profile = plan.matchingProfile ?? {};
  return html`
    <form
      class="platform-pricing__matching-profile"
      data-testid="plan-matching-profile-${plan.id}"
      @submit=${(event: Event) => {
        event.preventDefault();
        void savePlanMatchingProfile(client, plan.id, event.currentTarget as HTMLFormElement);
      }}
    >
      <h4 class="platform-pricing__matching-profile-title">
        ${t("platformPricing.matchingProfileLabel")}
      </h4>
      <label class="platform-pricing__field">
        <span>${t("platformPricing.matchingPersonasLabel")}</span>
        <input
          type="text"
          name="targetPersonas"
          data-testid="matching-personas-${plan.id}"
          .value=${(profile.targetPersonas ?? []).join(", ")}
          ?disabled=${state.busy}
        />
        <span class="enterprise-hint">${t("platformPricing.matchingPersonasHint")}</span>
      </label>
      <label class="platform-pricing__field">
        <span>${t("platformPricing.matchingPriorityLabel")}</span>
        <input
          type="number"
          name="matchingPriority"
          min="0"
          max="100"
          data-testid="matching-priority-${plan.id}"
          .value=${profile.matchingPriority != null ? String(profile.matchingPriority) : ""}
          ?disabled=${state.busy}
        />
      </label>
      <label class="platform-pricing__field">
        <span>${t("platformPricing.inPlanNotesLabel")}</span>
        <textarea
          name="inPlanFlexibilityNotes"
          rows="3"
          data-testid="matching-in-plan-notes-${plan.id}"
          .value=${profile.inPlanFlexibilityNotes ?? ""}
          ?disabled=${state.busy}
        ></textarea>
      </label>
      <label class="platform-pricing__field">
        <span>${t("platformPricing.beyondPlanNotesLabel")}</span>
        <textarea
          name="beyondPlanNotes"
          rows="3"
          data-testid="matching-beyond-notes-${plan.id}"
          .value=${profile.beyondPlanNotes ?? ""}
          ?disabled=${state.busy}
        ></textarea>
      </label>
      <button
        type="submit"
        class="btn btn--sm btn--primary"
        data-testid="matching-profile-save-${plan.id}"
        ?disabled=${state.busy}
      >
        ${t("platformPricing.matchingProfileSave")}
      </button>
    </form>
  `;
}

function renderActivateConfirm(client: GatewayBrowserClient): TemplateResult {
  const confirm = state.activateConfirm;
  if (!confirm) {
    return html``;
  }
  const active = activeVersionOf(confirm.planId);
  const lockedCount = active
    ? versionLockedSubscriptions(confirm.planId, active.id, state.commercialSummary)
    : 0;
  const plan = state.plans.find((entry) => entry.id === confirm.planId);
  const activeMeta = active
    ? versionCommercialMeta(active.id, state.versionMetaById, state.versionsByPlan)
    : null;
  const draftMeta = versionCommercialMeta(
    confirm.versionId,
    state.versionMetaById,
    state.versionsByPlan,
  );
  const marginDelta =
    plan !== undefined
      ? computeActivationMarginDelta({
          basePriceCents: plan.basePriceCents,
          activeMonthlyCredits: activeMeta?.monthlyCredits ?? null,
          draftMonthlyCredits: draftMeta.monthlyCredits,
          activeAllowedTiers: activeMeta?.tiers ?? [],
          draftAllowedTiers: draftMeta.tiers,
          activeSelectorStrategy: policySelectorStrategy(activeMeta?.policyId ?? null),
          draftSelectorStrategy: policySelectorStrategy(draftMeta.policyId),
          planActual: state.economicsOverview?.byPlan?.[confirm.planId],
          platformSummary: state.economicsOverview?.summary,
          economicsOverview: state.economicsOverview,
        })
      : null;

  return renderPlanActivateConfirmPanel({
    versionNumber: confirm.versionNumber,
    entitlementDiff: confirm.entitlementDiff,
    pricingDiff: confirm.diff,
    pricingDiffLoading: confirm.diffLoading,
    bindingDiff: confirm.bindingDiff,
    impact: {
      lockedCount,
      marginDeltaLabel: marginDelta !== null ? formatMarginRateDelta(marginDelta) : null,
    },
    busy: state.busy,
    fmtMoney,
    onConfirm: () => void confirmActivate(client),
    onCancel: () => {
      state.activateConfirm = null;
      rerenderFn?.();
    },
  });
}

function renderDeleteConfirm(client: GatewayBrowserClient): TemplateResult {
  const confirm = state.deleteConfirm;
  if (!confirm) {
    return html``;
  }
  return renderDeleteConfirmPanel({
    versionNumber: confirm.versionNumber,
    busy: state.busy,
    onConfirm: () => void confirmDelete(client),
    onCancel: () => {
      state.deleteConfirm = null;
      rerenderFn?.();
    },
  });
}

function renderDraftEditor(client: GatewayBrowserClient): TemplateResult {
  const editor = state.draftEditor;
  if (!editor) {
    return html``;
  }
  return renderDraftEditorPanel({
    rows: editor.rows,
    meters: editor.meters,
    busy: state.busy,
    title: t("platformPricing.editDraft"),
    modelsLabel: t("platformPricing.sectionModels"),
    aorLabel: t("platformPricing.sectionAor"),
    saveLabel: t("platformPricing.saveDraft"),
    cancelLabel: t("platformPricing.cancel"),
    onPriceInput: (idx, value) => {
      const row = editor.rows[idx];
      if (!row) {
        return;
      }
      editor.rows[idx] = {
        ...row,
        priceYuan: value,
      };
    },
    onMeterKeyInput: (idx, value) => {
      const row = editor.meters[idx];
      if (!row) {
        return;
      }
      editor.meters[idx] = { ...row, key: value };
    },
    onMeterUnitChange: (idx, value) => {
      const row = editor.meters[idx];
      if (!row) {
        return;
      }
      editor.meters[idx] = { ...row, unit: value };
      rerenderFn?.();
    },
    onMeterIncludedMode: (idx, value) => {
      const row = editor.meters[idx];
      if (!row) {
        return;
      }
      editor.meters[idx] = { ...row, includedMode: value };
      rerenderFn?.();
    },
    onMeterOverageMode: (idx, value) => {
      const row = editor.meters[idx];
      if (!row) {
        return;
      }
      editor.meters[idx] = { ...row, overageMode: value };
      rerenderFn?.();
    },
    onMeterQuotaInput: (idx, value) => {
      const row = editor.meters[idx];
      if (!row) {
        return;
      }
      editor.meters[idx] = { ...row, includedQuota: value };
    },
    onMeterAdd: () => {
      editor.meters = [
        ...editor.meters,
        {
          key: "",
          unit: "count",
          includedQuota: "",
          includedMode: "free",
          overageMode: "block",
        },
      ];
      rerenderFn?.();
    },
    onMeterRemove: (idx) => {
      editor.meters = editor.meters.filter((_, i) => i !== idx);
      rerenderFn?.();
    },
    modelLibraryContent: renderDraftModelSection(editor),
    aorEnableContent: renderAorEnableCheckbox(editor.aor, "draft", (patch) => {
      applyAorPatch(
        editor.aor,
        (resolved) => {
          editor.aor = { ...editor.aor, ...resolved };
          rerenderFn?.();
        },
        patch,
      );
    }),
    aorFieldsContent: renderAorFields(editor.aor, "draft", (patch) => {
      applyAorPatch(
        editor.aor,
        (resolved) => {
          editor.aor = { ...editor.aor, ...resolved };
          rerenderFn?.();
        },
        patch,
      );
    }),
    entitlementContent: renderEntitlementEditor(editor.entitlement, "draft"),
    onSave: () => void saveDraft(client),
    onCancel: () => {
      state.draftEditor = null;
      rerenderFn?.();
    },
  });
}

function renderEntitlementDiffPanel(rows: EntitlementDiffRow[]): TemplateResult {
  if (rows.length === 0) {
    return html`
      <div class="muted platform-pricing__diff-empty" data-testid="entitlement-diff">
        ${t("platformPricing.commercialNoEntitlementDiff")}
      </div>
    `;
  }
  return html`
    <div class="platform-pricing__entitlement-diff" data-testid="entitlement-diff">
      ${rows.map(
        (row) => html`
          <div class="platform-pricing__entitlement-diff-row">
            <span class="platform-pricing__entitlement-diff-label">${row.label}</span>
            <span class="platform-pricing__entitlement-diff-from">${row.from}</span>
            <span class="platform-pricing__entitlement-diff-arrow">→</span>
            <span class="platform-pricing__entitlement-diff-to">${row.to}</span>
          </div>
        `,
      )}
    </div>
  `;
}

function renderVersionCommercialSpecs(versionId: string): TemplateResult {
  const meta = versionCommercialMeta(versionId, state.versionMetaById, state.versionsByPlan);
  return html`
    <div class="platform-pricing__version-specs platform-pricing__version-specs--commercial">
      ${
        meta.monthlyCredits != null
          ? html`
              <div class="platform-pricing__version-spec">
                <span class="platform-pricing__version-spec-label">Credits</span>
                <span class="platform-pricing__version-spec-value">
                  ${meta.monthlyCredits === 0 ? t("platformPricing.enterpriseBudget") : `${meta.monthlyCredits}${t("platformPricing.perMonth")}`}
                </span>
              </div>
            `
          : nothing
      }
      ${
        meta.botQuota !== null
          ? html`
              <div class="platform-pricing__version-spec">
                <span class="platform-pricing__version-spec-label"
                  >${t("platformPricing.botsUnit")}</span
                >
                <span class="platform-pricing__version-spec-value">${meta.botQuota}</span>
              </div>
            `
          : nothing
      }
      ${
        meta.tiers.length > 0
          ? html`
              <div class="platform-pricing__version-spec platform-pricing__version-spec--wide">
                <span class="platform-pricing__version-spec-label"
                  >${t("platformPricing.commercialCapabilities")}</span
                >
                <span class="platform-pricing__version-spec-value"
                  >${tierCapabilityLabels(meta.tiers, state.catalogTiers).join(" · ")}</span
                >
              </div>
            `
          : nothing
      }
      ${
        meta.policyId
          ? html`
              <div class="platform-pricing__version-spec platform-pricing__version-spec--wide">
                <span class="platform-pricing__version-spec-label">Policy</span>
                <span class="platform-pricing__version-spec-value">
                  ${(() => {
                    const policy = policyDisplay(meta.policyId, state.catalogPolicies);
                    return policy.description
                      ? `${policy.name} · ${policy.description}`
                      : policy.name;
                  })()}
                </span>
              </div>
            `
          : nothing
      }
    </div>
  `;
}

function renderVersionBillingDetails(version: PlanVersion): TemplateResult | typeof nothing {
  if (version.snapshot.pricing.length === 0) {
    return nothing;
  }
  return html`
    <details class="platform-pricing__billing-details">
      <summary>${t("platformPricing.commercialBillingParams")}</summary>
      <div class="platform-pricing__version-specs">
        ${version.snapshot.pricing.map(
          (entry) => html`
            <div class="platform-pricing__version-spec">
              <span class="platform-pricing__version-spec-label"
                >${pricingSpecLabel(entry.type, entry.key)}</span
              >
              <span class="platform-pricing__version-spec-value"
                >${fmtMoney(entry.priceCents)}</span
              >
            </div>
          `,
        )}
      </div>
    </details>
  `;
}

function renderUnitEconomicsDrawerPanel(
  _client: GatewayBrowserClient,
): TemplateResult | typeof nothing {
  const planId = state.unitEconomicsDrawerPlanId;
  if (!planId) {
    return nothing;
  }
  const plan = state.plans.find((entry) => entry.id === planId);
  if (!plan) {
    return nothing;
  }
  const meta = planDisplayMeta(plan, state.versionMetaById);
  return renderUnitEconomicsDrawer({
    plan,
    monthlyCredits: meta.monthlyCredits,
    allowedTiers: meta.tiers,
    selectorStrategy: policySelectorStrategy(meta.policyId),
    economics: state.economicsOverview,
    commercial: state.commercialSummary,
    onClose: () => {
      state.unitEconomicsDrawerPlanId = null;
      rerenderFn?.();
    },
    onOpenEconomicsTab: () => {
      setEconomicsFocus(plan.id, plan.name);
      state.unitEconomicsDrawerPlanId = null;
      setPricingSubTab("economics", lastClient, { basePath: lastPricingBasePath });
      rerenderFn?.();
    },
  });
}

function pricingSpecLabel(type: string, key: string): string {
  if (type === "seat" && key === "viewer") {
    return "Viewer";
  }
  if (type === "seat" && key === "creator") {
    return "Creator";
  }
  if (type === "usage" && key === "ai_token") {
    return "AI Token";
  }
  return `${type}/${key}`;
}

function versionStatusBadgeClass(status: PlanVersion["status"]): string {
  if (status === "active") {
    return "is-active";
  }
  if (status === "draft") {
    return "is-draft";
  }
  if (status === "deprecated") {
    return "is-deprecated";
  }
  return "";
}

function renderVersionRow(
  client: GatewayBrowserClient,
  basePath: string,
  planId: string,
  version: PlanVersion,
): TemplateResult {
  const meta = versionMetaOf(version.id);
  const isActive = version.status === "active";
  const isDraft = version.status === "draft";
  const plan = state.plans.find((p) => p.id === planId);
  const isCurrent = plan?.currentVersionId === version.id;
  const canDelete = !isActive && !isCurrent;
  const active = activeVersionOf(planId);
  const lockedCount = versionLockedSubscriptions(planId, version.id, state.commercialSummary);
  const draftDiff =
    isDraft && active
      ? computeEntitlementDiff(
          versionMetaOf(active.id),
          meta,
          state.catalogTiers,
          state.catalogPolicies,
        )
      : [];
  return html`
    <article
      class="platform-pricing__timeline-item platform-pricing__version-card"
      data-testid="version-row"
      data-status=${version.status}
    >
      <div
        class="platform-pricing__timeline-marker ${versionStatusBadgeClass(version.status)}"
      ></div>
      <div class="platform-pricing__timeline-content">
        <div class="platform-pricing__version-card-head">
          <div class="platform-pricing__version-badges">
            <span class="platform-pricing__version-num">v${version.version}</span>
            <span
              class="platform-pricing__version-status ${versionStatusBadgeClass(version.status)}"
            >
              <span class="platform-pricing__version-status-dot" aria-hidden="true"></span>
              ${statusLabel(version.status)}
            </span>
            ${
              lockedCount > 0
                ? html`
                    <span class="platform-pricing__version-usage">
                      ${t("platformPricing.commercialLockedOnVersion", { count: String(lockedCount) })}
                    </span>
                  `
                : nothing
            }
          </div>
          <div class="platform-pricing__version-actions">
            ${
              isActive && meta?.bindingState === "valid"
                ? html`
                    <button
                      class="btn btn--sm"
                      data-testid="allocation-preview-btn"
                      ?disabled=${state.busy}
                      @click=${() => void loadAllocationPreview(client, version.id)}
                    >
                      ${t("platformPricing.allocationPreview")}
                    </button>
                  `
                : nothing
            }
            ${
              isDraft
                ? html`
                    <button
                      class="btn btn--sm"
                      ?disabled=${state.busy}
                      @click=${() => openDraftEditor(planId, version)}
                    >
                      ${t("platformPricing.editDraft")}
                    </button>
                    <button
                      class="btn btn--sm btn--primary"
                      data-testid="activate-btn"
                      ?disabled=${state.busy || Boolean(meta && !meta.activationReady)}
                      @click=${() => void openActivateConfirm(client, planId, version)}
                    >
                      ${t("platformPricing.activate")}
                    </button>
                  `
                : nothing
            }
            ${
              isActive
                ? html`
                    <button
                      class="btn btn--sm"
                      data-testid="edit-active-btn"
                      ?disabled=${state.busy}
                      @click=${() => void editActiveVersion(client, planId)}
                    >
                      编辑并发布新版本
                    </button>
                    <button
                      class="btn btn--sm"
                      data-testid="deprecate-btn"
                      ?disabled=${state.busy}
                      @click=${() => void deprecateVersion(client, planId, version.id)}
                    >
                      ${t("platformPricing.deprecate")}
                    </button>
                  `
                : nothing
            }
            ${
              canDelete
                ? html`
                    <button
                      class="btn btn--sm"
                      data-testid="delete-btn"
                      ?disabled=${state.busy}
                      @click=${() => openDeleteConfirm(planId, version)}
                    >
                      删除
                    </button>
                  `
                : nothing
            }
          </div>
        </div>
        ${renderVersionCommercialSpecs(version.id)}
        ${
          draftDiff.length > 0
            ? html`
                <div class="platform-pricing__inline-diff">
                  <div class="platform-pricing__inline-diff-title">
                    ${t("platformPricing.commercialEntitlementDiff")}
                  </div>
                  ${renderEntitlementDiffPanel(draftDiff)}
                </div>
              `
            : nothing
        }
        ${renderVersionBillingDetails(version)}
        ${
          meta && (meta.activationBlockers?.length ?? 0) > 0
            ? html`
                <div class="platform-pricing__version-blocker">
                  <span
                    >${t("platformPricing.planConfigBlockerPrefix")}${(meta.activationBlockers ?? []).map(formatActivationBlocker).join("，")}</span
                  >
                  ${
                    (meta.activationBlockers ?? []).includes("missing_binding")
                      ? html`
                          <button
                            type="button"
                            class="btn btn--sm btn--primary"
                            data-testid="version-fix-models-btn"
                            ?disabled=${state.busy}
                            @click=${() => navigateToPlanDetail(basePath, client, planId, "models")}
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
        ${
          state.allocationPreviews[version.id]
            ? html`
                <div class="platform-pricing__version-note" data-testid="allocation-preview">
                  ${t("platformPricing.allocationPreviewTitle")}：
                  ${state.allocationPreviews[version.id].roleProfiles
                    .map(
                      (p) => `${p.label} ${p.modelCount}${t("platformPricing.allocationModels")}`,
                    )
                    .join(" · ")}
                </div>
              `
            : nothing
        }
      </div>
    </article>
  `;
}

function renderVersionTimelineGroup(
  client: GatewayBrowserClient,
  basePath: string,
  planId: string,
  title: string,
  versions: PlanVersion[],
): TemplateResult | typeof nothing {
  if (versions.length === 0) {
    return nothing;
  }
  return html`
    <section class="platform-pricing__timeline-group">
      <h4 class="platform-pricing__timeline-group-title">${title}</h4>
      <div class="platform-pricing__timeline">
        ${versions.map((version) => renderVersionRow(client, basePath, planId, version))}
      </div>
    </section>
  `;
}

function renderVersionsPanel(
  client: GatewayBrowserClient,
  basePath: string,
  plan: Plan,
): TemplateResult {
  const versions = state.versionsByPlan[plan.id] ?? [];
  return html`
    <section
      class="platform-pricing__versions-panel platform-pricing__versions-panel--flat"
      data-testid="versions-panel"
    >
      <div class="platform-pricing__versions-panel-head">
        <div class="card-title">${t("platformPricing.versions")}</div>
        <button
          class="btn btn--sm"
          data-testid="create-draft-btn"
          ?disabled=${state.busy}
          @click=${() => void createDraft(client, plan)}
        >
          ${state.busy ? t("platformPricing.creatingDraft") : t("platformPricing.createDraft")}
        </button>
      </div>
      ${
        state.versionsLoading
          ? html`
              <div class="muted platform-pricing__versions-loading">…</div>
            `
          : versions.length === 0
            ? html`<div class="muted platform-pricing__versions-empty">
                ${t("platformPricing.noVersions")}
              </div>`
            : html`
                ${(() => {
                  const groups = groupVersionsForTimeline(versions);
                  return html`
                    ${renderVersionTimelineGroup(
                      client,
                      basePath,
                      plan.id,
                      t("platformPricing.commercialActiveVersion"),
                      groups.active ? [groups.active] : [],
                    )}
                    ${renderVersionTimelineGroup(
                      client,
                      basePath,
                      plan.id,
                      t("platformPricing.commercialDraftVersions"),
                      groups.drafts,
                    )}
                    ${renderVersionTimelineGroup(
                      client,
                      basePath,
                      plan.id,
                      t("platformPricing.commercialHistoricalVersions"),
                      groups.historical,
                    )}
                  `;
                })()}
              `
      }
      ${renderDraftEditor(client)} ${renderDeleteConfirm(client)} ${renderActivateConfirm(client)}
    </section>
  `;
}

function planStatusLabel(status: Plan["status"]): string {
  if (status === "active") {
    return t("platformPricing.statusActive");
  }
  if (status === "archived") {
    return t("platformPricing.statusDeprecated");
  }
  return status;
}

function renderBillingPanel(plan: Plan): TemplateResult {
  const active = activeVersionOf(plan.id);
  if (!active || active.snapshot.pricing.length === 0) {
    return html` <div class="muted">${t("platformPricing.billingEmpty")}</div> `;
  }
  return html`
    <dl class="platform-pricing__drawer-kv">
      ${active.snapshot.pricing.map(
        (entry) => html`
          <div class="platform-pricing__drawer-kv-row">
            <dt>${pricingSpecLabel(entry.type, entry.key)}</dt>
            <dd>${fmtMoney(entry.priceCents)}</dd>
          </div>
        `,
      )}
    </dl>
  `;
}

function renderPlanPreviewContent(
  client: GatewayBrowserClient,
  basePath: string,
  plan: Plan,
): TemplateResult {
  const meta = planDisplayMeta(plan, state.versionMetaById);
  const activeVersion = state.versionsByPlan[plan.id]?.find((v) => v.id === plan.currentVersionId);
  const activeMeta = activeVersion ? versionMetaOf(activeVersion.id) : null;
  const metrics = planCommercialMetrics(plan.id, state.commercialSummary);

  return html`
    <p class="muted platform-pricing__drawer-panel-hint">${t("platformPricing.planPreviewHint")}</p>
    ${renderPlanPreviewOverview({
      plan,
      activeVersionNumber: activeVersion?.version ?? null,
      monthlyCredits: meta.monthlyCredits,
      maxConcurrentRuns: activeMeta?.entitlementSnapshot?.maxConcurrentRuns ?? null,
      maxWorkflows: activeMeta?.entitlementSnapshot?.maxWorkflows ?? null,
      maxKnowledgeBases: activeMeta?.entitlementSnapshot?.maxKnowledgeBases ?? null,
      tierIds: meta.tiers,
      features: activeMeta?.entitlementSnapshot?.features ?? null,
      allowPrivateModels: activeMeta?.entitlementSnapshot?.allowPrivateModels === true,
      allowCustomPolicy: activeMeta?.entitlementSnapshot?.allowCustomPolicy === true,
      policyId: meta.policyId,
      catalogTiers: state.catalogTiers,
      catalogPolicies: state.catalogPolicies,
      activationBlockers: activeMeta?.activationBlockers ?? [],
      activeSubscriptions: metrics?.activeSubscriptions ?? 0,
      mrrCents: metrics?.mrrCents ?? 0,
      fmtMoney,
      onOpenModelsTab: () =>
        navigateToPlanDetail(basePath, client, plan.id, { mode: "edit", editTab: "models" }),
    })}
    <section
      class="platform-pricing__compare-card-shell"
      data-testid="plan-single-preview-comparison"
    >
      <div class="card-title">${t("platformPricing.comparePreviewTitle")}</div>
      ${
        state.pricingCatalog?.plans.some((p) => p.id === plan.id)
          ? renderPricingPage({
              catalog: {
                ...state.pricingCatalog,
                plans: state.pricingCatalog.plans.filter((p) => p.id === plan.id),
              },
              selectedCycle: pricingComparisonCycle,
              onSelectCycle: setPricingComparisonCycle,
              hideCta: true,
              readOnly: true,
            })
          : renderPricingComparison({
              plans: [plan],
              selectedCycle: pricingComparisonCycle,
              onSelectCycle: setPricingComparisonCycle,
              readOnly: true,
            })
      }
    </section>
  `;
}

/**
 * 套餐「权益与模型」Tab 的只读模型池：优先由所选 Tier 同步解析；
 * 旧版本无 Tier、仅有 allowedModelIds 时回退展示其历史模型。
 */
function planResolvedModelIds(planId: string, tierIds: readonly string[]): string[] {
  if (tierIds.length > 0) {
    return resolveModelIdsFromTiersSync(tierIds);
  }
  return uniqueSorted(editableVersionMetaOf(planId)?.binding?.allowedModelIds ?? []);
}

function renderPlanConfigWorkspaceContent(
  client: GatewayBrowserClient,
  basePath: string,
  plan: Plan,
  mode: PlanWorkspaceMode,
  editTab: PlanEditTab,
): TemplateResult {
  const meta = planDisplayMeta(plan, state.versionMetaById);
  const activeVersion = state.versionsByPlan[plan.id]?.find((v) => v.id === plan.currentVersionId);
  const activeMeta = activeVersion ? versionMetaOf(activeVersion.id) : null;
  const metrics = planCommercialMetrics(plan.id, state.commercialSummary);

  return renderPlanConfigWorkspace({
    plan,
    mode,
    editTab,
    onModeChange: (nextMode) => {
      if (nextMode === "preview") {
        navigateToPlanDetail(basePath, client, plan.id, { mode: "preview" });
        return;
      }
      navigateToPlanDetail(basePath, client, plan.id, { mode: "edit", editTab });
    },
    onEditTabChange: (nextTab) =>
      navigateToPlanDetail(basePath, client, plan.id, { mode: "edit", editTab: nextTab }),
    previewContent: renderPlanPreviewContent(client, basePath, plan),
    activeVersionNumber: activeVersion?.version ?? null,
    monthlyCredits: meta.monthlyCredits,
    tierIds: meta.tiers,
    policyId: meta.policyId,
    catalogTiers: state.catalogTiers,
    catalogPolicies: state.catalogPolicies,
    activationBlockers: activeMeta?.activationBlockers ?? [],
    activeSubscriptions: metrics?.activeSubscriptions ?? 0,
    mrrCents: metrics?.mrrCents ?? 0,
    client,
    resolvedModelIds: planResolvedModelIds(plan.id, meta.tiers),
    catalogModels: state.catalogModels,
    onOpenBundleEditor: () =>
      navigateToPlanDetail(basePath, client, plan.id, { mode: "edit", editTab: "bundle" }),
    onOpenResourceCatalog: () => openResourceCatalogFromPlan(basePath, client),
    marketingContent: html`
      ${renderPlanMarketingTags(client, plan)} ${renderPlanMatchingProfile(client, plan)}
    `,
    publishWorkflowContent: renderPlanPublishWorkflow(buildPublishWorkflowInput(plan), {
      onStepClick: (step) => handlePublishWorkflowStep(client, basePath, plan, step),
    }),
    versionsContent: renderVersionsPanel(client, basePath, plan),
    billingContent: renderBillingPanel(plan),
    fmtMoney,
  });
}

function renderPlanDetailPage(
  client: GatewayBrowserClient,
  basePath: string,
  planId: string,
  mode: PlanWorkspaceMode,
  editTab: PlanEditTab,
): TemplateResult {
  const plan = state.plans.find((entry) => entry.id === planId);
  if (plan) {
    ensurePlanDetailLoaded(client, planId, mode, editTab);
  }
  const plansHref = platformPricingHomeHref(basePath, { tab: pricingSubTab });
  if (!plan) {
    return html`
      <section
        class="platform-pricing__plan-detail platform-pricing__plan-detail--flat"
        data-testid="plan-detail-page"
      >
        <a
          class="platform-pricing__back-link"
          href=${plansHref}
          data-testid="back-to-plans"
          @click=${(event: MouseEvent) => followPortHref(event, plansHref)}
        >
          ← ${t("platformPricing.planDetailBack")}
        </a>
        <div class="muted card-follow--sm">${t("platformPricing.planNotFound")}</div>
      </section>
    `;
  }

  if (editTab === "bundle") {
    if (!state.versionsByPlan[planId]) {
      if (!state.versionsLoading) {
        void loadVersions(client, planId);
      }
      return html`
        <section
          class="platform-pricing__plan-detail platform-pricing__plan-detail--flat"
          data-testid="edit-plan-page"
        >
          <div class="muted">${t("platformPricing.loading")}</div>
        </section>
      `;
    }
    return renderEditPlanBundlePage(client, basePath, plan);
  }

  const activeVersion = state.versionsByPlan[plan.id]?.find((v) => v.id === plan.currentVersionId);
  return html`
    <section
      class="platform-pricing__plan-detail platform-pricing__plan-detail--flat"
      data-testid="plan-detail-page"
    >
      <div class="platform-pricing__page-toolbar platform-pricing__plan-detail-toolbar">
        <a
          class="platform-pricing__back-link"
          href=${plansHref}
          data-testid="back-to-plans"
          @click=${(event: MouseEvent) => followPortHref(event, plansHref)}
        >
          ← ${t("platformPricing.planDetailBack")}
        </a>
      </div>
      <header class="platform-pricing__plan-detail-head">
        <div>
          <h2 class="platform-pricing__plan-detail-title">${plan.name}</h2>
          <p class="muted platform-pricing__plan-detail-sub">
            ${t("platformPricing.planConfigDrawerTitle")}
          </p>
        </div>
        <div class="platform-pricing__plan-detail-meta">
          ${activeVersion ? html`<span class="chip">v${activeVersion.version}</span>` : nothing}
          <span
            class="platform-pricing__plan-status ${plan.status === "active" ? "is-active" : ""}"
          >
            ${planStatusLabel(plan.status)}
          </span>
        </div>
      </header>
      ${renderPlanConfigWorkspaceContent(client, basePath, plan, mode, editTab)}
    </section>
  `;
}

function buildCreatePreviewPlan(): Plan {
  const now = new Date().toISOString();
  return {
    id: "create-preview",
    name: state.formName.trim() || t("platformPricing.createPlanPreviewFallbackName"),
    billingCycle: "monthly",
    basePriceCents: yuanToCents(state.formBasePriceYuan),
    currentVersionId: "create-preview-version",
    seatQuota: {},
    botQuota: Number.parseInt(state.formBotQuota, 10) || 0,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

function renderPlanBundleEditForm(
  client: GatewayBrowserClient,
  basePath: string,
  mode: "create" | "edit",
  planId?: string,
): TemplateResult {
  const testIdPrefix: PlanBundleFormPrefix = mode === "create" ? "create" : "edit";
  const canSubmit = !state.busy;
  const listHref = platformPricingHref(basePath);
  const formTestId = mode === "create" ? "create-plan-edit-form" : "edit-plan-edit-form";
  return html`
    <div class="platform-pricing__create-form platform-pricing__editor" data-testid=${formTestId}>
      ${renderBasicInfoSection(testIdPrefix)} ${renderMarketingPresentationSection(testIdPrefix)}

      <section class="platform-pricing__editor-section">
        <h3 class="platform-pricing__section-heading">
          ${t("platformPricing.sectionEntitlement")}
        </h3>
        ${renderEntitlementEditor(state.formEntitlement, testIdPrefix)}
      </section>

      <section class="platform-pricing__editor-section">
        <h3 class="platform-pricing__section-heading">
          ${t("platformPricing.sectionModelsResolved")}
        </h3>
        <div class="platform-pricing__form-hint">
          ${t("platformPricing.sectionModelsResolvedHint")}
        </div>
        <div class="platform-pricing__editor-aligned-control">
          ${renderResolvedTierModelPreview({
            modelIds: state.resolvedTierModelIds,
            catalogModels: state.catalogModels,
            testIdPrefix,
          })}
          ${renderAdvancedModelControl({
            modelIds: state.resolvedTierModelIds,
            catalogModels: state.catalogModels,
            testIdPrefix,
            modelQuota: state.formModelQuota,
            onQuotaChange: (modelId, field, value) => {
              const prev = state.formModelQuota[modelId] ?? { maxRequests: "", maxTokens: "" };
              state.formModelQuota = {
                ...state.formModelQuota,
                [modelId]: { ...prev, [field]: value },
              };
              rerenderFn?.();
            },
            modelBudgets: state.formModelBudgets,
            onBudgetChange: (modelId, field, value) => {
              const prev = state.formModelBudgets[modelId] ?? {
                monthlyCreditsCap: "",
                spendCapCents: "",
              };
              state.formModelBudgets = {
                ...state.formModelBudgets,
                [modelId]: { ...prev, [field]: value },
              };
              rerenderFn?.();
            },
          })}
        </div>
      </section>

      <section class="platform-pricing__editor-section platform-pricing__editor-section--aor">
        <div class="platform-pricing__section-heading-row">
          <h3 class="platform-pricing__section-heading">${t("platformPricing.sectionAor")}</h3>
          ${renderAorEnableCheckbox(state.formAor, testIdPrefix, (patch) => {
            applyAorPatch(
              state.formAor,
              (resolved) => {
                state.formAor = { ...state.formAor, ...resolved };
                rerenderFn?.();
              },
              patch,
            );
          })}
        </div>
        ${renderAorFields(state.formAor, testIdPrefix, (patch) => {
          applyAorPatch(
            state.formAor,
            (resolved) => {
              state.formAor = { ...state.formAor, ...resolved };
              rerenderFn?.();
            },
            patch,
          );
        })}
      </section>

      <div class="platform-pricing__form-actions">
        <button
          class="btn"
          type="button"
          data-testid=${mode === "create" ? "cancel-create-plan-btn" : "cancel-edit-plan-btn"}
          ?disabled=${state.busy}
          @click=${() => navigatePricingHref(listHref)}
        >
          ${t("platformPricing.cancel")}
        </button>
        <button
          class="btn btn--primary"
          type="button"
          data-testid=${mode === "create" ? "create-plan-btn" : "save-plan-btn"}
          ?disabled=${!canSubmit}
          @click=${() =>
            mode === "create"
              ? void submitCreate(client, basePath)
              : planId
                ? void submitUpdate(client, basePath, planId)
                : undefined}
        >
          ${
            state.busy
              ? mode === "create"
                ? t("platformPricing.creatingDraft")
                : t("platformPricing.savingPlan")
              : mode === "create"
                ? t("platformPricing.createPlan")
                : t("platformPricing.savePlan")
          }
        </button>
      </div>
    </div>
  `;
}

function renderCreatePlanEditForm(client: GatewayBrowserClient, basePath: string): TemplateResult {
  return renderPlanBundleEditForm(client, basePath, "create");
}

function renderCreatePlanPreviewContent(): TemplateResult {
  const previewPlan = buildCreatePreviewPlan();
  const monthlyCreditsRaw = state.formEntitlement.monthlyCredits.trim();
  const monthlyCredits =
    monthlyCreditsRaw.length > 0 ? Number.parseInt(monthlyCreditsRaw, 10) || 0 : null;

  return html`
    <div class="platform-pricing__create-preview" data-testid="create-plan-preview">
      <p class="muted platform-pricing__drawer-panel-hint">
        ${t("platformPricing.planPreviewHint")}
      </p>
      ${renderPlanPreviewOverview({
        plan: previewPlan,
        activeVersionNumber: null,
        monthlyCredits,
        maxConcurrentRuns: parseMaxConcurrentRuns(state.formEntitlement.maxConcurrentRuns) ?? null,
        maxWorkflows: parseMaxConcurrentRuns(state.formEntitlement.maxWorkflows) ?? null,
        maxKnowledgeBases: parseMaxConcurrentRuns(state.formEntitlement.maxKnowledgeBases) ?? null,
        tierIds: state.formEntitlement.allowedTiers,
        features: {
          auditLog: state.formEntitlement.auditLog,
          mfa: state.formEntitlement.mfa,
          sso: state.formEntitlement.sso,
          vpcIsolation: state.formEntitlement.vpcIsolation,
        },
        allowPrivateModels: state.formEntitlement.allowPrivateModels,
        allowCustomPolicy: state.formEntitlement.allowCustomPolicy,
        policyId: state.formEntitlement.policyId || null,
        catalogTiers: state.catalogTiers,
        catalogPolicies: state.catalogPolicies,
        activationBlockers: [],
        activeSubscriptions: 0,
        mrrCents: 0,
        fmtMoney,
        onOpenModelsTab: () => {
          createWorkspaceMode = "edit";
          rerenderFn?.();
        },
      })}
      <section
        class="platform-pricing__compare-card-shell"
        data-testid="create-plan-preview-comparison"
      >
        <div class="card-title">${t("platformPricing.comparePreviewTitle")}</div>
        ${renderPricingComparison({
          plans: [previewPlan],
          selectedCycle: pricingComparisonCycle,
          onSelectCycle: setPricingComparisonCycle,
          readOnly: true,
        })}
      </section>
    </div>
  `;
}

function renderEditPlanPreviewContent(plan: Plan): TemplateResult {
  const previewPlan: Plan = {
    ...plan,
    name: state.formName.trim() || plan.name,
    basePriceCents: yuanToCents(state.formBasePriceYuan),
    botQuota: Number.parseInt(state.formBotQuota, 10) || 0,
  };
  const monthlyCreditsRaw = state.formEntitlement.monthlyCredits.trim();
  const monthlyCredits =
    monthlyCreditsRaw.length > 0 ? Number.parseInt(monthlyCreditsRaw, 10) || 0 : null;
  const activeVersion = state.versionsByPlan[plan.id]?.find(
    (entry) => entry.id === plan.currentVersionId,
  );

  return html`
    <div class="platform-pricing__create-preview" data-testid="edit-plan-preview">
      <p class="muted platform-pricing__drawer-panel-hint">
        ${t("platformPricing.planPreviewHint")}
      </p>
      ${renderPlanPreviewOverview({
        plan: previewPlan,
        activeVersionNumber: activeVersion?.version ?? null,
        monthlyCredits,
        maxConcurrentRuns: parseMaxConcurrentRuns(state.formEntitlement.maxConcurrentRuns) ?? null,
        maxWorkflows: parseMaxConcurrentRuns(state.formEntitlement.maxWorkflows) ?? null,
        maxKnowledgeBases: parseMaxConcurrentRuns(state.formEntitlement.maxKnowledgeBases) ?? null,
        tierIds: state.formEntitlement.allowedTiers,
        features: {
          auditLog: state.formEntitlement.auditLog,
          mfa: state.formEntitlement.mfa,
          sso: state.formEntitlement.sso,
          vpcIsolation: state.formEntitlement.vpcIsolation,
        },
        allowPrivateModels: state.formEntitlement.allowPrivateModels,
        allowCustomPolicy: state.formEntitlement.allowCustomPolicy,
        policyId: state.formEntitlement.policyId || null,
        catalogTiers: state.catalogTiers,
        catalogPolicies: state.catalogPolicies,
        activationBlockers: [],
        activeSubscriptions:
          planCommercialMetrics(plan.id, state.commercialSummary)?.activeSubscriptions ?? 0,
        mrrCents: planCommercialMetrics(plan.id, state.commercialSummary)?.mrrCents ?? 0,
        fmtMoney,
        onOpenModelsTab: () => {
          editWorkspaceMode = "edit";
          rerenderFn?.();
        },
      })}
      <section
        class="platform-pricing__compare-card-shell"
        data-testid="edit-plan-preview-comparison"
      >
        <div class="card-title">${t("platformPricing.comparePreviewTitle")}</div>
        ${renderPricingComparison({
          plans: [previewPlan],
          selectedCycle: pricingComparisonCycle,
          onSelectCycle: setPricingComparisonCycle,
          readOnly: true,
        })}
      </section>
    </div>
  `;
}

function renderEditPlanBundlePage(
  client: GatewayBrowserClient,
  basePath: string,
  plan: Plan,
): TemplateResult {
  ensurePlanBundleFormPopulated(plan);
  if (
    state.formEntitlement.allowedTiers.length > 0 &&
    state.resolvedTierModelIds.length === 0 &&
    lastClient
  ) {
    void syncResolvedTierModels(lastClient, state.formEntitlement.allowedTiers);
  }
  const listHref = platformPricingHref(basePath);
  const draft = primaryDraftOf(plan.id);
  return html`
    <section class="card platform-pricing__editor-card" data-testid="edit-plan-page">
      <div class="platform-pricing__page-toolbar">
        <a
          class="platform-pricing__back-link"
          href=${listHref}
          data-testid="back-to-plans"
          @click=${(event: MouseEvent) => followPortHref(event, listHref)}
        >
          ← ${t("platformPricing.backToPlans")}
        </a>
      </div>
      <div class="card-title">${t("platformPricing.editPlanTitle")}</div>
      ${
        draft
          ? html`
              <div class="platform-pricing__version-blocker" data-testid="edit-plan-draft-banner">
                <span>
                  ${t("platformPricing.planConfigDraftBanner", {
                    version: `v${draft.version}`,
                  })}
                </span>
                <button
                  type="button"
                  class="btn btn--sm btn--primary"
                  data-testid="edit-plan-activate-draft-btn"
                  ?disabled=${state.busy}
                  @click=${() => void openActivateConfirm(client, plan.id, draft)}
                >
                  ${t("platformPricing.planConfigDraftActivate")}
                </button>
              </div>
            `
          : nothing
      }
      <nav class="platform-pricing__drawer-tabs platform-pricing__drawer-tabs--mode" role="tablist">
        <button
          type="button"
          class="platform-pricing__drawer-tab platform-pricing__drawer-tab--mode ${editWorkspaceMode === "preview" ? "is-active" : ""}"
          role="tab"
          aria-selected=${String(editWorkspaceMode === "preview")}
          data-testid="edit-plan-mode-preview"
          @click=${() => {
            editWorkspaceMode = "preview";
            rerenderFn?.();
          }}
        >
          ${t("platformPricing.planConfigModePreview")}
        </button>
        <button
          type="button"
          class="platform-pricing__drawer-tab platform-pricing__drawer-tab--mode ${editWorkspaceMode === "edit" ? "is-active" : ""}"
          role="tab"
          aria-selected=${String(editWorkspaceMode === "edit")}
          data-testid="edit-plan-mode-edit"
          @click=${() => {
            editWorkspaceMode = "edit";
            rerenderFn?.();
          }}
        >
          ${t("platformPricing.planConfigModeEdit")}
        </button>
      </nav>
      ${
        editWorkspaceMode === "preview"
          ? renderEditPlanPreviewContent(plan)
          : renderPlanBundleEditForm(client, basePath, "edit", plan.id)
      }
    </section>
  `;
}

function renderCreatePlanPage(client: GatewayBrowserClient, basePath: string): TemplateResult {
  const listHref = platformPricingHref(basePath);
  return html`
    <section class="card platform-pricing__editor-card" data-testid="create-plan-page">
      <div class="platform-pricing__page-toolbar">
        <a
          class="platform-pricing__back-link"
          href=${listHref}
          data-testid="back-to-plans"
          @click=${(event: MouseEvent) => followPortHref(event, listHref)}
        >
          ← ${t("platformPricing.backToPlans")}
        </a>
      </div>
      <div class="card-title">${t("platformPricing.createPlanTitle")}</div>
      <nav class="platform-pricing__drawer-tabs platform-pricing__drawer-tabs--mode" role="tablist">
        <button
          type="button"
          class="platform-pricing__drawer-tab platform-pricing__drawer-tab--mode ${createWorkspaceMode === "preview" ? "is-active" : ""}"
          role="tab"
          aria-selected=${String(createWorkspaceMode === "preview")}
          data-testid="create-plan-mode-preview"
          @click=${() => {
            createWorkspaceMode = "preview";
            rerenderFn?.();
          }}
        >
          ${t("platformPricing.planConfigModePreview")}
        </button>
        <button
          type="button"
          class="platform-pricing__drawer-tab platform-pricing__drawer-tab--mode ${createWorkspaceMode === "edit" ? "is-active" : ""}"
          role="tab"
          aria-selected=${String(createWorkspaceMode === "edit")}
          data-testid="create-plan-mode-edit"
          @click=${() => {
            createWorkspaceMode = "edit";
            rerenderFn?.();
          }}
        >
          ${t("platformPricing.planConfigModeEdit")}
        </button>
      </nav>
      ${
        createWorkspaceMode === "preview"
          ? renderCreatePlanPreviewContent()
          : renderCreatePlanEditForm(client, basePath)
      }
    </section>
  `;
}

function openUnitEconomicsDrawer(planId: string): void {
  state.unitEconomicsDrawerPlanId = planId;
  rerenderFn?.();
}

function pricingRerender(): void {
  requestOpenBotAppRerender();
  if (typeof document !== "undefined" && !document.querySelector("openbot-app")) {
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

function renderPackagesHomePreviewSection(
  client: GatewayBrowserClient,
  basePath: string,
): TemplateResult {
  const createHref = platformPricingCreateHref(basePath);
  return html`
    <section class="platform-pricing__compare-card-shell" data-testid="pricing-comparison-shell">
      ${renderPricingPage({
        catalog: state.pricingCatalog,
        loading: state.pricingCatalogLoading || state.loading,
        error: state.pricingCatalogError ?? (state.plans.length === 0 ? state.error : null),
        selectedCycle: pricingComparisonCycle,
        onSelectCycle: setPricingComparisonCycle,
        // Admin preview: hide purchase CTAs, keep edit affordance.
        hideCta: true,
        onEditPlan: (plan) =>
          navigateToPlanDetail(basePath, client, plan.id, { mode: "edit", editTab: "bundle" }),
      })}
      <div class="pricing-v3__footer-actions">
        <a
          class="btn btn--primary btn--sm"
          href=${createHref}
          data-testid="create-plan-link"
          @click=${(event: MouseEvent) => followPortHref(event, createHref)}
        >
          + ${t("platformPricing.createPlan")}
        </a>
      </div>
    </section>
  `;
}

function renderPackagesHomeSection(client: GatewayBrowserClient, basePath: string): TemplateResult {
  syncPackagesHomeFromUrl();
  return html` ${renderPackagesHomePreviewSection(client, basePath)} `;
}

/** 测试用：重置模块级状态，避免用例间污染。 */
export function __resetPlatformPricingForTest(): void {
  state.plans = [];
  state.loading = false;
  state.error = null;
  state.notice = null;
  state.formName = "";
  state.formBasePriceYuan = "0";
  state.formBotQuota = "10";
  state.formViewerPriceYuan = "10";
  state.formCreatorPriceYuan = "30";
  state.formAiTokenPriceCents = "0.002";
  state.formMeters = defaultFormMeters();
  state.formAllowedModelIds = [];
  state.formModelQuota = {};
  state.formModelBudgets = {};
  state.resolvedTierModelIds = [];
  state.formModelSearch = "";
  state.formAor = {
    enabled: false,
    taskTypeId: "",
    selectorStrategy: "balanced",
    evaluatorMode: "",
  };
  state.formEntitlement = {
    monthlyCredits: "0",
    aiBasic: "",
    aiPro: "",
    aiElite: "",
    maxConcurrentRuns: "",
    maxWorkflows: "",
    maxKnowledgeBases: "",
    overagePolicyType: "block",
    allowBurstConcurrency: false,
    allowedTiers: [],
    allowedPolicies: [],
    policyId: "balanced",
    auditLog: false,
    mfa: false,
    sso: false,
    vpcIsolation: false,
    allowPrivateModels: false,
    allowCustomPolicy: false,
  };
  state.formSlogan = "";
  state.formTargetAudience = "";
  state.formMarketingFeatures = "";
  state.busy = false;
  state.expandedPlanId = null;
  state.bundleCatalog = [];
  state.catalogTiers = [];
  state.catalogPolicies = [];
  state.versionsByPlan = {};
  state.versionMetaById = {};
  state.versionsLoading = false;
  state.draftEditor = null;
  state.deleteConfirm = null;
  state.activateConfirm = null;
  lastClient = null;
  lastGatewayReconnectClient = null;
  loaded = false;
  loadedEpochKey = null;
  inflightEpochKey = null;
  loadPlansEpoch = 0;
  pricingSubTab = "packages";
  pricingComparisonCycle = "monthly";
  state.commercialSummary = null;
  state.economicsOverview = null;
  state.unitEconomicsDrawerPlanId = null;
  state.planDetailPlanId = null;
  state.bindingConsistencyIssues = null;
  state.bindingConsistencyLoading = false;
  state.pricingCatalog = null;
  state.pricingCatalogLoading = false;
  state.pricingCatalogError = null;
  clearEconomicsFocus();
  createWorkspaceMode = "edit";
  editWorkspaceMode = "edit";
  bundleFormPlanId = null;
  cancelLoadPlansRetry();
  loadPlansInFlight = null;
  __resetEconomicsSectionForTest();
  __resetResourceCatalogSectionForTest();
  __resetResourceCatalogTierDetailForTest();
  __resetPricingOperatingDashboardForTest();
  __resetPlatformCommerceWorkbenchForTest();
}

function renderPackagesRoute(
  client: GatewayBrowserClient,
  basePath: string,
  route: ReturnType<typeof resolvePricingRoute>,
): TemplateResult {
  if (route.view === "create") {
    return renderCreatePlanPage(client, basePath);
  }
  if (route.view === "planDetail") {
    state.planDetailPlanId = route.planId;
    return renderPlanDetailPage(client, basePath, route.planId, route.mode, route.editTab);
  }
  return renderPackagesHomeSection(client, basePath);
}

export function renderPlatformPricingSurface(props: PlatformSurfaceProps): TemplateResult {
  const client = props.client ?? null;
  const basePath = props.basePath;
  lastPricingBasePath = basePath;
  if (typeof window !== "undefined") {
    maybeRedirectLegacyPricingPath(basePath);
    syncPackagesHomeFromUrl();
    syncPricingSubTabFromUrl();
  }
  const route =
    typeof window !== "undefined"
      ? resolvePricingRoute(window.location.pathname, basePath)
      : { view: "home" as const, mode: "edit" as const };
  const rerender = pricingRerender;
  ensureLoaded(client, rerender);

  if (!client || !client.connected) {
    return html`
      <div class="callout warning" data-testid="pricing-gateway-disconnected">
        <p>尚未连接到 Gateway，无法管理套餐与定价。</p>
        <p class="muted">WebSocket 未连接。连接恢复前不会继续显示目录 Loading。</p>
        ${
          client
            ? html`
                <button
                  type="button"
                  class="btn btn--sm"
                  data-testid="pricing-gateway-retry"
                  @click=${() => retryPricingLoads(client)}
                >
                  ${t("platformPricing.retryLoad")}
                </button>
              `
            : nothing
        }
      </div>
    `;
  }

  const nestedPackagesRoute = route.view === "planDetail" || route.view === "create";
  const nestedTierRoute = route.view === "tierDetail";

  const catalogOptions = {
    plans: state.plans,
    catalogPolicies: state.catalogPolicies,
    versionMetaById: state.versionMetaById,
    economicsProjectionContext: state.economicsOverview?.projectionContext ?? null,
    economicsSummary: state.economicsOverview?.summary ?? null,
    commercialSummary: state.commercialSummary,
    onOpenTier: (tierId: string, focus?: "modelPool") =>
      openTierGovernanceDetail(basePath, client, tierId, focus),
  };

  return html`
    <div class="platform-pricing">
      ${renderPricingSubTabs(pricingSubTab, client, basePath)}
      ${pricingSubTab === "packages" ? renderPackagesPrereqBanner(client, basePath) : nothing}
      ${renderGatewayReconnectHint(client)}
      ${state.error ? html`<div class="callout warning">${state.error}</div>` : nothing}
      ${state.notice ? html`<div class="callout">${state.notice}</div>` : nothing}
      ${
        nestedPackagesRoute
          ? renderPackagesRoute(client, basePath, route)
          : nestedTierRoute
            ? renderPlatformResourceCatalogTierDetail(client, route.tierId, rerender, {
                ...catalogOptions,
                basePath,
                onBack: () => {
                  navigatePricingHref(
                    platformPricingHomeHref(basePath, {
                      tab: "resourceCatalog",
                    }),
                  );
                  reloadPlatformResourceCatalogSection(client, rerender);
                },
              })
            : pricingSubTab === "resourceCatalog"
              ? renderPlatformResourceCatalogSection(client, rerender, catalogOptions)
              : pricingSubTab === "economics"
                ? html`
                    ${renderPlatformEconomicsSection(client, rerender, {
                      commercialSummary: state.commercialSummary,
                      plans: state.plans,
                      catalogPolicies: state.catalogPolicies,
                      versionMetaById: state.versionMetaById,
                      versionsByPlan: state.versionsByPlan,
                      onBackToPackages: () => {
                        clearEconomicsFocus();
                        setPricingSubTab("packages", client, { basePath });
                        rerenderFn?.();
                      },
                      onOpenUnitEconomics: (planId) => openUnitEconomicsDrawer(planId),
                      onFocusPlan: (planId) => {
                        const plan = state.plans.find((entry) => entry.id === planId);
                        const meta = plan ? state.versionMetaById[plan.currentVersionId] : null;
                        const needsModels = resolvePlanVersionHealth(meta).needsModels;
                        navigateToPlanDetail(
                          basePath,
                          client,
                          planId,
                          needsModels ? { mode: "edit", editTab: "models" } : { mode: "preview" },
                        );
                      },
                      onFixPlanModels: (planId) => {
                        navigateToPlanDetail(basePath, client, planId, {
                          mode: "edit",
                          editTab: "models",
                        });
                      },
                      operatingRerender: pricingRerender,
                    })}
                    ${renderUnitEconomicsDrawerPanel(client)}
                  `
                : pricingSubTab === "commerce"
                  ? renderPlatformCommerceWorkbench(client, rerender)
                  : renderPackagesRoute(client, basePath, route)
      }
    </div>
  `;
}
