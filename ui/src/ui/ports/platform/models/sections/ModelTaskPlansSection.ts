import { html } from "lit";
import { formatCost } from "../../../../views/usage-metrics.ts";
import { requestPlatformSurfaceRerender } from "../../shared/surface.ts";
import type {
  LegacyPlatformModelsVM,
  ModelPlan,
  ModelTaskPlansVM,
  PlatformModelsTabContext,
  TaskProfile,
} from "../view-model.ts";
import { renderPlanAorExecutionChip } from "./AorIntegrationPanel.ts";

type TaskPlansNavigateTab =
  | "overview"
  | "modelAssets"
  | "smartRouting"
  | "usageAnalytics"
  | "governance";

type TaskPlansFilterState = {
  search: string;
  categories: TaskProfile["category"][];
  statuses: ModelPlan["status"][];
  audiences: ModelPlan["audience"][];
  costTargets: ModelPlan["costTarget"][];
  qualityTargets: ModelPlan["qualityTarget"][];
  latencyTargets: ModelPlan["latencyTarget"][];
  userSelectable: "all" | "yes" | "no";
  tenantOverrideAllowed: "all" | "yes" | "no";
  missingFallback: "all" | "yes" | "no";
  sortField: ModelTaskPlansVM["defaultSort"]["field"];
  sortDirection: ModelTaskPlansVM["defaultSort"]["direction"];
  selectedPlanId: string | null;
};

const DEFAULT_TASK_PLANS_FILTER_STATE: TaskPlansFilterState = {
  search: "",
  categories: [],
  statuses: [],
  audiences: [],
  costTargets: [],
  qualityTargets: [],
  latencyTargets: [],
  userSelectable: "all",
  tenantOverrideAllowed: "all",
  missingFallback: "all",
  sortField: "updatedAt",
  sortDirection: "desc",
  selectedPlanId: null,
};

let taskPlansFilterState: TaskPlansFilterState = { ...DEFAULT_TASK_PLANS_FILTER_STATE };
let lastTaskPlansContextKey = "";
let taskPlanEditorKey = "";
let taskPlanEditorState = {
  primaryModel: "",
  fallbackModels: "",
};

function requestRerender() {
  requestPlatformSurfaceRerender();
}

function ensureTaskPlanDefaults(defaultSort: ModelTaskPlansVM["defaultSort"]) {
  if (
    taskPlansFilterState.sortField === DEFAULT_TASK_PLANS_FILTER_STATE.sortField &&
    taskPlansFilterState.sortDirection === DEFAULT_TASK_PLANS_FILTER_STATE.sortDirection
  ) {
    taskPlansFilterState = {
      ...taskPlansFilterState,
      sortField: defaultSort.field,
      sortDirection: defaultSort.direction,
    };
  }
}

function syncTaskPlansContext(vm: ModelTaskPlansVM, context?: PlatformModelsTabContext) {
  const contextKey = JSON.stringify(context ?? {});
  if (contextKey === lastTaskPlansContextKey) {
    return;
  }
  lastTaskPlansContextKey = contextKey;
  if (context?.planId) {
    taskPlansFilterState = {
      ...taskPlansFilterState,
      search: context.planId,
      selectedPlanId: context.planId,
    };
    return;
  }
  if (context?.taskProfileId) {
    const matchedPlan =
      vm.plans.find((plan) => plan.taskProfileId === context.taskProfileId) ?? null;
    taskPlansFilterState = {
      ...taskPlansFilterState,
      search: context.taskProfileId,
      selectedPlanId: matchedPlan?.planId ?? null,
    };
  }
}

function resetTaskPlanFilters(defaultSort: ModelTaskPlansVM["defaultSort"]) {
  taskPlansFilterState = {
    ...DEFAULT_TASK_PLANS_FILTER_STATE,
    sortField: defaultSort.field,
    sortDirection: defaultSort.direction,
  };
}

function updateTaskPlanFilters(next: Partial<TaskPlansFilterState>) {
  taskPlansFilterState = {
    ...taskPlansFilterState,
    ...next,
  };
  requestRerender();
}

function updateTaskPlanEditor(next: Partial<typeof taskPlanEditorState>) {
  taskPlanEditorState = {
    ...taskPlanEditorState,
    ...next,
  };
  requestRerender();
}

const taskCategoryLabels: Record<TaskProfile["category"], string> = {
  general_text: "通用文本",
  long_context: "长文本",
  coding: "编程",
  image_generation: "图片生成",
  image_understanding: "图片理解",
  video_processing: "视频处理",
  realtime_voice: "实时语音",
  high_quality_reasoning: "高质量推理",
  low_cost_batch: "低成本批处理",
};

function taskPlanActionHint(context?: PlatformModelsTabContext) {
  if (!context?.actionHint) {
    return "";
  }
  const source = context.sourceModelId ? `，当前问题模型 ${context.sourceModelId}` : "";
  const suggestion = context.suggestedModelId ? `，建议优先评估 ${context.suggestedModelId}` : "";
  if (context.actionHint === "replace_model") {
    return `当前从 Issues 跳转而来：请优先调整方案主模型${source}${suggestion}。`;
  }
  if (context.actionHint === "add_fallback") {
    return `当前从 Issues 跳转而来：请优先检查方案 fallback${source}${suggestion}。`;
  }
  return `当前从 Issues 跳转而来：请优先确认任务方案与默认策略是否匹配${suggestion}。`;
}

function renderTaskPlanAutofillPanel(
  plan: ModelPlan,
  profile: TaskProfile | null,
  context: PlatformModelsTabContext | undefined,
  compat: LegacyPlatformModelsVM | null | undefined,
  onNavigateTab: (tab: TaskPlansNavigateTab, context?: PlatformModelsTabContext) => void,
  onSetDefaultPrimary?: (modelRef: string | null) => void,
  onSetDefaultFallbacks?: (fallbacks: string[]) => void,
  onSetDefaultImagePrimary?: (modelRef: string | null) => void,
  onUpsertTaskPlanConfig?: (input: {
    planId: string;
    taskProfileId?: string | null;
    primaryModelIds: string[];
    fallbackModelIds: string[];
  }) => void,
  onSaveConfig?: () => void,
) {
  if (!context?.actionHint) {
    return html``;
  }
  const submitTarget = resolvePlanSubmitTarget(profile);
  const suggestedModelId = context.suggestedModelId;
  const sourceModelId = context.sourceModelId;
  return html`
    <section class="card card-follow">
      <div class="card-title">已自动填充修复建议</div>
      <div class="grid grid-cols-2 card-follow">
        <section class="card">
          <div class="card-title">当前方案配置</div>
          <div class="list card-follow">
            <div class="list-item">
              <div class="list-main">
                <div class="list-title">任务方案</div>
                <div class="list-sub">${plan.name}</div>
              </div>
            </div>
            <div class="list-item">
              <div class="list-main">
                <div class="list-title">主模型</div>
                <div class="list-sub">${plan.primaryModelIds.join(", ") || "未配置"}</div>
              </div>
            </div>
            <div class="list-item">
              <div class="list-main">
                <div class="list-title">Fallback</div>
                <div class="list-sub">${plan.fallbackModelIds.join(" → ") || "缺少 fallback"}</div>
              </div>
            </div>
            <div class="list-item">
              <div class="list-main">
                <div class="list-title">任务画像</div>
                <div class="list-sub">${profile?.name ?? plan.taskProfileId}</div>
              </div>
            </div>
          </div>
        </section>
        <section class="card">
          <div class="card-title">建议变更</div>
          <div class="list card-follow">
            ${
              sourceModelId
                ? html`<div class="list-item">
                    <div class="list-main">
                      <div class="list-title">问题模型</div>
                      <div class="list-sub">${sourceModelId}</div>
                    </div>
                  </div>`
                : ""
            }
            ${
              suggestedModelId
                ? html`<div class="list-item list-item-selected">
                    <div class="list-main">
                      <div class="list-title">
                        ${context.actionHint === "add_fallback" ? "建议 fallback" : "建议替换模型"}
                      </div>
                      <div class="list-sub">${suggestedModelId}</div>
                    </div>
                    <span class="chip ok">已预填</span>
                  </div>`
                : html`<div class="list-item">
                    <div class="list-main">
                      <div class="list-title">建议动作</div>
                      <div class="list-sub">
                        ${context.actionHint === "add_fallback" ? "优先补充 fallback" : "优先调整主模型"}
                      </div>
                    </div>
                  </div>`
            }
          </div>
        </section>
      </div>
      <section class="card card-follow">
        <div class="card-title">提交到平台默认配置</div>
        <div class="card-sub">
          ${
            submitTarget === "text-default"
              ? "当前可直接提交到平台默认文本模型配置。这会影响默认文本任务的主模型与 fallback，不是单个方案私有配置。"
              : submitTarget === "image-default"
                ? "当前可直接提交到平台默认图片模型配置。这会影响默认图片生成主模型，不是单个方案私有配置。"
                : submitTarget === "dedicated"
                  ? "当前可直接提交到独立 Task Plan 配置源。这会覆盖该任务方案的主模型与 fallback，不再依赖推导结果。"
                  : "当前任务方案没有独立配置源。若要真正提交，需要先补齐独立 Task Plan 配置模型。"
          }
        </div>
        ${
          submitTarget === "text-default"
            ? html`
                <div class="grid grid-cols-2 card-follow">
                  <label class="field">
                    <span>平台默认主模型</span>
                    <input
                      .value=${taskPlanEditorState.primaryModel}
                      @input=${(event: Event) =>
                        updateTaskPlanEditor({
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
                        updateTaskPlanEditor({
                          fallbackModels:
                            event.currentTarget instanceof HTMLTextAreaElement
                              ? event.currentTarget.value
                              : "",
                        })}
                    >
${taskPlanEditorState.fallbackModels}</textarea>
                  </label>
                </div>
                <div class="row row--tight card-follow row--wrap">
                  <button
                    class="btn btn--primary"
                    type="button"
                    ?disabled=${!onSetDefaultPrimary}
                    title=${onSetDefaultPrimary ? "" : "写入能力待接入"}
                    @click=${() => onSetDefaultPrimary?.(taskPlanEditorState.primaryModel.trim() || null)}
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
                        dedupeModelRefs(taskPlanEditorState.fallbackModels.split(/\n|,/g)),
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
                        .value=${taskPlanEditorState.primaryModel}
                        @input=${(event: Event) =>
                          updateTaskPlanEditor({
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
                      @click=${() => onSetDefaultImagePrimary?.(taskPlanEditorState.primaryModel.trim() || null)}
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
                        <span>方案主模型</span>
                        <input
                          .value=${taskPlanEditorState.primaryModel}
                          @input=${(event: Event) =>
                            updateTaskPlanEditor({
                              primaryModel:
                                event.currentTarget instanceof HTMLInputElement
                                  ? event.currentTarget.value
                                  : "",
                            })}
                        />
                      </label>
                      <label class="field">
                        <span>方案 fallback（每行一个）</span>
                        <textarea
                          rows="4"
                          @input=${(event: Event) =>
                            updateTaskPlanEditor({
                              fallbackModels:
                                event.currentTarget instanceof HTMLTextAreaElement
                                  ? event.currentTarget.value
                                  : "",
                            })}
                        >
${taskPlanEditorState.fallbackModels}</textarea>
                      </label>
                    </div>
                    <div class="row row--tight card-follow row--wrap">
                      <button
                        class="btn btn--primary"
                        type="button"
                        ?disabled=${!onUpsertTaskPlanConfig}
                        title=${onUpsertTaskPlanConfig ? "" : "写入能力待接入"}
                        @click=${() =>
                          onUpsertTaskPlanConfig?.({
                            planId: plan.planId,
                            taskProfileId: plan.taskProfileId,
                            primaryModelIds: dedupeModelRefs([taskPlanEditorState.primaryModel]),
                            fallbackModelIds: dedupeModelRefs(
                              taskPlanEditorState.fallbackModels.split(/\n|,/g),
                            ),
                          })}
                      >
                        应用到任务方案
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
                      当前任务方案仍是推导层。建议先在 Smart Routing 完成评估，再通过平台默认模型配置落地。
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
                  @click=${() => onNavigateTab("modelAssets", { modelId: suggestedModelId, sourceModelId, suggestedModelId, actionHint: context.actionHint })}
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
            onNavigateTab("smartRouting", {
              planId: plan.planId,
              taskProfileId: plan.taskProfileId,
              ...(sourceModelId ? { sourceModelId } : {}),
              ...(suggestedModelId ? { suggestedModelId } : {}),
              ...(context.actionHint ? { actionHint: context.actionHint } : {}),
            })}
        >
          去路由页执行调整
        </button>
      </div>
    </section>
  `;
}

function priorityModeLabel(value: TaskProfile["priorityMode"]) {
  switch (value) {
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

function findTaskProfile(taskProfiles: TaskProfile[], taskProfileId: string) {
  return taskProfiles.find((profile) => profile.taskProfileId === taskProfileId) ?? null;
}

function comparePlans(
  left: ModelPlan,
  right: ModelPlan,
  taskProfiles: TaskProfile[],
  field: ModelTaskPlansVM["defaultSort"]["field"],
) {
  const leftProfile = findTaskProfile(taskProfiles, left.taskProfileId);
  const rightProfile = findTaskProfile(taskProfiles, right.taskProfileId);
  switch (field) {
    case "category":
      return (leftProfile?.category ?? "").localeCompare(rightProfile?.category ?? "");
    case "status":
      return left.status.localeCompare(right.status);
    case "calls7d":
      return (left.usage7d?.calls ?? -1) - (right.usage7d?.calls ?? -1);
    case "cost7d":
      return (left.usage7d?.cost ?? -1) - (right.usage7d?.cost ?? -1);
    case "updatedAt":
      return (left.updatedAt ?? 0) - (right.updatedAt ?? 0);
    default:
      return left.name.localeCompare(right.name);
  }
}

function matchesPlanFilters(plan: ModelPlan, profile: TaskProfile | null) {
  const search = taskPlansFilterState.search.trim().toLowerCase();
  if (search) {
    const haystacks = [
      plan.name,
      plan.description,
      profile?.name ?? "",
      profile?.description ?? "",
    ].map((value) => value.toLowerCase());
    if (!haystacks.some((value) => value.includes(search))) {
      return false;
    }
  }
  if (taskPlansFilterState.categories.length > 0 && profile) {
    if (!taskPlansFilterState.categories.includes(profile.category)) {
      return false;
    }
  }
  if (
    taskPlansFilterState.statuses.length > 0 &&
    !taskPlansFilterState.statuses.includes(plan.status)
  ) {
    return false;
  }
  if (
    taskPlansFilterState.audiences.length > 0 &&
    !taskPlansFilterState.audiences.includes(plan.audience)
  ) {
    return false;
  }
  if (
    taskPlansFilterState.costTargets.length > 0 &&
    !taskPlansFilterState.costTargets.includes(plan.costTarget)
  ) {
    return false;
  }
  if (
    taskPlansFilterState.qualityTargets.length > 0 &&
    !taskPlansFilterState.qualityTargets.includes(plan.qualityTarget)
  ) {
    return false;
  }
  if (
    taskPlansFilterState.latencyTargets.length > 0 &&
    !taskPlansFilterState.latencyTargets.includes(plan.latencyTarget)
  ) {
    return false;
  }
  if (taskPlansFilterState.userSelectable === "yes" && !plan.userSelectable) {
    return false;
  }
  if (taskPlansFilterState.userSelectable === "no" && plan.userSelectable) {
    return false;
  }
  if (taskPlansFilterState.tenantOverrideAllowed === "yes" && !plan.tenantOverrideAllowed) {
    return false;
  }
  if (taskPlansFilterState.tenantOverrideAllowed === "no" && plan.tenantOverrideAllowed) {
    return false;
  }
  if (taskPlansFilterState.missingFallback === "yes" && plan.fallbackModelIds.length > 0) {
    return false;
  }
  if (taskPlansFilterState.missingFallback === "no" && plan.fallbackModelIds.length === 0) {
    return false;
  }
  return true;
}

function renderTaskPlanSummary(vm: ModelTaskPlansVM) {
  const cards = [
    {
      label: "任务画像数",
      value: vm.summary.totalTaskProfiles,
      onClick: () => {
        resetTaskPlanFilters(vm.defaultSort);
        requestRerender();
      },
    },
    {
      label: "方案总数",
      value: vm.summary.totalPlans,
      onClick: () => {
        resetTaskPlanFilters(vm.defaultSort);
        requestRerender();
      },
    },
    {
      label: "已发布方案",
      value: vm.summary.publishedPlans,
      onClick: () => updateTaskPlanFilters({ statuses: ["published"] }),
    },
    {
      label: "草稿方案",
      value: vm.summary.draftPlans,
      onClick: () => updateTaskPlanFilters({ statuses: ["draft"] }),
    },
    {
      label: "下线方案",
      value: vm.summary.deprecatedPlans,
      onClick: () => updateTaskPlanFilters({ statuses: ["deprecated"] }),
    },
    {
      label: "用户可选方案",
      value: vm.summary.userSelectablePlans,
      onClick: () => updateTaskPlanFilters({ userSelectable: "yes" }),
    },
    {
      label: "允许租户覆盖方案",
      value: vm.summary.tenantOverrideAllowedPlans,
      onClick: () => updateTaskPlanFilters({ tenantOverrideAllowed: "yes" }),
    },
    {
      label: "缺少 fallback 的方案",
      value: vm.summary.plansMissingFallback,
      onClick: () => updateTaskPlanFilters({ missingFallback: "yes" }),
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

function renderTaskPlanFilterBar(vm: ModelTaskPlansVM, resultCount: number) {
  const usageMissing = vm.plans.length > 0 && vm.plans.every((plan) => plan.usage7d == null);
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
            @click=${() => {
              resetTaskPlanFilters(vm.defaultSort);
              requestRerender();
            }}
          >
            清空筛选
          </button>
        </div>
      </div>
      ${
        usageMissing
          ? html`
              <div class="callout card-follow">使用数据未接入。</div>
            `
          : ""
      }
      <div class="grid grid-cols-3 card-follow">
        <label class="field">
          <span>搜索</span>
          <input
            .value=${taskPlansFilterState.search}
            placeholder="方案名称 / 描述 / 任务名称"
            @input=${(event: Event) =>
              updateTaskPlanFilters({
                search:
                  event.currentTarget instanceof HTMLInputElement ? event.currentTarget.value : "",
              })}
          />
        </label>
        <label class="field">
          <span>任务类别</span>
          <select
            .value=${taskPlansFilterState.categories[0] ?? ""}
            @change=${(event: Event) =>
              updateTaskPlanFilters({
                categories:
                  event.currentTarget instanceof HTMLSelectElement && event.currentTarget.value
                    ? [event.currentTarget.value as TaskProfile["category"]]
                    : [],
              })}
          >
            <option value="">全部</option>
            ${vm.filters.categories.map(
              (category) =>
                html`<option value=${category}>${taskCategoryLabels[category]}</option>`,
            )}
          </select>
        </label>
        <label class="field">
          <span>方案状态</span>
          <select
            .value=${taskPlansFilterState.statuses[0] ?? ""}
            @change=${(event: Event) =>
              updateTaskPlanFilters({
                statuses:
                  event.currentTarget instanceof HTMLSelectElement && event.currentTarget.value
                    ? [event.currentTarget.value as ModelPlan["status"]]
                    : [],
              })}
          >
            <option value="">全部</option>
            ${vm.filters.statuses.map((status) => html`<option value=${status}>${status}</option>`)}
          </select>
        </label>
        <label class="field">
          <span>适用对象</span>
          <select
            .value=${taskPlansFilterState.audiences[0] ?? ""}
            @change=${(event: Event) =>
              updateTaskPlanFilters({
                audiences:
                  event.currentTarget instanceof HTMLSelectElement && event.currentTarget.value
                    ? [event.currentTarget.value as ModelPlan["audience"]]
                    : [],
              })}
          >
            <option value="">全部</option>
            ${vm.filters.audiences.map((audience) => html`<option value=${audience}>${audience}</option>`)}
          </select>
        </label>
        <label class="field">
          <span>是否缺少 fallback</span>
          <select
            .value=${taskPlansFilterState.missingFallback}
            @change=${(event: Event) =>
              updateTaskPlanFilters({
                missingFallback:
                  event.currentTarget instanceof HTMLSelectElement
                    ? (event.currentTarget.value as TaskPlansFilterState["missingFallback"])
                    : "all",
              })}
          >
            <option value="all">全部</option>
            <option value="yes">缺少 fallback</option>
            <option value="no">fallback 完整</option>
          </select>
        </label>
        <label class="field">
          <span>排序</span>
          <select
            .value=${taskPlansFilterState.sortField}
            @change=${(event: Event) =>
              updateTaskPlanFilters({
                sortField:
                  event.currentTarget instanceof HTMLSelectElement
                    ? (event.currentTarget.value as ModelTaskPlansVM["defaultSort"]["field"])
                    : vm.defaultSort.field,
              })}
          >
            <option value="updatedAt">最近更新</option>
            <option value="name">方案名称</option>
            <option value="category">任务类别</option>
            <option value="status">状态</option>
            <option value="calls7d">7 日调用</option>
            <option value="cost7d">7 日成本</option>
          </select>
        </label>
      </div>
    </section>
  `;
}

function renderModelList(modelIds: string[]) {
  if (modelIds.length === 0) {
    return "未配置";
  }
  const visible = modelIds.slice(0, 2);
  return `${visible.join(", ")}${modelIds.length > 2 ? ` +${modelIds.length - 2}` : ""}`;
}

function renderFallbackChain(modelIds: string[]) {
  return modelIds.length > 0 ? modelIds.join(" → ") : "缺少 fallback";
}

function dedupeModelRefs(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function resolvePlanSubmitTarget(profile: TaskProfile | null) {
  if (!profile) {
    return null;
  }
  if (profile.category === "general_text") {
    return "text-default" as const;
  }
  if (profile.category === "image_generation") {
    return "image-default" as const;
  }
  return "dedicated" as const;
}

function syncTaskPlanEditor(
  selectedPlan: ModelPlan | null,
  profile: TaskProfile | null,
  context: PlatformModelsTabContext | undefined,
  compat: LegacyPlatformModelsVM | null | undefined,
) {
  if (!selectedPlan) {
    return;
  }
  const submitTarget = resolvePlanSubmitTarget(profile);
  const nextKey = JSON.stringify({
    planId: selectedPlan.planId,
    submitTarget,
    actionHint: context?.actionHint ?? "",
    suggestedModelId: context?.suggestedModelId ?? "",
    routingPrimary: compat?.routingPrimary ?? "",
    routingImagePrimary: compat?.routingImagePrimary ?? "",
    routingFallbacks: compat?.routingFallbacks ?? [],
  });
  if (nextKey === taskPlanEditorKey) {
    return;
  }
  taskPlanEditorKey = nextKey;
  if (submitTarget === "image-default") {
    taskPlanEditorState = {
      primaryModel:
        (context?.actionHint === "replace_model" && context.suggestedModelId) ||
        compat?.routingImagePrimary ||
        selectedPlan.primaryModelIds[0] ||
        "",
      fallbackModels: "",
    };
    return;
  }
  if (submitTarget === "dedicated") {
    taskPlanEditorState = {
      primaryModel:
        (context?.actionHint === "replace_model" && context.suggestedModelId) ||
        selectedPlan.primaryModelIds[0] ||
        "",
      fallbackModels: dedupeModelRefs([
        ...selectedPlan.fallbackModelIds,
        ...(context?.actionHint === "add_fallback" && context.suggestedModelId
          ? [context.suggestedModelId]
          : []),
      ]).join("\n"),
    };
    return;
  }
  taskPlanEditorState = {
    primaryModel:
      (context?.actionHint === "replace_model" && context.suggestedModelId) ||
      compat?.routingPrimary ||
      selectedPlan.primaryModelIds[0] ||
      "",
    fallbackModels: dedupeModelRefs([
      ...(compat?.routingFallbacks ?? selectedPlan.fallbackModelIds),
      ...(context?.actionHint === "add_fallback" && context.suggestedModelId
        ? [context.suggestedModelId]
        : []),
    ]).join("\n"),
  };
}

export type ModelTaskPlansSectionProps = {
  vm: ModelTaskPlansVM;
  readModel?: import("../../semantic/platform-read-model.ts").PlatformPortReadModel;
  onNavigateTab: (tab: TaskPlansNavigateTab, context?: PlatformModelsTabContext) => void;
  context?: PlatformModelsTabContext;
  compat?: LegacyPlatformModelsVM | null;
  onCreatePlan?: () => void;
  onEditPlan?: (planId: string) => void;
  onDuplicatePlan?: (planId: string) => void;
  onUpdatePlanStatus?: (planId: string, nextStatus: "draft" | "published" | "deprecated") => void;
  onSetDefaultPrimary?: (modelRef: string | null) => void;
  onSetDefaultFallbacks?: (fallbacks: string[]) => void;
  onSetDefaultImagePrimary?: (modelRef: string | null) => void;
  onUpsertTaskPlanConfig?: (input: {
    planId: string;
    taskProfileId?: string | null;
    primaryModelIds: string[];
    fallbackModelIds: string[];
  }) => void;
  onSaveConfig?: () => void;
};

export function renderModelTaskPlansSection(props: ModelTaskPlansSectionProps) {
  const {
    vm,
    onNavigateTab,
    context,
    compat,
    onCreatePlan,
    onEditPlan,
    onDuplicatePlan,
    onUpdatePlanStatus,
    onSetDefaultPrimary,
    onSetDefaultFallbacks,
    onSetDefaultImagePrimary,
    onUpsertTaskPlanConfig,
    onSaveConfig,
  } = props;
  ensureTaskPlanDefaults(vm.defaultSort);
  syncTaskPlansContext(vm, context);
  if (vm.emptyState) {
    return html`
      <section class="card">
        <div class="card-title">${vm.emptyState.title}</div>
        <div class="card-sub">${vm.emptyState.description}</div>
        <div class="row row--tight card-follow">
          <button
            class="btn btn--primary"
            type="button"
            ?disabled=${!onCreatePlan}
            title=${onCreatePlan ? "" : "写入能力待接入"}
            @click=${() => onCreatePlan?.()}
          >
            ${vm.emptyState.primaryActionLabel ?? "新建任务方案"}
          </button>
        </div>
      </section>
    `;
  }
  const filteredPlans = vm.plans
    .filter((plan) =>
      matchesPlanFilters(plan, findTaskProfile(vm.taskProfiles, plan.taskProfileId)),
    )
    .toSorted((left, right) => {
      const delta = comparePlans(left, right, vm.taskProfiles, taskPlansFilterState.sortField);
      return taskPlansFilterState.sortDirection === "asc" ? delta : -delta;
    });
  const selectedPlan =
    filteredPlans.find((plan) => plan.planId === taskPlansFilterState.selectedPlanId) ??
    vm.plans.find((plan) => plan.planId === taskPlansFilterState.selectedPlanId) ??
    null;
  const selectedPlanProfile = selectedPlan
    ? findTaskProfile(vm.taskProfiles, selectedPlan.taskProfileId)
    : null;
  syncTaskPlanEditor(selectedPlan, selectedPlanProfile, context, compat);
  const usageMissing = vm.plans.length > 0 && vm.plans.every((plan) => plan.usage7d == null);
  const onlyProfilesNoPlans = vm.taskProfiles.length > 0 && vm.plans.length === 0;
  return html`
    <section class="card">
      <div class="row row--split row--top">
        <div>
          <div class="card-title">任务方案中心</div>
        </div>
        <div class="row row--tight row--wrap">
          <button class="btn btn--sm" type="button" @click=${() => onNavigateTab("smartRouting")}>
            查看路由策略
          </button>
          <button class="btn btn--sm" type="button" @click=${() => onNavigateTab("modelAssets")}>
            查看模型资产
          </button>
          <button
            class="btn btn--primary"
            type="button"
            ?disabled=${!onCreatePlan}
            title=${onCreatePlan ? "" : "写入能力待接入"}
            @click=${() => onCreatePlan?.()}
          >
            新建任务方案
          </button>
        </div>
      </div>
      ${renderTaskPlanSummary(vm)}
    </section>
    ${
      context?.actionHint
        ? html`<section class="card card-follow">
            <div class="callout">${taskPlanActionHint(context)}</div>
          </section>`
        : ""
    }
    ${
      onlyProfilesNoPlans
        ? html`
            <section class="card card-follow">
              <div class="callout">
                已检测到任务画像，但尚未创建标准方案。请为任务画像绑定主模型与 fallback，发布为可用方案。
              </div>
            </section>
          `
        : ""
    }
    ${renderTaskPlanFilterBar(vm, filteredPlans.length)}
    <section class="card card-follow">
      <div class="card-title">Task Plan Table</div>
      ${
        usageMissing
          ? html`
              <div class="callout card-follow">使用数据未接入</div>
            `
          : ""
      }
      <div class="enterprise-data-table-wrap card-follow">
        <table class="enterprise-data-table">
          <thead>
            <tr>
              <th>方案</th>
              <th>任务类别</th>
              <th>优先级</th>
              <th>成本目标</th>
              <th>延迟目标</th>
              <th>主模型</th>
              <th>Fallback</th>
              <th>使用情况</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${filteredPlans.map((plan) => {
              const profile = findTaskProfile(vm.taskProfiles, plan.taskProfileId);
              return html`
                <tr>
                  <td>
                    <div class="enterprise-data-table__strong">${plan.name}</div>
                    <div class="enterprise-data-table__sub">${plan.description}</div>
                    ${renderPlanAorExecutionChip(plan.aorExecution)}
                  </td>
                  <td>${profile ? taskCategoryLabels[profile.category] : plan.taskProfileId}</td>
                  <td>${profile ? priorityModeLabel(profile.priorityMode) : "未定义"}</td>
                  <td>
                    ${plan.costTarget}
                    <div class="enterprise-data-table__sub">
                      ${profile?.maxCostPerRequest != null ? `$${profile.maxCostPerRequest}` : "未设预算"}
                    </div>
                  </td>
                  <td>
                    ${plan.latencyTarget}
                    <div class="enterprise-data-table__sub">
                      ${profile?.latencyTargetMs != null ? `${profile.latencyTargetMs}ms` : "未设目标"}
                    </div>
                  </td>
                  <td>${renderModelList(plan.primaryModelIds)}</td>
                  <td>
                    <span class="chip ${plan.fallbackModelIds.length === 0 ? "warn" : ""}">
                      ${renderFallbackChain(plan.fallbackModelIds)}
                    </span>
                    ${
                      plan.missingModelIds?.length
                        ? html`
                            <div class="enterprise-data-table__sub card-follow--xs">模型缺失</div>
                          `
                        : ""
                    }
                  </td>
                  <td>
                    ${
                      plan.usage7d
                        ? html`
                            <div>${plan.usage7d.calls} 次</div>
                            <div class="enterprise-data-table__sub">
                              ${formatCost(plan.usage7d.cost)} ·
                              ${plan.usage7d.successRate != null ? `${plan.usage7d.successRate}%` : "成功率未接入"}
                            </div>
                          `
                        : "未接入"
                    }
                  </td>
                  <td>${plan.status}</td>
                  <td>
                    <div class="row row--tight row--wrap">
                      <button
                        class="btn btn--sm"
                        type="button"
                        @click=${() => updateTaskPlanFilters({ selectedPlanId: plan.planId })}
                      >
                        查看详情
                      </button>
                      <button
                        class="btn btn--sm"
                        type="button"
                        ?disabled=${!onEditPlan}
                        title=${onEditPlan ? "" : "写入能力待接入"}
                        @click=${() => onEditPlan?.(plan.planId)}
                      >
                        编辑
                      </button>
                      <button
                        class="btn btn--sm"
                        type="button"
                        ?disabled=${!onDuplicatePlan}
                        title=${onDuplicatePlan ? "" : "写入能力待接入"}
                        @click=${() => onDuplicatePlan?.(plan.planId)}
                      >
                        复制
                      </button>
                      <button
                        class="btn btn--sm"
                        type="button"
                        ?disabled=${!onUpdatePlanStatus}
                        title=${onUpdatePlanStatus ? "" : "写入能力待接入"}
                        @click=${() =>
                          onUpdatePlanStatus?.(
                            plan.planId,
                            plan.status === "published" ? "deprecated" : "published",
                          )}
                      >
                        ${plan.status === "published" ? "下线" : "发布"}
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
    ${
      selectedPlan
        ? (() => {
            const profile = selectedPlanProfile;
            return html`
              ${renderTaskPlanAutofillPanel(
                selectedPlan,
                profile,
                context,
                compat,
                onNavigateTab,
                onSetDefaultPrimary,
                onSetDefaultFallbacks,
                onSetDefaultImagePrimary,
                onUpsertTaskPlanConfig,
                onSaveConfig,
              )}
              <aside class="card card-follow">
                <div class="row row--split row--top">
                  <div>
                    <div class="card-title">方案详情</div>
                  </div>
                  <button
                    class="btn btn--sm"
                    type="button"
                    @click=${() => updateTaskPlanFilters({ selectedPlanId: null })}
                  >
                    关闭
                  </button>
                </div>
                <div class="grid grid-cols-2 card-follow">
                  <section class="card">
                    <div class="card-title">基础信息</div>
                    <div class="list card-follow">
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">${selectedPlan.name}</div>
                          <div class="list-sub">${selectedPlan.description}</div>
                        </div>
                        <div class="list-meta">${selectedPlan.status}</div>
                      </div>
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">适用对象</div>
                          <div class="list-sub">${selectedPlan.audience}</div>
                        </div>
                      </div>
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">用户可选</div>
                          <div class="list-sub">
                            ${selectedPlan.userSelectable ? "允许" : "不允许"}
                          </div>
                        </div>
                      </div>
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">租户覆盖</div>
                          <div class="list-sub">
                            ${selectedPlan.tenantOverrideAllowed ? "允许" : "不允许"}
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                  <section class="card">
                    <div class="card-title">任务画像</div>
                    ${
                      profile
                        ? html`
                            <div class="list card-follow">
                              <div class="list-item">
                                <div class="list-main">
                                  <div class="list-title">${profile.name}</div>
                                  <div class="list-sub">${profile.description ?? ""}</div>
                                </div>
                              </div>
                              <div class="list-item">
                                <div class="list-main">
                                  <div class="list-title">任务类别</div>
                                  <div class="list-sub">
                                    ${taskCategoryLabels[profile.category]}
                                  </div>
                                </div>
                              </div>
                              <div class="list-item">
                                <div class="list-main">
                                  <div class="list-title">能力要求</div>
                                  <div class="list-sub">
                                    ${profile.requiredCapabilities.join(", ") || "无"}
                                  </div>
                                </div>
                              </div>
                              <div class="list-item">
                                <div class="list-main">
                                  <div class="list-title">输入 / 输出</div>
                                  <div class="list-sub">
                                    ${profile.inputModalities.join(", ")} →
                                    ${profile.outputModalities.join(", ")}
                                  </div>
                                </div>
                              </div>
                              <div class="list-item">
                                <div class="list-main">
                                  <div class="list-title">优先模式</div>
                                  <div class="list-sub">
                                    ${priorityModeLabel(profile.priorityMode)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          `
                        : html`
                            <div class="callout card-follow">任务画像缺失</div>
                          `
                    }
                  </section>
                  <section class="card">
                    <div class="card-title">模型配置</div>
                    <div class="list card-follow">
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">主模型</div>
                          <div class="list-sub">
                            ${selectedPlan.primaryModelIds.join(", ") || "未配置"}
                          </div>
                        </div>
                      </div>
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">Fallback</div>
                          <div class="list-sub">
                            ${selectedPlan.fallbackModelIds.join(" → ") || "缺少 fallback"}
                          </div>
                        </div>
                      </div>
                      ${
                        selectedPlan.fallbackModelIds.length === 0
                          ? html`
                              <div class="callout card-follow--sm">缺少 fallback</div>
                            `
                          : ""
                      }
                      ${
                        selectedPlan.missingModelIds?.length
                          ? html`
                              <div class="callout danger card-follow--sm">
                                模型缺失：${selectedPlan.missingModelIds.join(", ")}
                                <div class="card-follow--xs">
                                  <button
                                    class="btn btn--sm"
                                    type="button"
                                    @click=${() =>
                                      onNavigateTab("modelAssets", {
                                        planId: selectedPlan.planId,
                                        taskProfileId: selectedPlan.taskProfileId,
                                      })}
                                  >
                                    前往模型资产
                                  </button>
                                </div>
                              </div>
                            `
                          : ""
                      }
                    </div>
                  </section>
                  <section class="card">
                    <div class="card-title">约束目标</div>
                    <div class="list card-follow">
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">成本目标</div>
                          <div class="list-sub">
                            ${selectedPlan.costTarget} /
                            ${profile?.maxCostPerRequest != null ? `$${profile.maxCostPerRequest}` : "未设预算"}
                          </div>
                        </div>
                      </div>
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">质量目标</div>
                          <div class="list-sub">${selectedPlan.qualityTarget}</div>
                        </div>
                      </div>
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">延迟目标</div>
                          <div class="list-sub">
                            ${selectedPlan.latencyTarget} /
                            ${profile?.latencyTargetMs != null ? `${profile.latencyTargetMs}ms` : "未设目标"}
                          </div>
                        </div>
                      </div>
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">稳定性目标</div>
                          <div class="list-sub">${profile?.stabilityTarget ?? "未设目标"}</div>
                        </div>
                      </div>
                    </div>
                  </section>
                  <section class="card">
                    <div class="card-title">使用情况</div>
                    ${
                      selectedPlan.usage7d
                        ? html`
                            <div class="list card-follow">
                              <div class="list-item">
                                <div class="list-main">
                                  <div class="list-title">7 日调用</div>
                                  <div class="list-sub">${selectedPlan.usage7d.calls} 次</div>
                                </div>
                              </div>
                              <div class="list-item">
                                <div class="list-main">
                                  <div class="list-title">7 日成本</div>
                                  <div class="list-sub">
                                    ${formatCost(selectedPlan.usage7d.cost)}
                                  </div>
                                </div>
                              </div>
                              <div class="list-item">
                                <div class="list-main">
                                  <div class="list-title">成功率</div>
                                  <div class="list-sub">
                                    ${selectedPlan.usage7d.successRate != null ? `${selectedPlan.usage7d.successRate}%` : "未接入"}
                                  </div>
                                </div>
                              </div>
                              <div class="list-item">
                                <div class="list-main">
                                  <div class="list-title">Fallback Rate</div>
                                  <div class="list-sub">
                                    ${selectedPlan.usage7d.fallbackRate != null ? `${selectedPlan.usage7d.fallbackRate}%` : "未接入"}
                                  </div>
                                </div>
                              </div>
                              <div class="list-item">
                                <div class="list-main">
                                  <div class="list-title">人工改配率</div>
                                  <div class="list-sub">
                                    ${selectedPlan.usage7d.manualOverrideRate != null ? `${selectedPlan.usage7d.manualOverrideRate}%` : "未接入"}
                                  </div>
                                </div>
                              </div>
                            </div>
                          `
                        : html`
                            <div class="callout card-follow">使用数据未接入</div>
                          `
                    }
                  </section>
                  <section class="card">
                    <div class="card-title">治理问题</div>
                    ${
                      selectedPlan.governance?.issueCount
                        ? html`
                            <div class="list card-follow">
                              <div class="list-item">
                                <div class="list-main">
                                  <div class="list-title">
                                    ${selectedPlan.governance.issueCount} 个关联治理项
                                  </div>
                                  <div class="list-sub">
                                    最高严重度 ${selectedPlan.governance.highestSeverity ?? "info"}
                                  </div>
                                </div>
                              </div>
                            </div>
                          `
                        : html`
                            <div class="callout card-follow">暂无治理问题</div>
                          `
                    }
                    <div class="row row--tight card-follow">
                      <button
                        class="btn btn--sm"
                        type="button"
                        @click=${() =>
                          onNavigateTab("smartRouting", {
                            planId: selectedPlan.planId,
                            taskProfileId: selectedPlan.taskProfileId,
                          })}
                      >
                        查看路由策略
                      </button>
                      <button
                        class="btn btn--sm"
                        type="button"
                        @click=${() =>
                          onNavigateTab("governance", {
                            planId: selectedPlan.planId,
                            taskProfileId: selectedPlan.taskProfileId,
                          })}
                      >
                        查看治理告警
                      </button>
                    </div>
                  </section>
                </div>
              </aside>
            `;
          })()
        : ""
    }
  `;
}
