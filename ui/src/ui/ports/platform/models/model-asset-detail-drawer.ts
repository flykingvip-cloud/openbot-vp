import { html, nothing } from "lit";
import { formatCost } from "../../../views/usage-metrics.ts";
import type { PlatformModelsActions } from "./actions.ts";
import {
  importAssetIntoPool,
  lifecycleActionLabel,
  localModelIdFromAsset,
  primaryLifecycleAction,
  publishAssetToAllowlist,
  resolveModelAssetCanManage,
} from "./model-asset-actions.ts";
import {
  lifecycleStageLabel,
  resolveModelAssetLifecycleStage,
  resolveModelAssetPresentation,
  tenantSelectableLabel,
  type ModelAssetLifecycleStage,
} from "./model-asset-presentation.ts";
import { hasSuccessfulModelConnection } from "./model-connection-gate.ts";
import type { ModelAsset, PlatformModelsTabContext } from "./view-model.ts";

type OverviewNavigateTab =
  | "overview"
  | "taskPlans"
  | "smartRouting"
  | "usageAnalytics"
  | "governance";

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

function lifecycleStageChipClass(stage: ModelAssetLifecycleStage): string {
  switch (stage) {
    case "published":
    case "configured":
      return "chip-ok";
    case "referenced":
    case "pending":
      return "chip-warn";
  }
}

function renderScopeBadges(badges: readonly string[]) {
  if (badges.length === 0) {
    return nothing;
  }
  return html`
    ${badges.map(
      (badge) => html`<span class="platform-model-assets-table__scope-badge">${badge}</span>`,
    )}
  `;
}

function renderKvRow(label: string, value: unknown) {
  if (value == null || value === "") {
    return nothing;
  }
  return html`
    <div class="platform-model-detail-kv__row">
      <dt>${label}</dt>
      <dd>${value}</dd>
    </div>
  `;
}

function renderPrimaryAction(params: {
  asset: ModelAsset;
  stage: ModelAssetLifecycleStage;
  actions: PlatformModelsActions;
  canManage: boolean;
  saving: boolean;
  onSavingChange: (next: boolean) => void;
}) {
  const { asset, stage, actions, canManage, saving, onSavingChange } = params;
  const primary = primaryLifecycleAction(stage);
  if (primary === "done") {
    return html`<span class="chip ok">${lifecycleActionLabel(asset)}</span>`;
  }
  const connected = hasSuccessfulModelConnection(asset);
  const label = primary === "import" ? (connected ? "入池" : "验证连接") : "上架";
  const helper =
    primary === "import"
      ? connected
        ? "写入 Provider 并加入 allowlist"
        : "先验证连接，成功后再入池"
      : "加入 agents.defaults.models，租户可见";
  return html`
    <div class="platform-model-detail__primary-action">
      <button
        class="btn btn--primary btn--sm"
        type="button"
        data-testid="model-detail-primary-action"
        ?disabled=${!canManage || saving}
        title=${canManage ? helper : "当前会话没有配置写入权限"}
        @click=${async () => {
          if (!canManage || saving) {
            return;
          }
          onSavingChange(true);
          try {
            if (primary === "import" && !hasSuccessfulModelConnection(asset)) {
              await actions.onProbeHealth?.({
                provider: asset.providerId,
                modelRef: asset.modelId,
              });
              return;
            }
            if (primary === "import") {
              await importAssetIntoPool({ asset, actions, connectionVerified: true });
            } else {
              await publishAssetToAllowlist({ asset, actions });
            }
          } finally {
            onSavingChange(false);
          }
        }}
      >
        ${saving ? "保存中…" : label}
      </button>
      <span class="muted platform-model-detail__primary-hint">${helper}</span>
    </div>
  `;
}

export type ModelAssetDetailDrawerProps = {
  selectedModel: ModelAsset | null;
  actions: PlatformModelsActions;
  compatCanManage?: boolean;
  saving?: boolean;
  onSavingChange: (next: boolean) => void;
  onClose: () => void;
  onNavigateTab: (tab: OverviewNavigateTab, context?: PlatformModelsTabContext) => void;
  context?: PlatformModelsTabContext;
};

export function renderModelAssetDetailDrawer(props: ModelAssetDetailDrawerProps) {
  const {
    selectedModel,
    actions,
    compatCanManage,
    saving = false,
    onSavingChange,
    onClose,
    onNavigateTab,
    context,
  } = props;
  if (!selectedModel) {
    return nothing;
  }

  const lifecycleStage = resolveModelAssetLifecycleStage(selectedModel);
  const presentation = resolveModelAssetPresentation({
    name: selectedModel.displayName,
    modelId: localModelIdFromAsset(selectedModel),
    providerId: selectedModel.providerId,
    providerName: selectedModel.providerName,
  });
  const subtitle = selectedModel.displaySubtitle ?? presentation.subtitle;
  const badges = selectedModel.scopeBadges ?? presentation.badges;
  const canManage = resolveModelAssetCanManage({ compatCanManage, actions });
  const hasUsage = selectedModel.usage7d != null;
  const priceLabel =
    selectedModel.inputPrice != null && selectedModel.outputPrice != null
      ? `$${selectedModel.inputPrice} / $${selectedModel.outputPrice} per 1M tokens`
      : null;

  return html`
    <div class="model-assets-drawer-overlay" role="dialog" aria-modal="true" @click=${onClose}>
      <aside
        class="model-assets-drawer model-assets-drawer--flat"
        @click=${(event: Event) => event.stopPropagation()}
      >
        <div class="model-assets-drawer__header">
          <div class="card-title">模型详情</div>
          <button class="btn btn--sm" type="button" @click=${onClose}>关闭</button>
        </div>

        <div class="platform-model-detail__hero">
          <span class="platform-model-assets-table__avatar"
            >${selectedModel.avatarLabel ?? presentation.avatarLabel}</span
          >
          <div class="platform-model-detail__hero-main">
            <div class="model-assets-drawer__title">${selectedModel.displayName}</div>
            <div class="model-assets-drawer__sub">${subtitle}</div>
            <div class="model-assets-drawer__sub muted">${selectedModel.modelId}</div>
            <div class="chip-row platform-model-detail__chips">
              <span class="chip ${lifecycleStageChipClass(lifecycleStage)}"
                >${lifecycleStageLabel(lifecycleStage)}</span
              >
              ${renderScopeBadges(badges)}
              <span class="chip">${healthLabel(selectedModel.health)}</span>
            </div>
          </div>
        </div>

        ${
          !canManage
            ? html`
                <div class="callout warn platform-model-detail__readonly">
                  当前会话为只读，无法执行入池或上架。请使用具备平台配置权限的账号。
                </div>
              `
            : nothing
        }
        ${renderPrimaryAction({
          asset: selectedModel,
          stage: lifecycleStage,
          actions,
          canManage,
          saving,
          onSavingChange,
        })}

        <dl class="platform-model-detail-kv">
          ${renderKvRow("生命周期", `${lifecycleStageLabel(lifecycleStage)} · ${modelSourceLabel(selectedModel.source)}`)}
          ${renderKvRow("推荐池", selectedModel.inRecommendationPool ? "已加入 allowlist" : "未加入")}
          ${renderKvRow("租户可选", tenantSelectableLabel(selectedModel))}
          ${renderKvRow("Provider", selectedModel.providerName ?? selectedModel.providerId)}
          ${renderKvRow(
            "健康",
            `${healthLabel(selectedModel.health)} · ${healthBasisLabel(selectedModel.healthBasis)}`,
          )}
          ${renderKvRow("健康说明", selectedModel.healthNote)}
          ${renderKvRow(
            "最近探测",
            selectedModel.liveProbe
              ? `${healthBasisLabel(selectedModel.healthBasis)}${selectedModel.liveProbe.latencyMs != null ? ` · ${selectedModel.liveProbe.latencyMs}ms` : ""}`
              : "尚未执行",
          )}
          ${renderKvRow(
            "输入 / 输出",
            `${selectedModel.inputModalities.join(", ") || "—"} → ${selectedModel.outputModalities.join(", ") || "—"}`,
          )}
          ${renderKvRow("能力", selectedModel.capabilities.join(", ") || "未声明")}
          ${renderKvRow("上下文", contextWindowLabel(selectedModel.contextWindow))}
          ${renderKvRow(
            "最大输出",
            selectedModel.maxOutputTokens ? String(selectedModel.maxOutputTokens) : null,
          )}
          ${renderKvRow("成本档位", costTierLabel(selectedModel.costTier))}
          ${renderKvRow("定价", priceLabel)}
          ${
            hasUsage
              ? renderKvRow(
                  "7 日用量",
                  `${selectedModel.usage7d?.calls ?? 0} 次 · ${formatCost(selectedModel.usage7d?.cost ?? 0)}`,
                )
              : nothing
          }
          ${
            selectedModel.avgLatencyMs != null
              ? renderKvRow("平均延迟", `${selectedModel.avgLatencyMs}ms`)
              : nothing
          }
          ${
            selectedModel.taskTags.length > 0
              ? renderKvRow("任务标签", selectedModel.taskTags.join(", "))
              : nothing
          }
          ${
            selectedModel.governance?.issueCount
              ? renderKvRow(
                  "治理问题",
                  `${selectedModel.governance.issueCount} 个 · 最高 ${selectedModel.governance.highestSeverity ?? "info"}`,
                )
              : nothing
          }
        </dl>

        <div class="platform-model-detail__links row">
          <button
            class="btn btn--sm"
            type="button"
            ?disabled=${!actions.onProbeHealth}
            @click=${() => actions.onProbeHealth?.()}
          >
            探测可用性
          </button>
          <button
            class="btn btn--sm"
            type="button"
            @click=${() => onNavigateTab("usageAnalytics", { modelId: selectedModel.modelId })}
          >
            使用分析
          </button>
          ${
            selectedModel.governance?.issueCount
              ? html`
                  <button
                    class="btn btn--sm"
                    type="button"
                    @click=${() => onNavigateTab("governance", { modelId: selectedModel.modelId })}
                  >
                    治理告警
                  </button>
                `
              : nothing
          }
        </div>

        ${
          context?.actionHint
            ? html`
                <div class="callout info platform-model-detail__hint">
                  ${
                    context.actionHint === "replace_model"
                      ? "从 Issues 跳转：请评估是否替换此模型。"
                      : context.actionHint === "add_fallback"
                        ? "从 Issues 跳转：请评估是否补充 fallback。"
                        : "从 Issues 跳转：请检查路由策略。"
                  }
                  ${
                    context.sourceModelId && context.sourceModelId !== selectedModel.modelId
                      ? html`<div class="card-follow--xs">
                          原问题模型：${context.sourceModelId}
                        </div>`
                      : nothing
                  }
                </div>
              `
            : nothing
        }
      </aside>
    </div>
  `;
}
