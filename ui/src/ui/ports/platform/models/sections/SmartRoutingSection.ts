import { html } from "lit";
import { formatCost } from "../../../../views/usage-metrics.ts";
import { requestPlatformSurfaceRerender } from "../../shared/surface.ts";
import type {
  LegacyPlatformModelsVM,
  ModelRoutingVM,
  PlatformModelsTabContext,
  RoutingDecisionExplanation,
  RoutingPolicy,
} from "../view-model.ts";

type SmartRoutingNavigateTab =
  | "overview"
  | "modelAssets"
  | "taskPlans"
  | "usageAnalytics"
  | "governance";

type RoutingFilterState = {
  search: string;
  taskProfileId: string;
  planId: string;
  status: "" | RoutingPolicy["status"];
  rankingMode: "" | RoutingPolicy["ranking"]["mode"];
  scopeType: "" | "platform" | "tenant" | "userSegment" | "agent";
  missingFallback: "all" | "yes" | "no";
  hasConflict: "all" | "yes" | "no";
  sortField: ModelRoutingVM["defaultSort"]["field"];
  sortDirection: ModelRoutingVM["defaultSort"]["direction"];
  selectedPolicyId: string | null;
  selectedExplanationId: string | null;
};

const DEFAULT_ROUTING_FILTER_STATE: RoutingFilterState = {
  search: "",
  taskProfileId: "",
  planId: "",
  status: "",
  rankingMode: "",
  scopeType: "",
  missingFallback: "all",
  hasConflict: "all",
  sortField: "updatedAt",
  sortDirection: "desc",
  selectedPolicyId: null,
  selectedExplanationId: null,
};

let routingFilterState: RoutingFilterState = { ...DEFAULT_ROUTING_FILTER_STATE };
let lastRoutingContextKey = "";
let routingEditorKey = "";
let routingEditorOpenPolicyId: string | null = null;
type RoutingPanelState =
  | { kind: "chain"; policyId: string }
  | { kind: "explanation"; policyId: string; explanationId: string | null }
  | { kind: "editor"; policyId: string }
  | { kind: "duplicate"; policyId: string }
  | { kind: "status"; policyId: string; nextStatus: "active" | "draft" | "disabled" }
  | { kind: "conflicts" }
  | null;

let routingPanelState: RoutingPanelState = null;
let routingEditorState = {
  primaryModel: "",
  fallbackModels: "",
};

function requestRerender() {
  requestPlatformSurfaceRerender();
}

function ensureRoutingDefaults(defaultSort: ModelRoutingVM["defaultSort"]) {
  if (
    routingFilterState.sortField === DEFAULT_ROUTING_FILTER_STATE.sortField &&
    routingFilterState.sortDirection === DEFAULT_ROUTING_FILTER_STATE.sortDirection
  ) {
    routingFilterState = {
      ...routingFilterState,
      sortField: defaultSort.field,
      sortDirection: defaultSort.direction,
    };
  }
}

function syncRoutingContext(context?: PlatformModelsTabContext) {
  const contextKey = JSON.stringify(context ?? {});
  if (contextKey === lastRoutingContextKey) {
    return;
  }
  lastRoutingContextKey = contextKey;
  if (context?.policyId) {
    routingFilterState = {
      ...routingFilterState,
      selectedPolicyId: context.policyId,
    };
    return;
  }
  routingFilterState = {
    ...routingFilterState,
    ...(context?.planId ? { planId: context.planId } : {}),
    ...(context?.taskProfileId ? { taskProfileId: context.taskProfileId } : {}),
  };
}

function updateRoutingFilters(next: Partial<RoutingFilterState>) {
  routingFilterState = {
    ...routingFilterState,
    ...next,
  };
  requestRerender();
}

function updateRoutingEditor(next: Partial<typeof routingEditorState>) {
  routingEditorState = {
    ...routingEditorState,
    ...next,
  };
  requestRerender();
}

function openRoutingEditor(policy: RoutingPolicy) {
  routingEditorOpenPolicyId = policy.policyId;
  routingFilterState = {
    ...routingFilterState,
    selectedPolicyId: policy.policyId,
  };
  routingEditorKey = "";
  routingPanelState = { kind: "editor", policyId: policy.policyId };
  requestRerender();
}

function openRoutingChain(policy: RoutingPolicy) {
  routingFilterState = {
    ...routingFilterState,
    selectedPolicyId: policy.policyId,
  };
  routingPanelState = { kind: "chain", policyId: policy.policyId };
  requestRerender();
}

function openRoutingExplanation(policy: RoutingPolicy, explanationId: string | null) {
  routingFilterState = {
    ...routingFilterState,
    selectedPolicyId: policy.policyId,
    selectedExplanationId: explanationId,
  };
  routingPanelState = { kind: "explanation", policyId: policy.policyId, explanationId };
  requestRerender();
}

function openRoutingDuplicate(policy: RoutingPolicy) {
  routingFilterState = {
    ...routingFilterState,
    selectedPolicyId: policy.policyId,
  };
  routingPanelState = { kind: "duplicate", policyId: policy.policyId };
  requestRerender();
}

function openRoutingStatus(policy: RoutingPolicy) {
  routingFilterState = {
    ...routingFilterState,
    selectedPolicyId: policy.policyId,
  };
  routingPanelState = {
    kind: "status",
    policyId: policy.policyId,
    nextStatus: policy.status === "active" ? "disabled" : "active",
  };
  requestRerender();
}

function openRoutingConflicts() {
  routingPanelState = { kind: "conflicts" };
  requestRerender();
}

function closeRoutingPanel() {
  routingPanelState = null;
  requestRerender();
}

function renderRoutingPanelModal(
  selectedPolicy: RoutingPolicy | null,
  selectedExplanation: RoutingDecisionExplanation | null,
  vm: ModelRoutingVM,
  context: PlatformModelsTabContext | undefined,
  compat: LegacyPlatformModelsVM | null | undefined,
  onNavigateTab: (tab: SmartRoutingNavigateTab, context?: PlatformModelsTabContext) => void,
  onSetDefaultPrimary?: (modelRef: string | null) => void,
  onSetDefaultFallbacks?: (fallbacks: string[]) => void,
  onSetDefaultImagePrimary?: (modelRef: string | null) => void,
  onUpsertRoutingPolicyConfig?: (input: {
    policyId: string;
    name?: string | null;
    taskProfileId?: string | null;
    planId?: string | null;
    primaryModelIds: string[];
    fallbackModelIds: string[];
    status?: "active" | "draft" | "disabled" | null;
    rankingMode?: "quality" | "cost" | "speed" | "balanced" | null;
    maxCostPerRequest?: number | null;
    maxLatencyMs?: number | null;
    requiredCapabilities?: string[] | null;
    requiredHealth?: "healthy" | "not_unavailable" | null;
  }) => void,
  onSaveConfig?: () => void,
  onDuplicatePolicy?: (policy: RoutingPolicy) => void,
  onUpdatePolicyStatus?: (policyId: string, nextStatus: "active" | "draft" | "disabled") => void,
) {
  if (!routingPanelState || !selectedPolicy) {
    return html``;
  }
  const panelTitle =
    routingPanelState.kind === "chain"
      ? "Routing Chain Viewer"
      : routingPanelState.kind === "explanation"
        ? "Decision Explanation"
        : routingPanelState.kind === "editor"
          ? "编辑路由策略"
          : routingPanelState.kind === "duplicate"
            ? "复制路由策略"
            : routingPanelState.kind === "status"
              ? routingPanelState.nextStatus === "active"
                ? "启用路由策略"
                : "禁用路由策略"
              : "Conflicts / Warnings";
  const panelSub =
    routingPanelState.kind === "chain"
      ? "从任务画像到约束、排序、主模型、Fallback 与排除模型的完整决策链。"
      : routingPanelState.kind === "explanation"
        ? "解释系统为什么命中某个模型，以及哪些候选因为约束被拒绝。"
        : routingPanelState.kind === "editor"
          ? "当前策略已带入配置区，可直接调整主模型与 fallback 链并写回配置。"
          : routingPanelState.kind === "duplicate"
            ? "复制当前策略为新的 draft 配置，便于先编辑再落地。"
            : routingPanelState.kind === "status"
              ? "确认后会立即更新策略状态。"
              : "查看所有冲突项与建议动作。";
  const toggleTarget = routingPanelState.kind === "status" ? routingPanelState.nextStatus : null;
  const conflicts = vm.conflicts;
  return html`
    <div
      class="platform-smart-routing-modal-overlay"
      role="dialog"
      aria-modal="true"
      @click=${closeRoutingPanel}
    >
      <section
        class="platform-smart-routing-modal"
        @click=${(event: Event) => event.stopPropagation()}
      >
        <div class="platform-smart-routing-modal__header">
          <div>
            <div class="platform-smart-routing-modal__title">${panelTitle}</div>
            <div class="platform-smart-routing-modal__sub">${panelSub}</div>
          </div>
          <button class="btn btn--sm" type="button" @click=${closeRoutingPanel}>关闭</button>
        </div>
        <div class="platform-smart-routing-modal__body">
          ${
            routingPanelState.kind === "chain"
              ? html`
                  <div class="list">
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">任务画像</div>
                        <div class="list-sub">${selectedPolicy.taskProfileId}</div>
                      </div>
                    </div>
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">约束条件</div>
                        <div class="list-sub">
                          ${
                            [
                              selectedPolicy.constraints.maxCostPerRequest != null
                                ? `成本 ≤ $${selectedPolicy.constraints.maxCostPerRequest}`
                                : null,
                              selectedPolicy.constraints.maxLatencyMs != null
                                ? `延迟 ≤ ${selectedPolicy.constraints.maxLatencyMs}ms`
                                : null,
                              selectedPolicy.constraints.requiredCapabilities?.length
                                ? `能力 ${selectedPolicy.constraints.requiredCapabilities.join(", ")}`
                                : null,
                              selectedPolicy.constraints.requiredHealth
                                ? `健康 ${selectedPolicy.constraints.requiredHealth}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "无"
                          }
                        </div>
                      </div>
                    </div>
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">排序方式</div>
                        <div class="list-sub">${rankingModeLabel(selectedPolicy.ranking.mode)}</div>
                      </div>
                    </div>
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">主模型候选</div>
                        <div class="list-sub">
                          ${selectedPolicy.candidates.primary.join(", ") || "未配置"}
                        </div>
                      </div>
                    </div>
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">Fallback 链</div>
                        <div class="list-sub">
                          ${fallbackChainLabel(selectedPolicy.candidates.fallback)}
                        </div>
                      </div>
                    </div>
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">排除模型</div>
                        <div class="list-sub">
                          ${selectedPolicy.candidates.excluded?.join(", ") || "无"}
                        </div>
                      </div>
                    </div>
                  </div>
                `
              : routingPanelState.kind === "explanation"
                ? html`
                    <div class="list">
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">请求 ID</div>
                          <div class="list-sub">
                            ${selectedExplanation?.requestId ?? "未找到解释"}
                          </div>
                        </div>
                      </div>
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">命中结果</div>
                          <div class="list-sub">
                            ${selectedExplanation?.selectedModelId ?? "未命中"}
                          </div>
                        </div>
                      </div>
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">命中原因</div>
                          <div class="list-sub">
                            ${selectedExplanation?.decisionReason ?? "暂无"}
                          </div>
                        </div>
                      </div>
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">匹配规则</div>
                          <div class="list-sub">
                            ${selectedExplanation?.matchedRules.join("；") || "无"}
                          </div>
                        </div>
                      </div>
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">被拒绝模型</div>
                          <div class="list-sub">
                            ${
                              selectedExplanation?.rejectedModels.length
                                ? selectedExplanation.rejectedModels
                                    .map((item) => `${item.modelId}：${item.reason}`)
                                    .join("；")
                                : "无"
                            }
                          </div>
                        </div>
                      </div>
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">Fallback 链</div>
                          <div class="list-sub">
                            ${selectedExplanation ? fallbackChainLabel(selectedExplanation.fallbackChain) : "无"}
                          </div>
                        </div>
                      </div>
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">约束快照</div>
                          <div class="list-sub">
                            ${
                              selectedExplanation
                                ? [
                                    selectedExplanation.constraintsSnapshot?.maxCostPerRequest !=
                                    null
                                      ? `成本 ≤ $${selectedExplanation.constraintsSnapshot.maxCostPerRequest}`
                                      : null,
                                    selectedExplanation.constraintsSnapshot?.maxLatencyMs != null
                                      ? `延迟 ≤ ${selectedExplanation.constraintsSnapshot.maxLatencyMs}ms`
                                      : null,
                                    selectedExplanation.constraintsSnapshot?.requiredCapabilities
                                      ?.length
                                      ? `能力 ${selectedExplanation.constraintsSnapshot.requiredCapabilities.join(", ")}`
                                      : null,
                                    selectedExplanation.constraintsSnapshot?.requiredHealth
                                      ? `健康 ${selectedExplanation.constraintsSnapshot.requiredHealth}`
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ") || "无"
                                : "无"
                            }
                          </div>
                        </div>
                      </div>
                    </div>
                  `
                : routingPanelState.kind === "editor"
                  ? renderRoutingAutofillPanel(
                      selectedPolicy,
                      context,
                      compat,
                      onNavigateTab,
                      onSetDefaultPrimary,
                      onSetDefaultFallbacks,
                      onSetDefaultImagePrimary,
                      onUpsertRoutingPolicyConfig,
                      onSaveConfig,
                    )
                  : routingPanelState.kind === "duplicate"
                    ? html`
                        <div class="list">
                          <div class="list-item">
                            <div class="list-main">
                              <div class="list-title">源策略</div>
                              <div class="list-sub">${selectedPolicy.name}</div>
                            </div>
                          </div>
                          <div class="list-item">
                            <div class="list-main">
                              <div class="list-title">当前主模型</div>
                              <div class="list-sub">
                                ${selectedPolicy.candidates.primary.join(", ") || "未配置"}
                              </div>
                            </div>
                          </div>
                          <div class="list-item">
                            <div class="list-main">
                              <div class="list-title">当前 Fallback</div>
                              <div class="list-sub">
                                ${fallbackChainLabel(selectedPolicy.candidates.fallback)}
                              </div>
                            </div>
                          </div>
                        </div>
                      `
                    : routingPanelState.kind === "status"
                      ? html`
                          <div class="callout">
                            将把 <strong>${selectedPolicy.name}</strong> 的状态更新为
                            <strong>${toggleTarget}</strong>。
                          </div>
                        `
                      : html`
                          <div class="list">
                            ${conflicts.map(
                              (conflict) => html`
                                <div class="list-item">
                                  <div class="list-main">
                                    <div class="list-title">${conflict.policyId}</div>
                                    <div class="list-sub">
                                      ${conflict.reason}
                                      ${
                                        conflict.relatedPolicyIds?.length
                                          ? html`<div class="card-follow--xs">
                                              关联策略：${conflict.relatedPolicyIds.join(", ")}
                                            </div>`
                                          : ""
                                      }
                                      ${
                                        conflict.suggestedAction
                                          ? html`<div class="card-follow--xs">
                                              建议：${conflict.suggestedAction}
                                            </div>`
                                          : ""
                                      }
                                    </div>
                                  </div>
                                </div>
                              `,
                            )}
                          </div>
                        `
          }
        </div>
        <div class="platform-smart-routing-modal__footer">
          <button class="btn btn--sm" type="button" @click=${closeRoutingPanel}>取消</button>
          ${
            routingPanelState.kind === "duplicate"
              ? html`<button
                  class="btn btn--primary"
                  type="button"
                  ?disabled=${!onDuplicatePolicy}
                  @click=${() => {
                    onDuplicatePolicy?.(selectedPolicy);
                    closeRoutingPanel();
                  }}
                >
                  复制策略
                </button>`
              : routingPanelState.kind === "status"
                ? html`<button
                    class="btn btn--primary"
                    type="button"
                    ?disabled=${!onUpdatePolicyStatus || !toggleTarget}
                    @click=${() => {
                      if (toggleTarget) {
                        onUpdatePolicyStatus?.(selectedPolicy.policyId, toggleTarget);
                      }
                      closeRoutingPanel();
                    }}
                  >
                    确认${toggleTarget === "active" ? "启用" : "禁用"}
                  </button>`
                : html`<button class="btn btn--primary" type="button" @click=${closeRoutingPanel}>
                    完成
                  </button>`
          }
        </div>
      </section>
    </div>
  `;
}

function resetRoutingFilters(defaultSort: ModelRoutingVM["defaultSort"]) {
  routingFilterState = {
    ...DEFAULT_ROUTING_FILTER_STATE,
    sortField: defaultSort.field,
    sortDirection: defaultSort.direction,
  };
  requestRerender();
}

function scopeLabel(policy: RoutingPolicy) {
  const parts: string[] = [];
  if ((policy.scope.tenantIds?.length ?? 0) > 0) {
    parts.push(`租户：${policy.scope.tenantIds?.length ?? 0} 个`);
  }
  if ((policy.scope.userSegments?.length ?? 0) > 0) {
    parts.push(`用户分组：${policy.scope.userSegments?.length ?? 0} 个`);
  }
  if ((policy.scope.agentIds?.length ?? 0) > 0) {
    parts.push(`Agent：${policy.scope.agentIds?.length ?? 0} 个`);
  }
  return parts.length > 0 ? parts.join(" · ") : "平台默认";
}

function rankingModeLabel(mode: RoutingPolicy["ranking"]["mode"]) {
  switch (mode) {
    case "quality":
      return "质量优先";
    case "cost":
      return "成本优先";
    case "speed":
      return "速度优先";
    default:
      return "平衡优先";
  }
}

function resolveScopeType(policy: RoutingPolicy): "platform" | "tenant" | "userSegment" | "agent" {
  if ((policy.scope.tenantIds?.length ?? 0) > 0) {
    return "tenant";
  }
  if ((policy.scope.userSegments?.length ?? 0) > 0) {
    return "userSegment";
  }
  if ((policy.scope.agentIds?.length ?? 0) > 0) {
    return "agent";
  }
  return "platform";
}

function routingActionHint(context?: PlatformModelsTabContext) {
  if (!context?.actionHint) {
    return "";
  }
  const source = context.sourceModelId ? `，当前问题模型 ${context.sourceModelId}` : "";
  const suggestion = context.suggestedModelId ? `，建议优先评估 ${context.suggestedModelId}` : "";
  if (context.actionHint === "replace_model") {
    return `当前从 Issues 跳转而来：请优先更换当前主模型${source}${suggestion}。`;
  }
  if (context.actionHint === "add_fallback") {
    return `当前从 Issues 跳转而来：请优先补充 fallback${source}${suggestion}。`;
  }
  return `当前从 Issues 跳转而来：请优先调整当前策略权重或约束${suggestion}。`;
}

function renderRoutingAutofillPanel(
  policy: RoutingPolicy | null,
  context: PlatformModelsTabContext | undefined,
  compat: LegacyPlatformModelsVM | null | undefined,
  onNavigateTab: (tab: SmartRoutingNavigateTab, context?: PlatformModelsTabContext) => void,
  onSetDefaultPrimary?: (modelRef: string | null) => void,
  onSetDefaultFallbacks?: (fallbacks: string[]) => void,
  onSetDefaultImagePrimary?: (modelRef: string | null) => void,
  onUpsertRoutingPolicyConfig?: (input: {
    policyId: string;
    taskProfileId?: string | null;
    planId?: string | null;
    primaryModelIds: string[];
    fallbackModelIds: string[];
  }) => void,
  onSaveConfig?: () => void,
) {
  const manualEditorOpen = policy ? routingEditorOpenPolicyId === policy.policyId : false;
  if (!policy || (!context?.actionHint && !manualEditorOpen)) {
    return html``;
  }
  const submitTarget = resolveRoutingSubmitTarget(policy);
  const suggestedModelId = context?.suggestedModelId;
  return html`
    <section id="platform-smart-routing-editor" class="card card-follow">
      <div class="card-title">${context?.actionHint ? "已自动填充修复建议" : "编辑路由策略"}</div>
      ${
        context?.actionHint
          ? html`
              <div class="grid grid-cols-2 card-follow">
                <section class="card">
                  <div class="card-title">当前策略</div>
                  <div class="list card-follow">
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">策略名称</div>
                        <div class="list-sub">${policy.name}</div>
                      </div>
                    </div>
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">主模型</div>
                        <div class="list-sub">
                          ${policy.candidates.primary.join(", ") || "未配置"}
                        </div>
                      </div>
                    </div>
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">Fallback</div>
                        <div class="list-sub">
                          ${policy.candidates.fallback.join(" → ") || "缺少 fallback"}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
                <section class="card">
                  <div class="card-title">建议变更</div>
                  <div class="list card-follow">
                    ${
                      context.sourceModelId
                        ? html`<div class="list-item">
                            <div class="list-main">
                              <div class="list-title">问题模型</div>
                              <div class="list-sub">${context.sourceModelId}</div>
                            </div>
                          </div>`
                        : ""
                    }
                    ${
                      suggestedModelId
                        ? html`<div class="list-item list-item-selected">
                            <div class="list-main">
                              <div class="list-title">
                                ${context.actionHint === "add_fallback" ? "建议 fallback" : "建议主模型"}
                              </div>
                              <div class="list-sub">${suggestedModelId}</div>
                            </div>
                            <span class="chip ok">已预填</span>
                          </div>`
                        : ""
                    }
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">建议动作</div>
                        <div class="list-sub">
                          ${context.actionHint === "add_fallback" ? "将建议模型加入 fallback 链" : context.actionHint === "replace_model" ? "将建议模型评估为新的主模型" : "优先调整成本、延迟或健康约束"}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            `
          : ""
      }
      <section class="card card-follow">
        <div class="card-title">提交到平台默认配置</div>
        <div class="card-sub">
          ${
            submitTarget === "text-default"
              ? "当前可直接提交到平台默认文本路由配置。这会影响默认文本任务的主模型与 fallback，不是单条策略私有配置。"
              : submitTarget === "image-default"
                ? "当前可直接提交到平台默认图片模型配置。这会影响默认图片生成主模型，不是单条策略私有配置。"
                : submitTarget === "dedicated"
                  ? "当前可直接提交到独立 RoutingPolicy 配置源。这会覆盖当前策略的主模型与 fallback，不再依赖推导结果。"
                  : "当前策略仍是推导层。若要真正提交，需要先补齐独立 RoutingPolicy 配置模型。"
          }
        </div>
        ${
          submitTarget === "text-default"
            ? html`
                <div class="grid grid-cols-2 card-follow">
                  <label class="field">
                    <span>平台默认主模型</span>
                    <input
                      .value=${routingEditorState.primaryModel}
                      @input=${(event: Event) =>
                        updateRoutingEditor({
                          primaryModel:
                            event.currentTarget instanceof HTMLInputElement
                              ? event.currentTarget.value
                              : "",
                        })}
                    />
                  </label>
                  <label class="field">
                    <span>平台默认 fallback（每行一个）</span>
                    <textarea
                      rows="4"
                      @input=${(event: Event) =>
                        updateRoutingEditor({
                          fallbackModels:
                            event.currentTarget instanceof HTMLTextAreaElement
                              ? event.currentTarget.value
                              : "",
                        })}
                    >
${routingEditorState.fallbackModels}</textarea>
                  </label>
                </div>
                <div class="row row--tight card-follow row--wrap">
                  <button
                    class="btn btn--primary"
                    type="button"
                    ?disabled=${!onSetDefaultPrimary}
                    title=${onSetDefaultPrimary ? "" : "写入能力待接入"}
                    @click=${() => onSetDefaultPrimary?.(routingEditorState.primaryModel.trim() || null)}
                  >
                    应用主模型
                  </button>
                  <button
                    class="btn btn--sm"
                    type="button"
                    ?disabled=${!onSetDefaultFallbacks}
                    title=${onSetDefaultFallbacks ? "" : "写入能力待接入"}
                    @click=${() =>
                      onSetDefaultFallbacks?.(
                        dedupeModelRefs(routingEditorState.fallbackModels.split(/\n|,/g)),
                      )}
                  >
                    应用 fallback
                  </button>
                  ${
                    compat
                      ? html`
                          <span class="chip ${compat.configDirty ? "warn" : ""}">
                            ${compat.configDirty ? "有未保存配置" : "配置已同步"}
                          </span>
                          <button
                            class="btn btn--sm"
                            type="button"
                            ?disabled=${!onSaveConfig || !compat.canManage || !compat.configDirty || compat.configSaving}
                            @click=${() => onSaveConfig?.()}
                          >
                            ${compat.configSaving ? "保存中" : "保存配置"}
                          </button>
                        `
                      : ""
                  }
                </div>
              `
            : submitTarget === "image-default"
              ? html`
                  <div class="grid grid-cols-2 card-follow">
                    <label class="field">
                      <span>平台默认图片主模型</span>
                      <input
                        .value=${routingEditorState.primaryModel}
                        @input=${(event: Event) =>
                          updateRoutingEditor({
                            primaryModel:
                              event.currentTarget instanceof HTMLInputElement
                                ? event.currentTarget.value
                                : "",
                          })}
                      />
                    </label>
                  </div>
                  <div class="row row--tight card-follow row--wrap">
                    <button
                      class="btn btn--primary"
                      type="button"
                      ?disabled=${!onSetDefaultImagePrimary}
                      title=${onSetDefaultImagePrimary ? "" : "写入能力待接入"}
                      @click=${() => onSetDefaultImagePrimary?.(routingEditorState.primaryModel.trim() || null)}
                    >
                      应用图片主模型
                    </button>
                    ${
                      compat
                        ? html`
                            <span class="chip ${compat.configDirty ? "warn" : ""}">
                              ${compat.configDirty ? "有未保存配置" : "配置已同步"}
                            </span>
                            <button
                              class="btn btn--sm"
                              type="button"
                              ?disabled=${!onSaveConfig || !compat.canManage || !compat.configDirty || compat.configSaving}
                              @click=${() => onSaveConfig?.()}
                            >
                              ${compat.configSaving ? "保存中" : "保存配置"}
                            </button>
                          `
                        : ""
                    }
                  </div>
                `
              : submitTarget === "dedicated"
                ? html`
                    <div class="grid grid-cols-2 card-follow">
                      <label class="field">
                        <span>策略主模型</span>
                        <input
                          .value=${routingEditorState.primaryModel}
                          @input=${(event: Event) =>
                            updateRoutingEditor({
                              primaryModel:
                                event.currentTarget instanceof HTMLInputElement
                                  ? event.currentTarget.value
                                  : "",
                            })}
                        />
                      </label>
                      <label class="field">
                        <span>策略 fallback（每行一个）</span>
                        <textarea
                          rows="4"
                          @input=${(event: Event) =>
                            updateRoutingEditor({
                              fallbackModels:
                                event.currentTarget instanceof HTMLTextAreaElement
                                  ? event.currentTarget.value
                                  : "",
                            })}
                        >
${routingEditorState.fallbackModels}</textarea>
                      </label>
                    </div>
                    <div class="row row--tight card-follow row--wrap">
                      <button
                        class="btn btn--primary"
                        type="button"
                        ?disabled=${!onUpsertRoutingPolicyConfig}
                        title=${onUpsertRoutingPolicyConfig ? "" : "写入能力待接入"}
                        @click=${() =>
                          onUpsertRoutingPolicyConfig?.({
                            policyId: policy.policyId,
                            taskProfileId: policy.taskProfileId,
                            planId: policy.planId,
                            primaryModelIds: dedupeModelRefs([routingEditorState.primaryModel]),
                            fallbackModelIds: dedupeModelRefs(
                              routingEditorState.fallbackModels.split(/\n|,/g),
                            ),
                          })}
                      >
                        应用到路由策略
                      </button>
                      ${
                        compat
                          ? html`
                              <span class="chip ${compat.configDirty ? "warn" : ""}">
                                ${compat.configDirty ? "有未保存配置" : "配置已同步"}
                              </span>
                              <button
                                class="btn btn--sm"
                                type="button"
                                ?disabled=${!onSaveConfig || !compat.canManage || !compat.configDirty || compat.configSaving}
                                @click=${() => onSaveConfig?.()}
                              >
                                ${compat.configSaving ? "保存中" : "保存配置"}
                              </button>
                            `
                          : ""
                      }
                    </div>
                  `
                : html`
                    <div class="callout card-follow">
                      当前策略暂无独立持久化配置源。建议先完成评估，再通过平台默认模型配置落地。
                    </div>
                  `
        }
      </section>
      <div class="row row--tight card-follow row--wrap">
        ${
          suggestedModelId
            ? html`
                <button
                  class="btn btn--sm"
                  type="button"
                  @click=${() =>
                    onNavigateTab("modelAssets", {
                      modelId: suggestedModelId,
                      ...(context?.sourceModelId ? { sourceModelId: context.sourceModelId } : {}),
                      suggestedModelId,
                      ...(context?.actionHint ? { actionHint: context.actionHint } : {}),
                    })}
                >
                  查看建议模型
                </button>
              `
            : ""
        }
        <button
          class="btn btn--sm"
          type="button"
          @click=${() =>
            onNavigateTab("usageAnalytics", {
              ...(context?.sourceModelId ? { modelId: context.sourceModelId } : {}),
              ...(context?.planId || policy.planId
                ? { planId: context?.planId ?? policy.planId }
                : {}),
              ...(context?.taskProfileId || policy.taskProfileId
                ? { taskProfileId: context?.taskProfileId ?? policy.taskProfileId }
                : {}),
            })}
        >
          查看影响数据
        </button>
      </div>
    </section>
  `;
}

function fallbackChainLabel(modelIds: string[]) {
  return modelIds.length > 0 ? modelIds.join(" → ") : "缺少 fallback";
}

function modelListLabel(modelIds: string[]) {
  if (modelIds.length === 0) {
    return "未配置";
  }
  const visible = modelIds.slice(0, 2);
  return `${visible.join(", ")}${modelIds.length > 2 ? ` +${modelIds.length - 2}` : ""}`;
}

function dedupeModelRefs(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function resolveRoutingSubmitTarget(policy: RoutingPolicy) {
  if (policy.taskProfileId === "general_text") {
    return "text-default" as const;
  }
  if (policy.taskProfileId === "image_generation") {
    return "image-default" as const;
  }
  return "dedicated" as const;
}

function syncRoutingEditor(
  policy: RoutingPolicy | null,
  context: PlatformModelsTabContext | undefined,
  compat: LegacyPlatformModelsVM | null | undefined,
) {
  if (!policy) {
    return;
  }
  const submitTarget = resolveRoutingSubmitTarget(policy);
  const nextKey = JSON.stringify({
    policyId: policy.policyId,
    submitTarget,
    actionHint: context?.actionHint ?? "",
    suggestedModelId: context?.suggestedModelId ?? "",
    routingPrimary: compat?.routingPrimary ?? "",
    routingImagePrimary: compat?.routingImagePrimary ?? "",
    routingFallbacks: compat?.routingFallbacks ?? [],
  });
  if (nextKey === routingEditorKey) {
    return;
  }
  routingEditorKey = nextKey;
  if (submitTarget === "image-default") {
    routingEditorState = {
      primaryModel:
        (context?.actionHint === "replace_model" && context.suggestedModelId) ||
        compat?.routingImagePrimary ||
        policy.candidates.primary[0] ||
        "",
      fallbackModels: "",
    };
    return;
  }
  if (submitTarget === "dedicated") {
    routingEditorState = {
      primaryModel:
        (context?.actionHint === "replace_model" && context.suggestedModelId) ||
        policy.candidates.primary[0] ||
        "",
      fallbackModels: dedupeModelRefs([
        ...policy.candidates.fallback,
        ...(context?.actionHint === "add_fallback" && context.suggestedModelId
          ? [context.suggestedModelId]
          : []),
      ]).join("\n"),
    };
    return;
  }
  routingEditorState = {
    primaryModel:
      (context?.actionHint === "replace_model" && context.suggestedModelId) ||
      compat?.routingPrimary ||
      policy.candidates.primary[0] ||
      "",
    fallbackModels: dedupeModelRefs([
      ...(compat?.routingFallbacks ?? policy.candidates.fallback),
      ...(context?.actionHint === "add_fallback" && context.suggestedModelId
        ? [context.suggestedModelId]
        : []),
    ]).join("\n"),
  };
}

function comparePolicies(
  left: RoutingPolicy,
  right: RoutingPolicy,
  field: ModelRoutingVM["defaultSort"]["field"],
) {
  switch (field) {
    case "status":
      return left.status.localeCompare(right.status);
    case "fallbackRate":
      return (left.performance?.fallbackRate ?? -1) - (right.performance?.fallbackRate ?? -1);
    case "primaryHitRate":
      return (left.performance?.primaryHitRate ?? -1) - (right.performance?.primaryHitRate ?? -1);
    case "updatedAt":
      return (left.updatedAt ?? 0) - (right.updatedAt ?? 0);
    default:
      return left.name.localeCompare(right.name);
  }
}

function matchesRoutingFilters(policy: RoutingPolicy, conflictIds: Set<string>) {
  const search = routingFilterState.search.trim().toLowerCase();
  if (search) {
    const haystacks = [policy.name, policy.policyId, policy.taskProfileId, policy.planId ?? ""].map(
      (value) => value.toLowerCase(),
    );
    if (!haystacks.some((value) => value.includes(search))) {
      return false;
    }
  }
  if (
    routingFilterState.taskProfileId &&
    policy.taskProfileId !== routingFilterState.taskProfileId
  ) {
    return false;
  }
  if (routingFilterState.planId && (policy.planId ?? "") !== routingFilterState.planId) {
    return false;
  }
  if (routingFilterState.status && policy.status !== routingFilterState.status) {
    return false;
  }
  if (routingFilterState.rankingMode && policy.ranking.mode !== routingFilterState.rankingMode) {
    return false;
  }
  if (routingFilterState.scopeType && resolveScopeType(policy) !== routingFilterState.scopeType) {
    return false;
  }
  if (routingFilterState.missingFallback === "yes" && policy.candidates.fallback.length > 0) {
    return false;
  }
  if (routingFilterState.missingFallback === "no" && policy.candidates.fallback.length === 0) {
    return false;
  }
  if (routingFilterState.hasConflict === "yes" && !conflictIds.has(policy.policyId)) {
    return false;
  }
  if (routingFilterState.hasConflict === "no" && conflictIds.has(policy.policyId)) {
    return false;
  }
  return true;
}

function renderRoutingSummary(vm: ModelRoutingVM) {
  const cards = [
    {
      label: "策略总数",
      value: vm.summary.totalPolicies,
      onClick: () => resetRoutingFilters(vm.defaultSort),
    },
    {
      label: "活跃策略",
      value: vm.summary.activePolicies,
      onClick: () => updateRoutingFilters({ status: "active" }),
    },
    {
      label: "草稿策略",
      value: vm.summary.draftPolicies,
      onClick: () => updateRoutingFilters({ status: "draft" }),
    },
    {
      label: "禁用策略",
      value: vm.summary.disabledPolicies,
      onClick: () => updateRoutingFilters({ status: "disabled" }),
    },
    {
      label: "缺少 fallback",
      value: vm.summary.policiesMissingFallback,
      onClick: () => updateRoutingFilters({ missingFallback: "yes" }),
    },
    {
      label: "冲突数",
      value: vm.summary.conflictsCount,
      onClick: () => updateRoutingFilters({ hasConflict: "yes" }),
    },
    {
      label: "平均主命中率",
      value:
        vm.summary.averagePrimaryHitRate != null
          ? `${vm.summary.averagePrimaryHitRate}%`
          : "未接入",
      onClick: () => requestRerender(),
    },
    {
      label: "平均回退率",
      value:
        vm.summary.averageFallbackRate != null ? `${vm.summary.averageFallbackRate}%` : "未接入",
      onClick: () => requestRerender(),
    },
    {
      label: "人工改配率",
      value: vm.summary.manualOverrideRate != null ? `${vm.summary.manualOverrideRate}%` : "未接入",
      onClick: () => requestRerender(),
    },
  ];
  return html`
    <div class="stat-grid stat-grid--compact card-follow">
      ${cards.map(
        (card) => html`
          <button class="stat stat--compact" type="button" @click=${card.onClick}>
            <div class="stat-label">${card.label}</div>
            <div class="stat-value">${card.value}</div>
          </button>
        `,
      )}
    </div>
  `;
}

function renderRoutingFilterBar(vm: ModelRoutingVM, resultCount: number) {
  return html`
    <section class="card card-follow">
      <div class="row row--split row--top">
        <div>
          <div class="card-title">筛选与排序</div>
        </div>
        <div class="row row--tight row--wrap">
          <span class="chip">当前结果 ${resultCount}</span>
          <button
            class="btn btn--sm"
            type="button"
            @click=${() => resetRoutingFilters(vm.defaultSort)}
          >
            清空筛选
          </button>
        </div>
      </div>
      <div class="grid grid-cols-3 card-follow">
        <label class="field">
          <span>搜索</span>
          <input
            .value=${routingFilterState.search}
            placeholder="策略名称 / taskProfile / plan"
            @input=${(event: Event) =>
              updateRoutingFilters({
                search:
                  event.currentTarget instanceof HTMLInputElement ? event.currentTarget.value : "",
              })}
          />
        </label>
        <label class="field">
          <span>任务画像</span>
          <select
            .value=${routingFilterState.taskProfileId}
            @change=${(event: Event) =>
              updateRoutingFilters({
                taskProfileId:
                  event.currentTarget instanceof HTMLSelectElement ? event.currentTarget.value : "",
              })}
          >
            <option value="">全部</option>
            ${vm.filters.taskProfileIds.map(
              (taskProfileId) => html`<option value=${taskProfileId}>${taskProfileId}</option>`,
            )}
          </select>
        </label>
        <label class="field">
          <span>任务方案</span>
          <select
            .value=${routingFilterState.planId}
            @change=${(event: Event) =>
              updateRoutingFilters({
                planId:
                  event.currentTarget instanceof HTMLSelectElement ? event.currentTarget.value : "",
              })}
          >
            <option value="">全部</option>
            ${vm.filters.planIds.map((planId) => html`<option value=${planId}>${planId}</option>`)}
          </select>
        </label>
        <label class="field">
          <span>状态</span>
          <select
            .value=${routingFilterState.status}
            @change=${(event: Event) =>
              updateRoutingFilters({
                status:
                  event.currentTarget instanceof HTMLSelectElement
                    ? (event.currentTarget.value as RoutingFilterState["status"])
                    : "",
              })}
          >
            <option value="">全部</option>
            ${vm.filters.statuses.map((status) => html`<option value=${status}>${status}</option>`)}
          </select>
        </label>
        <label class="field">
          <span>优先模式</span>
          <select
            .value=${routingFilterState.rankingMode}
            @change=${(event: Event) =>
              updateRoutingFilters({
                rankingMode:
                  event.currentTarget instanceof HTMLSelectElement
                    ? (event.currentTarget.value as RoutingFilterState["rankingMode"])
                    : "",
              })}
          >
            <option value="">全部</option>
            ${vm.filters.rankingModes.map(
              (mode) => html`<option value=${mode}>${rankingModeLabel(mode)}</option>`,
            )}
          </select>
        </label>
        <label class="field">
          <span>作用范围</span>
          <select
            .value=${routingFilterState.scopeType}
            @change=${(event: Event) =>
              updateRoutingFilters({
                scopeType:
                  event.currentTarget instanceof HTMLSelectElement
                    ? (event.currentTarget.value as RoutingFilterState["scopeType"])
                    : "",
              })}
          >
            <option value="">全部</option>
            ${vm.filters.scopeTypes.map((scopeType) => html`<option value=${scopeType}>${scopeType}</option>`)}
          </select>
        </label>
        <label class="field">
          <span>Fallback</span>
          <select
            .value=${routingFilterState.missingFallback}
            @change=${(event: Event) =>
              updateRoutingFilters({
                missingFallback:
                  event.currentTarget instanceof HTMLSelectElement
                    ? (event.currentTarget.value as RoutingFilterState["missingFallback"])
                    : "all",
              })}
          >
            <option value="all">全部</option>
            <option value="yes">缺少 fallback</option>
            <option value="no">fallback 完整</option>
          </select>
        </label>
        <label class="field">
          <span>冲突</span>
          <select
            .value=${routingFilterState.hasConflict}
            @change=${(event: Event) =>
              updateRoutingFilters({
                hasConflict:
                  event.currentTarget instanceof HTMLSelectElement
                    ? (event.currentTarget.value as RoutingFilterState["hasConflict"])
                    : "all",
              })}
          >
            <option value="all">全部</option>
            <option value="yes">有冲突</option>
            <option value="no">无冲突</option>
          </select>
        </label>
        <label class="field">
          <span>排序</span>
          <select
            .value=${routingFilterState.sortField}
            @change=${(event: Event) =>
              updateRoutingFilters({
                sortField:
                  event.currentTarget instanceof HTMLSelectElement
                    ? (event.currentTarget.value as ModelRoutingVM["defaultSort"]["field"])
                    : vm.defaultSort.field,
              })}
          >
            <option value="updatedAt">最近更新</option>
            <option value="name">策略名称</option>
            <option value="status">状态</option>
            <option value="primaryHitRate">主命中率</option>
            <option value="fallbackRate">回退率</option>
          </select>
        </label>
      </div>
    </section>
  `;
}

export type SmartRoutingSectionProps = {
  vm: ModelRoutingVM;
  onNavigateTab: (tab: SmartRoutingNavigateTab, context?: PlatformModelsTabContext) => void;
  context?: PlatformModelsTabContext;
  compat?: LegacyPlatformModelsVM | null;
  onEditPolicy?: (policyId: string) => void;
  onDuplicatePolicy?: (policy: RoutingPolicy) => void;
  onUpdatePolicyStatus?: (policyId: string, nextStatus: "active" | "draft" | "disabled") => void;
  onSimulateRouting?: (input: {
    taskProfileId: string;
    planId?: string;
    sampleInput?: string;
  }) => void;
  onSetDefaultPrimary?: (modelRef: string | null) => void;
  onSetDefaultFallbacks?: (fallbacks: string[]) => void;
  onSetDefaultImagePrimary?: (modelRef: string | null) => void;
  onUpsertRoutingPolicyConfig?: (input: {
    policyId: string;
    name?: string | null;
    taskProfileId?: string | null;
    planId?: string | null;
    primaryModelIds: string[];
    fallbackModelIds: string[];
    status?: "active" | "draft" | "disabled" | null;
    rankingMode?: "quality" | "cost" | "speed" | "balanced" | null;
    maxCostPerRequest?: number | null;
    maxLatencyMs?: number | null;
    requiredCapabilities?: string[] | null;
    requiredHealth?: "healthy" | "not_unavailable" | null;
  }) => void;
  onSaveConfig?: () => void;
};

export function renderSmartRoutingSection(props: SmartRoutingSectionProps) {
  const {
    vm,
    onNavigateTab,
    context,
    compat,
    onEditPolicy,
    onDuplicatePolicy,
    onUpdatePolicyStatus,
    onSimulateRouting,
    onSetDefaultPrimary,
    onSetDefaultFallbacks,
    onSetDefaultImagePrimary,
    onUpsertRoutingPolicyConfig,
    onSaveConfig,
  } = props;
  ensureRoutingDefaults(vm.defaultSort);
  syncRoutingContext(context);
  if (vm.emptyState) {
    return html`
      <section class="card">
        <div class="card-title">${vm.emptyState.title}</div>
        <div class="card-sub">${vm.emptyState.description}</div>
        <div class="row row--tight card-follow">
          <button class="btn btn--primary" type="button" @click=${() => onNavigateTab("taskPlans")}>
            ${vm.emptyState.primaryActionLabel ?? "前往任务方案"}
          </button>
        </div>
      </section>
    `;
  }

  const conflictIds = new Set(vm.conflicts.map((conflict) => conflict.policyId));
  const filteredPolicies = vm.policies
    .filter((policy) => matchesRoutingFilters(policy, conflictIds))
    .toSorted((left, right) => {
      const delta = comparePolicies(left, right, routingFilterState.sortField);
      return routingFilterState.sortDirection === "asc" ? delta : -delta;
    });
  const selectedPolicy =
    filteredPolicies.find((policy) => policy.policyId === routingFilterState.selectedPolicyId) ??
    vm.policies.find((policy) => policy.policyId === routingFilterState.selectedPolicyId) ??
    filteredPolicies[0] ??
    vm.policies[0] ??
    null;
  const selectedExplanation =
    vm.explanations.find(
      (explanation) => explanation.requestId === routingFilterState.selectedExplanationId,
    ) ??
    vm.explanations.find(
      (explanation) =>
        explanation.taskProfileId === selectedPolicy?.taskProfileId &&
        (!selectedPolicy?.planId || explanation.planId === selectedPolicy.planId),
    ) ??
    vm.explanations[0] ??
    null;
  syncRoutingEditor(selectedPolicy, context, compat);

  return html`
    <section class="card">
      <div class="row row--split row--top">
        <div>
          <div class="card-title">智能路由中心</div>
        </div>
        <div class="row row--tight row--wrap">
          <button class="btn btn--sm" type="button" @click=${() => onNavigateTab("taskPlans")}>
            前往任务方案
          </button>
          <button class="btn btn--sm" type="button" @click=${() => onNavigateTab("usageAnalytics")}>
            查看使用分析
          </button>
          <button
            class="btn btn--primary"
            type="button"
            ?disabled=${!onSimulateRouting || !selectedPolicy}
            title=${onSimulateRouting && selectedPolicy ? "" : "模拟能力待接入"}
            @click=${() =>
              selectedPolicy
                ? onSimulateRouting?.({
                    taskProfileId: selectedPolicy.taskProfileId,
                    planId: selectedPolicy.planId,
                  })
                : undefined}
          >
            模拟请求
          </button>
          <button class="btn btn--sm" type="button" @click=${openRoutingConflicts}>查看告警</button>
        </div>
      </div>
      ${renderRoutingSummary(vm)}
    </section>
    ${
      context?.actionHint
        ? html`<section class="card card-follow">
            <div class="callout">${routingActionHint(context)}</div>
          </section>`
        : ""
    }
    ${renderRoutingAutofillPanel(
      selectedPolicy,
      context,
      compat,
      onNavigateTab,
      onSetDefaultPrimary,
      onSetDefaultFallbacks,
      onSetDefaultImagePrimary,
      onUpsertRoutingPolicyConfig,
      onSaveConfig,
    )}
    ${renderRoutingFilterBar(vm, filteredPolicies.length)}
    <section class="card platform-smart-routing-list card-follow">
      <div class="card-title">Routing Policy List</div>
      <div class="enterprise-data-table-wrap platform-smart-routing-list__table-wrap">
        <table class="enterprise-data-table platform-smart-routing-list__table">
          <thead>
            <tr>
              <th class="col-name">策略名称</th>
              <th class="col-plan">任务方案</th>
              <th class="col-profile">任务画像</th>
              <th class="col-scope">作用范围</th>
              <th class="col-mode">优先模式</th>
              <th class="col-primary">主模型</th>
              <th class="col-fallback">Fallback 链</th>
              <th class="col-constraints">约束</th>
              <th class="col-performance">表现</th>
              <th class="col-status">状态</th>
              <th class="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            ${filteredPolicies.map((policy) => {
              const hasConflict = conflictIds.has(policy.policyId);
              return html`
                <tr>
                  <td class="col-name">
                    <div class="enterprise-data-table__strong">${policy.name}</div>
                    <div class="enterprise-data-table__sub">${policy.policyId}</div>
                  </td>
                  <td class="col-plan">${policy.planId ?? "未绑定方案"}</td>
                  <td class="col-profile">${policy.taskProfileId}</td>
                  <td class="col-scope">${scopeLabel(policy)}</td>
                  <td class="col-mode">${rankingModeLabel(policy.ranking.mode)}</td>
                  <td class="col-primary">${modelListLabel(policy.candidates.primary)}</td>
                  <td class="col-fallback">
                    <span
                      class="chip platform-smart-routing-list__fallback ${policy.candidates.fallback.length === 0 ? "warn" : ""}"
                    >
                      ${fallbackChainLabel(policy.candidates.fallback)}
                    </span>
                  </td>
                  <td class="col-constraints">
                    <div
                      class="enterprise-data-table__sub platform-smart-routing-list__constraints"
                    >
                      ${
                        [
                          policy.constraints.maxCostPerRequest != null
                            ? `成本 ≤ $${policy.constraints.maxCostPerRequest}`
                            : null,
                          policy.constraints.maxLatencyMs != null
                            ? `延迟 ≤ ${policy.constraints.maxLatencyMs}ms`
                            : null,
                          policy.constraints.requiredCapabilities?.length
                            ? `能力 ${policy.constraints.requiredCapabilities.join(", ")}`
                            : null,
                          policy.constraints.requiredHealth
                            ? `健康 ${policy.constraints.requiredHealth}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "无约束"
                      }
                    </div>
                  </td>
                  <td class="col-performance">
                    ${
                      policy.performance
                        ? html`
                            <div>
                              ${policy.performance.primaryHitRate != null ? `${policy.performance.primaryHitRate}% 主命中` : "未接入"}
                            </div>
                            <div class="enterprise-data-table__sub">
                              ${policy.performance.fallbackRate != null ? `${policy.performance.fallbackRate}% 回退` : ""}
                              ${policy.performance.avgLatencyMs != null ? ` · ${policy.performance.avgLatencyMs}ms` : ""}
                              ${
                                policy.performance.avgCostPerRequest != null
                                  ? ` · ${formatCost(policy.performance.avgCostPerRequest)}`
                                  : ""
                              }
                            </div>
                          `
                        : "未接入"
                    }
                  </td>
                  <td class="col-status">
                    <div>${policy.status}</div>
                    ${
                      hasConflict
                        ? html`
                            <div class="enterprise-data-table__sub">存在冲突</div>
                          `
                        : ""
                    }
                  </td>
                  <td class="col-actions">
                    <div class="platform-smart-routing-list__actions">
                      <button
                        class="btn btn--sm"
                        type="button"
                        @click=${() => openRoutingChain(policy)}
                      >
                        查看链路
                      </button>
                      <button
                        class="btn btn--sm"
                        type="button"
                        @click=${() =>
                          openRoutingExplanation(
                            policy,
                            vm.explanations.find(
                              (item) => item.taskProfileId === policy.taskProfileId,
                            )?.requestId ?? null,
                          )}
                      >
                        解释命中
                      </button>
                      <button
                        class="btn btn--sm"
                        type="button"
                        @click=${() => {
                          openRoutingEditor(policy);
                          onEditPolicy?.(policy.policyId);
                        }}
                      >
                        编辑
                      </button>
                      <button
                        class="btn btn--sm"
                        type="button"
                        ?disabled=${!onDuplicatePolicy}
                        title=${onDuplicatePolicy ? "" : "写入能力待接入"}
                        @click=${() => openRoutingDuplicate(policy)}
                      >
                        复制
                      </button>
                      <button
                        class="btn btn--sm"
                        type="button"
                        ?disabled=${!onUpdatePolicyStatus}
                        title=${onUpdatePolicyStatus ? "" : "写入能力待接入"}
                        @click=${() => openRoutingStatus(policy)}
                      >
                        ${policy.status === "active" ? "禁用" : "启用"}
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>
    </section>
    ${renderRoutingPanelModal(
      selectedPolicy,
      selectedExplanation,
      vm,
      context,
      compat,
      onNavigateTab,
      onSetDefaultPrimary,
      onSetDefaultFallbacks,
      onSetDefaultImagePrimary,
      onUpsertRoutingPolicyConfig,
      onSaveConfig,
      onDuplicatePolicy,
      onUpdatePolicyStatus,
    )}
  `;
}
