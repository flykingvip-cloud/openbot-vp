import { html, nothing } from "lit";
import { renderIcon } from "../../../../icons.ts";
import { formatCost } from "../../../../views/usage-metrics.ts";
import "./model-assets-drawer.css";
import "./model-assets-list.css";
import { requestPlatformSurfaceRerender } from "../../shared/surface.ts";
import type { PlatformModelsActions } from "../actions.ts";
import {
  buildCapabilityMatrixView,
  verificationTaskStatusLabel,
} from "../admission/capability-matrix.ts";
import {
  cancelCapabilityVerification,
  startCapabilityVerification,
} from "../admission/controller.ts";
import { statusLabel as capabilityStatusLabel } from "../capability-evidence.ts";
import { assetMatchesRequiredCapabilities, capabilityLabel } from "../capability-ids.ts";
import { resolveExecutorPathLabel } from "../executor-path-labels.ts";
import {
  getModelAdmission,
  listVerificationTasks,
  setExecutorCallTypeArchive,
} from "../model-admission-store.ts";
import {
  importAssetIntoPool as commitPoolImport,
  saveEndpointThenAllowlistVerified,
} from "../model-asset-actions.ts";
import { autoRoutingAdmissionLabel, tenantSelectableLabel } from "../model-asset-presentation.ts";
import {
  buildConnectionFingerprint,
  hasSuccessfulModelConnection,
  isConnectionVerificationStale,
  isManagedPoolModel,
  markModelConnectionVerified,
} from "../model-connection-gate.ts";
import { formatOperatorProbeMessage } from "../probe-operator-message.ts";
import {
  SPECIALIZED_EVAL_BACKEND_STATUS,
  buildSpecializedEvalDisplay,
  formatQualityScore,
  runDemoSpecializedEval,
} from "../specialized-eval.ts";
import type {
  LegacyPlatformModelsVM,
  ModelAsset,
  ModelAssetsVM,
  PlatformModelsTabContext,
} from "../view-model.ts";
import { renderModelCatalogSection } from "./ModelCatalogSection.ts";
import { renderModelPoolSection } from "./ModelPoolSection.ts";
import { renderModelProviderHealthSection } from "./ModelProviderHealthSection.ts";
import { renderModelProviderSection } from "./ModelProviderSection.ts";

function formText(data: FormData, name: string) {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Empty / invalid → null (unknown). Never invent 128000 / 8192. */
function formOptionalNumber(data: FormData, name: string): number | null {
  const raw = formText(data, name);
  if (!raw) {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

/**
 * The add-provider dialog renders one panel per provider in a single form and
 * toggles them with `display:none`. Per-panel fields (`apiKey`, `baseUrl`)
 * therefore appear multiple times under the same name, so `FormData.get()`
 * would always return the first panel's value. Read these from the currently
 * visible (active) panel instead.
 */
function activeProviderPanel(form: HTMLFormElement): HTMLElement | null {
  const panels = Array.from(
    form.querySelectorAll<HTMLElement>(".platform-model-add__provider-panel"),
  );
  return panels.find((panel) => panel.style.display !== "none") ?? panels[0] ?? null;
}

function activePanelField(form: HTMLFormElement, name: string): string {
  const panel = activeProviderPanel(form);
  const input = panel?.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  return input ? input.value.trim() : "";
}

export function buildBootstrapModelInput(form: HTMLFormElement) {
  const data = new FormData(form);
  const providerId = formText(data, "providerId");
  const modelId = formText(data, "modelId");
  if (!providerId || !modelId) {
    return null;
  }
  const inputModesRaw = formText(data, "inputModes");
  const inputModes = inputModesRaw
    ? inputModesRaw
        .split(",")
        .map((item) => item.trim())
        .filter((item): item is "text" | "image" => item === "text" || item === "image")
    : [];
  const callTypeRaw = formText(data, "callType");
  const callType =
    callTypeRaw === "image_generation" ||
    callTypeRaw === "music_generation" ||
    callTypeRaw === "text_chat"
      ? callTypeRaw
      : undefined;
  return {
    providerId,
    baseUrl: activePanelField(form, "baseUrl"),
    modelId,
    name: formText(data, "name") || modelId,
    api: formText(data, "api") || "openai-responses",
    contextWindow: formOptionalNumber(data, "contextWindow"),
    maxTokens: formOptionalNumber(data, "maxTokens"),
    inputModes,
    reasoning: data.get("reasoning") === "on",
    apiKey: activePanelField(form, "apiKey"),
    ...(callType ? { callType } : {}),
  };
}

function parseModelRowRef(text: string): { providerId: string; modelId: string } | null {
  const trimmed = text.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0) {
    return null;
  }
  const providerId = trimmed.slice(0, slash).trim();
  const modelId = trimmed.slice(slash + 1).trim();
  if (!providerId || !modelId) {
    return null;
  }
  return { providerId, modelId };
}

function selectedModelRows(form: HTMLFormElement): Array<{ providerId: string; modelId: string }> {
  const panel = activeProviderPanel(form);
  if (!panel) {
    return [];
  }
  const rows: Array<{ providerId: string; modelId: string }> = [];
  for (const row of panel.querySelectorAll<HTMLElement>(".platform-model-add__model-row")) {
    if (row.classList.contains("platform-model-add__model-row--input")) {
      continue;
    }
    const checkbox = row.querySelector<HTMLInputElement>(
      '.platform-model-add__toggle input[type="checkbox"]',
    );
    if (checkbox && !checkbox.checked) {
      continue;
    }
    const idText = row.querySelector(".platform-model-add__model-id")?.textContent ?? "";
    const parsed = parseModelRowRef(idText);
    if (parsed) {
      rows.push(parsed);
    }
  }
  return rows;
}

/** Collect every checked model row in the active provider panel (or fallback to one hidden field). */
export function buildBootstrapModelInputs(
  form: HTMLFormElement,
): Array<NonNullable<ReturnType<typeof buildBootstrapModelInput>>> {
  const base = buildBootstrapModelInput(form);
  const selected = selectedModelRows(form);
  if (selected.length === 0) {
    return base ? [base] : [];
  }
  const template =
    base ??
    ({
      providerId: selected[0].providerId,
      baseUrl: activePanelField(form, "baseUrl"),
      modelId: selected[0].modelId,
      name: selected[0].modelId,
      api: "openai-responses",
      contextWindow: null,
      maxTokens: null,
      inputModes: [] as Array<"text" | "image">,
      reasoning: false,
      apiKey: activePanelField(form, "apiKey"),
    } satisfies NonNullable<ReturnType<typeof buildBootstrapModelInput>>);
  return selected.map(({ providerId, modelId }) => ({
    ...template,
    providerId,
    modelId,
    name: modelId,
  }));
}

type OverviewNavigateTab =
  | "overview"
  | "taskPlans"
  | "smartRouting"
  | "usageAnalytics"
  | "governance";

type ModelAssetFilterState = {
  search: string;
  providers: string[];
  modalities: string[];
  capabilities: string[];
  costTiers: Array<"low" | "medium" | "high" | "unknown">;
  healthStates: Array<"healthy" | "degraded" | "unavailable">;
  taskTags: string[];
  recommendationPool: "all" | "yes" | "no";
  tenantSelectable: "all" | "yes" | "no";
  sortField: ModelAssetsVM["defaultSort"]["field"];
  sortDirection: ModelAssetsVM["defaultSort"]["direction"];
  selectedModelId: string | null;
};

const DEFAULT_FILTER_STATE: ModelAssetFilterState = {
  search: "",
  providers: [],
  modalities: [],
  capabilities: [],
  costTiers: [],
  healthStates: [],
  taskTags: [],
  recommendationPool: "all",
  tenantSelectable: "all",
  sortField: "displayName",
  sortDirection: "asc",
  selectedModelId: null,
};

let modelAssetsFilterState: ModelAssetFilterState = { ...DEFAULT_FILTER_STATE };
let lastModelAssetsContextKey = "";
let addModelDialogOpen = false;

type ModelVerificationState = {
  modelId: string;
  phase: "probing" | "success" | "failed";
  message: string;
  latencyMs?: number;
};

let modelVerificationState: ModelVerificationState | null = null;

function requestRerender() {
  requestPlatformSurfaceRerender();
}

export function __resetModelAssetsSectionStateForTest() {
  modelAssetsFilterState = { ...DEFAULT_FILTER_STATE };
  modelVerificationState = null;
  addModelDialogOpen = false;
  lastModelAssetsContextKey = "";
}

function openAddModelDialog() {
  addModelDialogOpen = true;
  requestRerender();
}

function closeAddModelDialog() {
  addModelDialogOpen = false;
  requestRerender();
}

function focusAddedModel(modelRef: string) {
  // After add/save, open detail without narrowing the table via search filters.
  updateFilterState({
    selectedModelId: modelRef,
    search: "",
    providers: [],
    modalities: [],
    capabilities: [],
    costTiers: [],
    healthStates: [],
    taskTags: [],
    recommendationPool: "all",
    tenantSelectable: "all",
  });
}

function parseProbeSummaryForModel(
  summary: unknown,
  modelRef: string,
): { ok: boolean; message: string; latencyMs?: number } {
  const record =
    summary && typeof summary === "object" ? (summary as Record<string, unknown>) : null;
  const results = Array.isArray(record?.results) ? record.results : [];
  const providerId = modelRef.includes("/") ? modelRef.split("/")[0] : "";
  const localModelId = modelRef.includes("/")
    ? modelRef.slice(modelRef.indexOf("/") + 1)
    : modelRef;
  const match = results.find((entry) => {
    const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    if (!item) {
      return false;
    }
    const provider = typeof item.provider === "string" ? item.provider : "";
    const model = typeof item.model === "string" ? item.model : "";
    return (
      model === modelRef ||
      (provider === providerId && (model.endsWith(`/${localModelId}`) || model === localModelId))
    );
  }) as Record<string, unknown> | undefined;
  if (!match) {
    return { ok: false, message: "未收到该模型的调用测试结果，请检查 Provider 凭证后重试。" };
  }
  const latencyMs = typeof match.latencyMs === "number" ? match.latencyMs : undefined;
  if (match.status === "ok") {
    return {
      ok: true,
      message: `调用测试成功${latencyMs != null ? `，延迟 ${latencyMs}ms` : ""}。`,
      latencyMs,
    };
  }
  const error =
    typeof match.error === "string" && match.error.trim()
      ? match.error.trim()
      : "调用测试失败，请检查模型 ID 与 Provider 凭证。";
  return { ok: false, message: formatOperatorProbeMessage(error), latencyMs };
}

async function verifyModelCall(
  modelRef: string,
  actions: PlatformModelsActions,
  endpoint?: { providerId?: string; baseUrl?: string | null; api?: string | null },
) {
  const slash = modelRef.indexOf("/");
  const providerId = endpoint?.providerId || (slash >= 0 ? modelRef.slice(0, slash) : "");
  modelVerificationState = {
    modelId: modelRef,
    phase: "probing",
    message: "正在发起调用测试…",
  };
  requestRerender();
  const summary = await actions.onProbeHealth?.({
    provider: providerId || undefined,
    modelRef,
  });
  const parsed = parseProbeSummaryForModel(summary, modelRef);
  if (parsed.ok) {
    markModelConnectionVerified(modelRef, {
      modelId: modelRef,
      providerId,
      baseUrl: endpoint?.baseUrl,
      api: endpoint?.api,
    });
  }
  modelVerificationState = {
    modelId: modelRef,
    phase: parsed.ok ? "success" : "failed",
    message: parsed.message,
    ...(parsed.latencyMs != null ? { latencyMs: parsed.latencyMs } : {}),
  };
  requestRerender();
  return parsed.ok;
}

async function commitAddedModels(
  inputs: Array<NonNullable<ReturnType<typeof buildBootstrapModelInput>>>,
  actions: PlatformModelsActions,
) {
  if (inputs.length === 0) {
    return;
  }
  const { allowlisted } = await saveEndpointThenAllowlistVerified({
    inputs,
    add: (input) => {
      actions.onAddModel(input);
      // callType is platform capability archive metadata — not ModelDefinitionSchema.
      if (input.callType) {
        setExecutorCallTypeArchive(`${input.providerId}/${input.modelId}`, input.callType);
      }
    },
    save: () => actions.onSaveConfig(),
    allowlist: (modelRef, name) => actions.onUpsertAllowlistEntry(modelRef, name),
    verify: (modelRef) => {
      const input = inputs.find((item) => `${item.providerId}/${item.modelId}` === modelRef);
      return verifyModelCall(modelRef, actions, {
        providerId: input?.providerId,
        baseUrl: input?.baseUrl,
        api: input?.api,
      });
    },
  });
  const focusRef =
    allowlisted[allowlisted.length - 1] ??
    `${inputs[inputs.length - 1].providerId}/${inputs[inputs.length - 1].modelId}`;
  focusAddedModel(focusRef);
}

function resetFilterState(defaultSort: ModelAssetsVM["defaultSort"]) {
  modelAssetsFilterState = {
    ...DEFAULT_FILTER_STATE,
    sortField: defaultSort.field,
    sortDirection: defaultSort.direction,
  };
  requestRerender();
}

function ensureFilterDefaults(defaultSort: ModelAssetsVM["defaultSort"]) {
  if (
    modelAssetsFilterState.sortField === DEFAULT_FILTER_STATE.sortField &&
    modelAssetsFilterState.sortDirection === DEFAULT_FILTER_STATE.sortDirection
  ) {
    modelAssetsFilterState = {
      ...modelAssetsFilterState,
      sortField: defaultSort.field,
      sortDirection: defaultSort.direction,
    };
  }
}

function syncModelAssetsContext(context?: PlatformModelsTabContext) {
  const contextKey = JSON.stringify(context ?? {});
  if (contextKey === lastModelAssetsContextKey) {
    return;
  }
  lastModelAssetsContextKey = contextKey;
  if (!context?.modelId) {
    return;
  }
  modelAssetsFilterState = {
    ...modelAssetsFilterState,
    selectedModelId: context.modelId,
  };
}

function activeFilterCount(state: ModelAssetFilterState): number {
  let count = 0;
  if (state.search.trim()) {
    count += 1;
  }
  if (state.providers.length > 0) {
    count += 1;
  }
  if (state.modalities.length > 0) {
    count += 1;
  }
  if (state.capabilities.length > 0) {
    count += 1;
  }
  if (state.costTiers.length > 0) {
    count += 1;
  }
  if (state.healthStates.length > 0) {
    count += 1;
  }
  if (state.taskTags.length > 0) {
    count += 1;
  }
  if (state.recommendationPool !== "all") {
    count += 1;
  }
  if (state.tenantSelectable !== "all") {
    count += 1;
  }
  return count;
}

function renderDrawerKvRow(label: string, value: string) {
  return html`
    <div class="model-assets-drawer__kv-row">
      <div class="model-assets-drawer__kv-label">${label}</div>
      <div class="model-assets-drawer__kv-value">${value}</div>
    </div>
  `;
}

function updateFilterState(next: Partial<ModelAssetFilterState>) {
  modelAssetsFilterState = {
    ...modelAssetsFilterState,
    ...next,
  };
  requestRerender();
}

function closeModelDetailDrawer() {
  updateFilterState({ selectedModelId: null });
}

function healthLabel(value: ModelAsset["health"]) {
  switch (value) {
    case "healthy":
      return "健康";
    case "degraded":
      return "降级";
    default:
      return "不可用";
  }
}

function contextWindowLabel(value?: number) {
  if (!value) {
    return "未知";
  }
  if (value >= 1_000_000) {
    return `${Math.round(value / 1_000_000)}M`;
  }
  if (value >= 1000) {
    return `${Math.round(value / 1000)}K`;
  }
  return String(value);
}

function costTierLabel(value: ModelAsset["costTier"]) {
  switch (value) {
    case "low":
      return "低";
    case "high":
      return "高";
    case "unknown":
      return "未接入";
    default:
      return "中";
  }
}

function renderCapabilityMatrix(asset: ModelAsset) {
  const evidence =
    asset.capabilityEvidence && asset.capabilityEvidence.length > 0
      ? asset.capabilityEvidence
      : null;
  const tasks = listVerificationTasks(asset.modelId);
  const matrix = buildCapabilityMatrixView({
    evidence: evidence ?? [],
    tasks,
  });
  if (!evidence) {
    return html`
      ${renderDrawerKvRow(
        "能力（建议）",
        asset.capabilities.length
          ? `${asset.capabilities.join(", ")}（待确认，非已验证）`
          : "未声明",
      )}
      ${renderSpecializedEvalPanel(asset)}
      ${renderVerificationHistory(matrix)}
    `;
  }
  return html`
    <div class="model-assets-drawer__kv-stack" data-testid="capability-matrix">
      ${matrix.rows.map(
        (item) => html`
          <div class="model-assets-drawer__kv-row" data-capability-id=${item.id}>
            <span class="muted">${item.label}</span>
            <span
              >${item.statusLabel} · ${item.sourceNote ?? item.sourceLabel}${
                item.failureReason ? ` — ${item.failureReason}` : ""
              }${item.testVersion ? ` · 测试版本 ${item.testVersion}` : ""}${
                item.isSpecializedEval && item.verifiedAtLabel ? ` · ${item.verifiedAtLabel}` : ""
              }${
                item.isSpecializedEval && item.qualityScore != null
                  ? ` · 质量评分 ${formatQualityScore(item.qualityScore)}`
                  : ""
              }</span
            >
          </div>
        `,
      )}
    </div>
    ${renderSpecializedEvalPanel(asset)}
    ${renderVerificationHistory(matrix)}
  `;
}

function renderVerificationHistory(matrix: ReturnType<typeof buildCapabilityMatrixView>) {
  if (matrix.history.length === 0 && !matrix.activeTask) {
    return html``;
  }
  return html`
    <details class="model-assets-drawer__fold card-follow--sm" data-testid="verification-history" open>
      <summary class="model-assets-drawer__fold-title">验证记录</summary>
      <div class="model-assets-drawer__kv-stack">
        ${
          matrix.activeTask
            ? html`
                <div class="callout info card-follow--xs" data-testid="verification-active-task">
                  进行中：${matrix.activeTask.taskId} ·
                  ${verificationTaskStatusLabel(matrix.activeTask.status)}
                </div>
              `
            : ""
        }
        ${matrix.history.slice(0, 5).map(
          (task) => html`
            <div class="model-assets-drawer__kv-row" data-testid="verification-task-row" data-task-id=${task.taskId}>
              <span class="muted">${task.taskId}</span>
              <span
                >${verificationTaskStatusLabel(task.status)} ·
                ${(task.capabilityIds ?? []).join(", ")}${
                  task.error ? ` — ${task.error}` : ""
                }</span
              >
            </div>
          `,
        )}
      </div>
    </details>
  `;
}

async function runFormalCapabilityVerification(asset: ModelAsset) {
  const fingerprint = buildConnectionFingerprint({
    modelId: asset.modelId,
    providerId: asset.providerId,
    baseUrl: asset.baseUrl,
    api: asset.api,
  });
  const capabilityIds = (asset.capabilityEvidence ?? [])
    .map((item) => item.id)
    .filter((id): id is NonNullable<typeof id> => Boolean(id));
  const ids =
    capabilityIds.length > 0
      ? (capabilityIds as import("../capability-ids.ts").CanonicalCapabilityId[])
      : (["text_chat", "tool_use"] as import("../capability-ids.ts").CanonicalCapabilityId[]);
  await startCapabilityVerification({
    modelRef: asset.modelId,
    capabilityIds: ids,
    configFingerprint: fingerprint,
  });
  requestPlatformSurfaceRerender();
}

function renderSpecializedEvalPanel(asset: ModelAsset) {
  const admission = getModelAdmission(asset.modelId);
  const rows = buildSpecializedEvalDisplay({
    formal: asset.capabilityEvidence ?? admission.capabilityEvidence ?? [],
    demo: admission.demoCapabilityEvidence,
  });
  return html`
    <details class="model-assets-drawer__fold card-follow--sm" data-testid="specialized-eval-panel" open>
      <summary class="model-assets-drawer__fold-title">专项评测</summary>
      <div class="muted card-follow--xs">
        展示质量评分的测试版本与时间。正式专项评测后端状态：${SPECIALIZED_EVAL_BACKEND_STATUS === "not_wired" ? "尚未接入" : SPECIALIZED_EVAL_BACKEND_STATUS}。
      </div>
      ${
        rows.length === 0
          ? html`
              <div class="muted card-follow--xs" data-testid="specialized-eval-empty">暂无专项评测记录</div>
            `
          : html`
              <div class="model-assets-drawer__kv-stack card-follow--xs">
                ${rows.map(
                  (row) => html`
                    <div
                      class="model-assets-drawer__kv-row"
                      data-testid="specialized-eval-row"
                      data-capability-id=${row.id}
                      data-demo=${row.isDemo ? "true" : "false"}
                    >
                      <span class="muted">${row.label}${row.isDemo ? " · 演示" : ""}</span>
                      <span
                        >${row.status} · 测试版本 ${row.testVersion ?? "—"} · ${row.verifiedAtLabel} · 质量评分 ${row.qualityScoreLabel}${
                          row.isDemo ? " · 模拟结果，不代表真实能力" : ""
                        }</span
                      >
                    </div>
                  `,
                )}
              </div>
            `
      }
      <div class="row row--tight card-follow--xs">
        <button
          class="btn btn--sm"
          type="button"
          disabled
          title="专项评测尚未接入后端，正式结果不可写入"
          data-testid="specialized-eval-formal-disabled"
        >
          运行专项评测（尚未接入）
        </button>
        <button
          class="btn btn--sm"
          type="button"
          title="仅写入演示区，不进入正式 verified / 路由准入"
          data-testid="specialized-eval-demo-run"
          @click=${() => {
            const ids = (asset.capabilityEvidence ?? []).map((item) => item.id).filter(Boolean);
            runDemoSpecializedEval({
              modelRef: asset.modelId,
              capabilityIds: ids.length ? ids : ["coding", "tool_use"],
            });
            requestPlatformSurfaceRerender();
          }}
        >
          演示专项评测
        </button>
      </div>
    </details>
  `;
}

function renderCapabilitySummary(
  capabilities: string[],
  evidence?: ModelAsset["capabilityEvidence"],
) {
  if ((!capabilities || capabilities.length === 0) && (!evidence || evidence.length === 0)) {
    return html`
      <span class="chip">未声明</span>
    `;
  }
  if (evidence && evidence.length > 0) {
    const visible = evidence.slice(0, 3);
    const rest = evidence.length - visible.length;
    return html`
      <div class="chip-row platform-model-assets-table__chips">
        ${visible.map((item) => {
          const isVerified = item.status === "passed";
          const isSuggested = item.status === "suggested" || item.status === "untested";
          const tone = isVerified
            ? "chip-ok"
            : item.status === "failed"
              ? "chip-danger"
              : "chip platform-capability-chip--suggested";
          const suffix = isSuggested
            ? " · 待确认"
            : isVerified
              ? ""
              : ` · ${capabilityStatusLabel(item.status)}`;
          return html`<span class="chip ${tone}" title=${item.sourceNote ?? item.source}
            >${item.label}${suffix}</span
          >`;
        })}
        ${rest > 0 ? html`<span class="chip">+${rest}</span>` : nothing}
      </div>
    `;
  }
  const visible = capabilities.slice(0, 3);
  const rest = capabilities.length - visible.length;
  return html`
    <div class="chip-row platform-model-assets-table__chips">
      ${visible.map(
        (capability) => html`<span class="chip platform-capability-chip--suggested"
          >${capabilityLabel(capability)} · 待确认</span
        >`,
      )}
      ${rest > 0 ? html`<span class="chip">+${rest}</span>` : nothing}
    </div>
  `;
}

function renderHealthBadge(health: ModelAsset["health"]) {
  const tone =
    health === "healthy" ? "chip-ok" : health === "degraded" ? "chip-warn" : "chip-danger";
  return html`<span class="chip ${tone}">${healthLabel(health)}</span>`;
}

function healthBasisLabel(basis: ModelAsset["healthBasis"]) {
  switch (basis) {
    case "live_probe_ok":
      return "真实探测成功";
    case "live_probe_failed":
      return "真实探测失败";
    case "catalog_verified":
      return "目录探测";
    case "catalog_missing":
      return "目录缺失";
    case "auth_missing":
      return "凭证缺失";
    default:
      return "配置推导";
  }
}

function renderHealthSummary(asset: ModelAsset) {
  if (!hasSuccessfulModelConnection(asset)) {
    return html`
      <span class="chip chip-danger">未连通</span>
    `;
  }
  return renderHealthBadge(asset.health);
}

function actionHintCallout(context?: PlatformModelsTabContext) {
  if (!context?.actionHint) {
    return "";
  }
  const source = context.sourceModelId ? `，当前问题模型 ${context.sourceModelId}` : "";
  const suggestion = context.suggestedModelId ? `，建议优先评估 ${context.suggestedModelId}` : "";
  if (context.actionHint === "replace_model") {
    return `当前从 Issues 跳转而来：请优先评估替换模型${source}${suggestion}。`;
  }
  if (context.actionHint === "add_fallback") {
    return `当前从 Issues 跳转而来：请优先补充 fallback${source}${suggestion}。`;
  }
  return `当前从 Issues 跳转而来：请优先检查当前路由策略${suggestion}。`;
}

function findAssetByModelId(models: ModelAsset[], modelId?: string) {
  if (!modelId) {
    return null;
  }
  return models.find((asset) => asset.modelId === modelId) ?? null;
}

function renderActionPrefillPanel(
  vm: ModelAssetsVM,
  context: PlatformModelsTabContext | undefined,
  onNavigateTab: (tab: OverviewNavigateTab, context?: PlatformModelsTabContext) => void,
) {
  if (!context?.actionHint) {
    return html``;
  }
  const sourceAsset = findAssetByModelId(vm.models, context.sourceModelId);
  const suggestedAsset = findAssetByModelId(vm.models, context.suggestedModelId);
  if (!sourceAsset && !suggestedAsset) {
    return html``;
  }
  return html`
    <section class="card card-follow">
      <div class="card-title">已自动填充修复建议</div>
      <div class="grid grid-cols-2 card-follow">
        ${
          sourceAsset
            ? html`
                <section class="card">
                  <div class="card-title">问题模型</div>
                  <div class="list card-follow">
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">${sourceAsset.displayName}</div>
                        <div class="list-sub">${sourceAsset.modelId}</div>
                      </div>
                      ${renderHealthSummary(sourceAsset)}
                    </div>
                  </div>
                </section>
              `
            : html``
        }
        ${
          suggestedAsset
            ? html`
                <section class="card">
                  <div class="card-title">建议模型</div>
                  <div class="list card-follow">
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">${suggestedAsset.displayName}</div>
                        <div class="list-sub">${suggestedAsset.modelId}</div>
                      </div>
                      <span class="chip ok">已预选</span>
                    </div>
                  </div>
                </section>
              `
            : html``
        }
      </div>
      <div class="row row--tight card-follow row--wrap">
        ${
          context.suggestedModelId
            ? html`
                <button
                  class="btn btn--sm"
                  type="button"
                  @click=${() =>
                    updateFilterState({
                      search: context.suggestedModelId ?? "",
                      selectedModelId: context.suggestedModelId ?? null,
                    })}
                >
                  聚焦建议模型
                </button>
              `
            : ""
        }
        <button
          class="btn btn--sm"
          type="button"
          @click=${() =>
            onNavigateTab("smartRouting", {
              ...(context.planId ? { planId: context.planId } : {}),
              ...(context.taskProfileId ? { taskProfileId: context.taskProfileId } : {}),
              ...(context.policyId ? { policyId: context.policyId } : {}),
              ...(context.sourceModelId ? { sourceModelId: context.sourceModelId } : {}),
              ...(context.suggestedModelId ? { suggestedModelId: context.suggestedModelId } : {}),
              ...(context.actionHint ? { actionHint: context.actionHint } : {}),
            })}
        >
          回到路由策略继续处理
        </button>
      </div>
    </section>
  `;
}

function modelSourceLabel(source: ModelAsset["source"]) {
  switch (source) {
    case "configured":
      return "显式配置";
    case "referenced":
      return "引用补全";
    default:
      return "目录发现";
  }
}

function modelConfigStateLabel(source: ModelAsset["source"]) {
  switch (source) {
    case "configured":
      return "已配置";
    case "referenced":
      return "已引用未入池";
    default:
      return "待入池";
  }
}

function renderModelSourceBadge(source: ModelAsset["source"]) {
  const tone = source === "configured" ? "ok" : source === "referenced" ? "warn" : "";
  return html`<span class="chip ${tone}">${modelSourceLabel(source)}</span>`;
}

function matchesFilters(asset: ModelAsset, filterState: ModelAssetFilterState) {
  const search = filterState.search.trim().toLowerCase();
  if (search) {
    const haystacks = [
      asset.displayName,
      asset.modelId,
      asset.providerId,
      asset.providerName ?? "",
    ].map((value) => value.toLowerCase());
    if (!haystacks.some((value) => value.includes(search))) {
      return false;
    }
  }
  if (filterState.providers.length > 0 && !filterState.providers.includes(asset.providerId)) {
    return false;
  }
  if (
    filterState.modalities.length > 0 &&
    !filterState.modalities.every(
      (modality) =>
        asset.inputModalities.includes(modality as never) ||
        asset.outputModalities.includes(modality as never),
    )
  ) {
    return false;
  }
  if (
    filterState.capabilities.length > 0 &&
    !assetMatchesRequiredCapabilities(asset.capabilities, filterState.capabilities)
  ) {
    return false;
  }
  if (filterState.costTiers.length > 0 && !filterState.costTiers.includes(asset.costTier)) {
    return false;
  }
  if (filterState.healthStates.length > 0 && !filterState.healthStates.includes(asset.health)) {
    return false;
  }
  if (
    filterState.taskTags.length > 0 &&
    !filterState.taskTags.every((tag) => asset.taskTags.includes(tag))
  ) {
    return false;
  }
  if (filterState.recommendationPool === "yes" && !asset.inRecommendationPool) {
    return false;
  }
  if (filterState.recommendationPool === "no" && asset.inRecommendationPool) {
    return false;
  }
  if (filterState.tenantSelectable === "yes" && !asset.tenantSelectable) {
    return false;
  }
  if (filterState.tenantSelectable === "no" && asset.tenantSelectable) {
    return false;
  }
  return true;
}

function compareAssets(
  left: ModelAsset,
  right: ModelAsset,
  field: ModelAssetsVM["defaultSort"]["field"],
) {
  switch (field) {
    case "providerId":
      return left.providerId.localeCompare(right.providerId);
    case "calls7d":
      return (left.usage7d?.calls ?? -1) - (right.usage7d?.calls ?? -1);
    case "cost7d":
      return (left.usage7d?.cost ?? -1) - (right.usage7d?.cost ?? -1);
    case "avgLatencyMs":
      return (
        (left.avgLatencyMs ?? Number.MAX_SAFE_INTEGER) -
        (right.avgLatencyMs ?? Number.MAX_SAFE_INTEGER)
      );
    case "stabilityScore":
      return (left.stabilityScore ?? -1) - (right.stabilityScore ?? -1);
    case "costTier": {
      const order = { low: 0, medium: 1, high: 2, unknown: 3 };
      return order[left.costTier] - order[right.costTier];
    }
    case "health": {
      const order = { healthy: 0, degraded: 1, unavailable: 2 };
      return order[left.health] - order[right.health];
    }
    default:
      return left.displayName.localeCompare(right.displayName);
  }
}

function filterAndSortModels(vm: ModelAssetsVM) {
  ensureFilterDefaults(vm.defaultSort);
  const filtered = vm.models.filter((asset) => matchesFilters(asset, modelAssetsFilterState));
  const sorted = [...filtered].toSorted((left, right) => {
    const delta = compareAssets(left, right, modelAssetsFilterState.sortField);
    return modelAssetsFilterState.sortDirection === "asc" ? delta : -delta;
  });
  return sorted;
}

function renderSummaryCards(poolModels: ModelAsset[], vm: ModelAssetsVM) {
  const usageModels = poolModels.filter((asset) => asset.usage7d?.calls && asset.usage7d.calls > 0);
  const totalCalls = usageModels.reduce((sum, asset) => sum + (asset.usage7d?.calls ?? 0), 0);
  const totalCost = usageModels.reduce((sum, asset) => sum + (asset.usage7d?.cost ?? 0), 0);
  const avgLatency =
    usageModels.length > 0
      ? Math.round(
          usageModels.reduce((sum, asset) => sum + (asset.avgLatencyMs ?? 0), 0) /
            usageModels.length,
        )
      : null;
  const avgCostPerCall = totalCalls > 0 ? totalCost / totalCalls : null;
  const unhealthyModels = poolModels.filter(
    (asset) => asset.health === "degraded" || asset.health === "unavailable",
  ).length;
  const cards = [
    {
      label: "模型总数",
      value: poolModels.length,
      testId: "model-pool-total",
      onClick: () => {
        resetFilterState(vm.defaultSort);
        requestRerender();
      },
    },
    {
      label: "活跃模型（7天）",
      value: usageModels.length,
      onClick: () => {
        updateFilterState({ sortField: "calls7d", sortDirection: "desc" });
      },
    },
    {
      label: "健康模型",
      value: poolModels.filter((asset) => asset.health === "healthy").length,
      onClick: () => updateFilterState({ healthStates: ["healthy"] }),
    },
    {
      label: "不健康模型",
      value: unhealthyModels,
      tone: unhealthyModels > 0 ? "warn" : "neutral",
      onClick: () => updateFilterState({ healthStates: ["degraded", "unavailable"] }),
    },
    {
      label: "平均成本（输入/1K tokens）",
      value: avgCostPerCall != null ? formatCost(avgCostPerCall) : "-",
      onClick: () => updateFilterState({ sortField: "cost7d", sortDirection: "desc" }),
    },
    {
      label: "平均延迟",
      value: avgLatency != null ? `${avgLatency}ms` : "-",
      onClick: () => updateFilterState({ sortField: "avgLatencyMs", sortDirection: "asc" }),
    },
  ];
  return html`
    <div class="platform-model-assets-summary">
      ${cards.map(
        (card) => html`
          <button
            class="platform-model-assets-summary__card"
            data-tone=${"tone" in card ? card.tone : "neutral"}
            type="button"
            @click=${card.onClick}
          >
            <div class="platform-model-assets-summary__label">${card.label}</div>
            <div
              class="platform-model-assets-summary__value"
              data-testid=${"testId" in card ? card.testId : nothing}
            >
              ${card.value}
            </div>
          </button>
        `,
      )}
    </div>
  `;
}

function renderFilterBar(vm: ModelAssetsVM, visibleCount: number, poolTotal: number) {
  const primaryProvider = modelAssetsFilterState.providers[0] ?? "";
  const filterCount = activeFilterCount(modelAssetsFilterState);
  return html`
    <div class="platform-model-assets-topbar">
      <div class="platform-model-assets-topbar__meta">
        <span class="platform-model-assets-topbar__count" data-testid="model-assets-visible-count">
          显示 ${visibleCount} / ${poolTotal} 个模型
        </span>
        ${
          filterCount > 0
            ? html`<span class="chip chip-warn">已启用 ${filterCount} 项筛选</span>`
            : nothing
        }
      </div>
      <div class="platform-model-assets-topbar__tools">
        <select
          class="platform-model-assets-control"
          .value=${primaryProvider}
          aria-label="Provider"
          @change=${(event: Event) =>
            updateFilterState({
              providers:
                event.currentTarget instanceof HTMLSelectElement && event.currentTarget.value
                  ? [event.currentTarget.value]
                  : [],
            })}
        >
          <option value="">所有 Provider</option>
          ${vm.filters.providers.map(
            (providerId) => html`<option value=${providerId}>${providerId}</option>`,
          )}
        </select>
        <label class="platform-model-assets-search">
          ${renderIcon("search", "platform-model-assets-search__icon")}
          <input
            .value=${modelAssetsFilterState.search}
            placeholder="搜索模型名称 / ID"
            aria-label="搜索模型名称或 ID"
            @input=${(event: Event) =>
              updateFilterState({
                search:
                  event.currentTarget instanceof HTMLInputElement ? event.currentTarget.value : "",
              })}
          />
        </label>
        <details class="platform-model-assets-filter-popover">
          <summary class="platform-model-assets-icon-button" aria-label="筛选">
            ${renderIcon("filter", "platform-model-assets-icon-button__icon")}
          </summary>
          <section class="platform-model-assets-filter-panel">
            <div class="platform-model-assets-filter-panel__grid">
              <label class="field">
                <span>推荐池</span>
                <select
                  .value=${modelAssetsFilterState.recommendationPool}
                  @change=${(event: Event) =>
                    updateFilterState({
                      recommendationPool:
                        event.currentTarget instanceof HTMLSelectElement
                          ? (event.currentTarget
                              .value as ModelAssetFilterState["recommendationPool"])
                          : "all",
                    })}
                >
                  <option value="all">全部</option>
                  <option value="yes">已加入</option>
                  <option value="no">未加入</option>
                </select>
              </label>
              <label class="field">
                <span>租户可选</span>
                <select
                  .value=${modelAssetsFilterState.tenantSelectable}
                  @change=${(event: Event) =>
                    updateFilterState({
                      tenantSelectable:
                        event.currentTarget instanceof HTMLSelectElement
                          ? (event.currentTarget.value as ModelAssetFilterState["tenantSelectable"])
                          : "all",
                    })}
                >
                  <option value="all">全部</option>
                  <option value="yes">允许</option>
                  <option value="no">不允许</option>
                </select>
              </label>
              <label class="field">
                <span>健康状态</span>
                <select
                  .value=${modelAssetsFilterState.healthStates[0] ?? ""}
                  @change=${(event: Event) =>
                    updateFilterState({
                      healthStates:
                        event.currentTarget instanceof HTMLSelectElement &&
                        event.currentTarget.value
                          ? [event.currentTarget.value as ModelAsset["health"]]
                          : [],
                    })}
                >
                  <option value="">全部</option>
                  ${vm.filters.healthStates.map(
                    (state) => html`<option value=${state}>${healthLabel(state)}</option>`,
                  )}
                </select>
              </label>
              <label class="field">
                <span>成本档位</span>
                <select
                  .value=${modelAssetsFilterState.costTiers[0] ?? ""}
                  @change=${(event: Event) =>
                    updateFilterState({
                      costTiers:
                        event.currentTarget instanceof HTMLSelectElement &&
                        event.currentTarget.value
                          ? [event.currentTarget.value as ModelAsset["costTier"]]
                          : [],
                    })}
                >
                  <option value="">全部</option>
                  ${vm.filters.costTiers.map(
                    (tier) => html`<option value=${tier}>${costTierLabel(tier)}</option>`,
                  )}
                </select>
              </label>
              <label class="field">
                <span>输入输出</span>
                <select
                  .value=${modelAssetsFilterState.modalities[0] ?? ""}
                  @change=${(event: Event) =>
                    updateFilterState({
                      modalities:
                        event.currentTarget instanceof HTMLSelectElement &&
                        event.currentTarget.value
                          ? [event.currentTarget.value]
                          : [],
                    })}
                >
                  <option value="">全部</option>
                  ${vm.filters.modalities.map(
                    (modality) => html`<option value=${modality}>${modality}</option>`,
                  )}
                </select>
              </label>
              <label class="field">
                <span>能力</span>
                <select
                  .value=${modelAssetsFilterState.capabilities[0] ?? ""}
                  @change=${(event: Event) =>
                    updateFilterState({
                      capabilities:
                        event.currentTarget instanceof HTMLSelectElement &&
                        event.currentTarget.value
                          ? [event.currentTarget.value]
                          : [],
                    })}
                >
                  <option value="">全部</option>
                  ${vm.filters.capabilities.map(
                    (capability) => html`<option value=${capability}>${capability}</option>`,
                  )}
                </select>
              </label>
              <label class="field">
                <span>排序</span>
                <select
                  .value=${modelAssetsFilterState.sortField}
                  @change=${(event: Event) =>
                    updateFilterState({
                      sortField:
                        event.currentTarget instanceof HTMLSelectElement
                          ? (event.currentTarget.value as ModelAssetsVM["defaultSort"]["field"])
                          : vm.defaultSort.field,
                    })}
                >
                  <option value="displayName">模型名称</option>
                  <option value="providerId">Provider</option>
                  <option value="calls7d">7 日调用</option>
                  <option value="cost7d">7 日成本</option>
                  <option value="avgLatencyMs">平均延迟</option>
                  <option value="stabilityScore">稳定性</option>
                  <option value="costTier">成本档位</option>
                  <option value="health">健康状态</option>
                </select>
              </label>
            </div>
            <div class="row row--end card-follow--sm">
              <button
                class="btn btn--sm"
                type="button"
                @click=${() => {
                  resetFilterState(vm.defaultSort);
                  requestRerender();
                }}
              >
                清空筛选
              </button>
            </div>
          </section>
        </details>
        <button
          class="btn btn--primary platform-model-assets-add-btn"
          type="button"
          @click=${openAddModelDialog}
        >
          + 添加模型
        </button>
      </div>
    </div>
  `;
}

function renderModelDetailDrawer(params: {
  selectedModel: ModelAsset | null;
  actions: PlatformModelsActions;
  canManage: boolean;
  onToggleRecommendationPool?: (modelId: string, nextValue: boolean) => void;
  onNavigateTab: (tab: OverviewNavigateTab, context?: PlatformModelsTabContext) => void;
  context?: PlatformModelsTabContext;
}) {
  const { selectedModel, actions, canManage, onToggleRecommendationPool, onNavigateTab, context } =
    params;
  if (!selectedModel) {
    return html``;
  }
  const usageMissing = selectedModel.usage7d == null;
  return html`
    <div
      class="model-assets-drawer-overlay"
      role="dialog"
      aria-modal="true"
      data-testid="model-detail-drawer"
      @click=${closeModelDetailDrawer}
    >
      <aside
        class="model-assets-drawer model-assets-drawer--flat"
        @click=${(event: Event) => event.stopPropagation()}
      >
        <div class="model-assets-drawer__header">
          <div>
            <div class="card-title">模型详情</div>
            <div class="muted card-follow--xs">在此完成接入验证、入池与治理操作</div>
          </div>
          <button class="btn btn--sm" type="button" @click=${closeModelDetailDrawer}>关闭</button>
        </div>

        <div class="model-assets-drawer__hero model-assets-drawer__hero--flat">
          <div class="model-assets-drawer__title">${selectedModel.displayName}</div>
          <div class="chip-row model-assets-drawer__chips">
            ${renderModelSourceBadge(selectedModel.source)}
            <span class="chip">${modelConfigStateLabel(selectedModel.source)}</span>
            <span class="chip">${selectedModel.providerName ?? selectedModel.providerId}</span>
            ${renderHealthBadge(selectedModel.health)}
            <span class="chip">${healthBasisLabel(selectedModel.healthBasis)}</span>
          </div>
        </div>

        <div class="model-assets-drawer__body model-assets-drawer__body--flat">
          ${
            context?.actionHint
              ? html`
                  <div class="callout info" data-testid="model-detail-action-hint">
                    ${actionHintCallout(context)}
                    ${
                      context.sourceModelId && context.sourceModelId !== selectedModel.modelId
                        ? html`<div class="card-follow--xs">
                            当前已自动打开建议模型详情，原问题模型为 ${context.sourceModelId}。
                          </div>`
                        : ""
                    }
                  </div>
                `
              : ""
          }
          ${renderModelVerificationSection(selectedModel, actions, canManage)}
          ${renderDrawerActionSection({
            selectedModel,
            actions,
            canManage,
            onToggleRecommendationPool,
            onNavigateTab,
          })}

          <details class="model-assets-drawer__fold" data-testid="model-detail-basics">
            <summary class="model-assets-drawer__fold-title">接入信息</summary>
            <div class="model-assets-drawer__kv-stack">
              ${renderDrawerKvRow("推荐池（入池）", selectedModel.inRecommendationPool ? "已加入" : "未加入")}
              ${renderDrawerKvRow("租户可选", tenantSelectableLabel(selectedModel))}
              ${renderDrawerKvRow(
                "自动路由",
                `${autoRoutingAdmissionLabel(selectedModel)}${
                  selectedModel.autoRoutingReason ? ` · ${selectedModel.autoRoutingReason}` : ""
                }`,
              )}
              ${renderDrawerKvRow(
                "执行路径",
                selectedModel.executorPathBadge ??
                  resolveExecutorPathLabel({
                    modelId: selectedModel.modelId,
                    providerId: selectedModel.providerId,
                    outputModalities: selectedModel.outputModalities,
                    taskTags: selectedModel.taskTags,
                  }).badge,
              )}
              ${
                isConnectionVerificationStale(selectedModel)
                  ? html`
                      <div class="callout warn card-follow--xs">配置已变更，需重新验证连接</div>
                    `
                  : ""
              }
            </div>
          </details>

          <details class="model-assets-drawer__fold" open>
            <summary class="model-assets-drawer__fold-title">能力档案</summary>
            <div class="model-assets-drawer__kv-stack">
              ${renderDrawerKvRow(
                "输入 / 输出",
                `${selectedModel.inputModalities.join(", ") || "未知"} → ${selectedModel.outputModalities.join(", ") || "未知"}`,
              )}
              ${renderCapabilityMatrix(selectedModel)}
              ${renderDrawerKvRow(
                "上下文窗口",
                selectedModel.contextWindow
                  ? `${contextWindowLabel(selectedModel.contextWindow)}（${selectedModel.contextWindowSource === "unknown" ? "来源待确认" : (selectedModel.contextWindowSource ?? "catalog")}）`
                  : "未知／待确认",
              )}
              ${renderDrawerKvRow(
                "最大输出",
                selectedModel.maxOutputTokens ? String(selectedModel.maxOutputTokens) : "未知",
              )}
            </div>
          </details>

          <details class="model-assets-drawer__fold">
            <summary class="model-assets-drawer__fold-title">成本与用量</summary>
            ${
              usageMissing
                ? html`
                    <div class="callout card-follow--sm">使用分析数据尚未接入，当前仅展示目录与配置信息。</div>
                  `
                : html`
                    <div class="model-assets-drawer__kv-stack">
                      ${renderDrawerKvRow("成本档位", costTierLabel(selectedModel.costTier))}
                      ${renderDrawerKvRow(
                        "输入 / 输出价格",
                        selectedModel.inputPrice != null && selectedModel.outputPrice != null
                          ? `$${selectedModel.inputPrice} / $${selectedModel.outputPrice} per 1M tokens`
                          : "待补充",
                      )}
                      ${renderDrawerKvRow(
                        "7 日调用",
                        selectedModel.usage7d ? `${selectedModel.usage7d.calls} 次` : "未接入",
                      )}
                      ${renderDrawerKvRow(
                        "7 日成本",
                        selectedModel.usage7d ? formatCost(selectedModel.usage7d.cost) : "-",
                      )}
                      ${renderDrawerKvRow(
                        "成功率",
                        selectedModel.usage7d?.successRate != null
                          ? `${selectedModel.usage7d.successRate}%`
                          : "未接入",
                      )}
                      ${renderDrawerKvRow(
                        "平均延迟",
                        selectedModel.avgLatencyMs != null
                          ? `${selectedModel.avgLatencyMs}ms`
                          : "未接入",
                      )}
                    </div>
                  `
            }
          </details>

          <details class="model-assets-drawer__fold">
            <summary class="model-assets-drawer__fold-title">任务与治理</summary>
            <div class="model-assets-drawer__kv-stack">
              ${renderDrawerKvRow(
                "任务标签",
                selectedModel.taskTags.join(", ") || "暂未绑定任务方案",
              )}
              ${renderDrawerKvRow(
                "关联 ModelPlan",
                selectedModel.inRecommendationPool ? "已进入候选方案池" : "暂未进入标准方案池",
              )}
            </div>
            ${
              selectedModel.governance?.issueCount
                ? html`
                    <div class="callout warn card-follow--sm">
                      ${selectedModel.governance.issueCount} 个关联治理问题（最高严重度
                      ${selectedModel.governance.highestSeverity ?? "info"}）
                    </div>
                    <div class="row row--tight card-follow--sm row--wrap">
                      <button
                        class="btn btn--sm btn--primary"
                        type="button"
                        @click=${() => onNavigateTab("governance", { modelId: selectedModel.modelId })}
                      >
                        查看治理告警
                      </button>
                    </div>
                  `
                : html`
                    <div class="callout card-follow--sm">暂无治理问题</div>
                  `
            }
          </details>
        </div>
      </aside>
    </div>
  `;
}

async function verifyPendingModel(asset: ModelAsset, actions: PlatformModelsActions) {
  await verifyModelCall(asset.modelId, actions, {
    providerId: asset.providerId,
    baseUrl: asset.baseUrl,
    api: asset.api,
  });
}

async function importPendingModel(asset: ModelAsset, actions: PlatformModelsActions) {
  if (!hasSuccessfulModelConnection(asset)) {
    return;
  }
  await commitPoolImport({ asset, actions, connectionVerified: true });
  requestRerender();
}

function renderModelVerificationSection(
  selectedModel: ModelAsset,
  actions: PlatformModelsActions,
  canManage: boolean,
) {
  const verification =
    modelVerificationState?.modelId === selectedModel.modelId ? modelVerificationState : null;
  const liveProbe = selectedModel.liveProbe;
  const phase =
    verification?.phase ?? (liveProbe?.status === "ok" ? "success" : liveProbe ? "failed" : null);
  const rawMessage =
    verification?.message ??
    (liveProbe?.status === "ok"
      ? `最近一次调用测试成功${liveProbe.latencyMs != null ? `，延迟 ${liveProbe.latencyMs}ms` : ""}。`
      : (liveProbe?.error ?? (liveProbe ? "最近一次调用测试失败。" : "保存后尚未执行调用测试。")));
  const message = formatOperatorProbeMessage(rawMessage);
  const latencyMs =
    verification?.latencyMs ??
    (phase !== "probing" && liveProbe?.latencyMs != null ? liveProbe.latencyMs : undefined);
  const tone =
    phase === "probing"
      ? "info"
      : phase === "success" || liveProbe?.status === "ok"
        ? "ok"
        : phase === "failed"
          ? "danger"
          : "neutral";
  return html`
    <section class="model-assets-drawer__section model-assets-drawer__section--full">
      <div class="card-title">接入验证</div>
      <div class="callout ${tone} card-follow" data-testid="model-verification-panel">
        ${
          phase === "probing"
            ? html`
                <div>正在验证模型是否可正常调用…</div>
              `
            : html`
                <div>${message}</div>
                ${
                  latencyMs != null
                    ? html`<div class="muted card-follow--xs">延迟 ${latencyMs}ms</div>`
                    : ""
                }
              `
        }
      </div>
      <div class="row row--tight card-follow--sm row--wrap">
        <button
          class="btn btn--sm btn--primary"
          type="button"
          ?disabled=${!canManage || !actions.onProbeHealth || phase === "probing"}
          @click=${() =>
            void verifyModelCall(selectedModel.modelId, actions, {
              providerId: selectedModel.providerId,
              baseUrl: selectedModel.baseUrl,
              api: selectedModel.api,
            })}
        >
          ${phase === "probing" ? "测试中…" : "重新测试调用"}
        </button>
      </div>
    </section>
  `;
}

function renderDrawerActionSection(params: {
  selectedModel: ModelAsset;
  actions: PlatformModelsActions;
  canManage: boolean;
  onToggleRecommendationPool?: (modelId: string, nextValue: boolean) => void;
  onNavigateTab: (tab: OverviewNavigateTab, context?: PlatformModelsTabContext) => void;
}) {
  const { selectedModel, actions, canManage, onToggleRecommendationPool, onNavigateTab } = params;
  return html`
    <section
      class="model-assets-drawer__section model-assets-drawer__section--full model-assets-drawer__section--actions"
    >
      <div class="card-title">治理操作</div>
      <div class="model-assets-drawer__action-grid">
        ${
          isManagedPoolModel(selectedModel)
            ? html`
                <span class="chip ok">已入模型池</span>
              `
            : hasSuccessfulModelConnection(selectedModel)
              ? html`
                  <button
                    class="btn btn--sm btn--primary"
                    type="button"
                    data-testid="model-drawer-import"
                    ?disabled=${!canManage}
                    @click=${() => void importPendingModel(selectedModel, actions)}
                  >
                    入池
                  </button>
                `
              : html`
                  <button
                    class="btn btn--sm btn--primary"
                    type="button"
                    data-testid="model-drawer-verify"
                    ?disabled=${!canManage}
                    @click=${() => void verifyPendingModel(selectedModel, actions)}
                  >
                    验证连接
                  </button>
                `
        }
        <button
          class="btn btn--sm"
          type="button"
          ?disabled=${!onToggleRecommendationPool}
          title=${onToggleRecommendationPool ? "" : "写入能力待接入"}
          @click=${() => onToggleRecommendationPool?.(selectedModel.modelId, !selectedModel.inRecommendationPool)}
        >
          ${selectedModel.inRecommendationPool ? "移出推荐池" : "加入推荐池"}
        </button>
        <button
          class="btn btn--sm"
          type="button"
          ?disabled=${true}
          title="租户可选准入尚未接入后端，当前不可操作"
          data-testid="model-drawer-tenant-selectable"
        >
          允许租户选择（尚未接入）
        </button>
        <button
          class="btn btn--sm"
          type="button"
          data-testid="model-drawer-auto-routing"
          ?disabled=${true}
          title="自动路由准入尚未接入后端，当前不可操作"
        >
          启用自动路由（尚未接入）
        </button>
        <button
          class="btn btn--sm"
          type="button"
          data-testid="model-drawer-verify-capabilities"
          ?disabled=${!canManage}
          title="发起正式协议探测（local_protocol）；不调用付费 Midjourney/Suno API"
          @click=${() => void runFormalCapabilityVerification(selectedModel)}
        >
          验证能力
        </button>
        <button
          class="btn btn--sm"
          type="button"
          data-testid="model-drawer-cancel-verification"
          title="取消进行中的验证任务"
          @click=${() => {
            const active = listVerificationTasks(selectedModel.modelId).find(
              (t) => t.status === "queued" || t.status === "running",
            );
            if (active) {
              void cancelCapabilityVerification(active.taskId).then(() =>
                requestPlatformSurfaceRerender(),
              );
            }
          }}
        >
          取消验证
        </button>
        <button
          class="btn btn--sm"
          type="button"
          data-testid="model-drawer-retry-verification"
          title="重试最近一次验证"
          @click=${() => void runFormalCapabilityVerification(selectedModel)}
        >
          重试验证
        </button>
        <button
          class="btn btn--sm"
          type="button"
          @click=${() => onNavigateTab("usageAnalytics", { modelId: selectedModel.modelId })}
        >
          使用分析
        </button>
        <button
          class="btn btn--sm"
          type="button"
          @click=${() => onNavigateTab("taskPlans", { modelId: selectedModel.modelId })}
        >
          任务方案
        </button>
        <button
          class="btn btn--sm"
          type="button"
          @click=${() => onNavigateTab("governance", { modelId: selectedModel.modelId })}
        >
          治理告警
        </button>
      </div>
    </section>
  `;
}

function renderBootstrapEntry(params: {
  emptyState: NonNullable<ModelAssetsVM["emptyState"]>;
  actions: PlatformModelsActions;
  compat?: LegacyPlatformModelsVM | null;
  onNavigateTab: (tab: OverviewNavigateTab, context?: PlatformModelsTabContext) => void;
}) {
  const { emptyState, actions, compat, onNavigateTab } = params;
  const canManage = compat?.canManage ?? true;
  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
    if (!form) {
      return;
    }
    const inputs = buildBootstrapModelInputs(form);
    if (inputs.length === 0) {
      return;
    }
    void commitAddedModels(inputs, actions).finally(() => {
      form.reset();
    });
  };
  return html`
    <section class="card">
      <div class="card-title">${emptyState.title}</div>
      <div class="card-sub">${emptyState.description}</div>
      <div class="row row--tight card-follow row--wrap">
        <button class="btn btn--sm" type="button" disabled title="跨端跳转待接入">
          ${emptyState.primaryActionLabel ?? "打开模型管理"}
        </button>
        <button class="btn btn--sm" type="button" @click=${() => onNavigateTab("smartRouting")}>
          先看路由设计
        </button>
      </div>
    </section>
    <section class="card card-follow">
      <div class="row row--split row--top">
        <div>
          <div class="card-title">手动添加模型</div>
        </div>
        ${
          compat
            ? html`
                <div class="row row--tight row--wrap">
                  ${
                    compat.configDirty
                      ? html`
                          <span class="chip warn">有未保存配置</span>
                        `
                      : html`
                          <span class="chip">配置已同步</span>
                        `
                  }
                  <button
                    class="btn btn--sm"
                    type="button"
                    ?disabled=${!canManage || !compat.configDirty || compat.configSaving}
                    @click=${() => actions.onSaveConfig()}
                  >
                    ${compat.configSaving ? "保存中" : "保存配置"}
                  </button>
                </div>
              `
            : html`
                <span class="chip">添加后请保存平台配置</span>
              `
        }
      </div>
      ${
        canManage
          ? html``
          : html`
              <div class="callout card-follow">
                当前会话没有平台配置写入权限，只能查看接入说明，不能提交首个模型。
              </div>
            `
      }
      <form class="card-follow" @submit=${onSubmit}>
        <div class="grid grid-cols-3">
          <label class="field">
            <span>Provider ID</span>
            <input
              name="providerId"
              placeholder="openai / anthropic / openrouter"
              ?disabled=${!canManage}
            />
          </label>
          <label class="field">
            <span>Model ID</span>
            <input name="modelId" placeholder="gpt-5.4" ?disabled=${!canManage} />
          </label>
          <label class="field">
            <span>显示名称</span>
            <input name="name" placeholder="GPT 5.4" ?disabled=${!canManage} />
          </label>
          <label class="field">
            <span>API 类型</span>
            <select name="api" ?disabled=${!canManage}>
              <option value="openai-responses">openai-responses</option>
              <option value="openai-completions">openai-completions</option>
              <option value="anthropic-messages">anthropic-messages</option>
              <option value="google-generative-ai">google-generative-ai</option>
              <option value="bedrock-converse-stream">bedrock-converse-stream</option>
              <option value="ollama">ollama</option>
            </select>
          </label>
          <label class="field">
            <span>Base URL</span>
            <input name="baseUrl" placeholder="已有 provider 可留空继承" ?disabled=${!canManage} />
          </label>
          <label class="field">
            <span>调用类型</span>
            <select name="callType" ?disabled=${!canManage}>
              <option value="text_chat">文本对话</option>
              <option value="image_generation">图片生成 · Stepfun</option>
              <option value="music_generation">音乐生成 · Suno 兼容</option>
            </select>
          </label>
          <label class="field">
            <span>输入类型（未知可留空）</span>
            <input
              name="inputModes"
              value=""
              placeholder="待确认，例如 text,image"
              ?disabled=${!canManage}
            />
          </label>
          <label class="field">
            <span>上下文窗口（未知可留空）</span>
            <input
              name="contextWindow"
              type="number"
              min="1"
              value=""
              placeholder="待确认建议值，勿填臆造默认"
              ?disabled=${!canManage}
            />
          </label>
          <label class="field">
            <span>最大输出（未知可留空）</span>
            <input
              name="maxTokens"
              type="number"
              min="1"
              value=""
              placeholder="待确认"
              ?disabled=${!canManage}
            />
          </label>
          <label class="field">
            <span>推理能力（声明，非验证）</span>
            <span class="row row--field-height">
              <input name="reasoning" type="checkbox" ?disabled=${!canManage} />
              <span class="muted">仅作建议标签，不会标为已验证</span>
            </span>
          </label>
        </div>
        <div class="callout card-follow--sm">
          图片生成实际执行路径为 Stepfun；音乐为 Suno 兼容端点。输入 Midjourney 关键词不会显示为已接入原生 Midjourney。
        </div>
        <div class="row row--end row--tight card-follow--sm">
          <button class="btn btn--sm" type="button" @click=${() => onNavigateTab("usageAnalytics")}>
            查看使用分析结构
          </button>
          <button class="btn" type="submit" name="intent" value="save" ?disabled=${!canManage}>
            保存配置
          </button>
          <button class="btn btn--primary" type="submit" name="intent" value="verify" ?disabled=${!canManage}>
            验证连接
          </button>
        </div>
      </form>
      <div class="callout card-follow">
        建议顺序：先填写提供方并验证连接，成功后再进入模型池；随后配置 Task Plans、Smart Routing 和
        Governance。
      </div>
    </section>
  `;
}

function renderAddModelWorkbench(params: {
  actions: PlatformModelsActions;
  compat?: LegacyPlatformModelsVM | null;
  onNavigateTab: (tab: OverviewNavigateTab, context?: PlatformModelsTabContext) => void;
}) {
  const { actions, compat } = params;
  const canManage = compat?.canManage ?? true;

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
    if (!form) {
      return;
    }
    const inputs = buildBootstrapModelInputs(form);
    if (inputs.length === 0) {
      return;
    }
    void commitAddedModels(inputs, actions).finally(() => {
      form.reset();
      closeAddModelDialog();
    });
  };

  // Model catalog — comprehensive list
  const modelCatalog = [
    {
      id: "gpt-4o",
      name: "GPT-4o",
      provider: "openai",
      category: "通用",
      tags: ["推荐", "多模态"],
      description: "最强通用能力，支持图像/语音",
      costLabel: "中",
      costTier: "medium" as const,
      contextWindow: 128000,
      maxTokens: 16384,
      inputModes: "text,image",
      api: "openai-responses",
      reasoning: false,
    },
    {
      id: "gpt-4o-mini",
      name: "GPT-4o Mini",
      provider: "openai",
      category: "通用",
      tags: ["高性价比"],
      description: "轻量快速，适合批量处理",
      costLabel: "低",
      costTier: "low" as const,
      contextWindow: 128000,
      maxTokens: 16384,
      inputModes: "text,image",
      api: "openai-responses",
      reasoning: false,
    },
    {
      id: "o3",
      name: "o3",
      provider: "openai",
      category: "推理",
      tags: ["最强推理"],
      description: "顶级推理能力，复杂问题求解",
      costLabel: "高",
      costTier: "high" as const,
      contextWindow: 200000,
      maxTokens: 100000,
      inputModes: "text,image",
      api: "openai-responses",
      reasoning: true,
    },
    {
      id: "o3-mini",
      name: "o3-mini",
      provider: "openai",
      category: "推理",
      tags: ["推理", "高性价比"],
      description: "高效推理，成本可控",
      costLabel: "中",
      costTier: "medium" as const,
      contextWindow: 200000,
      maxTokens: 100000,
      inputModes: "text",
      api: "openai-responses",
      reasoning: true,
    },
    {
      id: "o4-mini",
      name: "o4-mini",
      provider: "openai",
      category: "推理",
      tags: ["推理"],
      description: "新一代轻量推理模型",
      costLabel: "中",
      costTier: "medium" as const,
      contextWindow: 200000,
      maxTokens: 100000,
      inputModes: "text,image",
      api: "openai-responses",
      reasoning: true,
    },
    {
      id: "gpt-4.1",
      name: "GPT-4.1",
      provider: "openai",
      category: "编程",
      tags: ["编程"],
      description: "编程与指令遵循优化",
      costLabel: "中",
      costTier: "medium" as const,
      contextWindow: 1000000,
      maxTokens: 32768,
      inputModes: "text,image",
      api: "openai-responses",
      reasoning: false,
    },
    {
      id: "gpt-4.1-mini",
      name: "GPT-4.1 Mini",
      provider: "openai",
      category: "编程",
      tags: ["高性价比", "编程"],
      description: "轻量编程模型",
      costLabel: "低",
      costTier: "low" as const,
      contextWindow: 1000000,
      maxTokens: 32768,
      inputModes: "text,image",
      api: "openai-responses",
      reasoning: false,
    },
    {
      id: "gpt-4.1-nano",
      name: "GPT-4.1 Nano",
      provider: "openai",
      category: "通用",
      tags: ["极低成本"],
      description: "极致性价比，简单任务首选",
      costLabel: "低",
      costTier: "low" as const,
      contextWindow: 1000000,
      maxTokens: 32768,
      inputModes: "text,image",
      api: "openai-responses",
      reasoning: false,
    },
    {
      id: "claude-sonnet-4",
      name: "Claude Sonnet 4",
      provider: "anthropic",
      category: "通用",
      tags: ["推荐", "推理"],
      description: "强推理与编程，均衡之选",
      costLabel: "中",
      costTier: "medium" as const,
      contextWindow: 200000,
      maxTokens: 8192,
      inputModes: "text,image",
      api: "anthropic-messages",
      reasoning: true,
    },
    {
      id: "claude-opus-4",
      name: "Claude Opus 4",
      provider: "anthropic",
      category: "推理",
      tags: ["最强推理"],
      description: "顶级推理与创作能力",
      costLabel: "高",
      costTier: "high" as const,
      contextWindow: 200000,
      maxTokens: 8192,
      inputModes: "text,image",
      api: "anthropic-messages",
      reasoning: true,
    },
    {
      id: "claude-haiku-3.5",
      name: "Claude 3.5 Haiku",
      provider: "anthropic",
      category: "通用",
      tags: ["高性价比"],
      description: "快速响应，低成本日常任务",
      costLabel: "低",
      costTier: "low" as const,
      contextWindow: 200000,
      maxTokens: 8192,
      inputModes: "text,image",
      api: "anthropic-messages",
      reasoning: false,
    },
    {
      id: "gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
      provider: "google",
      category: "通用",
      tags: ["长上下文", "推理"],
      description: "超长上下文，文档分析利器",
      costLabel: "低",
      costTier: "low" as const,
      contextWindow: 1000000,
      maxTokens: 8192,
      inputModes: "text,image",
      api: "google-generative-ai",
      reasoning: true,
    },
    {
      id: "gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
      provider: "google",
      category: "通用",
      tags: ["高性价比", "快速"],
      description: "极速响应，适合实时场景",
      costLabel: "低",
      costTier: "low" as const,
      contextWindow: 1000000,
      maxTokens: 8192,
      inputModes: "text,image",
      api: "google-generative-ai",
      reasoning: false,
    },
    {
      id: "deepseek-r1",
      name: "DeepSeek R1",
      provider: "deepseek",
      category: "推理",
      tags: ["推理", "高性价比"],
      description: "开源推理模型，极具性价比",
      costLabel: "低",
      costTier: "low" as const,
      contextWindow: 128000,
      maxTokens: 8192,
      inputModes: "text",
      api: "openai-completions",
      reasoning: true,
    },
    {
      id: "deepseek-v3",
      name: "DeepSeek V3",
      provider: "deepseek",
      category: "通用",
      tags: ["高性价比"],
      description: "通用对话，成本极低",
      costLabel: "低",
      costTier: "low" as const,
      contextWindow: 128000,
      maxTokens: 8192,
      inputModes: "text",
      api: "openai-completions",
      reasoning: false,
    },
    {
      id: "qwen3-235b",
      name: "Qwen3 235B",
      provider: "custom",
      category: "通用",
      tags: ["开源"],
      description: "通义千问旗舰，中文能力突出",
      costLabel: "中",
      costTier: "medium" as const,
      contextWindow: 128000,
      maxTokens: 8192,
      inputModes: "text",
      api: "openai-completions",
      reasoning: true,
    },
    {
      id: "llama-4-maverick",
      name: "Llama 4 Maverick",
      provider: "custom",
      category: "通用",
      tags: ["开源", "多模态"],
      description: "Meta 开源旗舰，多模态支持",
      costLabel: "中",
      costTier: "medium" as const,
      contextWindow: 1000000,
      maxTokens: 8192,
      inputModes: "text,image",
      api: "openai-completions",
      reasoning: false,
    },
    {
      id: "mistral-large",
      name: "Mistral Large",
      provider: "custom",
      category: "通用",
      tags: ["多语言"],
      description: "欧洲旗舰模型，多语言优秀",
      costLabel: "中",
      costTier: "medium" as const,
      contextWindow: 128000,
      maxTokens: 8192,
      inputModes: "text",
      api: "openai-completions",
      reasoning: false,
    },
  ];

  const fillFormFromModel = (model: (typeof modelCatalog)[number], event: Event) => {
    const dialog = (event.currentTarget as HTMLElement).closest("form");
    if (!dialog) {
      return;
    }
    const setVal = (name: string, value: string) => {
      const el = dialog.querySelector<HTMLInputElement>(`[name="${name}"]`);
      if (el) {
        el.value = value;
      }
    };
    const setChecked = (name: string, checked: boolean) => {
      const el = dialog.querySelector<HTMLInputElement>(`[name="${name}"]`);
      if (el) {
        el.checked = checked;
      }
    };
    setVal("providerId", model.provider);
    setVal("name", model.name);
    setVal("modelId", model.id);
    setVal("api", model.api);
    setVal("inputModes", model.inputModes);
    setVal("contextWindow", String(model.contextWindow));
    setVal("maxTokens", String(model.maxTokens));
    setChecked("reasoning", model.reasoning);
    dialog
      .querySelectorAll(".platform-model-add__list-item")
      .forEach((row) => row.classList.remove("is-selected"));
    (event.currentTarget as HTMLElement).classList.add("is-selected");
  };

  const providerGroups = new Map<string, typeof modelCatalog>();
  for (const model of modelCatalog) {
    const list = providerGroups.get(model.provider) ?? [];
    list.push(model);
    providerGroups.set(model.provider, list);
  }
  const providerNames = [...providerGroups.keys()];

  return html`
    <div
      class="platform-model-assets-add-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="添加模型"
      @click=${closeAddModelDialog}
    >
      <section
        class="platform-model-assets-add platform-model-assets-add--split"
        id="platform-model-assets-add-workbench"
        @click=${(event: Event) => event.stopPropagation()}
      >
        <div class="platform-model-assets-add__header">
          <h3>模型配置</h3>
          <button class="btn btn--sm" type="button" @click=${closeAddModelDialog}>✕</button>
        </div>

        <form @submit=${onSubmit} class="platform-model-add__form">
          <div class="platform-model-add__layout">
            <!-- Left: Provider list -->
            <nav class="platform-model-add__sidebar">
              ${providerNames.map(
                (provider, index) => html`
                  <button
                    type="button"
                    class="platform-model-add__sidebar-item ${index === 0 ? "is-active" : ""}"
                    @click=${(event: Event) => {
                      const layout = (event.currentTarget as HTMLElement).closest(
                        ".platform-model-add__layout",
                      );
                      if (!layout) {
                        return;
                      }
                      layout
                        .querySelectorAll(".platform-model-add__sidebar-item")
                        .forEach((el) => el.classList.remove("is-active"));
                      (event.currentTarget as HTMLElement).classList.add("is-active");
                      layout
                        .querySelectorAll(".platform-model-add__provider-panel")
                        .forEach((el) => {
                          (el as HTMLElement).style.display =
                            (el as HTMLElement).dataset.provider === provider ? "" : "none";
                        });
                    }}
                  >
                    ${provider}
                  </button>
                `,
              )}
              <div class="platform-model-add__sidebar-spacer"></div>
              <button
                type="button"
                class="platform-model-add__sidebar-item platform-model-add__sidebar-item--add"
                @click=${(event: Event) => {
                  const sidebar = (event.currentTarget as HTMLElement).closest(
                    ".platform-model-add__sidebar",
                  );
                  if (!sidebar) {
                    return;
                  }
                  const name = prompt("请输入服务商名称（如：硅基流动、火山方舟）");
                  if (!name || !name.trim()) {
                    return;
                  }
                  const providerName = name.trim();
                  const layout = sidebar.closest(".platform-model-add__layout");
                  const main = layout?.querySelector(".platform-model-add__main");
                  if (!layout || !main) {
                    return;
                  }
                  const panel = document.createElement("div");
                  panel.className = "platform-model-add__provider-panel";
                  panel.dataset.provider = providerName;
                  panel.style.display = "none";
                  panel.innerHTML = `<div class="platform-model-add__provider-header"><strong>${providerName}</strong></div><label class="field"><span>API 密钥</span><input type="password" name="apiKey" placeholder="sk-..." autocomplete="off" /></label><label class="field"><span>API 地址</span><input name="baseUrl" placeholder="https://api.example.com/v1" /></label><div class="platform-model-add__models-header"><span>模型</span><span class="muted">输入模型 ID 后回车添加</span></div><div class="platform-model-add__models-list"><div class="platform-model-add__model-row platform-model-add__model-row--input"><input type="text" class="platform-model-add__manual-input" placeholder="输入模型 ID，回车添加" /></div></div>`;
                  const hiddenFields = main.querySelector('input[type="hidden"]');
                  if (hiddenFields) {
                    main.insertBefore(panel, hiddenFields);
                  } else {
                    main.appendChild(panel);
                  }
                  const manualInput = panel.querySelector(
                    ".platform-model-add__manual-input",
                  ) as HTMLInputElement;
                  if (manualInput) {
                    manualInput.addEventListener("keydown", (e) => {
                      if (e.key !== "Enter") {
                        return;
                      }
                      e.preventDefault();
                      const val = manualInput.value.trim();
                      if (!val) {
                        return;
                      }
                      const form = panel.closest("form");
                      if (form) {
                        const pi = form.querySelector<HTMLInputElement>('[name="providerId"]');
                        const mi = form.querySelector<HTMLInputElement>('[name="modelId"]');
                        const ni = form.querySelector<HTMLInputElement>('[name="name"]');
                        if (pi) {
                          pi.value = providerName;
                        }
                        if (mi) {
                          mi.value = val;
                        }
                        if (ni) {
                          ni.value = val;
                        }
                      }
                      const list = panel.querySelector(".platform-model-add__models-list");
                      const row = document.createElement("div");
                      row.className = "platform-model-add__model-row";
                      row.innerHTML = `<span class="platform-model-add__model-id">${providerName}/${val}</span><label class="platform-model-add__toggle"><input type="checkbox" checked /><span></span></label><button type="button" class="platform-model-add__delete-btn" title="删除">✕</button>`;
                      row
                        .querySelector(".platform-model-add__delete-btn")
                        ?.addEventListener("click", () => row.remove());
                      list?.insertBefore(
                        row,
                        manualInput.closest(".platform-model-add__model-row--input"),
                      );
                      manualInput.value = "";
                    });
                  }
                  const newItem = document.createElement("button");
                  newItem.type = "button";
                  newItem.className = "platform-model-add__sidebar-item";
                  newItem.textContent = providerName;
                  const spacer = sidebar.querySelector(".platform-model-add__sidebar-spacer");
                  if (spacer) {
                    sidebar.insertBefore(newItem, spacer);
                  }
                  newItem.addEventListener("click", () => {
                    layout
                      .querySelectorAll(".platform-model-add__sidebar-item")
                      .forEach((el) => el.classList.remove("is-active"));
                    newItem.classList.add("is-active");
                    layout.querySelectorAll(".platform-model-add__provider-panel").forEach((el) => {
                      (el as HTMLElement).style.display =
                        (el as HTMLElement).dataset.provider === providerName ? "" : "none";
                    });
                  });
                  sidebar
                    .querySelectorAll(".platform-model-add__sidebar-item")
                    .forEach((el) => el.classList.remove("is-active"));
                  newItem.classList.add("is-active");
                  main.querySelectorAll(".platform-model-add__provider-panel").forEach((el) => {
                    (el as HTMLElement).style.display =
                      (el as HTMLElement).dataset.provider === providerName ? "" : "none";
                  });
                  const form = sidebar.closest("form");
                  if (form) {
                    const pi = form.querySelector<HTMLInputElement>('[name="providerId"]');
                    if (pi) {
                      pi.value = providerName;
                    }
                  }
                  setTimeout(() => {
                    const apiKey = panel.querySelector<HTMLInputElement>('input[type="password"]');
                    if (apiKey) {
                      apiKey.focus();
                    }
                  }, 50);
                }}
              >
                + 添加服务商
              </button>
            </nav>

            <!-- Right: Config panel per provider -->
            <div class="platform-model-add__main">
              ${providerNames.map(
                (provider, providerIndex) => html`
                  <div
                    class="platform-model-add__provider-panel"
                    data-provider=${provider}
                    style=${providerIndex === 0 ? "" : "display:none"}
                  >
                    <div class="platform-model-add__provider-header">
                      <strong>${provider}</strong>
                    </div>

                    <label class="field">
                      <span>API 密钥</span>
                      <input
                        type="password"
                        name="apiKey"
                        placeholder="sk-..."
                        autocomplete="off"
                      />
                    </label>

                    <label class="field">
                      <span>API 地址</span>
                      <input name="baseUrl" placeholder="https://api.openai.com/v1" />
                    </label>

                    <div class="platform-model-add__models-header">
                      <span>模型</span>
                      <span class="muted">点击开关启用模型</span>
                    </div>

                    <div class="platform-model-add__models-list">
                      ${(providerGroups.get(provider) ?? []).map(
                        (model) => html`
                          <div class="platform-model-add__model-row">
                            <span class="platform-model-add__model-id"
                              >${model.provider}/${model.id}</span
                            >
                            <span class="platform-model-add__list-tags">
                              ${model.tags.slice(0, 2).map((tag) => html`<span class="platform-model-add__tag">${tag}</span>`)}
                            </span>
                            <label class="platform-model-add__toggle">
                              <input
                                type="checkbox"
                                @change=${(event: Event) => {
                                  const checked = (event.currentTarget as HTMLInputElement).checked;
                                  if (!checked) {
                                    return;
                                  }
                                  fillFormFromModel(model, event);
                                }}
                              />
                              <span></span>
                            </label>
                          </div>
                        `,
                      )}
                      <div
                        class="platform-model-add__model-row platform-model-add__model-row--input"
                      >
                        <input
                          type="text"
                          class="platform-model-add__manual-input"
                          placeholder="输入模型 ID，回车添加"
                          @keydown=${(event: KeyboardEvent) => {
                            if (event.key !== "Enter") {
                              return;
                            }
                            event.preventDefault();
                            const input = event.currentTarget as HTMLInputElement;
                            const value = input.value.trim();
                            if (!value) {
                              return;
                            }
                            const form = input.closest("form");
                            if (!form) {
                              return;
                            }
                            const parts = value.includes("/")
                              ? value.split("/")
                              : [provider, value];
                            const providerInput =
                              form.querySelector<HTMLInputElement>('[name="providerId"]');
                            const modelIdInput =
                              form.querySelector<HTMLInputElement>('[name="modelId"]');
                            const nameInput = form.querySelector<HTMLInputElement>('[name="name"]');
                            if (providerInput) {
                              providerInput.value = parts[0];
                            }
                            if (modelIdInput) {
                              modelIdInput.value = parts.slice(1).join("/") || value;
                            }
                            if (nameInput) {
                              nameInput.value = parts.slice(1).join("/") || value;
                            }
                            input.value = "";
                          }}
                        />
                      </div>
                    </div>
                  </div>
                `,
              )}

              <!-- Hidden identity fields; params stay unknown until catalog/admin confirms. -->
              <input type="hidden" name="providerId" />
              <input type="hidden" name="name" />
              <input type="hidden" name="modelId" />
              <input type="hidden" name="api" value="openai-responses" />
              <input type="hidden" name="inputModes" value="" />
              <input type="hidden" name="contextWindow" value="" />
              <input type="hidden" name="maxTokens" value="" />
              <input type="hidden" name="callType" value="text_chat" />
              <input type="hidden" name="reasoning" />

              <div class="row row--end row--tight row--footer">
                <button class="btn btn--sm" type="button" @click=${closeAddModelDialog}>
                  取消
                </button>
                <button class="btn" type="submit" name="intent" value="save" ?disabled=${!canManage}>
                  保存配置
                </button>
                <button class="btn btn--primary" type="submit" name="intent" value="verify" ?disabled=${!canManage}>
                  验证连接
                </button>
              </div>
            </div>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderCompatWorkbench(
  compat: LegacyPlatformModelsVM | null | undefined,
  actions: PlatformModelsActions,
) {
  if (!compat) {
    return html``;
  }
  return html`
    <details class="platform-disclosure card-follow">
      <summary class="platform-disclosure__summary">
        <div>
          <div class="card-title">历史资产维护视图</div>
        </div>
        <span class="chip">兼容区</span>
      </summary>
      ${renderModelPoolSection(compat, { models: actions } as never)}
      ${renderModelCatalogSection(compat, { models: actions } as never)}
      ${renderModelProviderHealthSection(compat)}
      ${renderModelProviderSection(compat, { models: actions } as never)}
    </details>
  `;
}

export type ModelAssetsSectionProps = {
  vm: ModelAssetsVM;
  actions: PlatformModelsActions;
  compat?: LegacyPlatformModelsVM | null;
  onNavigateTab: (tab: OverviewNavigateTab, context?: PlatformModelsTabContext) => void;
  context?: PlatformModelsTabContext;
  onToggleRecommendationPool?: (modelId: string, nextValue: boolean) => void;
  /**
   * True while the models-management snapshot has not resolved yet (initial
   * fetch pending or in flight). Used to render a loading placeholder instead
   * of the empty-state bootstrap page, which otherwise flashes on refresh
   * because `emptyState` is derived purely from `models.length === 0`.
   */
  loading?: boolean;
};

/**
 * Loading placeholder shown while the first snapshot is still loading. Mirrors
 * the assets surface shell (summary cards + table) so the layout does not jump
 * when real data arrives.
 */
function renderModelAssetsLoading() {
  const placeholderCards = [
    "模型总数",
    "活跃模型 (7天)",
    "健康模型",
    "不健康模型",
    "平均成本（输入/1K tokens）",
    "平均延迟",
  ];
  return html`
    <section class="platform-model-assets-surface" aria-busy="true">
      <div class="stat-grid stat-grid--compact platform-model-assets-summary">
        ${placeholderCards.map(
          (label) => html`
            <div class="stat stat--compact">
              <div class="stat-label">${label}</div>
              <div class="stat-value muted">—</div>
            </div>
          `,
        )}
      </div>
      <div class="callout card-follow">正在加载模型资产…</div>
    </section>
  `;
}

function renderPendingConnectSection(params: {
  models: ModelAsset[];
  actions: PlatformModelsActions;
}) {
  const { models, actions } = params;
  if (models.length === 0) {
    return nothing;
  }
  return html`
    <section class="stack card-follow" data-testid="model-pending-connect">
      <div class="card-title">尚未连通</div>
      <div class="callout">
        这些模型还没有通过连接验证，不会进入模型池。请先验证连接，成功后再入池。
      </div>
      <div class="enterprise-data-table-wrap">
        <table class="enterprise-data-table platform-model-assets-table">
          <thead>
            <tr>
              <th>模型名称</th>
              <th>Provider</th>
              <th>接入</th>
              <th>健康</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${models.map((asset) => {
              const connected = hasSuccessfulModelConnection(asset);
              return html`
                <tr>
                  <td>${asset.displayName}</td>
                  <td>${asset.providerName ?? asset.providerId}</td>
                  <td>
                    <span class="chip ${connected ? "chip-warn" : ""}"
                      >${connected ? "待入池" : "未连通"}</span
                    >
                  </td>
                  <td class="platform-model-assets-table__col-health">${renderHealthSummary(asset)}</td>
                  <td>
                    <div class="platform-model-assets-row-actions">
                      ${
                        connected
                          ? html`
                              <button
                                class="platform-model-assets-row-actions__text"
                                type="button"
                                data-testid="model-pool-import"
                                data-model-id=${asset.modelId}
                                @click=${() => void importPendingModel(asset, actions)}
                              >
                                入池
                              </button>
                            `
                          : html`
                              <button
                                class="platform-model-assets-row-actions__text"
                                type="button"
                                data-testid="model-connect-verify"
                                data-model-id=${asset.modelId}
                                @click=${() => void verifyPendingModel(asset, actions)}
                              >
                                验证连接
                              </button>
                            `
                      }
                      <button
                        class="platform-model-assets-row-actions__text"
                        type="button"
                        @click=${() => updateFilterState({ selectedModelId: asset.modelId })}
                      >
                        详情
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
  `;
}

export function renderModelAssetsSection(props: ModelAssetsSectionProps) {
  const { vm, actions, compat, onNavigateTab, context, onToggleRecommendationPool, loading } =
    props;
  ensureFilterDefaults(vm.defaultSort);
  syncModelAssetsContext(context);
  // While the first snapshot is still loading and we have no models yet, show a
  // loading placeholder rather than the empty-state bootstrap page. This avoids
  // the two-phase flash (empty page → table) on refresh. If data already exists
  // (a background refresh), keep the current table instead of blanking it.
  if (loading && vm.models.length === 0) {
    return renderModelAssetsLoading();
  }
  const matchedModels = filterAndSortModels(vm);
  const poolUniverse = vm.models.filter((asset) => isManagedPoolModel(asset));
  const visiblePool = matchedModels.filter((asset) => isManagedPoolModel(asset));
  const visiblePending = matchedModels.filter((asset) => !isManagedPoolModel(asset));
  const selectedModel =
    matchedModels.find((asset) => asset.modelId === modelAssetsFilterState.selectedModelId) ??
    vm.models.find((asset) => asset.modelId === modelAssetsFilterState.selectedModelId) ??
    null;
  const canManage = compat?.canManage ?? true;
  if (vm.emptyState) {
    return html`
      ${renderBootstrapEntry({
        emptyState: vm.emptyState,
        actions,
        compat,
        onNavigateTab,
      })}
      ${renderCompatWorkbench(compat, actions)}
    `;
  }

  return html`
    <section class="platform-model-assets-surface">
      ${renderSummaryCards(poolUniverse, vm)}
      ${renderFilterBar(vm, visiblePool.length, poolUniverse.length)}
      ${
        context?.actionHint
          ? html`<div class="callout card-follow--sm">${actionHintCallout(context)}</div>`
          : ""
      }
      <div class="enterprise-data-table-wrap platform-model-assets-table-wrap">
        <table
          class="enterprise-data-table platform-model-assets-table"
          data-testid="model-pool-table"
        >
          <thead>
            <tr>
              <th class="platform-model-assets-table__col-model">模型名称</th>
              <th class="platform-model-assets-table__col-provider">Provider</th>
              <th class="platform-model-assets-table__col-state">接入</th>
              <th class="platform-model-assets-table__col-input">输入类型</th>
              <th class="platform-model-assets-table__col-output">输出类型</th>
              <th class="platform-model-assets-table__col-capability">能力</th>
              <th class="platform-model-assets-table__col-context">上下文</th>
              <th class="platform-model-assets-table__col-cost">成本档位</th>
              <th class="platform-model-assets-table__col-health">健康</th>
              <th class="platform-model-assets-table__col-calls">7 日调用</th>
              <th class="platform-model-assets-table__col-cost7d">7 日成本</th>
              <th class="platform-model-assets-table__col-action">操作</th>
            </tr>
          </thead>
          <tbody>
            ${
              visiblePool.length === 0
                ? html`
                    <tr>
                      <td colspan="12">
                        <div
                          class="callout card-follow--sm card-lead"
                          data-testid=${visiblePending.length === 0 && vm.models.length > 0 ? "model-assets-filter-empty" : "model-pool-empty"}
                        >
                          ${
                            visiblePending.length === 0 && vm.models.length > 0
                              ? "当前筛选条件下没有匹配的模型。"
                              : "模型池里还没有已连通的模型。请先完成连接验证，成功后再入池。"
                          }
                          ${
                            visiblePending.length === 0 && vm.models.length > 0
                              ? html`
                                  <button
                                    class="btn btn--sm inline-start-gap"
                                    type="button"
                                    @click=${() => resetFilterState(vm.defaultSort)}
                                  >
                                    清空筛选
                                  </button>
                                `
                              : nothing
                          }
                        </div>
                      </td>
                    </tr>
                  `
                : visiblePool.map(
                    (asset) => html`
                      <tr
                        class=${[
                          context?.suggestedModelId === asset.modelId
                            ? "platform-model-assets-table__row--suggested"
                            : "",
                          context?.sourceModelId === asset.modelId
                            ? "platform-model-assets-table__row--source"
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <td class="platform-model-assets-table__col-model">
                          <div class="platform-model-assets-table__model-cell">
                            <span class="platform-model-assets-table__avatar"
                              >${asset.displayName.slice(0, 2).toUpperCase()}</span
                            >
                            <div>
                              <div
                                class="platform-model-assets-table__model-name"
                                title=${asset.modelId}
                              >
                                ${asset.displayName}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td class="platform-model-assets-table__col-provider">
                          <div
                            class="platform-model-assets-table__primary"
                            title=${asset.providerName ?? asset.providerId}
                          >
                            ${asset.providerName ?? asset.providerId}
                          </div>
                        </td>
                        <td class="platform-model-assets-table__col-state">
                          <span class="chip chip-ok">已入池</span>
                        </td>
                        <td class="platform-model-assets-table__col-input">
                          <div class="platform-model-assets-table__primary">
                            ${asset.inputModalities.join("、") || "—"}
                          </div>
                        </td>
                        <td class="platform-model-assets-table__col-output">
                          <div class="platform-model-assets-table__primary">
                            ${asset.outputModalities.join("、") || "—"}
                          </div>
                        </td>
                        <td class="platform-model-assets-table__col-capability">
                          ${renderCapabilitySummary(asset.capabilities, asset.capabilityEvidence)}
                        </td>
                        <td class="platform-model-assets-table__col-context">
                          <div
                            class=${`platform-model-assets-table__metric${asset.contextWindow ? "" : " is-muted"}`}
                          >
                            ${contextWindowLabel(asset.contextWindow)}
                          </div>
                        </td>
                        <td class="platform-model-assets-table__col-cost">
                          <span class="platform-model-assets-cost-tier ${asset.costTier}"
                            >${costTierLabel(asset.costTier)}</span
                          >
                        </td>
                        <td class="platform-model-assets-table__col-health">
                          ${renderHealthSummary(asset)}
                        </td>
                        <td class="platform-model-assets-table__col-calls">
                          <div
                            class=${`platform-model-assets-table__metric${asset.usage7d ? "" : " is-muted"}`}
                          >
                            ${asset.usage7d ? `${asset.usage7d.calls}` : "未接入"}
                          </div>
                        </td>
                        <td class="platform-model-assets-table__col-cost7d">
                          <div
                            class=${`platform-model-assets-table__metric${asset.usage7d ? "" : " is-muted"}`}
                          >
                            ${asset.usage7d ? formatCost(asset.usage7d.cost) : "-"}
                          </div>
                        </td>
                        <td class="platform-model-assets-table__col-action">
                          <div class="platform-model-assets-row-actions">
                            <button
                              class="platform-model-assets-row-actions__text"
                              title="查看详情"
                              type="button"
                              @click=${() => updateFilterState({ selectedModelId: asset.modelId })}
                            >
                              详情
                            </button>
                          </div>
                        </td>
                      </tr>
                    `,
                  )
            }
          </tbody>
        </table>
      </div>
      ${renderPendingConnectSection({ models: visiblePending, actions })}
    </section>
    ${renderActionPrefillPanel(vm, context, onNavigateTab)}
    ${addModelDialogOpen ? renderAddModelWorkbench({ actions, compat, onNavigateTab }) : ""}
    ${renderModelDetailDrawer({
      selectedModel,
      actions,
      canManage,
      onToggleRecommendationPool,
      onNavigateTab,
      context,
    })}
  `;
}
