import { html } from "lit";
import {
  normalizeAppHistoryHref,
  requestOpenBotAppRerender,
} from "../../../request-app-rerender.ts";
import type { PlatformSurfaceProps } from "../shared/surface.ts";
import { selectPlatformModelsActions } from "./actions.ts";
import { buildPlatformModelsVM } from "./adapter.ts";
import { previewRoutingDecisionViaService } from "./admission/routing-decision-service.ts";
import {
  bindCapabilityAdmissionGateway,
  ensureCapabilityVerificationLifecycle,
  isCapabilityAdmissionRpcActive,
} from "./admission/verification-service.ts";
import type { RoutingDecisionPreview } from "./routing-decision-preview.ts";
import {
  renderModelsAorBanditPanel,
  renderModelsAorLiveCodingEvidence,
  renderModelsAorStatusCard,
} from "./sections/AorIntegrationPanel.ts";
import { renderModelAssetsSection } from "./sections/ModelAssetsSection.ts";
import { renderModelGovernanceSection } from "./sections/ModelGovernanceSection.ts";
import { renderModelTaskPlansSection } from "./sections/ModelTaskPlansSection.ts";
import { renderModelUsageAnalyticsSection } from "./sections/ModelUsageAnalyticsSection.ts";
import { renderSmartRoutingSection } from "./sections/SmartRoutingSection.ts";
import type { ModelsTabId, PlatformModelsTabContext } from "./view-model.ts";

const MODELS_HASH_PREFIX = "#platform-models:";
let activeModelsContext: PlatformModelsTabContext = {};

const MODEL_TABS: Array<{ id: ModelsTabId; label: string }> = [
  { id: "modelAssets", label: "模型池" },
  { id: "taskPlans", label: "任务方案" },
  { id: "smartRouting", label: "智能路由" },
  { id: "usageAnalytics", label: "使用分析" },
  { id: "governance", label: "治理告警" },
];

function resolveActiveModelsTab(): ModelsTabId {
  if (typeof window === "undefined") {
    return "modelAssets";
  }
  const raw = window.location.hash.trim();
  if (!raw.startsWith(MODELS_HASH_PREFIX)) {
    return "modelAssets";
  }
  const value = raw.slice(MODELS_HASH_PREFIX.length);
  if (value === "overview") {
    return "modelAssets";
  }
  return MODEL_TABS.some((tab) => tab.id === value) ? (value as ModelsTabId) : "modelAssets";
}

function activateModelsTab(tab: ModelsTabId, context: PlatformModelsTabContext = {}) {
  if (typeof window === "undefined") {
    return;
  }
  activeModelsContext = context;
  const { pathname, search } = window.location;
  // 同页 hash 不能走 replaceAppHistoryState：合成 popstate 会进入
  // onPopState → refreshActiveTab，模型页会同时 loadOverview 与 loadModelsManagement。
  window.history.replaceState(
    {},
    "",
    normalizeAppHistoryHref(`${pathname}${search}${MODELS_HASH_PREFIX}${tab}`),
  );
  requestOpenBotAppRerender();
}

function mapDefaultModelsTab(tab: ModelsTabId) {
  return tab === "governance" ? "issues" : tab;
}

function renderModelsTabBar(activeTab: ModelsTabId) {
  return html`
    <div
      class="platform-module-tabs platform-module-tabs--inline"
      role="tablist"
      aria-label="模型模块"
    >
      ${MODEL_TABS.map(
        (tab) => html`
          <button
            type="button"
            class="platform-module-tab ${activeTab === tab.id ? "is-active" : ""}"
            role="tab"
            aria-selected=${String(activeTab === tab.id)}
            @click=${() => activateModelsTab(tab.id)}
          >
            ${tab.label}
          </button>
        `,
      )}
    </div>
  `;
}

let modelsSnapshotAutoLoadTriggered = false;
let modelsSnapshotAutoLoadTimer: number | null = null;
let lastRoutingPreview: RoutingDecisionPreview | null = null;
export function getLastRoutingPreviewForTest() {
  return lastRoutingPreview;
}

function maybeAutoTriggerModelsSnapshot(props: PlatformSurfaceProps): void {
  if (modelsSnapshotAutoLoadTriggered) {
    return;
  }
  if (typeof window === "undefined") {
    return;
  }
  if (props.readModel.modelsManagementLoading === true) {
    return;
  }
  if (props.readModel.modelsManagementSnapshot) {
    modelsSnapshotAutoLoadTriggered = true;
    return;
  }
  if (props.readModel.modelsManagementError) {
    modelsSnapshotAutoLoadTriggered = true;
    return;
  }
  if (modelsSnapshotAutoLoadTimer !== null) {
    return;
  }
  modelsSnapshotAutoLoadTimer = window.setTimeout(() => {
    modelsSnapshotAutoLoadTimer = null;
    modelsSnapshotAutoLoadTriggered = true;
    void props.actions.models.onRefresh();
  }, 0);
}

let admissionGatewayBindKey: string | null = null;

function ensureAdmissionGatewayBinding(props: PlatformSurfaceProps) {
  const connected = Boolean(props.client && props.connected);
  const key = connected ? "connected" : "offline";
  if (admissionGatewayBindKey === key) {
    return;
  }
  admissionGatewayBindKey = key;
  if (connected && props.client) {
    const client = props.client;
    void bindCapabilityAdmissionGateway((method, params) =>
      client.request(method, params ?? {}),
    ).then((result) => {
      if (result.synced > 0) {
        requestOpenBotAppRerender();
      }
    });
    return;
  }
  if (isCapabilityAdmissionRpcActive()) {
    void bindCapabilityAdmissionGateway(null);
  }
}

export function renderPlatformModelsSurface(props: PlatformSurfaceProps) {
  // Page lifecycle: recover orphaned verification tasks from a prior refresh.
  // Live in-page tasks are preserved; opening a detail drawer does not re-enter here alone.
  ensureCapabilityVerificationLifecycle();
  ensureAdmissionGatewayBinding(props);
  maybeAutoTriggerModelsSnapshot(props);
  let vm: ReturnType<typeof buildPlatformModelsVM>;
  try {
    vm = buildPlatformModelsVM({
      legacyModelsVM: props.pageViewModels?.models ?? null,
      readModel: props.readModel,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return html`
      <section class="card">
        <div class="card-title">Platform Models</div>
        <div class="card-sub">
          模型运营数据加载失败。请稍后重试，或进入模型资产页查看基础模型配置。
        </div>
        <div class="callout danger card-follow">${message}</div>
        <div class="row row--tight card-follow">
          <button
            class="btn btn--primary"
            type="button"
            @click=${() => activateModelsTab("modelAssets")}
          >
            查看模型资产
          </button>
        </div>
      </section>
    `;
  }
  const actions = selectPlatformModelsActions(props.actions);
  const activeTab = resolveActiveModelsTab();
  const aorIntegration = { readModel: props.readModel };
  const onNavigateTab = (
    tab:
      | "overview"
      | "modelAssets"
      | "taskPlans"
      | "smartRouting"
      | "usageAnalytics"
      | "governance",
    context?: PlatformModelsTabContext,
  ) => activateModelsTab(mapDefaultModelsTab(tab), context);

  return html`
    <section class="card">${renderModelsTabBar(activeTab)}</section>
    ${
      activeTab === "modelAssets"
        ? html`
            ${renderModelsAorStatusCard(aorIntegration)}
            ${
              props.readModel.modelsManagementError
                ? html`
                    <div class="callout danger card-lead" role="alert">
                      ${props.readModel.modelsManagementError}
                      <div class="row row--tight card-follow--sm">
                        <button
                          class="btn btn--sm btn--primary"
                          type="button"
                          @click=${() => void props.actions.models.onRefresh()}
                        >
                          重试加载
                        </button>
                      </div>
                    </div>
                  `
                : ""
            }
            ${renderModelAssetsSection({
              vm: vm.assets,
              actions,
              compat: vm.compat?.legacyModelsVM ?? null,
              onNavigateTab,
              context: activeModelsContext,
              // Treat "snapshot not yet resolved" as loading so the empty-state
              // bootstrap page does not flash before data arrives. Once the
              // snapshot resolves (or errors), fall through to the real content.
              loading:
                props.readModel.modelsManagementLoading === true ||
                (!props.readModel.modelsManagementSnapshot &&
                  !props.readModel.modelsManagementError),
              // 推荐池 = allowlist（入池／可被推荐），与租户可选、自动路由分开。
              onToggleRecommendationPool: (modelId, nextValue) => {
                if (nextValue) {
                  actions.onUpsertAllowlistEntry(modelId, null);
                } else {
                  actions.onRemoveAllowlistEntry(modelId);
                }
                void actions.onSaveConfig?.();
              },
              // 租户可选／自动路由：仅在 gateway models.admission.* 已绑定时由抽屉启用；
              // localStorage 草稿不会被展示成平台已生效状态。
              // 准入 applied／platformEffective 只写存档并供干跑预览；不驱动线上会话选型。
            })}
          `
        : activeTab === "taskPlans"
          ? renderModelTaskPlansSection({
              vm: vm.taskPlans,
              readModel: props.readModel,
              onNavigateTab,
              context: activeModelsContext,
              compat: vm.compat?.legacyModelsVM ?? null,
              onSetDefaultPrimary: actions.onSetDefaultPrimary,
              onSetDefaultFallbacks: actions.onSetDefaultFallbacks,
              onSetDefaultImagePrimary: actions.onSetDefaultImagePrimary,
              onUpsertTaskPlanConfig: actions.onUpsertTaskPlanConfig,
              onSaveConfig: actions.onSaveConfig,
            })
          : activeTab === "smartRouting"
            ? html`
                ${renderModelsAorStatusCard(aorIntegration)}
                ${renderSmartRoutingSection({
                  vm: vm.routing,
                  onNavigateTab,
                  context: activeModelsContext,
                  compat: vm.compat?.legacyModelsVM ?? null,
                  routingPreview: lastRoutingPreview,
                  onSimulateRouting: (input) => {
                    void previewRoutingDecisionViaService({
                      request: {
                        taskProfileId: input.taskProfileId,
                        planId: input.planId,
                        taskText: input.taskText ?? input.sampleInput,
                        outputType: input.outputType,
                        budget: input.budget,
                        requiredCapabilities: input.requiredCapabilities,
                      },
                      candidates: vm.assets.models,
                    }).then((preview) => {
                      lastRoutingPreview = preview;
                      requestOpenBotAppRerender();
                    });
                  },
                  onSetDefaultPrimary: actions.onSetDefaultPrimary,
                  onSetDefaultFallbacks: actions.onSetDefaultFallbacks,
                  onSetDefaultImagePrimary: actions.onSetDefaultImagePrimary,
                  onUpsertRoutingPolicyConfig: actions.onUpsertRoutingPolicyConfig,
                  onDuplicatePolicy: actions.onDuplicateRoutingPolicyConfig
                    ? (policy) =>
                        actions.onDuplicateRoutingPolicyConfig({
                          policyId: policy.policyId,
                          name: `${policy.name} 副本`,
                          taskProfileId: policy.taskProfileId,
                          planId: policy.planId,
                          primaryModelIds: policy.candidates.primary,
                          fallbackModelIds: policy.candidates.fallback,
                          status: "draft",
                          // Persisted routing policies do not carry the adaptive "bandit"
                          // mode (the read model normalizes it away), so drop it to null here.
                          rankingMode:
                            policy.ranking.mode === "bandit" ? null : policy.ranking.mode,
                          maxCostPerRequest: policy.constraints.maxCostPerRequest,
                          maxLatencyMs: policy.constraints.maxLatencyMs,
                          requiredCapabilities: policy.constraints.requiredCapabilities,
                          requiredHealth: policy.constraints.requiredHealth,
                        })
                    : undefined,
                  onUpdatePolicyStatus: actions.onUpdateRoutingPolicyStatus,
                  onSaveConfig: actions.onSaveConfig,
                })}
              `
            : activeTab === "usageAnalytics"
              ? html`
                  ${renderModelsAorBanditPanel(aorIntegration)}
                  ${renderModelUsageAnalyticsSection({
                    vm: vm.analytics,
                    onNavigateTab,
                    context: activeModelsContext,
                  })}
                `
              : activeTab === "issues"
                ? html`
                    ${renderModelsAorLiveCodingEvidence(aorIntegration)}
                    ${renderModelGovernanceSection({
                      vm: vm.governance,
                      actions,
                      compat: vm.compat?.legacyModelsVM ?? null,
                      onNavigateTab,
                      context: activeModelsContext,
                      mode: "issues",
                    })}
                  `
                : html`
                    ${renderModelsAorLiveCodingEvidence(aorIntegration)}
                    ${renderModelGovernanceSection({
                      vm: vm.governance,
                      actions,
                      compat: vm.compat?.legacyModelsVM ?? null,
                      onNavigateTab,
                      context: activeModelsContext,
                      mode: "governance",
                    })}
                  `
    }
  `;
}
